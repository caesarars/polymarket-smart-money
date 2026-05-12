import { Worker } from "bullmq";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { createRedisConnection } from "../../lib/redis";
import { alertService } from "../alerts/alert.service";
import { AlertJob, QUEUE_NAMES, ScoreWalletsJob } from "../jobs/queues";
import { walletScoring } from "./wallet.scoring";

export function startScoreWalletsWorker(): Worker<ScoreWalletsJob> {
  const worker = new Worker<ScoreWalletsJob>(
    QUEUE_NAMES.scoreWallets,
    async (job) => {
      const limit = job.data.limit ?? 500;
      logger.info({ jobId: job.id, limit }, "scoreWallets: started");
      const scored = await walletScoring.scoreAll(limit);
      logger.info({ jobId: job.id, scored }, "scoreWallets: finished");
      return { scored };
    },
    {
      connection: createRedisConnection(),
      concurrency: 1,
    },
  );

  worker.on("error", (err) => logger.error({ err }, "scoreWallets worker error"));
  return worker;
}

export function startAlertWorker(): Worker<AlertJob> {
  const worker = new Worker<AlertJob>(
    QUEUE_NAMES.alerts,
    async (job) => {
      const { walletAddress, marketId, tradeId } = job.data;
      const wallet = await prisma.wallet.findUnique({
        where: { address: walletAddress.toLowerCase() },
      });
      const market = await prisma.market.findUnique({ where: { id: marketId } });
      const trade = await prisma.walletTrade.findUnique({ where: { id: tradeId } });

      if (!wallet || !market || !trade) {
        logger.warn(
          { walletAddress, marketId, tradeId },
          "alerts: missing entity, skipping",
        );
        return { sent: false };
      }

      const sent = await alertService.maybeSendNewMarketAlert({
        wallet,
        market,
        trade,
      });
      return { sent };
    },
    {
      connection: createRedisConnection(),
      concurrency: 5,
    },
  );

  worker.on("error", (err) => logger.error({ err }, "alerts worker error"));
  return worker;
}

if (require.main === module) {
  startScoreWalletsWorker();
  startAlertWorker();
  logger.info("wallet workers (score + alerts) are running");
}
