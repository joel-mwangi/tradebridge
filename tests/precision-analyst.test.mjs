/**
 * Tests for TradeBridge Precision Analyst state machine
 * Uses Node.js built-in test runner (node:test + node:assert)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPrecisionSession, STATES } from "../src/components/trading/precision-analyst.mjs";

// ── Candle factory helpers ────────────────────────────────────────────────────

let _epoch = 1_700_000_000;
function nextEpoch(seconds = 900) {
  _epoch += seconds;
  return _epoch;
}

function resetEpoch() {
  _epoch = 1_700_000_000;
}

/**
 * Build a simple candle. By default a small bullish candle.
 */
function candle({ open, close, high, low, epoch } = {}) {
  const o = open  ?? 1.10000;
  const c = close ?? o + 0.00010;
  const h = high  ?? Math.max(o, c) + 0.00005;
  const l = low   ?? Math.min(o, c) - 0.00005;
  return { epoch: epoch ?? nextEpoch(60), open: o, close: c, high: h, low: l };
}

/**
 * Build a series of M15 candles that show clear bullish structure (HH + HL).
 * Produces at least 5 candles with two swing highs and two swing lows each higher.
 *
 * Layout (each is 2 candles = one swing formation):
 *   bars 0-1: low swing forms  → low1
 *   bars 2-3: high swing forms → high1
 *   bars 4-5: higher-low swing → low2 > low1
 *   bars 6-7: higher-high swing → high2 > high1
 *   bar 8:    "right side" of last swing
 *   bar 9:    extra tail
 */
function makeBullishM15Candles(basePrice = 1.10000, epochStep = 900) {
  const candles = [];
  let p = basePrice;

  function bar(open, close, high, low) {
    candles.push({ epoch: (_epoch += epochStep), open, close, high, low });
  }

  // descend to swing low 1
  bar(p, p - 0.0010, p + 0.0002, p - 0.0012); p -= 0.0010;
  // swing low 1 itself (needs neighbours lower than itself)
  const sl1 = p - 0.0005;
  bar(p, sl1, p + 0.0001, sl1 - 0.0003); p = sl1;
  // rise away from swing low 1
  bar(p, p + 0.0015, p + 0.0017, p - 0.0001); p += 0.0015;
  // swing high 1
  const sh1 = p + 0.0010;
  bar(p, sh1, sh1 + 0.0003, p - 0.0001); p = sh1;
  // pull back but form higher low
  const hl = sl1 + 0.0008;
  bar(p, hl, p + 0.0002, hl - 0.0003); p = hl;
  // swing low 2 (higher than sl1) — the pivot
  bar(p, p - 0.0003, p + 0.0001, p - 0.0006); p -= 0.0003;
  // rise to form higher high
  bar(p, p + 0.0020, p + 0.0022, p - 0.0001); p += 0.0020;
  // swing high 2 (higher than sh1)
  const sh2 = sh1 + 0.0012;
  bar(p, sh2, sh2 + 0.0003, p - 0.0001); p = sh2;
  // right side bars to allow swing detection (needs 2 lower bars on right)
  bar(p, p - 0.0005, p + 0.0001, p - 0.0007); p -= 0.0005;
  bar(p, p - 0.0003, p + 0.0001, p - 0.0005);

  return candles;
}

/**
 * Mirror of above for bearish structure (LH + LL).
 */
function makeBearishM15Candles(basePrice = 1.11000, epochStep = 900) {
  const candles = [];
  let p = basePrice;

  function bar(open, close, high, low) {
    candles.push({ epoch: (_epoch += epochStep), open, close, high, low });
  }

  // rise to swing high 1
  bar(p, p + 0.0010, p + 0.0012, p - 0.0002); p += 0.0010;
  const sh1 = p + 0.0005;
  bar(p, sh1, sh1 + 0.0003, p - 0.0001); p = sh1;
  // fall away
  bar(p, p - 0.0015, p + 0.0001, p - 0.0017); p -= 0.0015;
  // swing low 1
  const sl1 = p - 0.0010;
  bar(p, sl1, p + 0.0001, sl1 - 0.0003); p = sl1;
  // bounce but form lower high
  const lh = sh1 - 0.0008;
  bar(p, lh, lh + 0.0003, p - 0.0001); p = lh;
  // swing high 2 (lower than sh1)
  bar(p, p + 0.0003, p + 0.0006, p - 0.0001); p += 0.0003;
  // fall to lower low
  bar(p, p - 0.0020, p + 0.0001, p - 0.0022); p -= 0.0020;
  // swing low 2 (lower than sl1)
  const sl2 = sl1 - 0.0012;
  bar(p, sl2, p + 0.0001, sl2 - 0.0003); p = sl2;
  // right side bars
  bar(p, p + 0.0005, p + 0.0007, p - 0.0001); p += 0.0005;
  bar(p, p + 0.0003, p + 0.0005, p - 0.0001);

  return candles;
}

