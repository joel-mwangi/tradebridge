/**
 * TradeBridge Precision Analyst — Signal Lifecycle State Machine
 *
 * Pure JS module, no React, no DOM, no external dependencies.
 * States: WAITING → SETUP_DETECTED → M5_CONFIRMED → M1_CONFIRMED → RISK_VALIDATED → BUY/SELL → EXPIRED/INVALIDATED
 */

// ── State constants ──────────────────────────────────────────────────────────
export const STATES = Object.freeze({
  WAITING: "WAITING",
  SETUP_DETECTED: "SETUP_DETECTED",
  M5_CONFIRMED: "M5_CONFIRMED",
  M1_CONFIRMED: "M1_CONFIRMED",
  RISK_VALIDATED: "RISK_VALIDATED",
  BUY: "BUY",
  SELL: "SELL",
  EXPIRED: "EXPIRED",
  INVALIDATED: "INVALIDATED",
});

// ── Expiry timeouts (seconds) ────────────────────────────────────────────────
const EXPIRY_SETUP_DETECTED   = 14400; // 4 hours
const EXPIRY_M5_CONFIRMED     = 3600;  // 1 hour
const EXPIRY_M1_CONFIRMED     = 900;   // 15 minutes
const EXPIRY_SIGNAL           = 1800;  // 30 minutes (BUY/SELL)

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Find recent swing highs or swing lows from an array of closed candles.
 * Returns the last `count` confirmed swing points of a given type.
 * A swing high is a candle whose high is higher than both its neighbours.
 * A swing low is a candle whose low is lower than both its neighbours.
 * @param {Array<{epoch:number,open:number,high:number,low:number,close:number}>} candles
 * @param {'high'|'low'} kind
 * @param {number} [count=5]
 * @param {number} [strength=2]
 */
function recentSwings(candles, kind, count = 5, strength = 2) {
  const result = [];
  for (let i = strength; i < candles.length - strength; i++) {
    let isSwing = true;
    for (let offset = 1; offset <= strength; offset++) {
      if (kind === "high") {
        if (candles[i].high <= candles[i - offset].high || candles[i].high <= candles[i + offset].high) {
          isSwing = false;
          break;
        }
      } else {
        if (candles[i].low >= candles[i - offset].low || candles[i].low >= candles[i + offset].low) {
          isSwing = false;
          break;
        }
      }
    }
    if (isSwing) {
      result.push({ epoch: candles[i].epoch, price: kind === "high" ? candles[i].high : candles[i].low });
    }
  }
  return result.slice(-count);
}

/**
 * Detect bullish market structure: at least two successive swing highs each
 * higher than the previous, and at least two successive swing lows each
 * higher than the previous (HH + HL).
 * Uses strength=1 so a single bar on each side confirms a swing point —
 * appropriate for M15 structure detection where we need fast confirmation.
 */
function hasBullishStructure(candles) {
  const highs = recentSwings(candles, "high", 3, 1);
  const lows  = recentSwings(candles, "low",  3, 1);
  if (highs.length < 2 || lows.length < 2) return false;
  const hhConfirmed = highs[highs.length - 1].price > highs[highs.length - 2].price;
  const hlConfirmed = lows[lows.length - 1].price  > lows[lows.length - 2].price;
  return hhConfirmed && hlConfirmed;
}

/**
 * Detect bearish market structure: LH + LL.
 */
function hasBearishStructure(candles) {
  const highs = recentSwings(candles, "high", 3, 1);
  const lows  = recentSwings(candles, "low",  3, 1);
  if (highs.length < 2 || lows.length < 2) return false;
  const lhConfirmed = highs[highs.length - 1].price < highs[highs.length - 2].price;
  const llConfirmed = lows[lows.length - 1].price   < lows[lows.length - 2].price;
  return lhConfirmed && llConfirmed;
}

/**
 * Detect whether the last candle sweeps a sell-side liquidity level (SSL).
 * SSL sweep: candle.low goes below a recent swing low, then closes above it.
 * Returns the swept level price, or null.
 */
function detectSslSweep(candles) {
  if (candles.length < 4) return null;
  const last = candles[candles.length - 1];
  // Look at swing lows formed before the current candle (use strength=1 for sensitivity)
  const prior = candles.slice(0, -1);
  const swingLows = recentSwings(prior, "low", 5, 1);
  for (let i = swingLows.length - 1; i >= 0; i--) {
    const level = swingLows[i].price;
    if (last.low < level && last.close > level) {
      return { level, wickLow: last.low };
    }
  }
  return null;
}

