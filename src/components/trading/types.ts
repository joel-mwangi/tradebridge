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
  lastDigit?: number;
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

export type DigitContractMode = "over-under" | "even-odd" | "matches-differs";
export type DigitPrediction = "OVER" | "UNDER" | "EVEN" | "ODD" | "MATCHES" | "DIFFERS";
export type DigitContractType = "DIGITOVER" | "DIGITUNDER" | "DIGITEVEN" | "DIGITODD" | "DIGITMATCH" | "DIGITDIFF";

export interface DemoQuote {
  id: string;
  askPrice: number;
  payout: number | null;
  symbol: string;
  contractType: DigitContractType;
  barrier?: string;
  durationUnit: "s" | "t";
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
  outcome: "open" | "won" | "lost" | "breakeven" | "cancelled" | "unknown";
  currency: string;
  startedAt: number | null;
  expiresAt: number | null;
  status: "open" | "settled";
  providerStatus: string;
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
