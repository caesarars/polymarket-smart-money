import { Worker } from "bullmq";
import { logger } from "../../lib/logger";
import { createRedisConnection } from "../../lib/redis";
import { PipelineJob, QUEUE_NAMES } from "../jobs/queues";
import { pipelineService } from "./pipeline.service";

export function startPipelineWorker(): Worker<PipelineJob> {
  const worker = new Worker<PipelineJob>(
    QUEUE_NAMES.pipeline,
    async (job) => {
      logger.info({ jobId: job.id, data: job.data }, "pipeline: started");
      const summary = await pipelineService.runOnce(job.data);
      logger.info({ jobId: job.id, summary }, "pipeline: finished");
      return summary;
    },
    {
      connection: createRedisConnection(),
      concurrency: 1,
    },
  );

  worker.on("error", (err) => logger.error({ err }, "pipeline worker error"));
  return worker;
}

if (require.main === module) {
  startPipelineWorker();
  logger.info("pipeline worker is running");
}
