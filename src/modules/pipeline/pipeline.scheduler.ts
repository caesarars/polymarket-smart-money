import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { PipelineJob, pipelineQueue } from "../jobs/queues";

const REPEAT_JOB_NAME = "pipeline-scheduled";

/**
 * Ensure a single repeatable pipeline job is registered. Removes any prior
 * scheduled instance first so that changing PIPELINE_INTERVAL_MINUTES across
 * restarts doesn't leave stale schedules behind.
 *
 * Call once at server boot.
 */
export async function ensurePipelineSchedule(): Promise<void> {
  const minutes = env.PIPELINE_INTERVAL_MINUTES;

  // Always clear existing repeatable entries with our name so the new
  // configuration is authoritative.
  try {
    const existing = await pipelineQueue.getRepeatableJobs();
    for (const r of existing) {
      if (r.name === REPEAT_JOB_NAME) {
        await pipelineQueue.removeRepeatableByKey(r.key);
        logger.debug({ key: r.key }, "PipelineScheduler: removed stale schedule");
      }
    }
  } catch (err) {
    logger.warn({ err }, "PipelineScheduler: failed to inspect existing schedules");
  }

  if (minutes <= 0) {
    logger.info("PipelineScheduler: disabled (PIPELINE_INTERVAL_MINUTES <= 0)");
    return;
  }

  const data: PipelineJob = {
    topMarkets: env.PIPELINE_TOP_MARKETS,
    tradesPerMarket: env.PIPELINE_TRADES_PER_MARKET,
  };

  await pipelineQueue.add(REPEAT_JOB_NAME, data, {
    repeat: { every: minutes * 60 * 1000 },
    // Run immediately on startup, then on every interval.
    jobId: REPEAT_JOB_NAME,
  });

  logger.info(
    { intervalMinutes: minutes, data },
    "PipelineScheduler: repeatable job registered",
  );
}
