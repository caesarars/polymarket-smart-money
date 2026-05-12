# Polymarket Smart Money — Agent Guide

> This file is written for AI coding agents. It assumes you know TypeScript/Node.js but nothing about this specific project.

## Project overview

`polymarket-smart-money` is a Node.js backend service that ingests data from Polymarket (a prediction-market exchange), scores wallets to identify "smart money", and sends Telegram alerts when a high-scoring wallet enters a new market.

Core capabilities:
1. **Sync markets** from the Polymarket Gamma API and persist them in PostgreSQL.
2. **Ingest trades / wallet activity** from the Polymarket Data API (and optionally the CLOB WebSocket feed).
3. **Score wallets** along five dimensions — PnL, timing, consistency, specialization, liquidity — and combine them into a single `smartScore` (0–100).
4. **Alert** via Telegram whenever a wallet with `smartScore >= SMART_WALLET_SCORE_THRESHOLD` makes its first trade on a new market. Duplicate alerts are prevented by a `(walletAddress, marketId)` unique constraint on `AlertLog`.

The codebase is entirely in **English** (code, comments, docs). The `README.md` contains one deployment section written in Indonesian; all other documentation is in English.

## Technology stack

- **Runtime**: Node.js >= 20
- **Language**: TypeScript (strict mode, ES2022, Node16 module resolution)
- **HTTP framework**: Express 4
- **Database**: PostgreSQL 16 (via Prisma ORM 5)
- **Cache / Job queue**: Redis 7 (via IORedis) + BullMQ 5
- **Queue dashboard**: `@bull-board/express` mounted at `/admin/queues`
- **HTTP clients**: Axios (REST APIs), `ws` (WebSocket)
- **Validation**: Zod (environment variables, request bodies, query params)
- **Logging**: Pino + `pino-http` (pretty transport in dev)
- **Frontend dashboard**: Static HTML/JS in `public/` (no build step)
- **Containerization**: Docker + Docker Compose (multi-stage `Dockerfile`)

## Project structure

```
prisma/
  schema.prisma          # Database schema (Postgres)
src/
  config/
    env.ts               # Zod-validated environment config
  lib/
    logger.ts            # Pino singleton
    prisma.ts            # PrismaClient singleton (global in dev)
    redis.ts             # IORedis singleton + connection factory
  modules/
    polymarket/
      gamma.client.ts    # REST client for Gamma API (markets/events)
      data.client.ts     # REST client for Data API (trades/positions/holders)
      clob.ws.ts         # WebSocket client for CLOB feeds
      polymarket.types.ts # Response type shapes (heavily commented)
    markets/
      market.service.ts  # Upsert markets, list active markets, get categories
      market.worker.ts   # BullMQ worker: sync active markets
    wallets/
      wallet.service.ts  # Ingest trades, lookup wallets/trades, detect new entries
      wallet.scoring.ts  # Pure scoring function + scoreAll runner
      wallet.worker.ts   # BullMQ workers: score wallets + send alerts
    alerts/
      alert.service.ts   # Telegram alert formatting + deduplication logic
      telegram.client.ts # Telegram Bot API client
    pipeline/
      pipeline.service.ts # Orchestrates sync → crawl → ingest → score → alert
      pipeline.scheduler.ts # Registers a repeatable BullMQ job from env
      pipeline.worker.ts  # BullMQ worker: run one pipeline pass
    jobs/
      queues.ts          # BullMQ queue definitions + event listeners
  routes/
    health.route.ts      # GET /health (liveness + DB/Redis check)
    stats.route.ts       # GET /stats (counts + last pipeline run)
    markets.route.ts     # GET /markets/active, /markets/categories, POST /jobs/sync-markets
    wallets.route.ts     # GET /wallets/top, /wallets/:addr, /wallets/:addr/trades, POST /jobs/score-wallets
    alerts.route.ts      # GET /alerts/recent
    pipeline.route.ts    # POST /jobs/run-pipeline
  scripts/
    syncMarkets.ts       # CLI: one-shot market sync
    scoreWallets.ts      # CLI: one-shot wallet scoring
    runPipeline.ts       # CLI: one-shot full pipeline run
  app.ts                 # Express app factory (routes, middleware, static files)
  server.ts              # Boot: workers + scheduler + HTTP server + graceful shutdown
public/
  index.html             # Dashboard UI
  app.js                 # Dashboard logic (plain ES2020, polls JSON API)
  style.css
```