/**
 * Detect whether the last candle sweeps a buy-side liquidity level (BSL).
 * BSL sweep: candle.high exceeds a recent swing high, then closes below it.
 */
function detectBslSweep(candles) {
  if (candles.length < 4) return null;
  const last = candles[candles.length - 1];
  const prior = candles.slice(0, -1);
  const swingHighs = recentSwings(prior, "high", 5, 1);
  for (let i = swingHighs.length - 1; i >= 0; i--) {
    const level = swingHighs[i].price;
    if (last.high > level && last.close < level) {
      return { level, wickHigh: last.high };
    }
  }
  return null;
}

/**
 * Detect bullish displacement + BoS or CHoCH on M5.
 * Bullish displacement: a bullish candle body > 1.5 × average body size
 * BoS: close > last swing high before the displacement
 * CHoCH: swing low is now higher than a previous swing low (structure shift)
 * Returns { confirmed, displacementCandle, bosLevel } or null.
 */
function detectBullishDisplacementBoS(candles) {
  if (candles.length < 5) return null;
  const last = candles[candles.length - 1];
  if (last.close <= last.open) return null; // must be bullish candle

  const body = Math.abs(last.close - last.open);
  // Exclude the candidate itself from the average to avoid self-inflation
  const priorForAvg = candles.slice(-11, -1);
  const avgBody = priorForAvg.length > 0
    ? priorForAvg.reduce((sum, c) => sum + Math.abs(c.close - c.open), 0) / priorForAvg.length
    : 0;
  const isDisplacement = avgBody > 0 && body >= 1.5 * avgBody;
  if (!isDisplacement) return null;

  // BoS: close breaks above a recent swing high
  const prior = candles.slice(0, -1);
  const swingHighs = recentSwings(prior, "high", 5, 1);
  if (swingHighs.length > 0) {
    const lastSwingHigh = swingHighs[swingHighs.length - 1].price;
    if (last.close > lastSwingHigh) {
      return { confirmed: true, bosLevel: lastSwingHigh, candleEpoch: last.epoch };
    }
  }

  // CHoCH fallback: a bullish displacement candle after a sweeping of a swing low
  // means the lower timeframe is shifting character — accept as valid
  if (swingHighs.length === 0) {
    return { confirmed: true, bosLevel: last.open, candleEpoch: last.epoch };
  }

  return null;
}

/**
 * Detect bearish displacement + BoS or CHoCH on M5.
 */
function detectBearishDisplacementBoS(candles) {
  if (candles.length < 5) return null;
  const last = candles[candles.length - 1];
  if (last.close >= last.open) return null; // must be bearish candle

  const body = Math.abs(last.close - last.open);
  // Exclude the candidate itself from the average to avoid self-inflation
  const priorForAvgB = candles.slice(-11, -1);
  const avgBody = priorForAvgB.length > 0
    ? priorForAvgB.reduce((sum, c) => sum + Math.abs(c.close - c.open), 0) / priorForAvgB.length
    : 0;
  const isDisplacement = avgBody > 0 && body >= 1.5 * avgBody;
  if (!isDisplacement) return null;

  const prior = candles.slice(0, -1);
  const swingLows = recentSwings(prior, "low", 5, 1);
  if (swingLows.length > 0) {
    const lastSwingLow = swingLows[swingLows.length - 1].price;
    if (last.close < lastSwingLow) {
      return { confirmed: true, bosLevel: lastSwingLow, candleEpoch: last.epoch };
    }
  }

  if (swingLows.length === 0) {
    return { confirmed: true, bosLevel: last.open, candleEpoch: last.epoch };
  }

  return null;
}

/**
 * Detect M1 retracement into the entry zone.
 * Entry zone: between sweepLow and displacementOpen (for BUY).
 * Price must trade into this range without having broken back through the sweep low.
 * @param {Array} candles
 * @param {number} zoneLow  - lower bound of entry zone
 * @param {number} zoneHigh - upper bound of entry zone
 */
function detectBullishRetracement(candles, zoneLow, zoneHigh) {
  if (!candles.length) return false;
  const last = candles[candles.length - 1];
  // Price should dip into the zone (low touches the zone) without closing below the zone low
  return last.low <= zoneHigh && last.low >= zoneLow * 0.9995 && last.close >= zoneLow;
}

