import { Router } from "express";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  const checks: Record<string, string> = { service: "ok" };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "down";
  }

  try {
    const pong = await redis.ping();
    checks.redis = pong === "PONG" ? "ok" : "degraded";
  } catch {
    checks.redis = "down";
  }

  const healthy = Object.values(checks).every((v) => v === "ok");
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    checks,
  });
});
