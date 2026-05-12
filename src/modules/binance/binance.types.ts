/**
 * Normalised Binance event types for the BTCUSDT futures stream.
 * The raw exchange payloads are wider; we only surface fields we care about.
 */

export interface BinanceAggTrade {
  e: "aggTrade";
  E: number; // event time
  s: string; // symbol
  p: string; // price
  q: string; // quantity
  m: boolean; // is buyer the market maker?
}

export interface BinanceMarkPrice {
  e: "markPriceUpdate";
  E: number;
  s: string;
  p: string; // mark price
  r: string; // funding rate
  T: number; // next funding time
}

export interface BinanceBookTicker {
  e: "bookTicker";
  E: number;
  s: string;
  b: string; // best bid price
  B: string; // best bid qty
  a: string; // best ask price
  A: string; // best ask qty
}

export interface BinanceForceOrder {
  e: "forceOrder";
  E: number;
  o: {
    s: string;
    S: "BUY" | "SELL";
    q: string; // quantity
    p: string; // price
    z: string; // average price
  };
}

export type BinanceStreamEvent =
  | BinanceAggTrade
  | BinanceMarkPrice
  | BinanceBookTicker
  | BinanceForceOrder;

export interface BtcMetrics {
  lastPrice: number;
  markPrice: number;
  priceVelocity5s: number;
  priceVelocity15s: number;
  priceVelocity60s: number;
  volatilityExpansion: number;
  orderflowImbalance: number;
  bidAskSpread: number;
  liquidationPressure: number;
  timestamp: number;
}
