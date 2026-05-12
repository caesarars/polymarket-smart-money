// TODO: response shapes are based on Polymarket public docs at time of writing.
// Adjust these once you have concrete sample responses captured in fixtures.

export interface GammaMarket {
  id: string | number;
  question: string;
  slug?: string;
  category?: string;
  endDate?: string;
  volume?: number | string;
  active?: boolean;
  closed?: boolean;
  // tokenYes/tokenNo on gamma are exposed via clobTokenIds (stringified JSON array)
  clobTokenIds?: string | string[];
  outcomes?: string | string[];
  conditionId?: string;
  marketMakerAddress?: string;
}

export interface GammaEvent {
  id: string | number;
  title: string;
  slug?: string;
  category?: string;
  endDate?: string;
  markets?: GammaMarket[];
}

export interface DataTrade {
  proxyWallet?: string;
  wallet?: string;
  market?: string;
  conditionId?: string;
  asset?: string;       // token id
  tokenId?: string;
  side?: "BUY" | "SELL" | string;
  price?: number | string;
  size?: number | string;
  timestamp?: number | string;
  [key: string]: unknown;
}

export interface DataActivity {
  proxyWallet?: string;
  wallet?: string;
  type?: string;
  market?: string;
  conditionId?: string;
  asset?: string;
  side?: string;
  price?: number | string;
  size?: number | string;
  timestamp?: number | string;
  [key: string]: unknown;
}

export interface DataPosition {
  proxyWallet?: string;
  wallet?: string;
  market?: string;
  conditionId?: string;
  asset?: string;
  size?: number | string;
  avgPrice?: number | string;
  curPrice?: number | string;
  realizedPnl?: number | string;
  unrealizedPnl?: number | string;
  [key: string]: unknown;
}

export interface DataHolder {
  proxyWallet?: string;
  wallet?: string;
  asset?: string;
  amount?: number | string;
  [key: string]: unknown;
}

// CLOB WebSocket message envelopes
export type ClobWsEventType =
  | "price_change"
  | "book"
  | "trade"
  | "last_trade_price"
  | "tick_size_change"
  | string;

export interface ClobWsMessage {
  event_type: ClobWsEventType;
  market?: string;
  asset_id?: string;
  timestamp?: string | number;
  [key: string]: unknown;
}
