# polymarket-smart-money

Backend service that ingests Polymarket markets, trades, and wallet activity, scores wallets to identify "smart money", and sends Telegram alerts when a high-scoring wallet enters a new market.

## What it does

1. **Sync markets** from the Polymarket Gamma API and persist them in Postgres.
2. **Ingest trades / wallet activity** from the Polymarket Data API and the CLOB WebSocket feed.
3. **Score wallets** along five dimensions — PnL, timing, consistency, specialization, liquidity — and combine them into a single `smartScore` (0–100).
4. **Alert** via Telegram whenever a wallet with `smartScore >= SMART_WALLET_SCORE_THRESHOLD` makes its first trade on a new market. Duplicate alerts are prevented by the `AlertLog` unique constraint.

## Tech stack

Node.js + TypeScript · Express · Prisma + PostgreSQL · Redis + BullMQ · Axios · `ws` · Telegram Bot API · Zod · Pino · Docker Compose.

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in environment variables
cp .env.example .env

# 3. Start Postgres + Redis
docker compose up -d

# 4. Generate the Prisma client and apply schema
npm run prisma:generate
npm run prisma:migrate -- --name init

# 5. Start the dev server (HTTP API + all workers)
npm run dev
```

### Environment variables

See [`.env.example`](.env.example). The required ones:

| Variable | Description |
| --- | --- |
| `PORT` | HTTP port for the Express API (default `3000`). |
| `DATABASE_URL` | Postgres connection string. |
| `REDIS_URL` | Redis connection string. |
| `POLYMARKET_GAMMA_API_URL` | Gamma API base URL. |
| `POLYMARKET_DATA_API_URL` | Data API base URL. |
| `POLYMARKET_CLOB_WS_URL` | CLOB WebSocket URL. |
| `TELEGRAM_BOT_TOKEN` | Bot token; if unset alerts are logged but not sent. |
| `TELEGRAM_CHAT_ID` | Target chat / channel id for alerts. |
| `SMART_WALLET_SCORE_THRESHOLD` | Minimum `smartScore` (0–100) required to trigger an alert. |

## Run commands

```bash
npm run dev              # HTTP server + workers, live-reload
npm run build            # Compile TypeScript to dist/
npm run start            # Run compiled server (dist/server.js)

npm run prisma:generate  # Generate Prisma client
npm run prisma:migrate   # Run dev migrations

npm run sync:markets     # CLI: sync markets immediately
npm run score:wallets    # CLI: rescore wallets immediately

npm run worker:markets   # Run only the sync-markets worker
npm run worker:wallets   # Run only the score-wallets + alerts workers
```

## HTTP API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Liveness + Postgres + Redis check. |
| `GET` | `/markets/active` | List active markets, ordered by volume. |
| `GET` | `/wallets/top` | Top wallets ordered by `smartScore`. |
| `GET` | `/wallets/:address` | Single wallet (404 if unseen). |
| `GET` | `/wallets/:address/trades` | Recent trades for a wallet. |
| `POST` | `/jobs/sync-markets` | Enqueue a Gamma sync (body: `{ "limit"?: number }`). |
| `POST` | `/jobs/score-wallets` | Enqueue a scoring pass (body: `{ "limit"?: number }`). |

## Architecture

```
        ┌────────────────────┐
        │  Polymarket APIs   │
        │ Gamma / Data / CLOB│
        └─────────┬──────────┘
                  │ axios / ws
                  ▼
       ┌──────────────────────┐
       │ src/modules/polymarket │   API clients (isolated from business logic)
       └────────────┬───────────┘
                    ▼
  ┌─────────────────────────────────────┐
  │ Services (markets / wallets / alerts)│
  │  - market.service.ts                 │
  │  - wallet.service.ts                 │
  │  - wallet.scoring.ts                 │
  │  - alert.service.ts                  │
  └──────────────┬──────────────────────┘
                 │ Prisma
                 ▼
        ┌────────────────┐         ┌──────────┐
        │  PostgreSQL    │◀────────│  Redis   │ BullMQ queues:
        └────────────────┘         │          │  sync-markets
                                   │          │  score-wallets
                                   │          │  alerts
                                   └──────────┘
                 ▲
                 │ enqueue jobs
                 │
        ┌────────┴───────┐
        │   Express API  │  /jobs/sync-markets, /jobs/score-wallets, etc.
        └────────────────┘
                 │
                 ▼
        ┌────────────────┐
        │  Telegram Bot  │  alerts when smartScore ≥ threshold
        └────────────────┘
