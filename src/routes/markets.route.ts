import { Router } from "express";
import { z } from "zod";
import { logger } from "../lib/logger";
import { marketService } from "../modules/markets/market.service";
import { syncMarketsQueue } from "../modules/jobs/queues";

export const marketsRouter = Router();

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  category: z.string().min(1).max(64).optional(),
});

marketsRouter.get("/markets/active", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const markets = await marketService.getActiveMarkets(parsed.data.limit, {
    category: parsed.data.category,
  });
  return res.json({ count: markets.length, markets });
});

marketsRouter.get("/markets/categories", async (_req, res) => {
  const categories = await marketService.getCategories();
  return res.json({ count: categories.length, categories });
});

const syncBodySchema = z.object({
  limit: z.coerce.number().int().min(1).max(5000).optional(),
  category: z.string().min(1).max(64).optional(),
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
