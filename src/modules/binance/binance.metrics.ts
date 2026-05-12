import {
  BinanceAggTrade,
  BinanceBookTicker,
  BinanceForceOrder,
  BinanceMarkPrice,
  BinanceStreamEvent,
  BtcMetrics,
} from "./binance.types";

interface PricePoint {
  price: number;
  timestamp: number;
}

interface TradeBucket {
  buyQty: number;
  sellQty: number;
  timestamp: number;
}

interface LiquidationBucket {
  buyQty: number;
  sellQty: number;
  timestamp: number;
}

function toNum(v: string | number | undefined): number {
  if (v === undefined) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function clamp(n: number, min = 0, max = 1): number {
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export class BinanceMetricsEngine {
  private priceHistory: PricePoint[] = [];
  private tradeHistory: TradeBucket[] = [];
  private liquidationHistory: LiquidationBucket[] = [];
  private lastBook: { bid: number; ask: number; timestamp: number } | null = null;
  private lastPrice = 0;
  private lastMarkPrice = 0;

  private readonly maxPriceHistoryMs = 90_000;
  private readonly maxTradeHistoryMs = 60_000;
  private readonly maxLiquidationHistoryMs = 60_000;

  onEvent(event: BinanceStreamEvent): void {
    switch (event.e) {
      case "aggTrade":
        this.handleAggTrade(event);
        break;
      case "markPriceUpdate":
        this.handleMarkPrice(event);
        break;
      case "bookTicker":
        this.handleBookTicker(event);
        break;
      case "forceOrder":
        this.handleForceOrder(event);
        break;
      default:
        break;
    }
  }

  private handleAggTrade(t: BinanceAggTrade): void {
    const price = toNum(t.p);
    const qty = toNum(t.q);
    const timestamp = t.E || Date.now();

    if (price > 0) {
      this.lastPrice = price;
      this.priceHistory.push({ price, timestamp });
    }

    if (qty > 0) {
      const isBuyerMaker = t.m;
      // If buyer is maker, it's a sell market order hitting the bid.
      const bucket: TradeBucket = {
        buyQty: isBuyerMaker ? 0 : qty,
        sellQty: isBuyerMaker ? qty : 0,
        timestamp,
      };
      this.tradeHistory.push(bucket);
    }

    this.trimHistory();
  }

  private handleMarkPrice(m: BinanceMarkPrice): void {
    const price = toNum(m.p);
    if (price > 0) {
      this.lastMarkPrice = price;
    }
  }

  private handleBookTicker(b: BinanceBookTicker): void {
    const bid = toNum(b.b);
    const ask = toNum(b.a);
    if (bid > 0 && ask > 0) {
      this.lastBook = { bid, ask, timestamp: b.E || Date.now() };
    }
  }

  private handleForceOrder(o: BinanceForceOrder): void {
    const qty = toNum(o.o.q);
    const timestamp = o.E || Date.now();
    const isBuy = o.o.S === "BUY";

    if (qty > 0) {
      this.liquidationHistory.push({
        buyQty: isBuy ? qty : 0,
        sellQty: isBuy ? 0 : qty,
        timestamp,
      });
    }

    this.trimHistory();
  }

  private trimHistory(): void {
    const now = Date.now();
    this.priceHistory = this.priceHistory.filter(
      (p) => now - p.timestamp <= this.maxPriceHistoryMs,
    );
    this.tradeHistory = this.tradeHistory.filter(
      (t) => now - t.timestamp <= this.maxTradeHistoryMs,
    );
    this.liquidationHistory = this.liquidationHistory.filter(
      (l) => now - l.timestamp <= this.maxLiquidationHistoryMs,
    );
  }

  compute(): BtcMetrics {
    const now = Date.now();
    this.trimHistory();

    const price = this.lastPrice || this.lastMarkPrice || 0;

    const velocity5s = this.computeVelocity(5_000);
    const velocity15s = this.computeVelocity(15_000);
    const velocity60s = this.computeVelocity(60_000);

    const volatility = this.computeVolatility();
    const orderflow = this.computeOrderflowImbalance();
    const spread = this.computeSpread(price);
    const liqPressure = this.computeLiquidationPressure();

    return {
      lastPrice: price,
      markPrice: this.lastMarkPrice,
      priceVelocity5s: velocity5s,
      priceVelocity15s: velocity15s,
      priceVelocity60s: velocity60s,
      volatilityExpansion: volatility,
      orderflowImbalance: orderflow,
      bidAskSpread: spread,
      liquidationPressure: liqPressure,
      timestamp: now,
    };
  }

  private computeVelocity(windowMs: number): number {
    const now = Date.now();
    const recent = this.priceHistory.filter(
      (p) => now - p.timestamp <= windowMs,
    );
    if (recent.length < 2) return 0;
    const first = recent[0].price;
    const last = recent[recent.length - 1].price;
    if (first === 0) return 0;
    return (last - first) / first;
  }

  private computeVolatility(): number {
    const now = Date.now();
    const windowMs = 60_000;
    const points = this.priceHistory.filter(
      (p) => now - p.timestamp <= windowMs,
    );
    if (points.length < 2) return 0;
    const returns: number[] = [];
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1].price;
      if (prev === 0) continue;
      returns.push((points[i].price - prev) / prev);
    }
    if (returns.length === 0) return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
    return Math.sqrt(variance);
  }

  private computeOrderflowImbalance(): number {
    const now = Date.now();
    const windowMs = 30_000;
    const recent = this.tradeHistory.filter(
      (t) => now - t.timestamp <= windowMs,
    );
    if (recent.length === 0) return 0;
    const buyQty = recent.reduce((a, t) => a + t.buyQty, 0);
    const sellQty = recent.reduce((a, t) => a + t.sellQty, 0);
    const total = buyQty + sellQty;
    if (total === 0) return 0;
    // Normalised to [-1, 1]
    return (buyQty - sellQty) / total;
  }

  private computeSpread(price: number): number {
    if (!this.lastBook || price === 0) return 0;
    return (this.lastBook.ask - this.lastBook.bid) / price;
  }

  private computeLiquidationPressure(): number {
    const now = Date.now();
    const windowMs = 60_000;
    const recent = this.liquidationHistory.filter(
      (l) => now - l.timestamp <= windowMs,
    );
    if (recent.length === 0) return 0;
    const buyQty = recent.reduce((a, l) => a + l.buyQty, 0);
    const sellQty = recent.reduce((a, l) => a + l.sellQty, 0);
    const total = buyQty + sellQty;
    if (total === 0) return 0;
    // Normalised to [-1, 1]; positive = long liquidations (sell pressure)
    return (sellQty - buyQty) / total;
  }
}

