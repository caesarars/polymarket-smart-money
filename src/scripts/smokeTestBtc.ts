import path from "node:path";
import express from "express";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { binanceService } from "../modules/binance/binance.service";
import { BtcMetrics } from "../modules/binance/binance.types";
import { marketService } from "../modules/markets/market.service";
import { btcRouter } from "../routes/btc.route";
import { healthRouter } from "../routes/health.route";

const PRINT_INTERVAL_MS = 5_000;
const PORT = env.PORT;
const PUBLIC_DIR = path.resolve(__dirname, "..", "..", "public");

/**
 * Build a minimal Express app that exposes just the BTC + health routes
 * (and the static dashboard). This intentionally skips the BullMQ queues,
 * bull-board, and the rest of the API surface so a smoke-test run doesn't
 * pull in worker plumbing.
 */
function createSmokeApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.use(healthRouter);
  app.use(btcRouter);
  app.use(express.static(PUBLIC_DIR, { fallthrough: true, index: "index.html" }));

  app.use((_req, res) => res.status(404).json({ error: "not_found" }));
  return app;
}

function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "–";
  return n.toFixed(digits);
}

function pct(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "–";
  return `${(n * 100).toFixed(digits)}%`;
}

function printSnapshot(metrics: BtcMetrics | null): void {
  if (!metrics) {
    logger.info("smoke: metrics not ready yet (waiting for Binance events)");
    return;
  }

  const signalScore = binanceService.getLatestSignalScore();
  const probability = binanceService.getLatestProbability();

  logger.info(
    {
      lastPrice: fmt(metrics.lastPrice, 2),
      markPrice: fmt(metrics.markPrice, 2),
      v5s: pct(metrics.priceVelocity5s),
      v15s: pct(metrics.priceVelocity15s),
      v60s: pct(metrics.priceVelocity60s),
      volatility: pct(metrics.volatilityExpansion, 5),
      orderflow: fmt(metrics.orderflowImbalance, 3),
      spread: pct(metrics.bidAskSpread, 4),
      liquidation: fmt(metrics.liquidationPressure, 3),
      signalScore: fmt(signalScore, 1),
      probability: fmt(probability, 3),
    },
    "smoke: BTC snapshot",
  );
}

async function main(): Promise<void> {
  logger.info("smoke-btc: starting");

  // --- 1. Sync BTC short-duration markets ---
  // MarketService.syncActiveMarkets already filters non-BTC-5m/15m markets
  // via isBtcShortDurationMarket(), so this is a one-line invocation.
  logger.info("smoke-btc: syncing markets from Gamma");
  try {
    const result = await marketService.syncActiveMarkets(500);
    if (result.synced === 0) {
      logger.warn(
        "smoke-btc: no BTC short-duration markets matched — proceeding anyway. " +
          "Either Polymarket has no 5m/15m BTC markets right now, or the filter " +
          "needs tuning in isBtcShortDurationMarket().",
      );
    } else {
      logger.info(result, "smoke-btc: sync complete");
    }
  } catch (err) {
    logger.error({ err }, "smoke-btc: sync failed — continuing without market data");
  }

  // --- 2. Connect to Binance WebSocket ---
  binanceService.start();

  // --- 3. Start HTTP server (exposes /btc/metrics) ---
  const app = createSmokeApp();
  const server = app.listen(PORT, () => {
    logger.info(
      { port: PORT, url: `http://127.0.0.1:${PORT}/btc/metrics` },
      "smoke-btc: HTTP server listening",
    );
  });

  // --- 4. Print latest metrics every 5 seconds ---
  const interval = setInterval(() => {
    printSnapshot(binanceService.getLatestMetrics());
  }, PRINT_INTERVAL_MS);

  // --- Graceful shutdown ---
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.warn({ signal }, "smoke-btc: shutting down");
    clearInterval(interval);
    binanceService.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
    await redis.quit().catch(() => undefined);
    logger.info("smoke-btc: shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) =>
    logger.error({ reason }, "smoke-btc: unhandled rejection"),
  );
}

main().catch((err) => {
  logger.fatal({ err }, "smoke-btc: failed to start");
  process.exit(1);
});
