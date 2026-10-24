import test from "node:test";
import assert from "node:assert/strict";
import { validateRunnableStrategySignal } from "./strategy-signal-contract.mjs";

const config = { symbol: "1HZ100V", direction: "OVER", barrier: 4, windowSize: 250 };
const status = {
  signal_generated: true,
  symbol: "1HZ100V",
  requested_direction: "over",
  selected_group: "over",
  barrier: 4,
  digit_window_size: 250,
};

test("accepts only a signal matching the complete selected configuration", () => {
  assert.deepEqual(validateRunnableStrategySignal(status, config), { ok: true, reason: null });
});
for (const [field, value, reason] of [
  ["symbol", "R_100", "market_mismatch"],
  ["barrier", 3, "barrier_mismatch"],
  ["digit_window_size", 1000, "window_mismatch"],
  ["requested_direction", "under", "requested_direction_mismatch"],
  ["selected_group", "under", "selected_group_mismatch"],
  ["signal_generated", false, "signal_not_generated"],
]) {
  test(`rejects stale or mismatched signal: ${field}`, () => {
    assert.equal(validateRunnableStrategySignal({ ...status, [field]: value }, config).reason, reason);
  });
}
test("rejects impossible contract barriers for the requested direction", () => {
  assert.equal(validateRunnableStrategySignal({ ...status, barrier: 9 }, config).reason, "barrier_mismatch");
  assert.equal(validateRunnableStrategySignal({ ...status, requested_direction: "under", selected_group: "under", barrier: 0 }, { ...config, direction: "UNDER", barrier: 0 }).reason, "invalid_under_barrier");
});
