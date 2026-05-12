import { Router } from "express";
import { z } from "zod";
import { logger } from "../lib/logger";
import { marketService } from "../modules/markets/market.service";
import { syncMarketsQueue } from "../modules/jobs/queues";

export const marketsRouter = Router();

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

marketsRouter.get("/markets/active", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const markets = await marketService.getActiveMarkets(parsed.data.limit);
  return res.json({ count: markets.length, markets });
});

const syncBodySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

marketsRouter.post("/jobs/sync-markets", async (req, res) => {
  const parsed = syncBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const job = await syncMarketsQueue.add("sync-markets", parsed.data);
  logger.info({ jobId: job.id }, "Enqueued sync-markets job");
  return res.status(202).json({ jobId: job.id });
});
