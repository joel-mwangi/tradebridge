export interface DerivAccount {
  account_id: string;
  balance: number | null;
  currency: string | null;
  account_type: string | null;
  status: string | null;
}

export interface MarketInstrument {
  symbol: string;
  name: string;
  market?: string;
  isTradingSuspended?: boolean;
}

export interface PricePoint {
  time: number;
  price: number;
}

export interface MarketSnapshot {
  quote: number;
  updatedAt: number;
  points: PricePoint[];
}

export interface MarketCandle {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface DemoQuote {
  id: string;
  askPrice: number;
  payout: number | null;
  symbol: string;
  contractType: "CALL" | "PUT";
  stake: number;
  duration: number;
  currency: string;
  receivedAt: number;
}

export interface OpenPosition {
  contractId: string;
  symbol: string;
  contractType: string;
  buyPrice: number | null;
  currentSpot: number | null;
  payout: number | null;
  profit: number | null;
  currency: string;
  startedAt: number | null;
  expiresAt: number | null;
  status: string;
  longcode: string;
}

export interface AccountActivity {
  id: string;
  time: number | null;
  action: string;
  description: string;
  amount: number | null;
  balance: number | null;
  currency: string;
  contractId?: string;
  profit?: number | null;
}
