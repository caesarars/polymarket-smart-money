import WebSocket from "ws";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { signalService } from "../signals/signal.service";
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

      // --- BTC odds tracking: normalise best bid/ask into PolymarketOdds ---
      this.maybeTrackOdds(typed);

      for (const handler of this.handlers) {
        try {
          handler(typed);
        } catch (err) {
          logger.error({ err }, "ClobWebSocketClient: handler error");
        }
      }
    }
  }

  private maybeTrackOdds(msg: ClobWsMessage): void {
    // The CLOB WS sends "book" events with bids/asks arrays, or
    // "last_trade_price" with a single price. We normalise whatever we can.
    if (msg.event_type !== "book" && msg.event_type !== "last_trade_price") {
      return;
    }

    const assetId = typeof msg.asset_id === "string" ? msg.asset_id : undefined;
    if (!assetId) return;

    let bestBid = 0;
    let bestAsk = 0;

    if (msg.event_type === "book" && Array.isArray(msg.bids) && Array.isArray(msg.asks)) {
      const bids = msg.bids as Array<{ price?: string | number; size?: string | number }>;
      const asks = msg.asks as Array<{ price?: string | number; size?: string | number }>;
      const topBid = bids[0];
      const topAsk = asks[0];
      if (topBid) bestBid = typeof topBid.price === "string" ? parseFloat(topBid.price) : Number(topBid.price) || 0;
      if (topAsk) bestAsk = typeof topAsk.price === "string" ? parseFloat(topAsk.price) : Number(topAsk.price) || 0;
    } else if (msg.event_type === "last_trade_price" && typeof msg.price === "string") {
      const price = parseFloat(msg.price);
      bestBid = price;
      bestAsk = price;
    }

    if (bestBid <= 0 && bestAsk <= 0) return;

    // Map asset_id back to Market via a lightweight in-memory lookup.
    // Because we don't have the marketId in the WS message, we rely on
    // signalService to resolve it. For now we pass assetId as the tokenId
    // and let the signal layer match it.
    const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;
    const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;

    // Fire-and-forget: don't block the WS loop on DB writes.
    void signalService.onOddsUpdate({
      marketId: assetId, // temporary; signalService will resolve via lookup if needed
      tokenId: assetId,
      bestBid,
      bestAsk,
      midPrice: mid,
      spread,
      timestamp: Date.now(),
    });
  }
}

export const clobWebSocketClient = new ClobWebSocketClient();
