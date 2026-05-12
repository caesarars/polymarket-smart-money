import { Router } from "express";
import { z } from "zod";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";

export const alertsRouter = Router();

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

alertsRouter.get("/alerts/recent", async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const alerts = await prisma.alertLog.findMany({
      take: parsed.data.limit,
      orderBy: { sentAt: "desc" },
      include: {
        wallet: { select: { address: true, smartScore: true } },
        market: { select: { question: true, slug: true, polymarketId: true } },
      },
    });
    return res.json({ count: alerts.length, alerts });
  } catch (err) {
    logger.error({ err }, "alerts: query failed");
    return res.status(500).json({ error: "alerts_query_failed" });
  }
});
