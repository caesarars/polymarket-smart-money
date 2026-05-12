import { Router } from "express";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { pipelineQueue } from "../modules/jobs/queues";

export const statsRouter = Router();

statsRouter.get("/stats", async (_req, res) => {
  try {
    const [
      activeMarkets,
      totalMarkets,
      wallets,
      smartWallets,
      trades,
      alerts,
    ] = await Promise.all([
      prisma.market.count({ where: { isActive: true } }),
      prisma.market.count(),
      prisma.wallet.count(),
      prisma.wallet.count({
        where: { smartScore: { gte: env.SMART_WALLET_SCORE_THRESHOLD } },
      }),
      prisma.walletTrade.count(),
      prisma.alertLog.count(),
    ]);

    let lastPipelineRun:
      | {
          id: string | undefined;
          status: "completed" | "failed";
          finishedAt: number | undefined;
          summary: unknown;
          error: string | null;
        }
      | null = null;

    try {
      const recent = await pipelineQueue.getJobs(
        ["completed", "failed"],
        0,
        0,
      );
      const job = recent[0];
      if (job) {
        const failed = Boolean(job.failedReason);
        lastPipelineRun = {
          id: job.id,
          status: failed ? "failed" : "completed",
          finishedAt: job.finishedOn,
          summary: failed ? null : job.returnvalue ?? null,
          error: job.failedReason ?? null,
        };
      }
    } catch (err) {
      logger.warn({ err }, "stats: failed to read last pipeline job");
    }

    res.json({
      threshold: env.SMART_WALLET_SCORE_THRESHOLD,
      counts: {
        activeMarkets,
        totalMarkets,
        wallets,
        smartWallets,
        trades,
        alerts,
      },
      lastPipelineRun,
      pipelineScheduler: {
        intervalMinutes: env.PIPELINE_INTERVAL_MINUTES,
        enabled: env.PIPELINE_INTERVAL_MINUTES > 0,
      },
    });
  } catch (err) {
    logger.error({ err }, "stats: query failed");
    res.status(500).json({ error: "stats_query_failed" });
  }
});
