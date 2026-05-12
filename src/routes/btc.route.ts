import { Router } from "express";
import { z } from "zod";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { binanceService } from "../modules/binance/binance.service";
import { signalService } from "../modules/signals/signal.service";

export const btcRouter = Router();

btcRouter.get("/btc/markets", async (_req, res) => {
  try {
    const markets = await prisma.market.findMany({
      where: {
        isActive: true,
        OR: [
          { question: { contains: "btc", mode: "insensitive" } },
          { question: { contains: "bitcoin", mode: "insensitive" } },
          { slug: { contains: "btc", mode: "insensitive" } },
          { slug: { contains: "bitcoin", mode: "insensitive" } },
        ],
      },
      orderBy: [{ volume: "desc" }],
      take: 50,
    });
    return res.json({ count: markets.length, markets });
  } catch (err) {
    logger.error({ err }, "btc/markets: query failed");
    return res.status(500).json({ error: "query_failed" });
  }
});

btcRouter.get("/btc/metrics", async (_req, res) => {
  const metrics = binanceService.getLatestMetrics();
  if (!metrics) {
    return res.status(503).json({ error: "metrics_not_ready" });
  }
  return res.json({
    metrics,
    signalScore: binanceService.getLatestSignalScore(),
    modelProbability: binanceService.getLatestProbability(),
  });
});

btcRouter.get("/btc/signals/latest", async (_req, res) => {
  try {
    const signals = await prisma.btcSignal.findMany({
      take: 20,
      orderBy: { timestamp: "desc" },
      include: { market: { select: { question: true, slug: true } } },
    });
    return res.json({ count: signals.length, signals });
  } catch (err) {
    logger.error({ err }, "btc/signals/latest: query failed");
    return res.status(500).json({ error: "query_failed" });
  }
});

const historyQuerySchema = z.object({
  marketId: z.string().min(1).optional(),
  side: z.enum(["YES", "NO"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

btcRouter.get("/btc/signals/history", async (req, res) => {
  const parsed = historyQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { marketId, side, limit } = parsed.data;

  try {
    const signals = await prisma.btcSignal.findMany({
      where: {
        ...(marketId ? { marketId } : {}),
        ...(side ? { side } : {}),
      },
      orderBy: { timestamp: "desc" },
      take: limit,
      include: { market: { select: { question: true, slug: true } } },
    });
    return res.json({ count: signals.length, signals });
  } catch (err) {
    logger.error({ err }, "btc/signals/history: query failed");
    return res.status(500).json({ error: "query_failed" });
  }
});