## Build and run commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Start HTTP server + all workers with `tsx watch` (live reload) |
| `npm run build` | Compile TypeScript (`src/`) to `dist/` |
| `npm run start` | Run compiled server (`node dist/server.js`) |
| `npm run lint` | Type-check without emitting (`tsc --noEmit`) |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:migrate` | Run dev migrations (interactive) |
| `npm run prisma:deploy` | Deploy migrations in production |
| `npm run sync:markets [limit]` | CLI script: sync markets immediately |
| `npm run score:wallets [limit]` | CLI script: rescore wallets immediately |
| `npm run pipeline:run` | CLI script: run full pipeline once |
| `npm run worker:markets` | Run only the sync-markets worker |
| `npm run worker:wallets` | Run only the score-wallets + alerts workers |
| `npm run worker:pipeline` | Run only the pipeline worker |

### Local development setup

1. `cp .env.example .env` and fill in variables.
2. `docker compose up -d` to start Postgres + Redis.
3. `npm run prisma:generate`
4. `npm run prisma:migrate -- --name init`
5. `npm run dev`

## Code style and conventions

- **TypeScript**: Strict mode enabled (`strict: true`, `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, etc.).
- **Module system**: `node16` resolution; use `import`/`export`.
- **No trailing semicolons enforced** — the codebase omits semicolons after most statements. Follow existing style.
- **Naming**: `camelCase` for variables/functions, `PascalCase` for classes/types/interfaces, `kebab-case` for filenames.
- **Error handling**: Services catch external API errors, log them via Pino, and return safe fallbacks (usually empty arrays or `null`). Do not let unhandled errors propagate out of BullMQ job handlers.
- **Logging**: Use the `logger` singleton from `src/lib/logger.ts`. Pass structured data as the first argument: `logger.info({ jobId }, "message")`.
- **Environment access**: All env vars are read **only** in `src/config/env.ts` via Zod. Import `env` from there everywhere else. Never read `process.env` directly in business logic.
- **Redaction**: Pino redacts `authorization`, `*.password`, `*.token`, and `TELEGRAM_BOT_TOKEN` automatically.
- **Prisma usage**: Use the `prisma` singleton from `src/lib/prisma.ts`. For transactions that must be atomic, use `prisma.$transaction([...])`.

## Architecture patterns

### Layered architecture
1. **API Clients** (`src/modules/polymarket/`) — Only know how to talk to Polymarket. They never touch the database. They return raw API shapes and log failures, returning empty arrays on error.
2. **Services** (`src/modules/*/ *.service.ts`) — Orchestrate clients + Prisma. They are the only layer that knows the domain. Services are instantiated as singletons and exported (`export const marketService = new MarketService()`).
3. **Workers** (`*.worker.ts`) — Consume BullMQ queues and call services. Workers run in-process by default (started from `server.ts`) but can be split out via `npm run worker:*`.
4. **Routes** (`src/routes/`) — Thin Express routers. Validate input with Zod, delegate to services/queues, and return JSON. Never put business logic here.
5. **Scoring** (`wallet.scoring.ts`) — `WalletScoring.compute(wallet, trades)` is a pure function returning a `ScoreBreakdown`. Swap in better signals without touching the rest of the pipeline.

### Background jobs (BullMQ)
There are four queues defined in `src/modules/jobs/queues.ts`:
- `sync-markets` — `SyncMarketsJob` (limit, category)
- `score-wallets` — `ScoreWalletsJob` (limit)
- `alerts` — `AlertJob` (walletAddress, marketId, tradeId)
- `pipeline` — `PipelineJob` (many optional knobs)

Queue events are attached at boot to log failures/completions. Jobs have retry policies (exponential backoff) configured per queue.

The **pipeline scheduler** (`pipeline.scheduler.ts`) registers a repeatable BullMQ job when `PIPELINE_INTERVAL_MINUTES > 0`. It clears any existing repeatable job with the same name first, so changing the interval in `.env` and restarting applies the new schedule.

### Graceful shutdown
`server.ts` handles `SIGINT`/`SIGTERM`:
1. Close HTTP server.
2. Close all BullMQ workers.
3. Close queues.
4. Disconnect Prisma.
5. Quit Redis.

## Database schema (Prisma)

Key models:
- `Market` — synced from Gamma API. Unique on `polymarketId`. Indexed on `isActive`, `endDate`, `category`.
- `Wallet` — inferred from trades. Unique on `address`. Indexed on `smartScore`, `lastSeenAt`.
- `WalletTrade` — individual trades. Indexed on `walletAddress`, `marketId`, `tokenId`, `timestamp`.
- `WalletScore` — per-run score breakdowns (PnL, timing, consistency, specialization, liquidity). Indexed on `walletAddress`, `totalScore`, `createdAt`.
- `AlertLog` — deduplicates alerts via `@@unique([walletAddress, marketId])`. Indexed on `sentAt`.
- `OrderbookSnapshot` — placeholder for future CLOB order-book persistence.

