import test from "node:test";
import assert from "node:assert/strict";
import {
  buildForexCandleHistoryRequest,
  isForexMarket,
} from "../src/lib/forex-market-data.mjs";

test("builds a one-shot candle history request without start or subscribe fields", () => {
  const request = buildForexCandleHistoryRequest("frxEURUSD", 900, 70001, 180);

  assert.deepEqual(request, {
    ticks_history: "frxEURUSD",
    end: "latest",
    count: 180,
    style: "candles",
    granularity: 900,
    req_id: 70001,
  });
  assert.equal(Object.hasOwn(request, "subscribe"), false);
  assert.equal(Object.hasOwn(request, "start"), false);
});

test("uses the selected symbol and timeframe for candle history", () => {
  const request = buildForexCandleHistoryRequest("frxEURCHF", 60, 70002, 100);

  assert.equal(request.ticks_history, "frxEURCHF");
  assert.equal(request.granularity, 60);
  assert.equal(request.count, 100);
  assert.equal(request.end, "latest");
});

test("rejects invalid candle history request parameters", () => {
  assert.throws(() => buildForexCandleHistoryRequest("", 60, 1), /symbol/);
  assert.throws(() => buildForexCandleHistoryRequest("frxEURUSD", 0, 1), /granularity/);
  assert.throws(() => buildForexCandleHistoryRequest("frxEURUSD", 60, 0), /Request ID/);
  assert.throws(() => buildForexCandleHistoryRequest("frxEURUSD", 60, 1, 0), /count/);
});

test("accepts Forex from explicit provider market metadata", () => {
  assert.equal(isForexMarket("forex", "Forex"), true);
  assert.equal(isForexMarket(" Forex ", ""), true);
  assert.equal(isForexMarket("", "FOREX"), true);
});

test("does not treat non-Forex frx-prefixed instruments as currency pairs", () => {
  assert.equal(isForexMarket("commodities", "Commodities"), false);
  assert.equal(isForexMarket("synthetic_index", "Derived"), false);
  assert.equal(isForexMarket("", ""), false);
  // Symbol prefix alone is deliberately not accepted as a market classification.
  assert.equal(isForexMarket(undefined, undefined), false);
});
