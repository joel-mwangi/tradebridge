export type StrategyType = "trend_following" | "mean_reversion" | "breakout" | "momentum";
export type Direction = "CALL" | "PUT";

export interface Signal {
  direction: Direction;
  score: number;
  reason: string;
  price: number;
}

export interface BacktestResult {
  valid: boolean;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  wilsonLower95: number;
  expectedReturnPerStake: number;
  netReturnPerStake: number;
  profitFactor: number;
  maxDrawdown: number;
  reason: string;
  payoutAssumption: number;
  firstEntryTime?: number | null;
  lastEntryTime?: number | null;
}

export interface BacktestInput {
  prices: number[];
  times: number[];
  strategy: StrategyType | string;
  durationSeconds: number;
  payoutPerStake: number;
  holdoutFraction?: number;
}

export interface EntryGateInput {
  signal: Signal | null;
  backtest: BacktestResult | null | undefined;
  askPrice: number;
  payout: number;
  configuredStake: number;
  balance: number;
  dailyPnl: number;
  dailyLossLimit: number;
  tradesToday: number;
  maxTradesPerDay: number;
  consecutiveLosses: number;
  maxConsecutiveLosses: number;
  openPositionCount: number;
  lastTradeAt: number | null;
  now: number;
  cooldownSeconds: number;
  maxStakeFraction?: number;
  minExpectedReturn?: number;
}

export interface EntryGateResult {
  allowed: boolean;
  reason: string;
  expectedReturnAtLowerBound: number | null;
}

export const STRATEGY_ENGINE_VERSION: string;
export const MIN_BACKTEST_TRADES: number;

export function analyzeSignal(prices: number[], strategy: StrategyType | string): Signal | null;
export function wilsonLowerBound(wins: number, trades: number, z?: number): number;
export function backtestStrategy(input: BacktestInput): BacktestResult;
export function evaluateEntry(input: EntryGateInput): EntryGateResult;

export interface HistoricalCandle {
  epoch?: number | string;
  close?: number | string;
}
export interface CandleSeries {
  prices: number[];
  times: number[];
}
export function completedCandleSeries(candles: HistoricalCandle[], granularity: number, nowEpoch: number): CandleSeries;
