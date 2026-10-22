import test from "node:test";
import assert from "node:assert/strict";
import { buildForexCandleHistoryRequest } from "../src/lib/forex-market-data.mjs";

test("builds a one-shot candle history request without the rejected subscribe field", () => {
  const request = buildForexCandleHistoryRequest("frxEURUSD", 900, 70001, 1_800_000_000);

  assert.deepEqual(request, {
    ticks_history: "frxEURUSD",
    start: 1_799_838_000,
    end: "latest",
    count: 180,
    style: "candles",
    granularity: 900,
    req_id: 70001,
  });
  assert.equal(Object.hasOwn(request, "subscribe"), false);
});

test("builds candle history requests for the selected pair and timeframe", () => {
  const request = buildForexCandleHistoryRequest("frxEURCHF", 60, 70002, 1_800_000_000, 100);

  assert.equal(request.ticks_history, "frxEURCHF");
  assert.equal(request.granularity, 60);
  assert.equal(request.count, 100);
  assert.equal(request.start, 1_799_994_000);
});

test("rejects invalid candle history request parameters", () => {
  assert.throws(() => buildForexCandleHistoryRequest("", 60, 1, 1_800_000_000), /symbol/);
  assert.throws(() => buildForexCandleHistoryRequest("frxEURUSD", 0, 1, 1_800_000_000), /granularity/);
  assert.throws(() => buildForexCandleHistoryRequest("frxEURUSD", 60, 0, 1_800_000_000), /Request ID/);
  assert.throws(() => buildForexCandleHistoryRequest("frxEURUSD", 60, 1, 1_800_000_000, 0), /count/);
});