All Prisma queries run through the singleton in `src/lib/prisma.ts`. In non-production, the client is stored on `global.__prisma` to survive HMR during `tsx watch`.

## Testing

There is **no test suite** in the project at this time. `tsconfig.json` explicitly excludes `**/*.test.ts`. If you add tests:
- Place them in `src/` next to the code they test or in a dedicated `tests/` directory.
- Update `tsconfig.json` `exclude` if necessary.
- The project uses no test runner; you would need to add one (e.g., Vitest, Jest) as a dev dependency.

## Security considerations

- **No API authentication or rate limiting** is currently implemented. The `/jobs/*` endpoints can enqueue BullMQ jobs. The README notes this as a roadmap item.
- **HTTP API binding**: In Docker Compose, the app binds to `127.0.0.1:3000` only — it is not exposed to the public internet. Access is intended via SSH tunnel.
- **Secrets**: `TELEGRAM_BOT_TOKEN` and database credentials live in `.env`. `.env` is in `.gitignore`. Never commit it.
- **Log redaction**: Pino redacts sensitive fields (see `logger.ts`), but do not log raw API keys or database URLs manually.
- **Prisma**: Uses parameterized queries; no raw SQL injection vectors in the current routes. One raw query exists in `health.route.ts` (`SELECT 1`), which is safe.
- **Input validation**: All HTTP inputs (query, body, params) are validated with Zod before reaching services.

## Deployment

### Docker Compose (recommended for production)
The stack consists of three services: `postgres`, `redis`, and `app`.

```bash
cp .env.example .env
# edit .env (set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, strong POSTGRES_PASSWORD)
docker compose up -d --build
```

On every container start, `npx prisma migrate deploy` runs automatically before the Node server starts (see `Dockerfile` `CMD`). This means schema changes apply on redeploy without manual steps.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | `development` | `development` / `production` |
| `LOG_LEVEL` | `info` | Pino log level |
| `DATABASE_URL` | *(required)* | Postgres connection string |
| `REDIS_URL` | *(required)* | Redis connection string |
| `POLYMARKET_GAMMA_API_URL` | `https://gamma-api.polymarket.com` | Gamma API base |
| `POLYMARKET_DATA_API_URL` | `https://data-api.polymarket.com` | Data API base |
| `POLYMARKET_CLOB_WS_URL` | `wss://ws-subscriptions-clob.polymarket.com/ws/market` | CLOB WS URL |
| `TELEGRAM_BOT_TOKEN` | *(optional)* | Telegram bot token |
| `TELEGRAM_CHAT_ID` | *(optional)* | Target chat/channel ID |
| `SMART_WALLET_SCORE_THRESHOLD` | `75` | Minimum score to trigger alert |
| `PIPELINE_INTERVAL_MINUTES` | `0` | Auto-pipeline interval; `0` disables scheduler |
| `PIPELINE_TOP_MARKETS` | `20` | Markets to crawl per scheduled run |
| `PIPELINE_TRADES_PER_MARKET` | `100` | Trades fetched per market |
| `PIPELINE_CATEGORY` | *(optional)* | Lock pipeline to one category |
| `POSTGRES_USER` | `polymarket` | Used by docker-compose |
| `POSTGRES_PASSWORD` | `polymarket` | Used by docker-compose |
| `POSTGRES_DB` | `polymarket` | Used by docker-compose |

In Docker Compose, `DATABASE_URL` and `REDIS_URL` are overridden to use internal hostnames (`postgres`, `redis`), regardless of what `.env` says.

## Important implementation details

- **CLOB WebSocket** (`clob.ws.ts`): The client auto-reconnects with exponential backoff (capped at 30s) and sends a heartbeat ping every 25s. It is instantiated as a singleton but is not currently wired into the main pipeline by default.
- **Trade ingestion deduplication**: `WalletService.ingestTrades` skips duplicates matched by `walletAddress + tokenId + timestamp + side + price + size`. It also links trades to `Market` rows via `polymarketId`/`conditionId` lookup.
- **Alert deduplication**: `AlertService.maybeSendNewMarketAlert` checks `AlertLog` `(walletAddress, marketId)` unique constraint before sending. Even if two pipeline runs race, only one alert wins.
- **Deterministic alert job IDs**: The pipeline enqueues alert jobs with `jobId: alert:${address}:${marketId}` so duplicate enqueue attempts within the same run are idempotent.
- **Dashboard**: `public/index.html` + `app.js` poll the JSON API every 15 seconds. It is served as static files from `express.static`.
