import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeForexCandles,
  calculateAtr,
  detectCandlePatterns,
  findSwingPoints,
  normalizeCandles,
} from "../src/lib/forex-analysis.mjs";

function candle(epoch, open, high, low, close) {
  return { epoch, open, high, low, close };
}

test("normalizeCandles sorts candles, keeps the latest value for duplicate epochs and rejects invalid OHLC", () => {
  const result = normalizeCandles([
    candle(2, 10, 12, 9, 11),
    candle(1, 9, 10, 8, 9.5),
    candle(2, 10, 13, 9, 12),
    candle(3, 7, 6, 8, 7),
  ]);
  assert.deepEqual(result.map((item) => item.epoch), [1, 2]);
  assert.equal(result[1].high, 13);
});

test("calculateAtr uses true range and returns zero without enough bars", () => {
  assert.equal(calculateAtr([candle(1, 10, 11, 9, 10)], 14), 0);
  const bars = [
    candle(1, 10, 12, 9, 11),
    candle(2, 12, 15, 10, 14),
  ];
  assert.equal(calculateAtr(bars, 14), 5);
});

test("detectCandlePatterns recognises bullish and bearish engulfing formations", () => {
  const bullish = detectCandlePatterns([
    candle(1, 10, 10.5, 7.5, 8),
    candle(2, 7.7, 10.8, 7.2, 10.4),
  ]);
  assert.equal(bullish.at(-1).label, "Bullish engulfing");
  assert.equal(bullish.at(-1).bias, "bullish");

  const bearish = detectCandlePatterns([
    candle(1, 8, 10.5, 7.5, 10),
    candle(2, 10.3, 10.8, 7.2, 7.6),
  ]);
  assert.equal(bearish.at(-1).label, "Bearish engulfing");
});

test("detectCandlePatterns recognises doji and inside bars", () => {
  const doji = detectCandlePatterns([
    candle(1, 10, 11, 9, 10.8),
    candle(2, 10.4, 11, 9, 10.41),
  ]);
  assert.equal(doji.at(-1).label, "Doji");

  const inside = detectCandlePatterns([
    candle(1, 10, 12, 8, 11),
    candle(2, 10.1, 11.5, 8.5, 10.9),
  ]);
  assert.equal(inside.at(-1).label, "Inside bar");
});

test("findSwingPoints confirms peaks and troughs with bars on both sides", () => {
  const bars = [
    candle(1, 5, 6, 4, 5),
    candle(2, 6, 8, 5, 7),
    candle(3, 7, 12, 6, 9),
    candle(4, 8, 9, 3, 4),
    candle(5, 4, 7, 2, 5),
  ];
  const swings = findSwingPoints(bars, 1);
  assert.ok(swings.some((point) => point.kind === "high" && point.index === 2 && point.price === 12));
  assert.ok(swings.some((point) => point.kind === "low" && point.index === 4 && point.price === 2) === false,
    "the final bar has no later confirmation bar");
});

test("analyzeForexCandles returns structured analysis without mutating input", () => {
  const bars = [];
  const closes = [10, 12, 11, 13, 12, 14, 13, 15, 14, 16, 15, 17, 16, 18, 17];
  closes.forEach((close, index) => {
    bars.push(candle(index * 60, close - 0.5, close + 1, close - 1, close));
  });
  const before = JSON.stringify(bars);
  const result = analyzeForexCandles(bars);
  assert.equal(result.lastPrice, 17);
  assert.ok(result.atr > 0);
  assert.ok(Array.isArray(result.patterns));
  assert.ok(result.structure.label.length > 0);
  assert.equal(JSON.stringify(bars), before);
});
