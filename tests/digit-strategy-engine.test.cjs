const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateDigitStrategy, extractLastDigit, wilsonLowerBound,
  backtestDigitContract, sessionRiskDecision,
} = require("../src/lib/bots/digit-strategy-engine.mjs");

const valid = {
  version: 1, market: "1HZ75V", contract_type: "DIGITOVER", barrier: 5,
  duration_ticks: 1, stake: 1, entry_rule: "last_digit_frequency",
  frequency_window: 100, max_session_loss: 5, session_profit_target: 5,
};

test("accepts a valid Over digit strategy and rejects malformed risk inputs", () => {
  assert.equal(validateDigitStrategy(valid).valid, true);
  assert.ok(validateDigitStrategy({ ...valid, stake: -1 }).errors.includes("stake_out_of_bounds"));
  assert.ok(validateDigitStrategy({ ...valid, barrier: 10 }).errors.includes("barrier_must_be_digit_0_to_9"));
  assert.ok(validateDigitStrategy({ ...valid, contract_type: "DIGITEVEN", barrier: 2 }).errors.includes("barrier_must_be_null_for_even_odd"));
});

test("extracts last displayed decimal digit without floating-point conversion", () => {
  assert.equal(extractLastDigit("123.450"), 0);
  assert.equal(extractLastDigit("123.45"), 5);
  assert.equal(extractLastDigit(123.4, 2), 0);
  assert.equal(extractLastDigit(123.456, 3), 6);
  assert.equal(extractLastDigit("abc"), null);
});

test("Wilson bound is conservative and rejects invalid samples", () => {
  assert.ok(wilsonLowerBound(60, 100) < 0.6);
  assert.equal(wilsonLowerBound(10, 0), 0);
});

test("backtest fails closed when history is insufficient and does not invent an edge", () => {
  assert.equal(backtestDigitContract(Array(80).fill(5), valid, 1.9).valid, false);
  const digits = Array.from({ length: 1200 }, (_, i) => (i * 7 + Math.floor(i / 10)) % 10);
  const result = backtestDigitContract(digits, valid, 1.9);
  assert.ok(["edge_not_proven", "insufficient_holdout_trades", "edge_gate_passed"].includes(result.reason));
  assert.equal(Number.isFinite(result.expectedReturnLowerBound), true);
});

test("session risk gate blocks open exposure and loss/profit boundaries", () => {
  assert.equal(sessionRiskDecision({ sessionPnl: 0, maxSessionLoss: 5, sessionProfitTarget: 5, openContractCount: 1 }).allowed, false);
  assert.equal(sessionRiskDecision({ sessionPnl: -5, maxSessionLoss: 5, sessionProfitTarget: 5, openContractCount: 0 }).reason, "session_loss_limit");
  assert.equal(sessionRiskDecision({ sessionPnl: 5, maxSessionLoss: 5, sessionProfitTarget: 5, openContractCount: 0 }).reason, "session_profit_target");
});
