const assert = require("node:assert/strict");
const test = require("node:test");

let analyzeSignal;
let completedCandleSeries;
let wilsonLowerBound;
let backtestStrategy;

test.before(async () => {
  ({ analyzeSignal, completedCandleSeries, wilsonLowerBound, backtestStrategy } =
    await import("../src/lib/bots/strategy-engine.mjs"));
});

function trendingPrices(direction = 1) {
  return Array.from({ length: 40 }, (_, index) =>
    100 + direction * index * 0.2 + Math.sin(index * 1.7) * 0.1,
  );
}

test("trend-following signals the direction of a sustained move", () => {
  assert.equal(analyzeSignal(trendingPrices(), "trend_following").reason, "fast_mean_above_slow_mean");
  assert.equal(analyzeSignal(trendingPrices(-1), "trend_following").direction, "PUT");
});

test("momentum signals a sufficiently strong short-horizon move", () => {
  const signal = analyzeSignal(trendingPrices(), "momentum");
  assert.equal(signal.reason, "positive_short_horizon_momentum");
  assert.equal(signal.direction, "CALL");
});

test("mean reversion fades a sustained deviation from the recent mean", () => {
  const prices = Array.from({ length: 64 }, (_, index) =>
    100 + Math.sin(index * 1.9) * 0.25 + (index >= 56 ? ((index - 55) / 8) : 0),
  );
  const signal = analyzeSignal(prices, "mean_reversion");
  assert.equal(signal.reason, "price_above_recent_mean");
  assert.equal(signal.direction, "PUT");
});

test("breakout signals a close beyond the prior range", () => {
  const prices = [
    ...Array.from({ length: 39 }, (_, index) => 100 + Math.sin(index * 2) * 0.05),
    101,
  ];
  const signal = analyzeSignal(prices, "breakout");
  assert.equal(signal.reason, "recent_high_breakout");
  assert.equal(signal.direction, "CALL");
});

test("unknown strategies, short history, and flat prices do not produce signals", () => {
  assert.equal(analyzeSignal(trendingPrices(), "other"), null);
  assert.equal(analyzeSignal([1, 2, 3], "momentum"), null);
  assert.equal(analyzeSignal(Array(40).fill(100), "trend_following"), null);
});

test("completed candle series omits invalid, duplicate, and unfinished candles", () => {
  const result = completedCandleSeries([
    { epoch: 10, close: 101 },
    { epoch: 10, close: 102 },
    { epoch: 20, close: 103 },
    { epoch: 30, close: 104 },
  ], 10, 30);

  assert.deepEqual(result, { prices: [102, 103], times: [20, 30] });
});

test("Wilson lower bound rejects invalid counts and stays below the observed rate", () => {
  assert.equal(wilsonLowerBound(2, 1), 0);
  assert.ok(wilsonLowerBound(40, 50) < 0.8);
});

test("backtest validates input and reports trades only for sufficient history", () => {
  const invalid = backtestStrategy({
    prices: [], times: [], strategy: "trend_following", durationSeconds: 1,
    payoutPerStake: 1.8,
  });
  assert.equal(invalid.valid, false);

  const prices = Array.from({ length: 64 }, (_, index) =>
    100 + index * 0.2 + Math.sin(index * 1.7) * 0.1,
  );
  const result = backtestStrategy({
    prices,
    times: prices.map((_, index) => index * 60),
    strategy: "trend_following",
    durationSeconds: 60,
    payoutPerStake: 1.8,
  });
  assert.equal(result.valid, true);
  assert.ok(result.trades > 0);
});