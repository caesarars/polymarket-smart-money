import { Market } from "@prisma/client";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { alertsQueue } from "../jobs/queues";
import { marketService } from "../markets/market.service";
import { dataClient } from "../polymarket/data.client";
import { DataTrade } from "../polymarket/polymarket.types";
import { walletScoring } from "../wallets/wallet.scoring";
import { walletService } from "../wallets/wallet.service";

export interface PipelineOptions {
  /** How many markets to upsert from the Gamma API. */
  marketLimit?: number;
  /** How many of the top active markets to crawl for trades / holders. */
  topMarkets?: number;
  /** How many trades to fetch per market. */
  tradesPerMarket?: number;
  /** How many holders to fetch per market for wallet discovery. */
  holdersPerMarket?: number;
  /** How many recent activity rows to fetch per newly-discovered wallet. */
  activityPerWallet?: number;
  /** Override SMART_WALLET_SCORE_THRESHOLD for this run. */
  scoreThreshold?: number;
}

export interface PipelineSummary {
  marketsSynced: number;
  marketsCrawled: number;
  tradesFetched: number;
  tradesInserted: number;
  tradesSkippedDuplicate: number;
  newWallets: number;
  walletsScored: number;
  smartWallets: number;
  alertsEnqueued: number;
}

export class PipelineService {
  /**
   * Run one full MVP pass:
   *   1. Sync active markets from Gamma.
   *   2. For each top market, fetch trades + holders and ingest trades.
   *   3. Score every wallet we touched.
   *   4. For each smart wallet (smartScore >= threshold), enqueue an alert job
   *      per market it just entered (AlertLog dedupes downstream).
   */
  async runOnce(opts: PipelineOptions = {}): Promise<PipelineSummary> {
    const cfg = {
      marketLimit: opts.marketLimit ?? 200,
      topMarkets: opts.topMarkets ?? 20,
      tradesPerMarket: opts.tradesPerMarket ?? 100,
      holdersPerMarket: opts.holdersPerMarket ?? 25,
      activityPerWallet: opts.activityPerWallet ?? 25,
      scoreThreshold: opts.scoreThreshold ?? env.SMART_WALLET_SCORE_THRESHOLD,
    };

    logger.info({ cfg }, "Pipeline.runOnce: starting");

    // --- 1. Sync markets ---
    const { synced: marketsSynced } = await marketService.syncActiveMarkets(
      cfg.marketLimit,
    );

    const topMarkets = await marketService.getActiveMarkets(cfg.topMarkets);
    logger.info(
      { count: topMarkets.length },
      "Pipeline: top active markets selected",
    );

    // --- 2. Crawl each market: trades (primary) + holders (discovery) ---
    let tradesFetched = 0;
    let tradesInserted = 0;
    let tradesSkippedDuplicate = 0;
    const newWalletSet = new Set<string>();
    /** wallet address -> set of internal Market.id values touched across all markets */
    const touched = new Map<string, Set<string>>();
    const fetchedHolders = new Map<string, string[]>();

    for (const market of topMarkets) {
      const trades = await this.fetchMarketTrades(market, cfg.tradesPerMarket);
      tradesFetched += trades.length;

      const result = await walletService.ingestTrades(trades);
      tradesInserted += result.inserted;
      tradesSkippedDuplicate += result.skippedDuplicates;
      for (const w of result.newWallets) newWalletSet.add(w);
      for (const [address, marketIds] of result.touched) {
        let set = touched.get(address);
        if (!set) {
          set = new Set<string>();
          touched.set(address, set);
        }
        for (const id of marketIds) set.add(id);
      }

      const holders = await this.fetchMarketHolders(
        market,
        cfg.holdersPerMarket,
      );
      if (holders.length > 0) fetchedHolders.set(market.id, holders);
    }

    // --- 2b. Wallet discovery via holders: ingest recent activity for unseen wallets ---
    const unseenFromHolders = new Set<string>();
    for (const list of fetchedHolders.values()) {
      for (const addr of list) {
        if (!addr) continue;
        if (touched.has(addr)) continue;
        const exists = await prisma.wallet.findUnique({
          where: { address: addr },
          select: { address: true },
        });
        if (!exists) unseenFromHolders.add(addr);
      }
    }

    for (const addr of unseenFromHolders) {
      const result = await walletService.ingestRecentActivityForWallet(
        addr,
        cfg.activityPerWallet,
      );
      tradesInserted += result.inserted;
      tradesSkippedDuplicate += result.skippedDuplicates;
      for (const w of result.newWallets) newWalletSet.add(w);
      for (const [address, marketIds] of result.touched) {
        let set = touched.get(address);
        if (!set) {
          set = new Set<string>();
          touched.set(address, set);
        }
        for (const id of marketIds) set.add(id);
      }
    }

    // --- 3. Score every wallet we touched in this run ---
    let walletsScored = 0;
    for (const address of touched.keys()) {
      try {
        await walletScoring.scoreWallet(address);
        walletsScored += 1;
      } catch (err) {
        logger.error(
          { err, address },
          "Pipeline: scoring failed for wallet",
        );
      }
    }

    // --- 4. Enqueue alerts for smart wallets on markets they just entered ---
    let smartWallets = 0;
    let alertsEnqueued = 0;

    for (const [address, marketIds] of touched) {
      const wallet = await prisma.wallet.findUnique({
        where: { address },
        select: { address: true, smartScore: true },
      });
      if (!wallet) continue;
      if (wallet.smartScore < cfg.scoreThreshold) continue;
      smartWallets += 1;

      for (const marketId of marketIds) {
        const alreadyAlerted = await prisma.alertLog.findUnique({
          where: {
            walletAddress_marketId: { walletAddress: address, marketId },
          },
          select: { id: true },
        });
        if (alreadyAlerted) continue;

        const trade = await walletService.getEarliestTradeForMarket(
          address,
          marketId,
        );
        if (!trade) continue;

        try {
          await alertsQueue.add(
            "alert",
            {
              walletAddress: address,
              marketId,
              tradeId: trade.id,
            },
            {
              // Deterministic jobId: prevents a hot loop from enqueueing the
              // same alert many times in a single run.
              jobId: `alert:${address}:${marketId}`,
            },
          );
          alertsEnqueued += 1;
        } catch (err) {
          logger.error(
            { err, address, marketId },
            "Pipeline: failed to enqueue alert",
          );
        }
      }
    }

    const summary: PipelineSummary = {
      marketsSynced,
      marketsCrawled: topMarkets.length,
      tradesFetched,
      tradesInserted,
      tradesSkippedDuplicate,
      newWallets: newWalletSet.size,
      walletsScored,
      smartWallets,
      alertsEnqueued,
    };
    logger.info(summary, "Pipeline.runOnce: complete");
    return summary;
  }

  private async fetchMarketTrades(
    market: Market,
    limit: number,
  ): Promise<DataTrade[]> {
    if (!market.polymarketId) return [];
    const trades = await dataClient.getTrades({
      market: market.polymarketId,
      limit,
    });
    logger.debug(
      { marketId: market.id, polymarketId: market.polymarketId, count: trades.length },
      "Pipeline: fetched trades",
    );
    return trades;
  }

  private async fetchMarketHolders(
    market: Market,
    limit: number,
  ): Promise<string[]> {
    if (!market.polymarketId) return [];
    const holders = await dataClient.getHolders(market.polymarketId);
    const addresses: string[] = [];
    for (const h of holders.slice(0, limit)) {
      const raw = h.proxyWallet ?? h.wallet;
      if (typeof raw === "string") addresses.push(raw.toLowerCase());
    }
    return addresses;
  }
}

export const pipelineService = new PipelineService();
