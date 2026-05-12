import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/redis";
import {
  attachQueueEvents,
  closeQueues,
} from "./modules/jobs/queues";
import {
  startAlertWorker,
  startScoreWalletsWorker,
} from "./modules/wallets/wallet.worker";
import { startSyncMarketsWorker } from "./modules/markets/market.worker";
import { ensurePipelineSchedule } from "./modules/pipeline/pipeline.scheduler";
import { startPipelineWorker } from "./modules/pipeline/pipeline.worker";
import { binanceService } from "./modules/binance/binance.service";
import { clobWebSocketClient } from "./modules/polymarket/clob.ws";
import { signalService } from "./modules/signals/signal.service";
import { prisma as prismaClient } from "./lib/prisma";

let signalScanInterval: NodeJS.Timeout | null = null;
let clobSubscriptionInterval: NodeJS.Timeout | null = null;

async function subscribeToBtcMarkets(): Promise<void> {
  try {
    const markets = await prismaClient.market.findMany({
      where: { isActive: true },
      select: { tokenYes: true, tokenNo: true },
    });
    const tokenIds: string[] = [];
    for (const m of markets) {
      if (m.tokenYes) tokenIds.push(m.tokenYes);
      if (m.tokenNo) tokenIds.push(m.tokenNo);
    }
    if (tokenIds.length > 0) {
      clobWebSocketClient.subscribeToMarket(tokenIds);
      logger.info(
        { count: tokenIds.length },
        "ClobWebSocketClient: subscribed to BTC market tokens",
      );
    }
  } catch (err) {
    logger.error({ err }, "Failed to subscribe to BTC markets on CLOB");
  }
}

async function main(): Promise<void> {
  const app = createApp();

  attachQueueEvents();
  const workers = [
    startSyncMarketsWorker(),
    startScoreWalletsWorker(),
    startAlertWorker(),
    startPipelineWorker(),
  ];

  await ensurePipelineSchedule();

  // --- Start Binance real-time feed ---
  binanceService.start();

  // --- Start Polymarket CLOB feed ---
  clobWebSocketClient.connect();

  // --- Refresh CLOB subscriptions periodically as markets sync ---
  clobSubscriptionInterval = setInterval(() => {
    void subscribeToBtcMarkets();
  }, 60_000);
  // Initial subscription after a short delay so markets may already be in DB.
  setTimeout(() => void subscribeToBtcMarkets(), 5_000);

  // --- Signal scanner: run every 5 seconds ---
  signalScanInterval = setInterval(() => {
    void signalService.scanForSignals();
  }, 5_000);

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "HTTP server listening");
  });

  const shutdown = async (signal: string) => {
    logger.warn({ signal }, "Shutdown initiated");

    if (signalScanInterval) clearInterval(signalScanInterval);
    if (clobSubscriptionInterval) clearInterval(clobSubscriptionInterval);

    binanceService.stop();
    clobWebSocketClient.close();

    server.close(() => logger.info("HTTP server closed"));
    await Promise.allSettled(workers.map((w) => w.close()));
    await closeQueues();
    await prisma.$disconnect();
    await redis.quit().catch(() => undefined);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) =>
    logger.error({ reason }, "Unhandled promise rejection"),
  );
  process.on("uncaughtException", (err) =>
    logger.fatal({ err }, "Uncaught exception"),
  );
}

main().catch((err) => {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
});
