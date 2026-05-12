import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { Market } from "@prisma/client";
import {
  BtcSignalOutput,
  PolymarketOdds,
  SignalSide,
} from "./signal.types";

function clamp(n: number, min = 0, max = 1): number {
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function abs(n: number): number {
  return Math.abs(n);
}

export class DiscrepancyDetector {
  /**
   * Compare Binance-derived model probability against Polymarket mid-price
   * probability for a single BTC market.
   *
   * Returns a signal when the absolute edge exceeds EDGE_THRESHOLD, the market
   * spread is within MIN_SPREAD_MAX, and implied liquidity looks reasonable.
   */
  detect(
    market: Market,
    odds: PolymarketOdds,
    modelProbability: number,
  ): BtcSignalOutput | null {
    const threshold = env.EDGE_THRESHOLD;
    const minLiquidity = env.MIN_LIQUIDITY;
    const maxSpread = env.MIN_SPREAD_MAX;

    const polymarketProbability = odds.midPrice;
    const spread = odds.spread;

    if (spread > maxSpread) {
      logger.debug(
        { marketId: market.id, spread },
        "DiscrepancyDetector: spread too wide",
      );
      return null;
    }

    if (market.volume < minLiquidity) {
      logger.debug(
        { marketId: market.id, volume: market.volume },
        "DiscrepancyDetector: liquidity too low",
      );
      return null;
    }

    const edge = modelProbability - polymarketProbability;
    if (abs(edge) < threshold) {
      return null;
    }

    const side: SignalSide = edge > 0 ? "YES" : "NO";
    const confidence = this.deriveConfidence(abs(edge), spread);
    const reason = this.buildReason(edge, modelProbability, polymarketProbability);

    return {
      marketId: market.id,
      question: market.question,
      side,
      polymarketProbability: clamp(polymarketProbability, 0, 1),
      modelProbability: clamp(modelProbability, 0, 1),
      edge: clamp(edge, -1, 1),
      confidence,
      reason,
      timestamp: Date.now(),
    };
  }

  private deriveConfidence(
    edge: number,
    spread: number,
  ): "HIGH" | "MEDIUM" | "LOW" {
    // Wider spreads reduce confidence because execution is more uncertain.
    const spreadPenalty = spread / env.MIN_SPREAD_MAX;
    if (edge > 0.12 && spreadPenalty < 0.5) return "HIGH";
    if (edge > 0.07 && spreadPenalty < 1.0) return "MEDIUM";
    return "LOW";
  }

  private buildReason(
    edge: number,
    modelProbability: number,
    polymarketProbability: number,
  ): string {
    const direction = edge > 0 ? "higher" : "lower";
    return [
      `Model probability (${(modelProbability * 100).toFixed(1)}%) is ${direction} than Polymarket mid (${(polymarketProbability * 100).toFixed(1)}%).`,
      "BTC momentum and orderflow are stronger than current Polymarket pricing.",
    ].join(" ");
  }
}

export const discrepancyDetector = new DiscrepancyDetector();
