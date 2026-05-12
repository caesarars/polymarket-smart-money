import { logger } from "../../lib/logger";
import {
  BinanceMetricsEngine,
  calculateBtcSignalScore,
  btcSignalScoreToProbability,
} from "./binance.metrics";
import { binanceRestClient } from "./binance.rest";
import { binanceWebSocketClient } from "./binance.ws";
import { BtcMetrics } from "./binance.types";

export class BinanceService {
  private readonly metricsEngine = new BinanceMetricsEngine();
  private wsUnsubscribe: (() => void) | null = null;
  private restUnsubscribe: (() => void) | null = null;
  private latestMetrics: BtcMetrics | null = null;
  private latestSignalScore = 0;
  private latestProbability = 0.5;

  start(): void {
    // --- WebSocket (primary) ---
    if (!this.wsUnsubscribe) {
      this.wsUnsubscribe = binanceWebSocketClient.onEvent((event) => {
        this.metricsEngine.onEvent(event);
        this.updateSnapshot();
      });
      binanceWebSocketClient.connect();
    }

    // --- REST polling (fallback / supplement) ---
    if (!this.restUnsubscribe) {
      this.restUnsubscribe = binanceRestClient.onEvent((event) => {
        this.metricsEngine.onEvent(event);
        this.updateSnapshot();
      });
      binanceRestClient.start(2_000);
    }

    logger.info("BinanceService: started (WS + REST)");
  }

  stop(): void {
    if (this.wsUnsubscribe) {
      this.wsUnsubscribe();
      this.wsUnsubscribe = null;
    }
    if (this.restUnsubscribe) {
      this.restUnsubscribe();
      this.restUnsubscribe = null;
    }
    binanceWebSocketClient.close();
    binanceRestClient.stop();
    logger.info("BinanceService: stopped");
  }

  private updateSnapshot(): void {
    const metrics = this.metricsEngine.compute();
    this.latestMetrics = metrics;
    this.latestSignalScore = calculateBtcSignalScore(metrics);
    this.latestProbability = btcSignalScoreToProbability(this.latestSignalScore);
  }

  getLatestMetrics(): BtcMetrics | null {
    return this.latestMetrics;
  }

  getLatestSignalScore(): number {
    return this.latestSignalScore;
  }

  getLatestProbability(): number {
    return this.latestProbability;
  }
}

export const binanceService = new BinanceService();