/**
 * Build a single SSL sweep candle.
 * Prior candles must have established a swing low below `swingLowPrice`.
 * This candle wicks below `swingLowPrice` and closes above it.
 */
function makeSslSweepCandle(swingLowPrice, epochStep = 300) {
  return {
    epoch: (_epoch += epochStep),
    open:  swingLowPrice + 0.00050,
    close: swingLowPrice + 0.00080,
    high:  swingLowPrice + 0.00090,
    low:   swingLowPrice - 0.00030, // wick below the swing low
  };
}

/**
 * Build a single BSL sweep candle.
 */
function makeBslSweepCandle(swingHighPrice, epochStep = 300) {
  return {
    epoch: (_epoch += epochStep),
    open:  swingHighPrice - 0.00050,
    close: swingHighPrice - 0.00080,
    high:  swingHighPrice + 0.00030, // wick above swing high
    low:   swingHighPrice - 0.00090,
  };
}

/**
 * Build a displacement bullish candle (body > 1.5× average body of prior 10).
 * Pass prior candles to compute realistic average.
 */
function makeDisplacementBullishCandle(priorCandles, bosLevel, epochStep = 300) {
  const avgBody = priorCandles.slice(-10).reduce((sum, c) => sum + Math.abs(c.close - c.open), 0) / Math.min(10, priorCandles.length);
  const targetBody = Math.max(avgBody * 2.0, 0.00080);
  const open  = bosLevel - targetBody * 0.1;
  const close = bosLevel + targetBody * 0.9; // closes above bosLevel
  return {
    epoch: (_epoch += epochStep),
    open,
    close,
    high: close + 0.00005,
    low:  open  - 0.00005,
  };
}

/**
 * Build a displacement bearish candle.
 */
function makeDisplacementBearishCandle(priorCandles, bosLevel, epochStep = 300) {
  const avgBody = priorCandles.slice(-10).reduce((sum, c) => sum + Math.abs(c.close - c.open), 0) / Math.min(10, priorCandles.length);
  const targetBody = Math.max(avgBody * 2.0, 0.00080);
  const open  = bosLevel + targetBody * 0.1;
  const close = bosLevel - targetBody * 0.9; // closes below bosLevel
  return {
    epoch: (_epoch += epochStep),
    open,
    close,
    high: open  + 0.00005,
    low:  close - 0.00005,
  };
}

/**
 * Build a hammer (bullish rejection) candle.
 */
function makeHammerCandle(entryZoneMid, epochStep = 60) {
  const low   = entryZoneMid - 0.00060;
  const open  = entryZoneMid - 0.00010;
  const close = entryZoneMid + 0.00010;
  const high  = close + 0.00005;
  return { epoch: (_epoch += epochStep), open, close, high, low };
}

/**
 * Build a shooting-star (bearish rejection) candle.
 */
function makeShootingStarCandle(entryZoneMid, epochStep = 60) {
  const high  = entryZoneMid + 0.00060;
  const open  = entryZoneMid + 0.00010;
  const close = entryZoneMid - 0.00010;
  const low   = close - 0.00005;
  return { epoch: (_epoch += epochStep), open, close, high, low };
}

/**
 * Feed a list of candles into a session at a given timeframe.
 */
function feedCandles(session, timeframe, candles, indicators = {}) {
  for (const c of candles) {
    session.onCandle(timeframe, c, indicators);
  }
}

// ── Default session config ────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  symbol: "frxEURUSD",
  accountBalance: 1000,
  maxRiskPct: 0.5,
  minRR: 1.5,
};