/**
 * Map raw BTC metrics into a 0–100 signal score.
 *
 * Weights:
 *   velocity 40%
 *   orderflow 20%
 *   liquidation 20%
 *   volatility 20%
 */
export function calculateBtcSignalScore(metrics: BtcMetrics): number {
  // Velocity score: reward strong directional moves, penalise chop.
  const velocityMagnitude = Math.abs(metrics.priceVelocity15s);
  const velocityDirection = Math.sign(metrics.priceVelocity15s);
  // Score 0..100 based on magnitude; cap at ~2% move in 15s for full score.
  const velocityScore = clamp(velocityMagnitude / 0.02, 0, 1) * 100;

  // Orderflow score: reward strong imbalance aligned with velocity.
  const orderflowAligned =
    velocityDirection * metrics.orderflowImbalance > 0
      ? Math.abs(metrics.orderflowImbalance)
      : Math.abs(metrics.orderflowImbalance) * 0.3;
  const orderflowScore = clamp(orderflowAligned, 0, 1) * 100;

  // Liquidation score: reward liquidations that reinforce the move.
  const liqAligned =
    velocityDirection * metrics.liquidationPressure > 0
      ? Math.abs(metrics.liquidationPressure)
      : Math.abs(metrics.liquidationPressure) * 0.3;
  const liquidationScore = clamp(liqAligned, 0, 1) * 100;

  // Volatility score: moderate expansion is good; extreme expansion reduces confidence.
  const volatilityScore = clamp(
    1 - Math.abs(metrics.volatilityExpansion - 0.001) / 0.005,
    0,
    1,
  ) * 100;

  const score =
    velocityScore * 0.40 +
    orderflowScore * 0.20 +
    liquidationScore * 0.20 +
    volatilityScore * 0.20;

  return clamp(score, 0, 100);
}

/**
 * Convert a BTC signal score into an estimated probability (0–1) for a
 * directional move. This is intentionally simple: a score of 50 maps to
 * 0.50 (no edge), and a score of 100 maps to ~0.70.
 */
export function btcSignalScoreToProbability(score: number): number {
  return clamp(0.50 + (score - 50) / 100, 0.05, 0.95);
}
