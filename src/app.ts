import express, { ErrorRequestHandler } from "express";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger";
import { healthRouter } from "./routes/health.route";
import { marketsRouter } from "./routes/markets.route";
import { pipelineRouter } from "./routes/pipeline.route";
import { walletsRouter } from "./routes/wallets.route";

export function createApp(): express.Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(
    pinoHttp({
      logger,
      customLogLevel: (_req, res, err) => {
        if (err) return "error";
        if (res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
    }),
  );

  app.use(healthRouter);
  app.use(marketsRouter);
  app.use(walletsRouter);
  app.use(pipelineRouter);

  app.use((_req, res) => res.status(404).json({ error: "not_found" }));

  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    logger.error({ err, path: req.path }, "Unhandled error");
    res.status(500).json({ error: "internal_server_error" });
  };
  app.use(errorHandler);

  return app;
}