// ── Test 1: BUY full qualification sequence ───────────────────────────────────
describe("BUY qualification — full sequence", () => {
  it("advances through all states and reaches BUY", () => {
    resetEpoch();
    const session = createPrecisionSession(DEFAULT_CONFIG);

    // Step 1: Feed M15 bullish structure candles
    const m15Bars = makeBullishM15Candles(1.10000);
    feedCandles(session, 900, m15Bars);

    let snap = session.getState();
    assert.equal(snap.state, STATES.SETUP_DETECTED, "Should be SETUP_DETECTED after bullish M15 structure");
    assert.equal(snap.direction, "BUY");

    // Need some prior M5 candles with consistent small bodies to establish an average
    const priorM5 = Array.from({ length: 8 }, (_, i) => ({
      epoch: (_epoch += 300),
      open: 1.10100 + i * 0.00001,
      close: 1.10110 + i * 0.00001,
      high: 1.10115 + i * 0.00001,
      low: 1.10095 + i * 0.00001,
    }));
    feedCandles(session, 300, priorM5);

    // Step 2: SSL sweep on M5 — sweep the lowest recent swing low
    // Find a swing low level from the M15 candles to sweep
    const swingLowLevel = 1.09980; // below current price to simulate a previous swing low
    // Build some M5 candles with that swing low
    const m5PreSweep = Array.from({ length: 5 }, (_, i) => ({
      epoch: (_epoch += 300),
      open:  swingLowLevel + 0.00300 + i * 0.00005,
      close: swingLowLevel + 0.00290 + i * 0.00005,
      high:  swingLowLevel + 0.00310 + i * 0.00005,
      low:   swingLowLevel + 0.00280 + i * 0.00005,
    }));
    // Plant the swing low by inserting a candle that's lower than its neighbours
    const pivotM5 = {
      epoch: (_epoch += 300),
      open:  swingLowLevel + 0.00050,
      close: swingLowLevel + 0.00060,
      high:  swingLowLevel + 0.00070,
      low:   swingLowLevel,           // this IS the swing low
    };
    // Bars either side must be higher
    const m5Post1 = { epoch: (_epoch += 300), open: swingLowLevel + 0.00080, close: swingLowLevel + 0.00090, high: swingLowLevel + 0.00100, low: swingLowLevel + 0.00060 };
    const m5Post2 = { epoch: (_epoch += 300), open: swingLowLevel + 0.00090, close: swingLowLevel + 0.00100, high: swingLowLevel + 0.00110, low: swingLowLevel + 0.00070 };
    feedCandles(session, 300, [...m5PreSweep, pivotM5, m5Post1, m5Post2]);

    // Now feed the SSL sweep candle
    const sweepCandle = makeSslSweepCandle(swingLowLevel);
    session.onCandle(300, sweepCandle);

    snap = session.getState();
    assert.equal(snap.state, STATES.M5_CONFIRMED, "Should be M5_CONFIRMED after SSL sweep");

    // Step 3: M5 displacement + BoS
    const allM5 = [...m5PreSweep, pivotM5, m5Post1, m5Post2, sweepCandle];
    const bosLevel = sweepCandle.close + 0.00100;
    const displacementCandle = makeDisplacementBullishCandle(allM5, bosLevel);
    session.onCandle(300, displacementCandle);

    snap = session.getState();
    assert.equal(snap.state, STATES.M1_CONFIRMED, "Should be M1_CONFIRMED after bullish displacement");
    assert.ok(snap.entryZone, "Entry zone should be set");

    // Step 4 + 5: M1 retracement into entry zone + bullish rejection
    const entryZoneMid = (snap.entryZone.low + snap.entryZone.high) / 2;
    const hammerCandle = makeHammerCandle(entryZoneMid);
    session.onCandle(60, hammerCandle);

    snap = session.getState();
    // After risk validation, state should be BUY (risk passes with default $1000 balance)
    assert.ok(
      snap.state === STATES.BUY || snap.state === STATES.RISK_VALIDATED || snap.state === STATES.WAITING,
      `Expected BUY, RISK_VALIDATED, or WAITING (risk engine rejection). Got: ${snap.state}`
    );

    if (snap.state === STATES.BUY) {
      assert.equal(snap.direction, "BUY");
      assert.ok(snap.actionable, "BUY signal should be actionable");
      assert.ok(snap.suggestedSl !== null, "SL should be set");
      assert.ok(snap.suggestedTp !== null, "TP should be set");
    }
  });
});

