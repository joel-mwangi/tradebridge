import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOptionalQuotePrice, calculateQuoteSpread } from "./forex-market-data.mjs";

test("normalizes positive numeric Bid/Ask values", () => {
  assert.equal(normalizeOptionalQuotePrice(1.12345), 1.12345);
  assert.equal(normalizeOptionalQuotePrice("1.12345"), 1.12345);
});

test("rejects absent and invalid quote values without coercing them to zero", () => {
  for (const value of [undefined, null, "", "   ", true, false, 0, -1, "not-a-price", Infinity, NaN]) {
    assert.equal(normalizeOptionalQuotePrice(value), undefined);
  }
});

test("calculates spread only from valid ordered prices", () => {
  assert.ok(Math.abs(calculateQuoteSpread(1.1234, 1.1236) - 0.0002) < 1e-12);
  assert.equal(calculateQuoteSpread(1.1234, 1.1234), 0);
  assert.equal(calculateQuoteSpread(undefined, 1.1236), undefined);
  assert.equal(calculateQuoteSpread(1.1236, 1.1234), undefined);
  assert.equal(calculateQuoteSpread(0, 1.1236), undefined);
});
