import WebSocket from "ws";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { ClobWsMessage } from "./polymarket.types";

export type ClobEventHandler = (msg: ClobWsMessage) => void;

interface SubscriptionMessage {
  type: "market";
  assets_ids: string[];
}

export class ClobWebSocketClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly handlers: Set<ClobEventHandler> = new Set();
  private subscribedTokens: Set<string> = new Set();
  private reconnectAttempts = 0;
  private readonly maxReconnectDelayMs = 30_000;
  private readonly baseReconnectDelayMs = 1_000;
  private shouldRun = false;
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(url: string = env.POLYMARKET_CLOB_WS_URL) {
    this.url = url;
  }

  onEvent(handler: ClobEventHandler): () => void {
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
        logger.warn({ err }, "ClobWebSocketClient: error while closing");
      }
      this.ws = null;
    }
  }

  subscribeToMarket(tokenIds: string[]): void {
    for (const id of tokenIds) this.subscribedTokens.add(id);
    this.sendSubscription();
  }

  private openSocket(): void {
    logger.info({ url: this.url }, "ClobWebSocketClient: connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectAttempts = 0;
      logger.info("ClobWebSocketClient: connected");
      this.sendSubscription();
      this.startHeartbeat();
    });

    ws.on("message", (raw: WebSocket.RawData) => {
      this.handleRaw(raw);
    });

    ws.on("close", (code, reason) => {
      logger.warn(
        { code, reason: reason?.toString() },
        "ClobWebSocketClient: socket closed",
      );
      this.cleanupSocket();
      if (this.shouldRun) this.scheduleReconnect();
    });

    ws.on("error", (err) => {
      logger.error({ err }, "ClobWebSocketClient: socket error");
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
          logger.warn({ err }, "ClobWebSocketClient: ping failed");
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
      "ClobWebSocketClient: reconnecting",
    );
    setTimeout(() => {
      if (this.shouldRun) this.openSocket();
    }, delay);
  }

  private sendSubscription(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.subscribedTokens.size === 0) return;
    const payload: SubscriptionMessage = {
      type: "market",
      assets_ids: Array.from(this.subscribedTokens),
    };
    try {
      this.ws.send(JSON.stringify(payload));
      logger.info(
        { count: payload.assets_ids.length },
        "ClobWebSocketClient: subscription sent",
      );
    } catch (err) {
      logger.error({ err }, "ClobWebSocketClient: failed to send subscription");
    }
  }

  private handleRaw(raw: WebSocket.RawData): void {
    let text: string;
    if (typeof raw === "string") text = raw;
    else if (Buffer.isBuffer(raw)) text = raw.toString("utf-8");
    else if (Array.isArray(raw)) text = Buffer.concat(raw).toString("utf-8");
    else text = String(raw);

    if (!text || text === "PONG") return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      logger.warn({ err, sample: text.slice(0, 200) }, "ClobWebSocketClient: invalid JSON frame");
      return;
    }

    const messages = Array.isArray(parsed) ? parsed : [parsed];
    for (const msg of messages) {
      if (!msg || typeof msg !== "object") continue;
      const typed = msg as ClobWsMessage;
      logger.debug(
        { event: typed.event_type, market: typed.market, asset: typed.asset_id },
        "ClobWebSocketClient: event",
      );
      for (const handler of this.handlers) {
        try {
          handler(typed);
        } catch (err) {
          logger.error({ err }, "ClobWebSocketClient: handler error");
        }
      }
    }
  }
}

export const clobWebSocketClient = new ClobWebSocketClient();
