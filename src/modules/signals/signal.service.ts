import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { binanceService } from "../binance/binance.service";
import { telegramClient } from "../alerts/telegram.client";
import { discrepancyDetector } from "./discrepancy.detector";
import { BtcSignalOutput, PolymarketOdds } from "./signal.types";

export class SignalService {
  private oddsMap = new Map<string, PolymarketOdds>();
  private lastPersistedSnap = new Map<string, number>();
  private lastAlertSent = new Map<string, number>();

  /**
   * Ingest a live odds update from the Polymarket CLOB WebSocket.
   * `odds.tokenId` is the Polymarket asset_id (maps to Market.tokenYes/tokenNo).
   * We only persist snapshots every 5–10 seconds or when a large price move
   * is detected, to avoid DB write storms.
   */
  async onOddsUpdate(odds: PolymarketOdds): Promise<void> {
    // Resolve internal market by tokenId
    const market = await prisma.market.findFirst({
      where: {
        OR: [{ tokenYes: odds.tokenId }, { tokenNo: odds.tokenId }],
      },
    });

    if (!market) {
      logger.debug(
        { tokenId: odds.tokenId },
        "SignalService: no market found for tokenId",
      );
      return;
    }

    const enriched: PolymarketOdds = { ...odds, marketId: market.id };
    this.oddsMap.set(market.id, enriched);

    const now = Date.now();
    const lastSnap = this.lastPersistedSnap.get(market.id) ?? 0;
    const existing = this.oddsMap.get(market.id);

    let largeMove = false;
    if (existing && existing.marketId === market.id) {
      const delta = Math.abs(existing.midPrice - enriched.midPrice);
      if (delta > 0.02) largeMove = true;
    }

    if (!largeMove && now - lastSnap < 10_000) return;

    try {
      await prisma.btcMarketSnapshot.create({
        data: {
          marketId: market.id,
          tokenId: enriched.tokenId,
          bestBid: enriched.bestBid,
          bestAsk: enriched.bestAsk,
          midPrice: enriched.midPrice,
          spread: enriched.spread,
          timestamp: new Date(enriched.timestamp),
          rawJson: enriched as unknown as any,
        },
      });
      this.lastPersistedSnap.set(market.id, now);
    } catch (err) {
      logger.error({ err, marketId: market.id }, "SignalService: failed to persist snapshot");
    }
  }

  /**
   * Run the discrepancy detector across all tracked BTC markets.
   * Call this on a timer (e.g. every 5 seconds) so signals are generated
   * continuously as both Binance and Polymarket data update.
   */
  async scanForSignals(): Promise<BtcSignalOutput[]> {
    const modelProbability = binanceService.getLatestProbability();
    const metrics = binanceService.getLatestMetrics();

    if (!metrics || modelProbability === undefined || modelProbability === null) {
      logger.debug("SignalService: no Binance metrics yet, skipping scan");
      return [];
    }

    const markets = await prisma.market.findMany({
      where: {
        isActive: true,
        OR: [
          { question: { contains: "btc", mode: "insensitive" } },
          { question: { contains: "bitcoin", mode: "insensitive" } },
          { slug: { contains: "btc", mode: "insensitive" } },
          { slug: { contains: "bitcoin", mode: "insensitive" } },
        ],
      },
    });

    const signals: BtcSignalOutput[] = [];

    for (const market of markets) {
      const odds = this.oddsMap.get(market.id);
      if (!odds) continue;

      const signal = discrepancyDetector.detect(market, odds, modelProbability);
      if (!signal) continue;

      signals.push(signal);

      try {
        await prisma.btcSignal.create({
          data: {
            marketId: signal.marketId,
            side: signal.side,
            polymarketProbability: signal.polymarketProbability,
            modelProbability: signal.modelProbability,
            edge: signal.edge,
            confidence: signal.confidence,
            reason: signal.reason,
            rawJson: signal as unknown as any,
          },
        });
      } catch (err) {
        logger.error({ err, signal }, "SignalService: failed to persist BtcSignal");
      }

      await this.maybeSendAlert(signal, metrics);
    }

    return signals;
  }

  private async maybeSendAlert(
    signal: BtcSignalOutput,
    metrics: import("../binance/binance.types").BtcMetrics,
  ): Promise<void> {
    const cooldownKey = `${signal.marketId}:${signal.side}`;
    const now = Date.now();
    const lastSent = this.lastAlertSent.get(cooldownKey) ?? 0;
    const cooldownMs = env.ALERT_COOLDOWN_SECONDS * 1000;

    if (now - lastSent < cooldownMs) {
      logger.debug({ cooldownKey }, "SignalService: alert on cooldown");
      return;
    }

    const text = this.formatAlert(signal, metrics);
    const ok = await telegramClient.sendMessage(text);

    if (ok) {
      this.lastAlertSent.set(cooldownKey, now);
    }

    // Persist alert log regardless of Telegram success (keeps dedup history)
    try {
      await prisma.alertLog.create({
        data: {
          marketId: signal.marketId,
          side: signal.side,
          cooldownKey,
          message: text,
        },
      });
    } catch (err) {
      logger.warn({ err, cooldownKey }, "SignalService: failed to persist AlertLog");
    }
  }

  private formatAlert(
    signal: BtcSignalOutput,
    metrics: import("../binance/binance.types").BtcMetrics,
  ): string {
    return [
      "*BTC Polymarket Edge Detected*",
      "",
      `Market: ${signal.question}`,
      `Side: ${signal.side}`,
      `Polymarket: ${(signal.polymarketProbability * 100).toFixed(0)}%`,
      `Model: ${(signal.modelProbability * 100).toFixed(0)}%`,
      `Edge: ${signal.edge > 0 ? "+" : ""}${(signal.edge * 100).toFixed(0)}%`,
      `Binance velocity 15s: ${(metrics.priceVelocity15s * 100).toFixed(2)}%`,
      `Spread: ${(metrics.bidAskSpread * 100).toFixed(1)}%`,
      `Confidence: ${signal.confidence}`,
      "",
      `Reason:`,
      signal.reason,
    ].join("\n");
  }

  getOdds(marketId: string): PolymarketOdds | undefined {
    return this.oddsMap.get(marketId);
  }

  getAllOdds(): PolymarketOdds[] {
    return Array.from(this.oddsMap.values());
  }
}

export const signalService = new SignalService();
