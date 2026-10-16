const assert = require("node:assert/strict");
const test = require("node:test");

let classifySettlement;
let findBotStopReason;
let makeInitialState;
let nextStakeAmount;

test.before(async () => {
  ({
    classifySettlement,
    findBotStopReason,
    makeInitialState,
    nextStakeAmount,
  } = await import("../src/components/bots/bot-runner-helpers.mjs"));
});

test("initial bot state starts empty and uses the selected currency", () => {
  assert.deepEqual(makeInitialState("EUR"), {
    status: "idle",
    currentStake: 0,
    tradeCount: 0,
    wins: 0,
    losses: 0,
    netPnl: 0,
    currency: "EUR",
    transactions: [],
    journal: [],
    startedAt: null,
    lastError: null,
  });
});

test("fixed, martingale, and d'Alembert stakes follow their configured bounds", () => {
  assert.equal(nextStakeAmount({ type: "fixed", amount: 2 }, -1, 8), 2);
  assert.equal(nextStakeAmount({ type: "martingale", base: 1, multiplier: 2, maxStake: 5 }, null, 0), 1);
  assert.equal(nextStakeAmount({ type: "martingale", base: 1, multiplier: 2, maxStake: 5 }, -1, 3), 5);
  assert.equal(nextStakeAmount({ type: "martingale", base: 1, multiplier: 2, maxStake: 5 }, 1, 3), 1);
  assert.equal(nextStakeAmount({ type: "dalembert", unit: 1, maxStake: 5 }, -1, 4), 5);
  assert.equal(nextStakeAmount({ type: "dalembert", unit: 1, maxStake: 5 }, 1, 1), 1);
});

test("settlements distinguish wins, losses, cancellations, and profit fallback", () => {
  assert.deepEqual(classifySettlement("won", -1), { isCancelled: false, isWin: true, isLoss: false });
  assert.deepEqual(classifySettlement("lost", 2), { isCancelled: false, isWin: false, isLoss: true });
  assert.deepEqual(classifySettlement("cancelled", -1), { isCancelled: true, isWin: false, isLoss: false });
  assert.deepEqual(classifySettlement("sold", 2), { isCancelled: false, isWin: true, isLoss: false });
});

test("bot stop checks honor targets, trade caps, time, and consecutive losses", () => {
  const base = {
    stopConditions: [],
    maxTradesPerDay: 50,
    maxConsecutiveLosses: 2,
  };
  const state = {
    netPnl: 5,
    tradeCount: 2,
    transactions: [
      { status: "lost", profit: -1 },
      { status: "lost", profit: -1 },
    ],
  };

  assert.equal(findBotStopReason({ ...base, stopConditions: [{ type: "profit", target: 5 }] }, state, 0, false), "Profit target reached (+5.00)");
  assert.equal(findBotStopReason({ ...base, stopConditions: [{ type: "time", seconds: 60 }] }, state, 61, false), "Time limit reached (61s)");
  assert.equal(findBotStopReason({ ...base, stopConditions: [{ type: "tradeCount", max: 2 }] }, state, 0, false), "Max trades reached (2)");
  assert.equal(findBotStopReason({ ...base, maxTradesPerDay: 2 }, state, 0, false), "Daily trade cap reached (2)");
  assert.equal(findBotStopReason(base, state, 0, true), "Max consecutive losses (2)");
  assert.equal(findBotStopReason(base, { ...state, transactions: [{ status: "cancelled", profit: -1 }] }, 0, true), null);
});