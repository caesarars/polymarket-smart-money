import path from "node:path";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { createBullBoard } from "@bull-board/api";
import { ExpressAdapter } from "@bull-board/express";
import express, { ErrorRequestHandler } from "express";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger";
import {
  alertsQueue,
  pipelineQueue,
  scoreWalletsQueue,
  syncMarketsQueue,
} from "./modules/jobs/queues";
import { alertsRouter } from "./routes/alerts.route";
import { btcRouter } from "./routes/btc.route";
import { healthRouter } from "./routes/health.route";
import { marketsRouter } from "./routes/markets.route";
import { pipelineRouter } from "./routes/pipeline.route";
import { statsRouter } from "./routes/stats.route";
import { walletsRouter } from "./routes/wallets.route";

const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

export function createApp(): express.Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(
    pinoHttp({
      logger,
      // Mute access logs for the dashboard auto-refresh polling — they spam.
      autoLogging: {
        ignore: (req) => {
          const url = req.url ?? "";
          return (
            url === "/health" ||
            url === "/stats" ||
            url.startsWith("/alerts/recent") ||
            url.startsWith("/wallets/top") ||
            url.startsWith("/markets/active") ||
            url.startsWith("/btc/")
          );
        },
      },
      customLogLevel: (_req, res, err) => {
        if (err) return "error";
        if (res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
    }),
  );

  // --- BullMQ admin UI ---
  // Cast: bullmq v5 widened Job["progress"] (now includes string) but
  // @bull-board/api hasn't picked the new type up yet. Runtime is fine.
  const bullBoardAdapter = new ExpressAdapter();
  bullBoardAdapter.setBasePath("/admin/queues");
  createBullBoard({
    queues: [
      new BullMQAdapter(syncMarketsQueue),
      new BullMQAdapter(scoreWalletsQueue),
      new BullMQAdapter(alertsQueue),
      new BullMQAdapter(pipelineQueue),
    ] as unknown as Parameters<typeof createBullBoard>[0]["queues"],
    serverAdapter: bullBoardAdapter,
  });
  app.use("/admin/queues", bullBoardAdapter.getRouter());

  // --- JSON API ---
  app.use(healthRouter);
  app.use(statsRouter);
  app.use(alertsRouter);
  app.use(marketsRouter);
  app.use(walletsRouter);
  app.use(pipelineRouter);
  app.use(btcRouter);

  // --- Static dashboard (HTML/CSS/JS that polls the JSON API) ---
  app.use(express.static(PUBLIC_DIR, { fallthrough: true, index: "index.html" }));

  app.use((_req, res) => res.status(404).json({ error: "not_found" }));

  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    logger.error({ err, path: req.path }, "Unhandled error");
    res.status(500).json({ error: "internal_server_error" });
  };
  app.use(errorHandler);

  return app;
}
