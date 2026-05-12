import { Queue, QueueEvents } from "bullmq";
import { logger } from "../../lib/logger";
import { createRedisConnection } from "../../lib/redis";

export const QUEUE_NAMES = {
  syncMarkets: "sync-markets",
  scoreWallets: "score-wallets",
  alerts: "alerts",
  pipeline: "pipeline",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface SyncMarketsJob {
  limit?: number;
}

export interface ScoreWalletsJob {
  limit?: number;
}

export interface AlertJob {
  walletAddress: string;
  marketId: string;
  tradeId: string;
}

export interface PipelineJob {
  marketLimit?: number;
  topMarkets?: number;
  tradesPerMarket?: number;
  holdersPerMarket?: number;
  activityPerWallet?: number;
  scoreThreshold?: number;
}

const connection = createRedisConnection();

export const syncMarketsQueue = new Queue<SyncMarketsJob>(QUEUE_NAMES.syncMarkets, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail: 100,
  },
});

export const scoreWalletsQueue = new Queue<ScoreWalletsJob>(QUEUE_NAMES.scoreWallets, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail: 100,
  },
});

export const alertsQueue = new Queue<AlertJob>(QUEUE_NAMES.alerts, {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 2_000 },
    removeOnComplete: 500,
    removeOnFail: 500,
  },
});

export const pipelineQueue = new Queue<PipelineJob>(QUEUE_NAMES.pipeline, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: 50,
    removeOnFail: 50,
  },
});

export function attachQueueEvents(): void {
  for (const name of Object.values(QUEUE_NAMES)) {
    const events = new QueueEvents(name, { connection: createRedisConnection() });
    events.on("failed", ({ jobId, failedReason }) =>
      logger.error({ queue: name, jobId, failedReason }, "Queue job failed"),
    );
    events.on("completed", ({ jobId }) =>
      logger.debug({ queue: name, jobId }, "Queue job completed"),
    );
  }
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([
    syncMarketsQueue.close(),
    scoreWalletsQueue.close(),
    alertsQueue.close(),
    pipelineQueue.close(),
  ]);
}
