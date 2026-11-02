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

export interface LiquidityLevels {
  bsl: number[];
  ssl: number[];
}

export interface SweepEvent {
  type: 'BSL' | 'SSL';
  level: number;
  epoch: number;
  wickExtreme: number;
}

export interface BosEvent {
  confirmed: boolean;
  bosLevel?: number;
  bosEpoch?: number;
}

export interface SmcSignal {
  signal: 'BUY' | 'SELL' | 'WAIT';
  type: 'SSL_SWEEP_BOS' | 'BSL_SWEEP_BOS' | null;
  sweepLevel: number | null;
  sweepLow: number | null;
  sweepHigh: number | null;
  bosLevel: number | null;
  entry: number | null;
  sl: number | null;
  tp: number | null;
  rrRatio: number | null;
  h1SweepLevel: number | null;
  confidence: 'HIGH' | 'MEDIUM' | null;
  h1Levels: LiquidityLevels;
  m15SweepEpoch: number | null;
  bosEpoch: number | null;
}

// ── Layer 1: Trendlines ────────────────────────────────────────────────────

export interface TrendlinePoint {
  epoch: number;
  price: number;
}

export interface Trendlines {
  uptrend: TrendlinePoint[] | null;
  downtrend: TrendlinePoint[] | null;
}

export function buildTrendlines(swings: SwingPoint[], structure: { bullish: boolean; bearish: boolean }): Trendlines;

// ── Layer 2: Sentiment ─────────────────────────────────────────────────────

export interface SentimentResult {
  score: number;
  label: 'BUYERS IN CONTROL' | 'SELLERS IN CONTROL' | 'NEUTRAL';
  bullish: boolean;
  bearish: boolean;
  candleRatio: number;
  aboveMidpoint: boolean;
}

export function computeSentiment(candles: ForexCandle[], structure: { bullish: boolean; bearish: boolean }): SentimentResult;

// ── Layer 3: Volume Profile ────────────────────────────────────────────────

export interface VolumeProfileBucket {
  price: number;
  weight: number;
  isVa: boolean;
  isPoc: boolean;
}

export interface VolumeProfileResult {
  buckets: VolumeProfileBucket[];
  poc: number;
  vah: number;
  val: number;
}

export function computeVolumeProfile(candles: ForexCandle[], anchorEpoch: number, buckets?: number): VolumeProfileResult;

// ── Layer 4: Trade Setup ───────────────────────────────────────────────────

export type TradeSetupAction = 'WATCH FOR BUY' | 'WATCH FOR SELL' | 'POSSIBLE BUY' | 'POSSIBLE SELL' | 'WAIT';
export type TradeSetupDirection = 'BUY' | 'SELL' | 'WAIT';

export interface TradeSetupResult {
  confluence: number;
  maxConfluence: number;
  structureAligned: boolean;
  sentimentAligned: boolean;
  nearPoc: boolean;
  direction: TradeSetupDirection;
  action: TradeSetupAction;
  poc: number;
  sl: number | null;
  tp: number | null;
  rrRatio: number | null;
  description: string;
}

export function computeTradeSetup(
  m1Candles: ForexCandle[],
  structure: { bullish: boolean; bearish: boolean; label: string },
  sentiment: SentimentResult,
  volumeProfile: VolumeProfileResult,
  livePrice: number | null,
  atr: number
): TradeSetupResult;

export function findLiquidityLevels(candles: ForexCandle[]): LiquidityLevels;
export function detectLiquiditySweep(candles: ForexCandle[], levels: LiquidityLevels): SweepEvent | null;
export function detectBreakOfStructure(candles: ForexCandle[], sweepEpoch: number, sweepType: 'BSL' | 'SSL'): BosEvent;
export function computeSmcSignal(
  m1Candles: ForexCandle[],
  m15Candles: ForexCandle[],
  h1Candles: ForexCandle[],
  currentBid?: number,
  currentAsk?: number
): SmcSignal;
