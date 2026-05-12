import { Router } from "express";
import { z } from "zod";
import { logger } from "../lib/logger";
import { pipelineQueue } from "../modules/jobs/queues";

export const pipelineRouter = Router();

const bodySchema = z.object({
  marketLimit: z.coerce.number().int().min(1).max(1000).optional(),
  topMarkets: z.coerce.number().int().min(1).max(500).optional(),
  tradesPerMarket: z.coerce.number().int().min(1).max(1000).optional(),
  holdersPerMarket: z.coerce.number().int().min(0).max(500).optional(),
  activityPerWallet: z.coerce.number().int().min(0).max(500).optional(),
  scoreThreshold: z.coerce.number().min(0).max(100).optional(),
});

pipelineRouter.post("/jobs/run-pipeline", async (req, res) => {
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const job = await pipelineQueue.add("pipeline", parsed.data);
  logger.info({ jobId: job.id }, "Enqueued pipeline job");
  return res.status(202).json({ jobId: job.id });
});
