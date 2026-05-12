import { Worker } from "bullmq";
import { logger } from "../../lib/logger";
import { createRedisConnection } from "../../lib/redis";
import { QUEUE_NAMES, SyncMarketsJob } from "../jobs/queues";
import { marketService } from "./market.service";

export function startSyncMarketsWorker(): Worker<SyncMarketsJob> {
  const worker = new Worker<SyncMarketsJob>(
    QUEUE_NAMES.syncMarkets,
    async (job) => {
      const limit = job.data.limit ?? 200;
      logger.info({ jobId: job.id, limit }, "syncMarkets: started");
      const result = await marketService.syncActiveMarkets(limit);
      logger.info({ jobId: job.id, ...result }, "syncMarkets: finished");
      return result;
    },
    {
      connection: createRedisConnection(),
      concurrency: 1,
    },
  );

  worker.on("error", (err) => logger.error({ err }, "syncMarkets worker error"));
  return worker;
}

if (require.main === module) {
  startSyncMarketsWorker();
  logger.info("syncMarkets worker is running");
}
