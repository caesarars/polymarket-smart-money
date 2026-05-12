import { Prisma, Wallet, WalletTrade } from "@prisma/client";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { dataClient } from "../polymarket/data.client";
import { DataTrade } from "../polymarket/polymarket.types";

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function parseTimestamp(raw: unknown): Date {
  if (typeof raw === "number") {
    return new Date(raw > 10 ** 12 ? raw : raw * 1000);
  }
  if (typeof raw === "string") {
    if (/^\d+$/.test(raw)) {
      const n = Number(raw);
      return new Date(n > 10 ** 12 ? n : n * 1000);
    }
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function tradeWalletAddress(trade: DataTrade): string | null {
  const address = trade.proxyWallet ?? trade.wallet;
  if (!address || typeof address !== "string") return null;
  return address.toLowerCase();
}

export interface IngestResult {
  inserted: number;
  skippedDuplicates: number;
  newWallets: string[];
  /** Map of walletAddress -> set of internal Market.id values touched in this batch. */
  touched: Map<string, Set<string>>;
  insertedTradeIds: string[];
}

export class WalletService {
  /**
   * Ingest a batch of trades. Idempotent: skips trades that already exist
   * (matched by wallet+tokenId+timestamp+side+price+size). Returns which
   * (wallet, market) pairs were touched so callers can target alerts.
   */
  async ingestTrades(trades: DataTrade[]): Promise<IngestResult> {
    const newWallets: string[] = [];
    const touched = new Map<string, Set<string>>();
    const insertedTradeIds: string[] = [];
    let inserted = 0;
    let skippedDuplicates = 0;

    for (const trade of trades) {
      const address = tradeWalletAddress(trade);
      const tokenId = String(trade.asset ?? trade.tokenId ?? "").trim();
      if (!address || !tokenId) continue;

      const price = toNumber(trade.price);
      const size = toNumber(trade.size);
      if (price <= 0 || size <= 0) continue;
      const side = String(trade.side ?? "").toUpperCase() || "UNKNOWN";
      const timestamp = parseTimestamp(trade.timestamp);

      const conditionId =
        typeof trade.conditionId === "string" ? trade.conditionId : null;
      const marketIdRaw =
        typeof trade.market === "string" ? trade.market : null;
      const polymarketId = conditionId ?? marketIdRaw;

      const market = polymarketId
        ? await prisma.market.findUnique({ where: { polymarketId } })
        : null;

      const duplicate = await prisma.walletTrade.findFirst({
        where: {
          walletAddress: address,
          tokenId,
          timestamp,
          side,
          price,
          size,
        },
        select: { id: true },
      });
      if (duplicate) {
        skippedDuplicates += 1;
        continue;
      }

      const existing = await prisma.wallet.findUnique({
        where: { address },
        select: { address: true },
      });
      if (!existing) newWallets.push(address);

      try {
        const [, created] = await prisma.$transaction([
          prisma.wallet.upsert({
            where: { address },
            create: {
              address,
              firstSeenAt: timestamp,
              lastSeenAt: timestamp,
              totalVolume: price * size,
            },
            update: {
              lastSeenAt: timestamp,
              totalVolume: { increment: price * size },
            },
          }),
          prisma.walletTrade.create({
            data: {
              walletAddress: address,
              marketId: market?.id ?? null,
              tokenId,
              side,
              price,
              size,
              timestamp,
              rawJson: trade as unknown as Prisma.InputJsonValue,
            },
            select: { id: true, marketId: true },
          }),
        ]);
        inserted += 1;
        insertedTradeIds.push(created.id);

        if (created.marketId) {
          let set = touched.get(address);
          if (!set) {
            set = new Set<string>();
            touched.set(address, set);
          }
          set.add(created.marketId);
        }
      } catch (err) {
        logger.error(
          { err, address, tokenId },
          "WalletService.ingestTrades: insert failed",
        );
      }
    }

    if (inserted > 0 || skippedDuplicates > 0) {
      logger.info(
        {
          inserted,
          skippedDuplicates,
          newWallets: newWallets.length,
          touchedWallets: touched.size,
        },
        "WalletService: trades ingested",
      );
    }
    return { inserted, skippedDuplicates, newWallets, touched, insertedTradeIds };
  }

  /**
   * Pull recent activity from data API and ingest. Useful for backfilling
   * wallets we discovered via the holders endpoint.
   */
  async ingestRecentActivityForWallet(
    address: string,
    limit = 50,
  ): Promise<IngestResult> {
    const activity = await dataClient.getActivityByWallet(address, limit);
    const trades: DataTrade[] = activity
      .filter((a) => a.type === "TRADE" || a.price !== undefined)
      .map((a) => a as DataTrade);
    return this.ingestTrades(trades);
  }

  async getTopWallets(limit = 50): Promise<Wallet[]> {
    return prisma.wallet.findMany({
      orderBy: { smartScore: "desc" },
      take: limit,
    });
  }

  async getByAddress(address: string): Promise<Wallet | null> {
    return prisma.wallet.findUnique({
      where: { address: address.toLowerCase() },
    });
  }

  async getTradesByWallet(
    address: string,
    limit = 100,
  ): Promise<WalletTrade[]> {
    return prisma.walletTrade.findMany({
      where: { walletAddress: address.toLowerCase() },
      orderBy: { timestamp: "desc" },
      take: limit,
    });
  }

  /**
   * Detect markets a wallet has just entered (no earlier trades in the market).
   * Pass a `marketIds` set to scope detection to a specific batch.
   */
  async detectNewMarketEntries(
    address: string,
    opts: { sinceMs?: number; marketIds?: Set<string> } = {},
  ): Promise<WalletTrade[]> {
    const since = new Date(Date.now() - (opts.sinceMs ?? 15 * 60 * 1000));

    const recent = await prisma.walletTrade.findMany({
      where: {
        walletAddress: address.toLowerCase(),
        timestamp: { gte: since },
        ...(opts.marketIds
          ? { marketId: { in: Array.from(opts.marketIds) } }
          : {}),
        NOT: { marketId: null },
      },
      orderBy: { timestamp: "asc" },
    });

    const firstByMarket = new Map<string, WalletTrade>();
    for (const t of recent) {
      if (!t.marketId) continue;
      if (!firstByMarket.has(t.marketId)) firstByMarket.set(t.marketId, t);
    }

    const newEntries: WalletTrade[] = [];
    for (const [marketId, trade] of firstByMarket) {
      const earlier = await prisma.walletTrade.count({
        where: {
          walletAddress: address.toLowerCase(),
          marketId,
          timestamp: { lt: trade.timestamp },
        },
      });
      if (earlier === 0) newEntries.push(trade);
    }

    return newEntries;
  }

  /**
   * Earliest trade by a given wallet in a given market — used to anchor an alert
   * to a concrete trade row.
   */
  async getEarliestTradeForMarket(
    address: string,
    marketId: string,
  ): Promise<WalletTrade | null> {
    return prisma.walletTrade.findFirst({
      where: { walletAddress: address.toLowerCase(), marketId },
      orderBy: { timestamp: "asc" },
    });
  }
}

export const walletService = new WalletService();
