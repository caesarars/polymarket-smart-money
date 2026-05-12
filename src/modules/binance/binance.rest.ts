import axios, { AxiosInstance } from "axios";
import { logger } from "../../lib/logger";
import {
  BinanceAggTrade,
  BinanceBookTicker,
  BinanceMarkPrice,
} from "./binance.types";

export type BinanceRestEventHandler = (event: BinanceAggTrade | BinanceBookTicker | BinanceMarkPrice) => void;

interface BookTickerResponse {
  symbol: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
}

interface PremiumIndexResponse {
  symbol: string;
  markPrice: string;
  lastFundingRate?: string;
  nextFundingTime?: number;
  time?: number;
}

interface TradeResponse {
  id: number;
  price: string;
  qty: string;
  quoteQty: string;
  time: number;
  isBuyerMaker: boolean;
}

export class BinanceRestClient {
  private readonly http: AxiosInstance;
  private readonly handlers: Set<BinanceRestEventHandler> = new Set();
  private interval: NodeJS.Timeout | null = null;
  private running = false;
  private lastTradeId = 0;

  constructor() {
    this.http = axios.create({
      baseURL: "https://fapi.binance.com",
      timeout: 10_000,
      headers: { Accept: "application/json" },
    });
  }

  onEvent(handler: BinanceRestEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  start(pollMs = 2_000): void {
    if (this.running) return;
    this.running = true;
    logger.info({ pollMs }, "BinanceRestClient: starting REST polling");
    this.poll();
    this.interval = setInterval(() => this.poll(), pollMs);
  }

  stop(): void {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    logger.info("BinanceRestClient: stopped");
  }

  private async poll(): Promise<void> {
    await Promise.allSettled([
      this.fetchBookTicker(),
      this.fetchPremiumIndex(),
      this.fetchTrades(),
    ]);
  }

  private async fetchBookTicker(): Promise<void> {
    try {
      const { data } = await this.http.get<BookTickerResponse>("/fapi/v1/ticker/bookTicker", {
        params: { symbol: "BTCUSDT" },
      });
      const evt: BinanceBookTicker = {
        e: "bookTicker",
        E: Date.now(),
        s: data.symbol,
        b: data.bidPrice,
        B: data.bidQty,
        a: data.askPrice,
        A: data.askQty,
      };
      this.dispatch(evt);
    } catch (err) {
      logger.debug({ err }, "BinanceRestClient: bookTicker failed");
    }
  }

  private async fetchPremiumIndex(): Promise<void> {
    try {
      const { data } = await this.http.get<PremiumIndexResponse>("/fapi/v1/premiumIndex", {
        params: { symbol: "BTCUSDT" },
      });
      const evt: BinanceMarkPrice = {
        e: "markPriceUpdate",
        E: data.time ?? Date.now(),
        s: data.symbol,
        p: data.markPrice,
        r: data.lastFundingRate ?? "0",
        T: data.nextFundingTime ?? 0,
      };
      this.dispatch(evt);
    } catch (err) {
      logger.debug({ err }, "BinanceRestClient: premiumIndex failed");
    }
  }

  private async fetchTrades(): Promise<void> {
    try {
      const { data } = await this.http.get<TradeResponse[]>("/fapi/v1/trades", {
        params: { symbol: "BTCUSDT", limit: 100 },
      });
      const now = Date.now();
      for (const t of data) {
        if (t.id <= this.lastTradeId) continue;
        this.lastTradeId = t.id;
        const evt: BinanceAggTrade = {
          e: "aggTrade",
          E: t.time,
          s: "BTCUSDT",
          p: t.price,
          q: t.qty,
          m: t.isBuyerMaker,
        };
        this.dispatch(evt);
      }
    } catch (err) {
      logger.debug({ err }, "BinanceRestClient: trades failed");
    }
  }

  private dispatch(event: BinanceAggTrade | BinanceBookTicker | BinanceMarkPrice): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (err) {
        logger.error({ err }, "BinanceRestClient: handler error");
      }
    }
  }
}

export const binanceRestClient = new BinanceRestClient();
