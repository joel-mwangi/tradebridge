const assert = require("node:assert/strict");
const test = require("node:test");
const enginePromise = import("../src/lib/bots/strategy-engine.mjs");

test("Wilson lower bound is conservative and invalid samples return zero", async () => {
  const { wilsonLowerBound } = await enginePromise;
  assert.equal(wilsonLowerBound(0, 0), 0);
  assert.ok(wilsonLowerBound(80, 100) < 0.8);
  assert.ok(wilsonLowerBound(80, 100) > wilsonLowerBound(60, 100));
});

test("signal engine refuses insufficient, flat, and invalid price history", async () => {
  const { analyzeSignal } = await enginePromise;
  assert.equal(analyzeSignal(Array(10).fill(100), "trend_following"), null);
  assert.equal(analyzeSignal(Array(50).fill(100), "trend_following"), null);
  assert.equal(analyzeSignal([1, 2, NaN, ...Array(40).fill(2)], "momentum"), null);
});

test("trend-following direction follows the recent trend without treating score as probability", async () => {
  const { analyzeSignal } = await enginePromise;
  const rising = Array.from({ length: 80 }, (_, i) => 100 + i * 0.5);
  const risingSignal = analyzeSignal(rising, "trend_following");
  assert.equal(risingSignal.direction, "CALL");
  assert.ok(risingSignal.score > 0 && risingSignal.score <= 1);
  assert.equal(analyzeSignal(rising.map((value) => 200 - value), "trend_following").direction, "PUT");
});

test("backtest uses chronological holdout data and labels the payout assumption", async () => {
  const { backtestStrategy } = await enginePromise;
  const prices = Array.from({ length: 400 }, (_, i) => 100 + Math.sin(i / 4) + i * 0.006);
  const times = Array.from({ length: prices.length }, (_, i) => i);
  const result = backtestStrategy({ prices, times, strategy: "trend_following", durationSeconds: 5, payoutPerStake: 1.8 });
  assert.equal(result.valid, true);
  assert.ok(result.trades >= 0);
  assert.ok(result.wilsonLower95 >= 0 && result.wilsonLower95 <= 1);
  assert.equal(result.payoutAssumption, 1.8);
  assert.ok(result.firstEntryTime === null || result.firstEntryTime >= Math.floor(prices.length * 0.7));
});

test("entry gate rejects weak samples, breached loss limits, and open exposure", async () => {
  const { evaluateEntry, MIN_BACKTEST_TRADES } = await enginePromise;
  const base = {
    signal: { direction: "CALL", score: 0.8, reason: "test", price: 100 },
    backtest: { valid: true, trades: MIN_BACKTEST_TRADES, wilsonLower95: 0.75 },
    askPrice: 1, payout: 1.8, configuredStake: 1, balance: 1000,
    dailyPnl: 0, dailyLossLimit: 5, tradesToday: 1, maxTradesPerDay: 20,
    consecutiveLosses: 0, maxConsecutiveLosses: 3, openPositionCount: 0,
    lastTradeAt: null, now: 100000, cooldownSeconds: 30,
  };
  assert.equal(evaluateEntry({ ...base, backtest: { ...base.backtest, trades: 10 } }).reason, "insufficient_backtest");
  assert.equal(evaluateEntry({ ...base, dailyPnl: -5 }).reason, "daily_loss_limit");
  assert.equal(evaluateEntry({ ...base, openPositionCount: 1 }).reason, "open_position_exists");
  assert.equal(evaluateEntry({ ...base, balance: 50 }).reason, "stake_exceeds_balance_fraction");
  assert.equal(evaluateEntry(base).allowed, true);
  assert.equal(evaluateEntry({ ...base, backtest: { ...base.backtest, wilsonLower95: 0.55 } }).reason, "edge_not_proven");
});


test("history bars are completed and aligned to the contract expiry horizon", async () => {
  const { granularityForDuration, completedCandleSeries } = await enginePromise;
  const series = completedCandleSeries([
    { epoch: 120, close: 102 },
    { epoch: 60, close: 101 },
    { epoch: 180, close: 103 },
    { epoch: 240, close: 104 },
    { epoch: -1, close: 100 },
    { epoch: 0, close: 0 },
  ], 60, 300);
  assert.deepEqual(series.prices, [101, 102, 103, 104]);
  assert.deepEqual(series.times, [120, 180, 240, 300]);
});