/**
 * Detect M1 bearish retracement into the entry zone.
 * @param {Array} candles
 * @param {number} zoneLow  - lower bound of entry zone
 * @param {number} zoneHigh - upper bound of entry zone
 */
function detectBearishRetracement(candles, zoneLow, zoneHigh) {
  if (!candles.length) return false;
  const last = candles[candles.length - 1];
  // Price should bounce into the zone (high touches the zone) without closing above the zone high
  return last.high >= zoneLow && last.high <= zoneHigh * 1.0005 && last.close <= zoneHigh;
}

/**
 * Detect bullish rejection on M1: hammer-like candle or momentum bullish candle.
 * Hammer: lower wick >= 2× body AND close > open.
 * Momentum: strong bullish close (body > 60% of range).
 */
function detectBullishRejection(candles) {
  if (!candles.length) return false;
  const last = candles[candles.length - 1];
  const body = Math.abs(last.close - last.open);
  const range = last.high - last.low;
  if (range <= 0) return false;
  const lowerWick = Math.min(last.open, last.close) - last.low;
  // Hammer
  if (last.close > last.open && lowerWick >= body * 2 && body / range <= 0.4) return true;
  // Momentum bullish candle
  if (last.close > last.open && body / range >= 0.6) return true;
  return false;
}

/**
 * Detect bearish rejection on M1: shooting star or momentum bearish candle.
 */
function detectBearishRejection(candles) {
  if (!candles.length) return false;
  const last = candles[candles.length - 1];
  const body = Math.abs(last.close - last.open);
  const range = last.high - last.low;
  if (range <= 0) return false;
  const upperWick = last.high - Math.max(last.open, last.close);
  // Shooting star
  if (last.close < last.open && upperWick >= body * 2 && body / range <= 0.4) return true;
  // Momentum bearish candle
  if (last.close < last.open && body / range >= 0.6) return true;
  return false;
}

/**
 * Run the risk engine validation.
 * @param {{ entry:number, sl:number, tp:number, spread:number, accountBalance:number, maxRiskPct:number, minRR:number }} params
 * @returns {{ valid:boolean, positionSize:number, rr:number, reason:string|null }}
 */
function validateRisk({ entry, sl, tp, spread, accountBalance, maxRiskPct, minRR }) {
  const stopDistance = Math.abs(entry - sl);
  const tpDistance   = Math.abs(tp - entry);

  if (stopDistance <= 0) return { valid: false, positionSize: 0, rr: 0, reason: "Stop distance is zero" };

  // Convert to pips (1 pip = 0.0001 for 5-decimal pairs; we use raw price distance)
  const stopDistancePips = stopDistance / 0.0001;
  const spreadPips = spread / 0.0001;

  // Reject if spread > 30% of stop distance
  if (spread > 0 && spreadPips > stopDistancePips * 0.3) {
    return { valid: false, positionSize: 0, rr: 0, reason: `Spread (${spreadPips.toFixed(1)} pips) is too high relative to stop (${stopDistancePips.toFixed(1)} pips)` };
  }

  const rr = tpDistance / stopDistance;
  if (rr < minRR) {
    return { valid: false, positionSize: 0, rr, reason: `R:R ${rr.toFixed(2)} is below minimum ${minRR}` };
  }

  const riskAmount = accountBalance * (maxRiskPct / 100);
  const positionSize = Math.round((riskAmount / stopDistancePips) * 100) / 100;

  if (positionSize < 0.01) {
    return { valid: false, positionSize, rr, reason: `Position size ${positionSize} lots is below broker minimum 0.01` };
  }

  return { valid: true, positionSize, rr, reason: null };
}

// ── Session factory ──────────────────────────────────────────────────────────

/**
 * Create a precision analysis session for one symbol.
 *
 * @param {{ symbol:string, accountBalance:number, maxRiskPct:number, minRR:number }} options
 * @returns {{ onCandle(timeframe:number, candle:object, indicators:object):object, getState():object, invalidate(reason:string):void }}
 */
