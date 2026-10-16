const assert = require("node:assert/strict");
const test = require("node:test");

let clearOrderResolution;
let readOrderResolution;
let writeOrderResolution;

test.before(async () => {
  ({ clearOrderResolution, readOrderResolution, writeOrderResolution } =
    await import("../src/components/trading/order-resolution.mjs"));
});

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("order resolution persists, reads, and clears a marker", () => {
  const storage = createStorage();
  const getStorage = () => storage;

  assert.equal(readOrderResolution(getStorage, "order"), null);
  writeOrderResolution(getStorage, "order", "pending");
  assert.equal(readOrderResolution(getStorage, "order"), "pending");
  writeOrderResolution(getStorage, "order", "unknown");
  assert.equal(readOrderResolution(getStorage, "order"), "unknown");
  clearOrderResolution(getStorage, "order");
  assert.equal(readOrderResolution(getStorage, "order"), null);
});

test("unavailable storage reads fail closed and writes or clears do not throw", () => {
  const getStorage = () => {
    throw new Error("storage blocked");
  };

  assert.equal(readOrderResolution(getStorage, "order"), "unknown");
  assert.doesNotThrow(() => writeOrderResolution(getStorage, "order", "pending"));
  assert.doesNotThrow(() => clearOrderResolution(getStorage, "order"));
});

test("missing keys are no-ops and do not access storage", () => {
  const getStorage = () => {
    throw new Error("must not access storage");
  };

  assert.equal(readOrderResolution(getStorage, null), null);
  assert.doesNotThrow(() => writeOrderResolution(getStorage, null, "pending"));
  assert.doesNotThrow(() => clearOrderResolution(getStorage, null));
});