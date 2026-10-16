const assert = require("node:assert/strict");
const test = require("node:test");

let logger;

test.before(async () => {
  ({ logger } = await import("../src/lib/logger.mjs"));
});

test("logger emits structured events and omits sensitive identifier fields", () => {
  const records = [];
  const originalError = console.error;
  console.error = (record) => records.push(JSON.parse(record));

  try {
    logger.error("deriv.session.failed", {
      account_ref: "...1234",
      account_id: "sensitive-account",
      access_token: "sensitive-token",
      attempt: 2,
    }, new Error("socket failed"));
  } finally {
    console.error = originalError;
  }

  assert.equal(records.length, 1);
  assert.equal(records[0].level, "error");
  assert.equal(records[0].event, "deriv.session.failed");
  assert.deepEqual(records[0].context, { account_ref: "...1234", attempt: 2 });
  assert.deepEqual(records[0].error, { name: "Error", message: "socket failed" });
  assert.equal(typeof records[0].timestamp, "string");
});