```

- **Clients** live in `src/modules/polymarket/` and only know how to talk to Polymarket. They never touch the database.
- **Services** orchestrate clients + Prisma. They are the only layer that knows the domain.
- **Workers** (`*.worker.ts`) consume BullMQ queues and call services. They run in-process by default (started from `server.ts`) but can be split out via `npm run worker:*`.
- **Scoring** is a single pure function — `WalletScoring.compute(wallet, trades)` — that returns a `ScoreBreakdown`. Swap in better signals without touching the rest of the pipeline.
- **Alerts** are deduplicated by a `(walletAddress, marketId)` unique constraint on `AlertLog`. Re-running scoring is safe.

## Deploy ke VPS (full Docker)

Semua dijalankan di Docker — `app` + `postgres` + `redis`. Port HTTP di-bind ke `127.0.0.1` saja, jadi API tidak terekspos ke internet (akses lewat SSH tunnel).

### Yang perlu disiapkan di VPS

| Item | Catatan |
| --- | --- |
| OS | Ubuntu 22.04 / 24.04 (atau distro lain dengan Docker support) |
| RAM | Minimum **2 GB** (Postgres + Redis + Node). 4 GB nyaman untuk pipeline interval pendek. |
| CPU | 2 vCPU cukup untuk MVP |
| Disk | 20 GB+ (Postgres tumbuh seiring jumlah trade) |
| Software | `docker` dan `docker compose plugin` (`docker compose version` harus jalan) |
| Akses jaringan keluar | `gamma-api.polymarket.com`, `data-api.polymarket.com`, `ws-subscriptions-clob.polymarket.com`, `api.telegram.org` (semua port 443) |
| Firewall (UFW) | `allow 22/tcp`, sisanya boleh `deny incoming`. Outbound bebas. |

### Secrets yang harus disiapkan

1. **Telegram bot token** — buat lewat [@BotFather](https://t.me/BotFather), perintah `/newbot`.
2. **Telegram chat id** — kirim pesan ke bot, lalu buka `https://api.telegram.org/bot<TOKEN>/getUpdates` untuk lihat `chat.id`. Atau pakai bot bantu seperti `@userinfobot`.
3. **Password Postgres** yang kuat (jangan pakai default `polymarket/polymarket`).

### Langkah deploy

```bash
# 1. Pasang Docker (di VPS)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER  # logout/login lagi setelah ini

# 2. Clone repo
git clone <repo-url> polymarket-smart-money
cd polymarket-smart-money

# 3. Siapkan .env (jangan commit!)
cp .env.example .env
nano .env
#   - DATABASE_URL boleh dibiarkan default; compose akan override-nya.
#   - Isi TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
#   - Ganti POSTGRES_PASSWORD dengan random string
#   - Set PIPELINE_INTERVAL_MINUTES=15 (atau berapa pun yang kamu mau)
#   - Set SMART_WALLET_SCORE_THRESHOLD sesuai preferensi

# 4. Build & jalankan
docker compose up -d --build

# 5. Cek status
docker compose ps
docker compose logs -f app

# 6. Cek health dari VPS sendiri
curl http://127.0.0.1:3000/health
```

API hanya bisa diakses dari dalam VPS. Untuk hit dari laptop:

```bash
# Di laptop kamu
ssh -L 3000:127.0.0.1:3000 user@vps.tokyo.example
# Lalu di tab lain:
curl http://127.0.0.1:3000/wallets/top
```

### Update / rebuild

