export interface ForexCandle {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}
export interface SwingPoint {
  index: number;
  epoch: number;
  price: number;
  kind: "high" | "low";
}
export interface CandlePattern {
  index: number;
  epoch: number;
  label: string;
  bias: "bullish" | "bearish" | "neutral";
}
export interface PriceZone {
  price: number;
  touches: number;
  lastTouch: number;
  distance: number;
}
export interface MarketStructure {
  label: string;
  detail: string;
  bullish: boolean;
  bearish: boolean;
}
export interface ForexAnalysis {
  candles: ForexCandle[];
  lastPrice: number | null;
  atr: number;
  patterns: CandlePattern[];
  latestPattern: CandlePattern | null;
  swings: SwingPoint[];
  structure: MarketStructure;
  support: PriceZone[];
  resistance: PriceZone[];
}
export type TradeSignal = 'STRONG_BUY' | 'BUY' | 'WAIT' | 'SELL' | 'STRONG_SELL' | 'NO_SIGNAL';

export interface SignalComponents {
  emaScore: number;
  patternScore: number;
  patternLabel: string;
  structureScore: number;
  atrActive: boolean;
}

export interface SignalResult {
  signal: TradeSignal;
  score: number;
  components: SignalComponents;
  suggestedSl: number | null;
  suggestedTp: number | null;
  entryPrice: number | null;
}

export const FOREX_CANDLE_PATTERNS: readonly string[];
export function normalizeCandles(candles: unknown): ForexCandle[];
export function calculateAtr(candles: ForexCandle[], period?: number): number;
export function calculateEma(candles: ForexCandle[], period: number): number;
export function detectCandlePatterns(candles: ForexCandle[], limit?: number): CandlePattern[];
export function findSwingPoints(candles: ForexCandle[], strength?: number): SwingPoint[];
export function analyzeForexCandles(candles: ForexCandle[], options?: {
  atrPeriod?: number; swingStrength?: number; patternLimit?: number;
}): ForexAnalysis;
export function computeSignal(
  m1Candles: ForexCandle[],
  m15Structure: { bullish: boolean; bearish: boolean },
  entryBid?: number,
  entryAsk?: number
): SignalResult;
