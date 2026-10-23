import test from "node:test";
import assert from "node:assert/strict";
import { createDemoExecutionSession } from "./strategy-auto-execution.mjs";

const signal = { qualified: true, symbol: "1HZ100V", group: "UNDER", triggerDigit: 2, pattern: [2, 1, 4, 7] };
const input = { symbol: "1HZ100V", contractType: "DIGITUNDER", barrier: "4", stake: 1, duration: 1, durationUnit: "t" };
const settled = (contractId, outcome, profit) => ({ status: "settled", contractId, outcome, profit });

test("rejects non-demo accounts", () => {
  assert.throws(() => createDemoExecutionSession({
    sessionId: "s1", isDemoAccount: false, executeAndReconcile: async () => settled("1", "won", 1),
  }), /Demo accounts only/);
});

test("submits at most three trades sequentially and waits for settlement", async () => {
  let active = 0;
  let maxActive = 0;
  let next = 0;
  const runner = createDemoExecutionSession({
    sessionId: "s2",
    isDemoAccount: true,
    executeAndReconcile: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      next += 1;
      return settled(String(next), "won", 0.8);
    },
  });
  const result = await runner.runQualifiedSignal(signal, input);
  assert.equal(result.submitted, 3);
  assert.equal(result.state, "completed");
  assert.equal(maxActive, 1);
  assert.deepEqual(result.contractIds, ["1", "2", "3"]);
});

test("stops after two consecutive losses", async () => {
  let next = 0;
  const outcomes = [
    settled("1", "lost", -1),
    settled("2", "lost", -1),
    settled("3", "won", 0.8),
  ];
  const runner = createDemoExecutionSession({
    sessionId: "s3",
    isDemoAccount: true,
    executeAndReconcile: async () => outcomes[next++],
  });
  const result = await runner.runQualifiedSignal(signal, input);
  assert.equal(result.submitted, 2);
  assert.equal(result.consecutiveLosses, 2);
  assert.equal(result.state, "stopped");
  assert.equal(next, 2);
});

test("a win resets the consecutive-loss streak", async () => {
  let next = 0;
  const outcomes = [
    settled("1", "lost", -1),
    settled("2", "won", 0.8),
    settled("3", "lost", -1),
  ];
  const runner = createDemoExecutionSession({
    sessionId: "s4",
    isDemoAccount: true,
    executeAndReconcile: async () => outcomes[next++],
  });
  const result = await runner.runQualifiedSignal(signal, input);
  assert.equal(result.submitted, 3);
  assert.equal(result.consecutiveLosses, 1);
  assert.equal(result.state, "completed");
});

test("unknown or unconfirmed outcome pauses for reconciliation without retry", async () => {
  let calls = 0;
  const runner = createDemoExecutionSession({
    sessionId: "s5",
    isDemoAccount: true,
    executeAndReconcile: async () => {
      calls += 1;
      return { status: "unknown", contractId: null, outcome: "unknown", profit: null };
    },
  });
  const result = await runner.runQualifiedSignal(signal, input);
  assert.equal(result.state, "reconciliation_required");
  assert.equal(result.submitted, 0);
  assert.equal(calls, 1);
});

test("rejects unqualified or mismatched-market signals", async () => {
  const runner = createDemoExecutionSession({
    sessionId: "s6", isDemoAccount: true,
    executeAndReconcile: async () => settled("1", "won", 1),
  });
  await assert.rejects(() => runner.runQualifiedSignal({ ...signal, qualified: false }, input), /qualified signal/);
  await assert.rejects(() => runner.runQualifiedSignal(signal, { ...input, symbol: "R_100" }), /qualified signal/);
});

test("prevents overlapping sequences", async () => {
  let resolveTrade;
  const runner = createDemoExecutionSession({
    sessionId: "s7", isDemoAccount: true,
    executeAndReconcile: () => new Promise((resolve) => { resolveTrade = resolve; }),
  });
  const pending = runner.runQualifiedSignal(signal, input);
  await Promise.resolve();
  await assert.rejects(() => runner.runQualifiedSignal(signal, input), /already in flight/);
  resolveTrade(settled("1", "won", 1));
  const result = await pending;
  assert.equal(result.submitted, 3);
});