```bash
git pull
docker compose up -d --build app
```

`prisma migrate deploy` dijalankan otomatis tiap container `app` start (lihat `CMD` di [Dockerfile](Dockerfile)), jadi migrasi schema baru langsung apply saat redeploy.

### Backup Postgres

Volume Docker `polymarket_postgres_data` menyimpan datanya. Untuk dump rutin:

```bash
docker compose exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > "backup-$(date +%F).sql.gz"
```

Pasang di cron VPS (mis. harian) dan rsync ke storage lain.

### Auto-scheduler

Kalau `PIPELINE_INTERVAL_MINUTES > 0`, server akan otomatis register repeatable job di BullMQ (lihat [pipeline.scheduler.ts](src/modules/pipeline/pipeline.scheduler.ts)). Ubah angka di `.env`, lalu `docker compose up -d app` — schedule lama dibersihkan dan diganti dengan yang baru.

## BTC 5m/15m Strategy

This project has been refactored into a **Binance-led Polymarket BTC short-duration intelligence engine**.

### How it works

1. **Binance is the primary signal source**. We stream real-time BTCUSDT futures data (trades, mark price, order book, liquidations) from Binance.
2. **Rolling metrics engine** computes BTC velocity (5s / 15s / 60s), volatility expansion, orderflow imbalance, bid-ask spread, and liquidation pressure — all in-memory.
3. **Model probability** is derived from the Binance signal score via a simple configurable formula.
4. **Polymarket odds tracker** subscribes to the Polymarket CLOB WebSocket for every active BTC 5-minute or 15-minute market and tracks best bid, best ask, and mid price.
5. **Discrepancy detector** compares the Binance model probability against the Polymarket mid-price probability. When the absolute edge exceeds `EDGE_THRESHOLD` (default 7%), a `BtcSignal` is generated.
6. **Telegram alerts** fire for high-confidence edges, with a per-market + per-side cooldown (`ALERT_COOLDOWN_SECONDS`).

### What is NOT implemented

- **No auto-trading or real-money execution**. The system only collects data, calculates signals, stores them, sends alerts, and exposes APIs.
- **No wallet scoring for BTC markets**. The original smart-wallet pipeline still runs but is orthogonal to the BTC signal flow.

### Relevant environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `BINANCE_WS_URL` | `wss://fstream.binance.com/stream` | Binance combined stream endpoint. |
| `EDGE_THRESHOLD` | `0.07` | Minimum absolute edge (0–1) to trigger a signal. |
| `MIN_LIQUIDITY` | `1000` | Minimum market volume (USD) to consider. |
| `MIN_SPREAD_MAX` | `0.05` | Maximum acceptable book spread (0–1). |
| `ALERT_COOLDOWN_SECONDS` | `60` | Cooldown between duplicate alerts for the same market + side. |

### New HTTP endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/btc/markets` | Active BTC 5m/15m markets. |
| `GET` | `/btc/metrics` | Latest Binance BTC metrics + signal score. |
| `GET` | `/btc/signals/latest` | Most recent 20 signals. |
| `GET` | `/btc/signals/history` | Queryable signal history (`?marketId=&side=&limit=`). |

## Roadmap

- **Better PnL**: ingest closed positions from the data API and compute realized PnL per market, not just per wallet.
- **Timing signal**: backfill each trade with the market's resolution price and score entries by how far below (or above) resolution they bought.
- **Order-book signals**: persist `OrderbookSnapshot` rows from the CLOB WebSocket and detect smart-wallet entries that coincide with sudden spread compression.
- **Smart wallet discovery**: schedule a periodic crawl over top market holders (`DataClient.getHolders`) to surface wallets we'd otherwise miss.
- **Alert routing**: support multiple chats (filtered by category, score band, etc.) and add a per-wallet snooze command.
- **Backtesting**: replay stored trades against historical resolutions to validate that the scoring weights actually predict future wallet performance.
- **API hardening**: add API keys + rate limiting on `/jobs/*` so the queue can't be flooded by anonymous callers.