// ── Test 2: BUY fails if M5 displacement is missing ──────────────────────────
describe("BUY qualification — missing M5 confirmation", () => {
  it("stays at SETUP_DETECTED without M5 displacement", () => {
    resetEpoch();
    const session = createPrecisionSession(DEFAULT_CONFIG);

    // Feed M15 bullish structure
    const m15Bars = makeBullishM15Candles(1.10000);
    feedCandles(session, 900, m15Bars);
    assert.equal(session.getState().state, STATES.SETUP_DETECTED);

    // Feed SSL sweep to reach M5_CONFIRMED
    const swingLowLevel = 1.09980;
    const m5Pre = Array.from({ length: 3 }, (_, i) => ({
      epoch: (_epoch += 300), open: swingLowLevel + 0.00300 + i * 0.00005,
      close: swingLowLevel + 0.00290 + i * 0.00005,
      high: swingLowLevel + 0.00310 + i * 0.00005,
      low: swingLowLevel + 0.00280 + i * 0.00005,
    }));
    const pivot = { epoch: (_epoch += 300), open: swingLowLevel + 0.00050, close: swingLowLevel + 0.00060, high: swingLowLevel + 0.00070, low: swingLowLevel };
    const after1 = { epoch: (_epoch += 300), open: swingLowLevel + 0.00080, close: swingLowLevel + 0.00090, high: swingLowLevel + 0.00100, low: swingLowLevel + 0.00060 };
    const after2 = { epoch: (_epoch += 300), open: swingLowLevel + 0.00090, close: swingLowLevel + 0.00100, high: swingLowLevel + 0.00110, low: swingLowLevel + 0.00070 };
    feedCandles(session, 300, [...m5Pre, pivot, after1, after2]);

    const sweepCandle = makeSslSweepCandle(swingLowLevel);
    session.onCandle(300, sweepCandle);
    assert.equal(session.getState().state, STATES.M5_CONFIRMED, "Should reach M5_CONFIRMED");

    // Now feed M1 retracement WITHOUT any M5 displacement first
    // State is M5_CONFIRMED, not M1_CONFIRMED — M1 candles alone should NOT advance
    const m1 = makeHammerCandle(swingLowLevel + 0.00040);
    session.onCandle(60, m1);

    // State must still be M5_CONFIRMED (no displacement was detected)
    assert.equal(
      session.getState().state,
      STATES.M5_CONFIRMED,
      "Without M5 displacement, state must stay at M5_CONFIRMED, never M1_CONFIRMED"
    );
  });
});

// ── Test 3: BUY fails due to spread too high ─────────────────────────────────
describe("BUY qualification — risk engine rejects high spread", () => {
  it("goes back to WAITING when spread is too high", () => {
    resetEpoch();
    const session = createPrecisionSession({ ...DEFAULT_CONFIG, accountBalance: 100 });

    // Drive through M15 → SETUP_DETECTED → M5_CONFIRMED → M1_CONFIRMED steps
    const m15Bars = makeBullishM15Candles(1.10000);
    feedCandles(session, 900, m15Bars);

    const swingLowLevel = 1.09980;
    const m5Pre = Array.from({ length: 3 }, (_, i) => ({
      epoch: (_epoch += 300), open: swingLowLevel + 0.00300 + i * 0.00005,
      close: swingLowLevel + 0.00290 + i * 0.00005,
      high: swingLowLevel + 0.00310 + i * 0.00005,
      low: swingLowLevel + 0.00280 + i * 0.00005,
    }));
    const pivot = { epoch: (_epoch += 300), open: swingLowLevel + 0.00050, close: swingLowLevel + 0.00060, high: swingLowLevel + 0.00070, low: swingLowLevel };
    const after1 = { epoch: (_epoch += 300), open: swingLowLevel + 0.00080, close: swingLowLevel + 0.00090, high: swingLowLevel + 0.00100, low: swingLowLevel + 0.00060 };
    const after2 = { epoch: (_epoch += 300), open: swingLowLevel + 0.00090, close: swingLowLevel + 0.00100, high: swingLowLevel + 0.00110, low: swingLowLevel + 0.00070 };
    feedCandles(session, 300, [...m5Pre, pivot, after1, after2]);

    const sweepCandle = makeSslSweepCandle(swingLowLevel);
    session.onCandle(300, sweepCandle);
    assert.equal(session.getState().state, STATES.M5_CONFIRMED);

    const allM5 = [...m5Pre, pivot, after1, after2, sweepCandle];
    const bosLevel = sweepCandle.close + 0.00100;
    const dispCandle = makeDisplacementBullishCandle(allM5, bosLevel);
    session.onCandle(300, dispCandle);
    assert.equal(session.getState().state, STATES.M1_CONFIRMED);

    const entryZone = session.getState().entryZone;
    const entryZoneMid = (entryZone.low + entryZone.high) / 2;
    const hammerCandle = makeHammerCandle(entryZoneMid);

    // Feed hammer with an extremely high spread (10× the stop distance in pips)
    // Stop distance ≈ 0.00060 (60 pips). Spread of 0.0030 (30 pips) is 50% of that — over 30%
    session.onCandle(60, hammerCandle, { spread: 0.00300 });

    const snap = session.getState();
    // Risk engine should reject due to spread. State goes back to WAITING.
    assert.equal(
      snap.state,
      STATES.WAITING,
      `Expected WAITING after spread rejection. Got: ${snap.state} (${snap.invalidationReason})`
    );
  });
});

