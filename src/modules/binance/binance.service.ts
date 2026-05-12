import { logger } from "../../lib/logger";
import {
  BinanceMetricsEngine,
  calculateBtcSignalScore,
  btcSignalScoreToProbability,
} from "./binance.metrics";
import { binanceWebSocketClient } from "./binance.ws";
import { BtcMetrics } from "./binance.types";

export class BinanceService {
  private readonly metricsEngine = new BinanceMetricsEngine();
  private unsubscribe: (() => void) | null = null;
  private latestMetrics: BtcMetrics | null = null;
  private latestSignalScore = 0;
  private latestProbability = 0.5;

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = binanceWebSocketClient.onEvent((event) => {
      this.metricsEngine.onEvent(event);
      this.updateSnapshot();
    });
    binanceWebSocketClient.connect();
    logger.info("BinanceService: started");
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    binanceWebSocketClient.close();
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
