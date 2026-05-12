import pino from "pino";
import { env } from "../config/env";

const isDev = env.NODE_ENV !== "production";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "polymarket-smart-money" },
  redact: {
    paths: [
      "req.headers.authorization",
      "*.password",
      "*.token",
      "TELEGRAM_BOT_TOKEN",
    ],
    censor: "[REDACTED]",
  },
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss.l",
          ignore: "pid,hostname,service",
        },
      }
    : undefined,
});

export type Logger = typeof logger;
