import WebSocket from "ws";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { BinanceStreamEvent } from "./binance.types";

export type BinanceEventHandler = (event: BinanceStreamEvent) => void;

const SUBSCRIBE_MESSAGE = {
  method: "SUBSCRIBE",
  params: [
    "btcusdt@aggTrade",
    "btcusdt@markPrice@1s",
    "btcusdt@bookTicker",
    "btcusdt@forceOrder",
  ],
  id: 1,
};

export class BinanceWebSocketClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly handlers: Set<BinanceEventHandler> = new Set();
  private reconnectAttempts = 0;
  private readonly maxReconnectDelayMs = 30_000;
  private readonly baseReconnectDelayMs = 1_000;
  private shouldRun = false;
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(url: string = env.BINANCE_WS_URL) {
    this.url = url;
  }

  onEvent(handler: BinanceEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  connect(): void {
    this.shouldRun = true;
    this.openSocket();
  }

  close(): void {
    this.shouldRun = false;
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      try {
        this.ws.close(1000, "client_shutdown");
      } catch (err) {
        logger.warn({ err }, "BinanceWebSocketClient: error while closing");
      }
      this.ws = null;
    }
  }

  private openSocket(): void {
    logger.info({ url: this.url }, "BinanceWebSocketClient: connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectAttempts = 0;
      logger.info("BinanceWebSocketClient: connected");
      this.sendSubscription();
      this.startHeartbeat();
    });

    ws.on("message", (raw: WebSocket.RawData) => {
      this.handleRaw(raw);
    });

    ws.on("close", (code, reason) => {
      logger.warn(
        { code, reason: reason?.toString() },
        "BinanceWebSocketClient: socket closed",
      );
      this.cleanupSocket();
      if (this.shouldRun) this.scheduleReconnect();
    });

    ws.on("error", (err) => {
      logger.error({ err }, "BinanceWebSocketClient: socket error");
    });
  }

  private cleanupSocket(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.ws = null;
  }

  private startHeartbeat(): void {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.ping();
        } catch (err) {
          logger.warn({ err }, "BinanceWebSocketClient: ping failed");
        }
      }
    }, 25_000);
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts += 1;
    const delay = Math.min(
      this.maxReconnectDelayMs,
      this.baseReconnectDelayMs * 2 ** Math.min(this.reconnectAttempts, 6),
    );
    logger.info(
      { delayMs: delay, attempt: this.reconnectAttempts },
      "BinanceWebSocketClient: reconnecting",
    );
    setTimeout(() => {
      if (this.shouldRun) this.openSocket();
    }, delay);
  }

  private sendSubscription(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(SUBSCRIBE_MESSAGE));
      logger.info("BinanceWebSocketClient: subscription sent");
    } catch (err) {
      logger.error({ err }, "BinanceWebSocketClient: failed to send subscription");
    }
  }

  private handleRaw(raw: WebSocket.RawData): void {
    let text: string;
    if (typeof raw === "string") text = raw;
    else if (Buffer.isBuffer(raw)) text = raw.toString("utf-8");
    else if (Array.isArray(raw)) text = Buffer.concat(raw).toString("utf-8");
    else text = String(raw);

    if (!text) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      logger.warn({ err, sample: text.slice(0, 200) }, "BinanceWebSocketClient: invalid JSON frame");
      return;
    }

    if (!parsed || typeof parsed !== "object") return;

    // Ignore subscription confirmation frames (they have "result" key)
    if ("result" in parsed) return;

    const event = parsed as BinanceStreamEvent;
    logger.debug(
      { event: event.e },
      "BinanceWebSocketClient: event",
    );

    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (err) {
        logger.error({ err }, "BinanceWebSocketClient: handler error");
      }
    }
  }
}

export const binanceWebSocketClient = new BinanceWebSocketClient();
