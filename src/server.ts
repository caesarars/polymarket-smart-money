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

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "HTTP server listening");
  });

  const shutdown = async (signal: string) => {
    logger.warn({ signal }, "Shutdown initiated");
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
