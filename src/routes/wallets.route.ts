import { Router } from "express";
import { z } from "zod";
import { logger } from "../lib/logger";
import { walletService } from "../modules/wallets/wallet.service";
import { scoreWalletsQueue } from "../modules/jobs/queues";

export const walletsRouter = Router();

const topQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

walletsRouter.get("/wallets/top", async (req, res) => {
  const parsed = topQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const wallets = await walletService.getTopWallets(parsed.data.limit);
  return res.json({ count: wallets.length, wallets });
});

const addressParam = z.object({
  address: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "address must be a hex 0x-prefixed 20-byte address"),
});

walletsRouter.get("/wallets/:address", async (req, res) => {
  const parsed = addressParam.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const wallet = await walletService.getByAddress(parsed.data.address);
  if (!wallet) return res.status(404).json({ error: "wallet_not_found" });
  return res.json(wallet);
});

const tradesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

walletsRouter.get("/wallets/:address/trades", async (req, res) => {
  const paramsParsed = addressParam.safeParse(req.params);
  const queryParsed = tradesQuerySchema.safeParse(req.query);
  if (!paramsParsed.success) {
    return res.status(400).json({ error: paramsParsed.error.flatten() });
  }
  if (!queryParsed.success) {
    return res.status(400).json({ error: queryParsed.error.flatten() });
  }
  const trades = await walletService.getTradesByWallet(
    paramsParsed.data.address,
    queryParsed.data.limit,
  );
  return res.json({ count: trades.length, trades });
});

const scoreBodySchema = z.object({
  limit: z.coerce.number().int().min(1).max(5000).optional(),
});

walletsRouter.post("/jobs/score-wallets", async (req, res) => {
  const parsed = scoreBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const job = await scoreWalletsQueue.add("score-wallets", parsed.data);
  logger.info({ jobId: job.id }, "Enqueued score-wallets job");
  return res.status(202).json({ jobId: job.id });
});