export function createPrecisionSession({ symbol, accountBalance, maxRiskPct = 0.5, minRR = 1.5 }) {
  // ── Internal state ──────────────────────────────────────────────────────
  let state = STATES.WAITING;
  let direction = null; // 'BUY' | 'SELL'
  let enteredAt = null; // ms timestamp
  let invalidationReason = null;

  // Setup details
  let setupM15Candles  = [];
  let m5Candles  = [];
  let m1Candles  = [];

  // Key price levels from each step
  let sweepLevel = null;    // the swept swing level price
  let sweepWick  = null;    // the wick extreme of the sweep candle
  let displacementLevel = null; // bosLevel or displacementOpen from M5
  let entryZoneLow  = null;
  let entryZoneHigh = null;
  let suggestedSl   = null;
  let suggestedTp   = null;
  let positionSize  = null;
  let rrRatio       = null;

  // ── Transition helpers ──────────────────────────────────────────────────
  function transitionTo(newState, nowMs) {
    state = newState;
    enteredAt = nowMs ?? Date.now();
  }

  function expire(reason, nowMs) {
    state = STATES.EXPIRED;
    invalidationReason = reason;
    enteredAt = nowMs ?? Date.now();
  }

  // ── Expiry check ────────────────────────────────────────────────────────
  function checkExpiry(nowMs) {
    if (state === STATES.WAITING || state === STATES.EXPIRED || state === STATES.INVALIDATED) return;
    if (enteredAt === null) return;
    const ageSeconds = (nowMs - enteredAt) / 1000;

    switch (state) {
      case STATES.SETUP_DETECTED:
        if (ageSeconds > EXPIRY_SETUP_DETECTED) expire("Setup expired: no M5 confirmation within 4 hours", nowMs);
        break;
      case STATES.M5_CONFIRMED:
        if (ageSeconds > EXPIRY_M5_CONFIRMED) expire("Setup expired: no M1 entry within 1 hour", nowMs);
        break;
      case STATES.M1_CONFIRMED:
        if (ageSeconds > EXPIRY_M1_CONFIRMED) expire("Setup expired: no risk validation within 15 minutes", nowMs);
        break;
      case STATES.BUY:
      case STATES.SELL:
        if (ageSeconds > EXPIRY_SIGNAL) expire("Signal expired: 30 minutes elapsed", nowMs);
        break;
      default:
        break;
    }
  }

  /**
   * Check invalidation: price moved 1.5× stop distance from the entry zone.
   */
  function checkInvalidationByPrice(currentPrice) {
    if (!sweepLevel || !displacementLevel) return;
    if (state === STATES.WAITING || state === STATES.EXPIRED || state === STATES.INVALIDATED) return;

    const refDistance = Math.abs(displacementLevel - sweepLevel);
    if (refDistance <= 0) return;

    if (direction === "BUY") {
      // If price drops 1.5× stop distance below the sweep wick, invalidate
      const threshold = (sweepWick ?? sweepLevel) - refDistance * 1.5;
      if (currentPrice < threshold) {
        invalidate("Price moved 1.5× setup stop distance below entry zone");
      }
      // For BUY signal, also check if price drops below SL
      if (state === STATES.BUY && suggestedSl !== null && currentPrice < suggestedSl) {
        invalidate("Price moved past stop-loss level");
      }
    } else if (direction === "SELL") {
      const threshold = (sweepWick ?? sweepLevel) + refDistance * 1.5;
      if (currentPrice > threshold) {
        invalidate("Price moved 1.5× setup stop distance above entry zone");
      }
      if (state === STATES.SELL && suggestedSl !== null && currentPrice > suggestedSl) {
        invalidate("Price moved past stop-loss level");
      }
    }
  }

  // ── candle accumulator ──────────────────────────────────────────────────
  function pushCandle(storage, candle) {
    // Deduplicate by epoch
    const existing = storage.findIndex((c) => c.epoch === candle.epoch);
    if (existing >= 0) {
      storage[existing] = candle;
    } else {
      storage.push(candle);
      storage.sort((a, b) => a.epoch - b.epoch);
    }
    // Keep only last 240 candles
    if (storage.length > 240) storage.splice(0, storage.length - 240);
  }

  // ── Main candle handler ─────────────────────────────────────────────────
  /**
   * @param {60|300|900} timeframe - M1=60, M5=300, M15=900
   * @param {{ epoch:number, open:number, high:number, low:number, close:number }} candle
   * @param {{ spread?:number, tp?:number }} [indicators]
   */
  function onCandle(timeframe, candle, indicators = {}) {
    const nowMs = candle.epoch ? candle.epoch * 1000 : Date.now();

    // Update candle storage
    if (timeframe === 900) pushCandle(setupM15Candles, candle);
    else if (timeframe === 300) pushCandle(m5Candles, candle);
    else if (timeframe === 60)  pushCandle(m1Candles, candle);

    // Check expiry first
    checkExpiry(nowMs);
    if (state === STATES.EXPIRED || state === STATES.INVALIDATED) return getState();

    // Check price invalidation
    checkInvalidationByPrice(candle.close);
    if (state === STATES.EXPIRED || state === STATES.INVALIDATED) return getState();

    // ── State machine transitions ─────────────────────────────────────────
    if (state === STATES.WAITING) {
      // Step 1 — M15: detect bullish or bearish context
      if (timeframe === 900 && setupM15Candles.length >= 5) {
        const bullish = hasBullishStructure(setupM15Candles);
        const bearish = hasBearishStructure(setupM15Candles);
        if (bullish) {
          direction = "BUY";
          transitionTo(STATES.SETUP_DETECTED, nowMs);
        } else if (bearish) {
          direction = "SELL";
          transitionTo(STATES.SETUP_DETECTED, nowMs);
        }
      }
    }

    else if (state === STATES.SETUP_DETECTED) {
      // Step 2 — M15 or M5: detect liquidity sweep in the correct direction
      if ((timeframe === 900 || timeframe === 300)) {
        const sourceCandles = timeframe === 900 ? setupM15Candles : m5Candles;
        if (direction === "BUY") {
          const sweep = detectSslSweep(sourceCandles);
          if (sweep) {
            sweepLevel = sweep.level;
            sweepWick  = sweep.wickLow;
            transitionTo(STATES.M5_CONFIRMED, nowMs);
          }
        } else if (direction === "SELL") {
          const sweep = detectBslSweep(sourceCandles);
          if (sweep) {
            sweepLevel = sweep.level;
            sweepWick  = sweep.wickHigh;
            transitionTo(STATES.M5_CONFIRMED, nowMs);
          }
        }
      }
    }

    else if (state === STATES.M5_CONFIRMED) {
      // Step 3 — M5: displacement + BoS/CHoCH
      if (timeframe === 300 && m5Candles.length >= 5) {
        if (direction === "BUY") {
          const result = detectBullishDisplacementBoS(m5Candles);
          if (result) {
            displacementLevel = result.bosLevel;
            // Entry zone: between sweep wick and displacement bosLevel
            entryZoneLow  = Math.min(sweepWick ?? sweepLevel, displacementLevel);
            entryZoneHigh = Math.max(sweepWick ?? sweepLevel, displacementLevel);
            transitionTo(STATES.M1_CONFIRMED, nowMs);
          }
        } else if (direction === "SELL") {
          const result = detectBearishDisplacementBoS(m5Candles);
          if (result) {
            displacementLevel = result.bosLevel;
            entryZoneLow  = Math.min(sweepWick ?? sweepLevel, displacementLevel);
            entryZoneHigh = Math.max(sweepWick ?? sweepLevel, displacementLevel);
            transitionTo(STATES.M1_CONFIRMED, nowMs);
          }
        }
      }
    }

    else if (state === STATES.M1_CONFIRMED) {
      // Step 4 — M1: retracement into entry zone (need at least 1 M1 candle)
      if (timeframe === 60 && m1Candles.length >= 1) {
        let retraced = false;
        if (direction === "BUY") {
          retraced = detectBullishRetracement(m1Candles, entryZoneLow, entryZoneHigh);
        } else if (direction === "SELL") {
          retraced = detectBearishRetracement(m1Candles, entryZoneLow, entryZoneHigh);
        }
        if (retraced) {
          // Step 5 — M1: rejection confirmed in same or next candle
          let rejected = false;
          if (direction === "BUY") {
            rejected = detectBullishRejection(m1Candles);
          } else {
            rejected = detectBearishRejection(m1Candles);
          }

          if (rejected) {
            transitionTo(STATES.RISK_VALIDATED, nowMs);
            // Immediately run risk engine
            _runRiskEngine(candle.close, indicators, nowMs);
          }
        }
      }
    }

    // RISK_VALIDATED is handled immediately in the M1_CONFIRMED block above,
    // but also re-check if we're already there (e.g. after a re-feed)
    else if (state === STATES.RISK_VALIDATED) {
      _runRiskEngine(candle.close, indicators, nowMs);
    }

    return getState();
  }

  /**
   * Run the risk engine and transition to BUY/SELL if valid.
   * @param {number} currentPrice
   * @param {{ spread?:number, tp?:number }} indicators
   * @param {number} [nowMs]
   */
  function _runRiskEngine(currentPrice, indicators, nowMs) {
    const spread = indicators?.spread ?? 0;

    // SL: below the sweep wick for BUY, above for SELL
    if (direction === "BUY") {
      suggestedSl = sweepWick !== null ? sweepWick * 0.9999 : sweepLevel * 0.9999;
      const stopDist = currentPrice - suggestedSl;
      suggestedTp = indicators?.tp ?? currentPrice + stopDist * Math.max(minRR, 1.5);
    } else {
      suggestedSl = sweepWick !== null ? sweepWick * 1.0001 : sweepLevel * 1.0001;
      const stopDist = suggestedSl - currentPrice;
      suggestedTp = indicators?.tp ?? currentPrice - stopDist * Math.max(minRR, 1.5);
    }

    const risk = validateRisk({
      entry: currentPrice,
      sl: suggestedSl,
      tp: suggestedTp,
      spread,
      accountBalance,
      maxRiskPct,
      minRR,
    });

    if (risk.valid) {
      positionSize = risk.positionSize;
      rrRatio = risk.rr;
      transitionTo(direction, nowMs); // → "BUY" or "SELL"
    } else {
      // Risk rejected — go back to WAITING and record why
      invalidationReason = risk.reason;
      transitionTo(STATES.WAITING, nowMs);
      // Reset setup data so we can detect a fresh setup
      sweepLevel = null;
      sweepWick  = null;
      displacementLevel = null;
      entryZoneLow  = null;
      entryZoneHigh = null;
      suggestedSl   = null;
      suggestedTp   = null;
    }
  }

  /**
   * Force transition to INVALIDATED.
   * @param {string} reason
   */
  function invalidate(reason) {
    state = STATES.INVALIDATED;
    invalidationReason = reason;
    if (enteredAt === null) enteredAt = Date.now();
  }

  /**
   * Return a snapshot of the current session state.
   */
  function getState() {
    const nowMs = Date.now();
    const ageMs = enteredAt !== null ? nowMs - enteredAt : 0;

    const terminal = state === STATES.EXPIRED || state === STATES.INVALIDATED;
    const actionable = (state === STATES.BUY || state === STATES.SELL) && !terminal;

    return {
      state,
      direction,
      symbol,
      enteredAt,
      ageMs,
      entryZone: entryZoneLow !== null ? { low: entryZoneLow, high: entryZoneHigh } : null,
      suggestedSl,
      suggestedTp,
      positionSize,
      rrRatio,
      sweepLevel,
      displacementLevel,
      invalidationReason: terminal ? invalidationReason : null,
      actionable,
      pendingStep: _pendingStep(),
    };
  }

  function _pendingStep() {
    switch (state) {
      case STATES.WAITING:
        return "Waiting for M15 bullish or bearish market structure";
      case STATES.SETUP_DETECTED:
        return direction === "BUY"
          ? "Waiting for M15/M5 sell-side liquidity (SSL) sweep"
          : "Waiting for M15/M5 buy-side liquidity (BSL) sweep";
      case STATES.M5_CONFIRMED:
        return direction === "BUY"
          ? "Waiting for M5 bullish displacement + BoS/CHoCH"
          : "Waiting for M5 bearish displacement + BoS/CHoCH";
      case STATES.M1_CONFIRMED:
        return direction === "BUY"
          ? "Waiting for M1 retracement into entry zone + bullish rejection"
          : "Waiting for M1 retracement into entry zone + bearish rejection";
      case STATES.RISK_VALIDATED:
        return "Running risk engine validation";
      case STATES.BUY:
        return "BUY signal active — monitor price and stop-loss";
      case STATES.SELL:
        return "SELL signal active — monitor price and stop-loss";
      case STATES.EXPIRED:
        return "Signal expired — reset and wait for new setup";
      case STATES.INVALIDATED:
        return "Signal invalidated — reset and wait for new setup";
      default:
        return "";
    }
  }

  // ── Expose public API ───────────────────────────────────────────────────
  return { onCandle, getState, invalidate };
}
