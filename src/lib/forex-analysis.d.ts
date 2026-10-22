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
export const FOREX_CANDLE_PATTERNS: readonly string[];
export function normalizeCandles(candles: unknown): ForexCandle[];
export function calculateAtr(candles: ForexCandle[], period?: number): number;
export function detectCandlePatterns(candles: ForexCandle[], limit?: number): CandlePattern[];
export function findSwingPoints(candles: ForexCandle[], strength?: number): SwingPoint[];
export function analyzeForexCandles(candles: ForexCandle[], options?: {
  atrPeriod?: number; swingStrength?: number; patternLimit?: number;
}): ForexAnalysis;
