export type SignalSide = "YES" | "NO";

export interface BtcSignalOutput {
  marketId: string;
  question: string;
  side: SignalSide;
  polymarketProbability: number;
  modelProbability: number;
  edge: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
  timestamp: number;
}

export interface PolymarketOdds {
  marketId: string;
  tokenId: string;
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  spread: number;
  timestamp: number;
}
