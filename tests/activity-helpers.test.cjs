const assert = require("node:assert/strict");
const test = require("node:test");

let toActivity;
let toPosition;
let mergeActivityRows;
let statementHasMore;
let statementPageLimit;

test.before(async () => {
  ({
    mergeActivityRows,
    statementHasMore,
    statementPageLimit,
    toActivity,
    toPosition,
  } = await import("../src/components/trading/activity-helpers.mjs"));
});

test("position conversion normalizes provider fields and numeric values", () => {
  assert.deepEqual(toPosition({
    contract_id: 123,
    underlying_symbol: "R_100",
    contract_type: "DIGITOVER",
    buy_price: "2.5",
    current_spot_display_value: "101.25",
    payout: "4.5",
    profit: "2",
    date_start: "1000",
    date_expiry: "1060",
  }), {
    contractId: "123",
    symbol: "R_100",
    contractType: "DIGITOVER",
    buyPrice: 2.5,
    currentSpot: 101.25,
    payout: 4.5,
    profit: 2,
    currency: "USD",
    startedAt: 1000,
    expiresAt: 1060,
    status: "open",
    longcode: "",
  });
});

test("invalid or absent positions are discarded and non-finite numbers become null", () => {
  assert.equal(toPosition({ contract_id: "" }), null);
  assert.equal(toPosition({ contract_id: "1", buy_price: "not-a-number" }).buyPrice, null);
});

test("activity conversion supports provider aliases and optional contract fields", () => {
  assert.deepEqual(toActivity({
    transaction_id: 45,
    transaction_timestamp: "1712345678",
    action_type: "sell",
    shortcode: "Closed contract",
    amount: "-2",
    balance_after: "18",
    contract_id: 987,
    profit: "-1",
  }), {
    id: "45",
    time: 1712345678,
    action: "sell",
    description: "Closed contract",
    amount: -2,
    balance: 18,
    currency: "USD",
    contractId: "987",
    profit: -1,
  });
});

test("activity conversion rejects missing ids and preserves safe defaults", () => {
  assert.equal(toActivity({ amount: 4 }), null);
  assert.deepEqual(toActivity({ id: "tx" }), {
    id: "tx",
    time: null,
    action: "transaction",
    description: "Account transaction",
    amount: null,
    balance: null,
    currency: "USD",
    contractId: undefined,
    profit: null,
  });
});

test("statement pagination clamps limits and supports both count and page-size responses", () => {
  assert.equal(statementPageLimit(0), 30);
  assert.equal(statementPageLimit(1200), 999);
  assert.equal(statementHasMore(61, 30, 30, 30), true);
  assert.equal(statementHasMore(60, 30, 30, 30), false);
  assert.equal(statementHasMore(undefined, 0, 30, 30), true);
  assert.equal(statementHasMore(undefined, 0, 29, 30), false);
});

test("activity page merges replace duplicate IDs and sort newest-first", () => {
  const merged = mergeActivityRows(
    [{ id: "same", time: 1 }, { id: "old", time: 2 }],
    [{ id: "same", time: 3 }, { id: "new", time: 4 }],
  );
  assert.deepEqual(merged, [
    { id: "new", time: 4 },
    { id: "same", time: 3 },
    { id: "old", time: 2 },
  ]);
});