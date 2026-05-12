import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  POLYMARKET_GAMMA_API_URL: z
    .string()
    .url()
    .default("https://gamma-api.polymarket.com"),
  POLYMARKET_DATA_API_URL: z
    .string()
    .url()
    .default("https://data-api.polymarket.com"),
  POLYMARKET_CLOB_WS_URL: z
    .string()
    .url()
    .default("wss://ws-subscriptions-clob.polymarket.com/ws/market"),

  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_CHAT_ID: z.string().min(1).optional(),

  SMART_WALLET_SCORE_THRESHOLD: z.coerce.number().min(0).max(100).default(75),

  /**
   * Pipeline auto-scheduler interval, in minutes. Set to 0 (or unset) to disable
   * the repeatable job; pipeline then only runs via CLI / HTTP trigger.
   */
  PIPELINE_INTERVAL_MINUTES: z.coerce.number().int().min(0).max(1440).default(0),
  /** Knobs for the scheduled pipeline run (only used when scheduler is enabled). */
  PIPELINE_TOP_MARKETS: z.coerce.number().int().min(1).max(500).default(20),
  PIPELINE_TRADES_PER_MARKET: z.coerce.number().int().min(1).max(1000).default(100),
  /**
   * Optional category to lock the pipeline to (e.g. "Crypto"). Leave empty to
   * crawl the top markets across all categories.
   */
  PIPELINE_CATEGORY: z.string().min(1).max(64).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error(
    "Invalid environment variables:",
    JSON.stringify(parsed.error.flatten().fieldErrors, null, 2),
  );
  throw new Error("Invalid environment configuration. See errors above.");
}

export const env = parsed.data;
export type Env = typeof env;