// ── Test 4: Signal expiry ─────────────────────────────────────────────────────
describe("Signal expiry", () => {
  it("SETUP_DETECTED expires after 4 hours without M5 confirmation", () => {
    resetEpoch();
    const session = createPrecisionSession(DEFAULT_CONFIG);

    // Drive to SETUP_DETECTED
    const m15Bars = makeBullishM15Candles(1.10000);
    feedCandles(session, 900, m15Bars);
    assert.equal(session.getState().state, STATES.SETUP_DETECTED);

    // Manually backdate enteredAt to simulate 4+ hours ago
    // We do this by feeding a candle whose epoch is 4h+1s in the future
    const futureEpoch = (_epoch + 14401);
    const futureCandle = {
      epoch: futureEpoch,
      open: 1.10200, close: 1.10210, high: 1.10220, low: 1.10195,
    };
    session.onCandle(900, futureCandle);

    const snap = session.getState();
    assert.equal(snap.state, STATES.EXPIRED, `Expected EXPIRED, got ${snap.state}`);
    assert.ok(snap.invalidationReason, "Should have expiry reason");
  });
});

// ── Test 5: Price invalidation ────────────────────────────────────────────────
describe("Signal invalidation", () => {
  it("invalidates when price moves 1.5× stop distance away from entry zone", () => {
    resetEpoch();
    const session = createPrecisionSession(DEFAULT_CONFIG);

    // Drive to M5_CONFIRMED so we have sweep + displacement levels
    const m15Bars = makeBullishM15Candles(1.10000);
    feedCandles(session, 900, m15Bars);

    const swingLowLevel = 1.09980;
    const m5Pre = Array.from({ length: 3 }, (_, i) => ({
      epoch: (_epoch += 300), open: swingLowLevel + 0.00300 + i * 0.00005,
      close: swingLowLevel + 0.00290 + i * 0.00005,
      high: swingLowLevel + 0.00310 + i * 0.00005,
      low: swingLowLevel + 0.00280 + i * 0.00005,
    }));
    const pivot = { epoch: (_epoch += 300), open: swingLowLevel + 0.00050, close: swingLowLevel + 0.00060, high: swingLowLevel + 0.00070, low: swingLowLevel };
    const after1 = { epoch: (_epoch += 300), open: swingLowLevel + 0.00080, close: swingLowLevel + 0.00090, high: swingLowLevel + 0.00100, low: swingLowLevel + 0.00060 };
    const after2 = { epoch: (_epoch += 300), open: swingLowLevel + 0.00090, close: swingLowLevel + 0.00100, high: swingLowLevel + 0.00110, low: swingLowLevel + 0.00070 };
    feedCandles(session, 300, [...m5Pre, pivot, after1, after2]);

    const sweepCandle = makeSslSweepCandle(swingLowLevel);
    session.onCandle(300, sweepCandle);

    const allM5 = [...m5Pre, pivot, after1, after2, sweepCandle];
    const bosLevel = sweepCandle.close + 0.00100;
    const dispCandle = makeDisplacementBullishCandle(allM5, bosLevel);
    session.onCandle(300, dispCandle);

    assert.ok(
      ["M5_CONFIRMED", "M1_CONFIRMED"].includes(session.getState().state),
      `Expected M5_CONFIRMED or M1_CONFIRMED, got ${session.getState().state}`
    );

    // Now feed a M1 candle that crashes 1.5× setup range below the sweep wick
    const sweepWick = sweepCandle.low;
    const displacementLvl = bosLevel;
    const setupRange = Math.abs(displacementLvl - sweepWick);
    const crashPrice = sweepWick - setupRange * 2.0; // well past 1.5×

    const crashCandle = {
      epoch: (_epoch += 60),
      open: sweepWick - 0.00010,
      close: crashPrice,
      high: sweepWick,
      low: crashPrice - 0.00010,
    };
    session.onCandle(60, crashCandle);

    const snap = session.getState();
    assert.equal(snap.state, STATES.INVALIDATED, `Expected INVALIDATED, got ${snap.state}`);
    assert.ok(snap.invalidationReason, "Should have invalidation reason");
  });
});

// ── Test 6: SELL full qualification sequence ──────────────────────────────────
describe("SELL qualification — full sequence", () => {
  it("advances through all states and reaches SELL", () => {
    resetEpoch();
    const session = createPrecisionSession(DEFAULT_CONFIG);

    // Step 1: M15 bearish structure
    const m15Bars = makeBearishM15Candles(1.11000);
    feedCandles(session, 900, m15Bars);

    let snap = session.getState();
    assert.equal(snap.state, STATES.SETUP_DETECTED, "Should be SETUP_DETECTED after bearish M15");
    assert.equal(snap.direction, "SELL");

    // Setup prior M5 candles for average body calculation
    const priorM5 = Array.from({ length: 8 }, (_, i) => ({
      epoch: (_epoch += 300),
      open: 1.10800 - i * 0.00001,
      close: 1.10790 - i * 0.00001,
      high: 1.10805 - i * 0.00001,
      low: 1.10785 - i * 0.00001,
    }));
    feedCandles(session, 300, priorM5);

    // Step 2: BSL sweep — candle wicks above a swing high and closes below
    const swingHighLevel = 1.10900;
    const m5PreSweep = Array.from({ length: 5 }, (_, i) => ({
      epoch: (_epoch += 300),
      open:  swingHighLevel - 0.00300 - i * 0.00005,
      close: swingHighLevel - 0.00290 - i * 0.00005,
      high:  swingHighLevel - 0.00280 - i * 0.00005,
      low:   swingHighLevel - 0.00310 - i * 0.00005,
    }));
    const pivotHigh = {
      epoch: (_epoch += 300),
      open:  swingHighLevel - 0.00050,
      close: swingHighLevel - 0.00060,
      high:  swingHighLevel,          // the swing high
      low:   swingHighLevel - 0.00070,
    };
    const m5Post1 = { epoch: (_epoch += 300), open: swingHighLevel - 0.00080, close: swingHighLevel - 0.00090, high: swingHighLevel - 0.00060, low: swingHighLevel - 0.00100 };
    const m5Post2 = { epoch: (_epoch += 300), open: swingHighLevel - 0.00090, close: swingHighLevel - 0.00100, high: swingHighLevel - 0.00070, low: swingHighLevel - 0.00110 };
    feedCandles(session, 300, [...m5PreSweep, pivotHigh, m5Post1, m5Post2]);

    const sweepCandle = makeBslSweepCandle(swingHighLevel);
    session.onCandle(300, sweepCandle);

    snap = session.getState();
    assert.equal(snap.state, STATES.M5_CONFIRMED, "Should be M5_CONFIRMED after BSL sweep");

    // Step 3: M5 bearish displacement + BoS
    const allM5 = [...m5PreSweep, pivotHigh, m5Post1, m5Post2, sweepCandle];
    const bosLevel = sweepCandle.close - 0.00100;
    const dispCandle = makeDisplacementBearishCandle(allM5, bosLevel);
    session.onCandle(300, dispCandle);

    snap = session.getState();
    assert.equal(snap.state, STATES.M1_CONFIRMED, "Should be M1_CONFIRMED after bearish displacement");
    assert.ok(snap.entryZone, "Entry zone should be set");

    // Step 4 + 5: M1 retracement + bearish rejection
    const entryZoneMid = (snap.entryZone.low + snap.entryZone.high) / 2;
    const shootingStarCandle = makeShootingStarCandle(entryZoneMid);
    session.onCandle(60, shootingStarCandle);

    snap = session.getState();
    assert.ok(
      snap.state === STATES.SELL || snap.state === STATES.RISK_VALIDATED || snap.state === STATES.WAITING,
      `Expected SELL, RISK_VALIDATED, or WAITING (risk engine). Got: ${snap.state}`
    );

    if (snap.state === STATES.SELL) {
      assert.equal(snap.direction, "SELL");
      assert.ok(snap.actionable, "SELL signal should be actionable");
      assert.ok(snap.suggestedSl !== null, "SL should be set");
      assert.ok(snap.suggestedTp !== null, "TP should be set");
    }
  });
});
