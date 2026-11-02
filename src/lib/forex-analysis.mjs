/**
 * Deterministic, inspectable forex chart analysis.
 * Inputs are chronologically ascending OHLC candles. Pass only closed candles
 * to analyzeForexCandles when confirmed formations are required.
 * This module does not infer future prices or calculate trade probabilities.
 */

/**
 * @typedef {{ epoch:number, open:number, high:number, low:number, close:number }} Candle
 * @typedef {{ index:number, epoch:number, price:number, kind:"high"|"low" }} SwingPoint
 * @typedef {{ index:number, epoch:number, label:string, bias:"bullish"|"bearish"|"neutral" }} CandlePattern
 * @typedef {{ price:number, touches:number, lastTouch:number, distance:number }} PriceZone
 */

export const FOREX_CANDLE_PATTERNS = Object.freeze([
  "Doji",
  "Hammer / lower-wick rejection",
  "Shooting star / upper-wick rejection",
  "Bullish engulfing",
  "Bearish engulfing",
  "Morning star",
  "Evening star",
  "Inside bar",
]);

function validCandle(candle) {
  return Boolean(
    candle &&
    Number.isFinite(candle.epoch) &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    candle.high >= Math.max(candle.open, candle.close) &&
    candle.low <= Math.min(candle.open, candle.close) &&
    candle.high >= candle.low
  );
}

export function normalizeCandles(candles) {
  if (!Array.isArray(candles)) return [];
  const byEpoch = new Map();
  for (const candle of candles) {
    if (validCandle(candle)) {
      byEpoch.set(Number(candle.epoch), {
        epoch: Number(candle.epoch),
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
      });
    }
  }
  return [...byEpoch.values()].sort((a, b) => a.epoch - b.epoch);
}

export function calculateAtr(candles, period = 14) {
  const bars = normalizeCandles(candles);
  const safePeriod = Number.isInteger(period) && period > 0 ? period : 14;
  if (bars.length < 2) return 0;
  const ranges = [];
  for (let i = 1; i < bars.length; i += 1) {
    const current = bars[i];
    const previousClose = bars[i - 1].close;
    ranges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previousClose),
      Math.abs(current.low - previousClose),
    ));
  }
  const selected = ranges.slice(-safePeriod);
  return selected.length
    ? selected.reduce((sum, value) => sum + value, 0) / selected.length
    : 0;
}

function candleGeometry(candle) {
  const range = candle.high - candle.low;
  const body = Math.abs(candle.close - candle.open);
  const topOfBody = Math.max(candle.open, candle.close);
  const bottomOfBody = Math.min(candle.open, candle.close);
  return {
    range,
    body,
    upperWick: candle.high - topOfBody,
    lowerWick: bottomOfBody - candle.low,
    bullish: candle.close > candle.open,
    bearish: candle.close < candle.open,
  };
}

function isSmallBody(candle, ratio = 0.3) {
  const shape = candleGeometry(candle);
  return shape.range > 0 && shape.body / shape.range <= ratio;
}

/**
 * Return one highest-priority geometric pattern label per bar.
 * Candle geometry is described separately from trend context; neither alone
 * predicts the next price movement.
 */
export function detectCandlePatterns(candles, limit = 160) {
  const bars = normalizeCandles(candles);
  if (bars.length < 1) return [];
  const maxBars = Number.isInteger(limit) && limit > 0 ? limit : 160;
  const start = Math.max(0, bars.length - maxBars);
  const patterns = [];

  for (let i = Math.max(1, start); i < bars.length; i += 1) {
    const current = bars[i];
    const previous = bars[i - 1];
    const currentShape = candleGeometry(current);
    const previousShape = candleGeometry(previous);
    const bodyHigh = Math.max(current.open, current.close);
    const bodyLow = Math.min(current.open, current.close);
    const previousBodyHigh = Math.max(previous.open, previous.close);
    const previousBodyLow = Math.min(previous.open, previous.close);
    let pattern = null;

    if (i >= 2) {
      const first = bars[i - 2];
      const middle = bars[i - 1];
      const firstShape = candleGeometry(first);
      const firstBodyMidpoint = (first.open + first.close) / 2;

      if (
        firstShape.bearish &&
        firstShape.range > 0 &&
        firstShape.body / firstShape.range >= 0.5 &&
        isSmallBody(middle, 0.35) &&
        currentShape.bullish &&
        current.close > firstBodyMidpoint
      ) {
        pattern = { label: "Morning star", bias: "bullish" };
      } else if (
        firstShape.bullish &&
        firstShape.range > 0 &&
        firstShape.body / firstShape.range >= 0.5 &&
        isSmallBody(middle, 0.35) &&
        currentShape.bearish &&
        current.close < firstBodyMidpoint
      ) {
        pattern = { label: "Evening star", bias: "bearish" };
      }
    }

    if (!pattern && currentShape.bullish && previousShape.bearish &&
        bodyLow <= previousBodyLow && bodyHigh >= previousBodyHigh) {
      pattern = { label: "Bullish engulfing", bias: "bullish" };
    } else if (!pattern && currentShape.bearish && previousShape.bullish &&
               bodyLow <= previousBodyLow && bodyHigh >= previousBodyHigh) {
      pattern = { label: "Bearish engulfing", bias: "bearish" };
    } else if (!pattern && currentShape.range > 0 &&
               currentShape.body / currentShape.range <= 0.1) {
      pattern = { label: "Doji", bias: "neutral" };
    } else if (!pattern && currentShape.range > 0 &&
               currentShape.body / currentShape.range <= 0.4 &&
               currentShape.lowerWick >= Math.max(currentShape.body * 2, currentShape.range * 0.55) &&
               currentShape.upperWick <= currentShape.range * 0.2) {
      pattern = { label: "Hammer / lower-wick rejection", bias: currentShape.bullish ? "bullish" : "neutral" };
    } else if (!pattern && currentShape.range > 0 &&
               currentShape.body / currentShape.range <= 0.4 &&
               currentShape.upperWick >= Math.max(currentShape.body * 2, currentShape.range * 0.55) &&
               currentShape.lowerWick <= currentShape.range * 0.2) {
      pattern = { label: "Shooting star / upper-wick rejection", bias: currentShape.bearish ? "bearish" : "neutral" };
    } else if (!pattern &&
               current.high < previous.high &&
               current.low > previous.low) {
      pattern = { label: "Inside bar", bias: "neutral" };
    }

    if (pattern) patterns.push({
      index: i,
      epoch: current.epoch,
      label: pattern.label,
      bias: pattern.bias,
    });
  }

  return patterns;
}

/**
 * Confirm swing points with bars on both sides, so the newest bars cannot be
 * marked as swings prematurely. Returned indices use ascending candle order.
 */
export function findSwingPoints(candles, strength = 2) {
  const bars = normalizeCandles(candles);
  const side = Number.isInteger(strength) && strength >= 1 ? strength : 2;
  if (bars.length < (side * 2) + 1) return [];

  const swings = [];
  for (let i = side; i < bars.length - side; i += 1) {
    let swingHigh = true;
    let swingLow = true;
    for (let offset = 1; offset <= side; offset += 1) {
      if (bars[i].high <= bars[i - offset].high ||
          bars[i].high <= bars[i + offset].high) swingHigh = false;
      if (bars[i].low >= bars[i - offset].low ||
          bars[i].low >= bars[i + offset].low) swingLow = false;
      if (!swingHigh && !swingLow) break;
    }
    if (swingHigh) swings.push({ index: i, epoch: bars[i].epoch, price: bars[i].high, kind: "high" });
    if (swingLow) swings.push({ index: i, epoch: bars[i].epoch, price: bars[i].low, kind: "low" });
  }
  return swings.sort((a, b) => a.index - b.index || a.kind.localeCompare(b.kind));
}

function classifyStructure(swings, atr) {
  const highs = swings.filter((point) => point.kind === "high");
  const lows = swings.filter((point) => point.kind === "low");
  if (highs.length < 2 || lows.length < 2) {
    return {
      label: "Not enough confirmed swings",
      detail: "More completed candles are needed to compare swing highs and lows.",
      bullish: false,
      bearish: false,
    };
  }

  const previousHigh = highs[highs.length - 2].price;
  const latestHigh = highs[highs.length - 1].price;
  const previousLow = lows[lows.length - 2].price;
  const latestLow = lows[lows.length - 1].price;
  const tolerance = Math.max(atr * 0.08, Number.EPSILON);
  const hh = latestHigh > previousHigh + tolerance;
  const lh = latestHigh < previousHigh - tolerance;
  const hl = latestLow > previousLow + tolerance;
  const ll = latestLow < previousLow - tolerance;

  if (hh && hl) return { label: "Bullish structure", detail: "Latest confirmed swings show a higher high and higher low.", bullish: true, bearish: false };
  if (lh && ll) return { label: "Bearish structure", detail: "Latest confirmed swings show a lower high and lower low.", bullish: false, bearish: true };
  return { label: "Mixed / range structure", detail: "Recent confirmed highs and lows do not agree on one direction.", bullish: false, bearish: false };
}

function clusterZones(swings, currentPrice, atr) {
  const mergeDistance = Math.max(atr * 0.35, Math.abs(currentPrice) * 0.00002);
  const buckets = { support: [], resistance: [] };

  for (const point of swings) {
    const side = point.kind === "low" && point.price < currentPrice
      ? "support"
      : point.kind === "high" && point.price > currentPrice
        ? "resistance"
        : null;
    if (!side) continue;

    const existing = buckets[side].find((zone) => Math.abs(zone.price - point.price) <= mergeDistance);
    if (existing) {
      existing.price = ((existing.price * existing.touches) + point.price) / (existing.touches + 1);
      existing.touches += 1;
      existing.lastTouch = Math.max(existing.lastTouch, point.epoch);
    } else {
      buckets[side].push({ price: point.price, touches: 1, lastTouch: point.epoch });
    }
  }

  const sortNearest = (zones) => zones
    .map((zone) => ({ ...zone, distance: Math.abs(currentPrice - zone.price) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3);

  return {
    support: sortNearest(buckets.support),
    resistance: sortNearest(buckets.resistance),
  };
}

/**
 * Standard EMA calculation.
 * @param {Array<{epoch:number, open:number, high:number, low:number, close:number}>} candles - chronologically ascending candles
 * @param {number} period
 * @returns {number} latest EMA value, or 0 if insufficient data
 */
export function calculateEma(candles, period) {
  const bars = normalizeCandles(candles);
  const safePeriod = Number.isInteger(period) && period > 0 ? period : 9;
  if (bars.length < safePeriod) return 0;

  // Seed with SMA of first `period` closes
  let ema = bars.slice(0, safePeriod).reduce((sum, c) => sum + c.close, 0) / safePeriod;
  const k = 2 / (safePeriod + 1);
  for (let i = safePeriod; i < bars.length; i++) {
    ema = bars[i].close * k + ema * (1 - k);
  }
  return ema;
}

/**
 * @param {Array<{epoch:number, open:number, high:number, low:number, close:number}>} m1Candles
 * @param {{bullish: boolean, bearish: boolean}} m15Structure
 * @param {number} [entryBid]
 * @param {number} [entryAsk]
 * @returns {{ signal: 'STRONG_BUY'|'BUY'|'WAIT'|'SELL'|'STRONG_SELL'|'NO_SIGNAL', score: number, components: { emaScore: number, patternScore: number, patternLabel: string, structureScore: number, atrActive: boolean }, suggestedSl: number|null, suggestedTp: number|null, entryPrice: number|null }}
 */
export function computeSignal(m1Candles, m15Structure, entryBid, entryAsk) {
  const bars = normalizeCandles(m1Candles);

  // Layer 1: EMA momentum
  const ema9 = calculateEma(bars, 9);
  const ema21 = calculateEma(bars, 21);
  const emaScore = ema9 > ema21 ? 2 : ema9 < ema21 ? -2 : 0;

  // Layer 2: Candle pattern (last pattern only)
  const patterns = detectCandlePatterns(bars);
  const lastPattern = patterns.length ? patterns[patterns.length - 1] : null;
  const patternLabel = lastPattern?.label ?? 'None';
  let patternScore = 0;
  if (lastPattern) {
    const lbl = lastPattern.label.toLowerCase();
    if (lbl.includes('bullish engulfing') || lbl.includes('morning star') || lbl.includes('hammer')) {
      patternScore = 2;
    } else if (lbl.includes('bearish engulfing') || lbl.includes('evening star') || lbl.includes('shooting star')) {
      patternScore = -2;
    }
  }

  // Layer 3: M15 structure
  const structureScore = m15Structure.bullish ? 1 : m15Structure.bearish ? -1 : 0;

  // ATR activity filter
  const currentAtr = calculateAtr(bars, 14);
  let avgAtr = 0;
  if (bars.length >= 15) {
    const startIdx = Math.max(14, bars.length - 20);
    const samples = [];
    for (let i = startIdx; i < bars.length; i++) {
      samples.push(calculateAtr(bars.slice(0, i + 1), 14));
    }
    avgAtr = samples.length ? samples.reduce((sum, v) => sum + v, 0) / samples.length : 0;
  }
  const atrActive = bars.length >= 15 && avgAtr > 0 && currentAtr >= 0.7 * avgAtr;

  if (!atrActive) {
    return {
      signal: 'NO_SIGNAL',
      score: 0,
      components: { emaScore, patternScore, patternLabel, structureScore, atrActive: false },
      suggestedSl: null,
      suggestedTp: null,
      entryPrice: null,
    };
  }

  const score = emaScore + patternScore + structureScore;
  let signal;
  if (score >= 4) signal = 'STRONG_BUY';
  else if (score === 3) signal = 'BUY';
  else if (score === -3) signal = 'SELL';
  else if (score <= -4) signal = 'STRONG_SELL';
  else signal = 'WAIT';

  // SL/TP
  let suggestedSl = null;
  let suggestedTp = null;
  let entryPrice = null;

  if (signal === 'STRONG_BUY' || signal === 'BUY') {
    entryPrice = (typeof entryAsk === 'number' && Number.isFinite(entryAsk) && entryAsk > 0)
      ? entryAsk
      : bars[bars.length - 1].close;
    const last3Lows = bars.slice(-3).map((c) => c.low);
    suggestedSl = Math.min(...last3Lows) - 0.3 * currentAtr;
    const slDist = entryPrice - suggestedSl;
    suggestedTp = entryPrice + slDist * 1.5;
  } else if (signal === 'SELL' || signal === 'STRONG_SELL') {
    entryPrice = (typeof entryBid === 'number' && Number.isFinite(entryBid) && entryBid > 0)
      ? entryBid
      : bars[bars.length - 1].close;
    const last3Highs = bars.slice(-3).map((c) => c.high);
    suggestedSl = Math.max(...last3Highs) + 0.3 * currentAtr;
    const slDist = suggestedSl - entryPrice;
    suggestedTp = entryPrice - slDist * 1.5;
  }

  return {
    signal,
    score,
    components: { emaScore, patternScore, patternLabel, structureScore, atrActive },
    suggestedSl,
    suggestedTp,
    entryPrice,
  };
}

// ── Smart Money Concepts (SMC) Signal Engine ────────────────────────────────

/**
 * Finds untapped Buy-Side Liquidity (BSL) swing highs and Sell-Side Liquidity
 * (SSL) swing lows from the last 5 confirmed swing points of each kind.
 * A level is "untapped" if no candle after it has a CLOSE strictly beyond it.
 * @param {Array<{epoch:number, open:number, high:number, low:number, close:number}>} candles
 * @returns {{ bsl: number[], ssl: number[] }}
 */
export function findLiquidityLevels(candles) {
  const bars = normalizeCandles(candles);
  const swings = findSwingPoints(bars, 2);

  const highs = swings.filter((s) => s.kind === 'high');
  const lows = swings.filter((s) => s.kind === 'low');

  // Take the last 5 confirmed swing highs / lows
  const recentHighs = highs.slice(-5);
  const recentLows = lows.slice(-5);

  const bsl = [];
  for (const swing of recentHighs) {
    const swingIndex = bars.findIndex((b) => b.epoch === swing.epoch);
    if (swingIndex < 0) continue;
    const tapped = bars.slice(swingIndex + 1).some((b) => b.close > swing.price);
    if (!tapped) bsl.push(swing.price);
  }

  const ssl = [];
  for (const swing of recentLows) {
    const swingIndex = bars.findIndex((b) => b.epoch === swing.epoch);
    if (swingIndex < 0) continue;
    const tapped = bars.slice(swingIndex + 1).some((b) => b.close < swing.price);
    if (!tapped) ssl.push(swing.price);
  }

  // Return most recent 3 of each (highest prices for BSL, lowest prices for SSL)
  return {
    bsl: bsl.slice(-3),
    ssl: ssl.slice(-3),
  };
}

/**
 * Detect whether the last candle in the array swept a BSL or SSL level.
 * BSL sweep: candle.high > bslLevel AND candle.close < bslLevel (bearish reversal setup).
 * SSL sweep: candle.low < sslLevel AND candle.close > sslLevel (bullish reversal setup).
 * @param {Array<{epoch:number, open:number, high:number, low:number, close:number}>} candles
 * @param {{ bsl: number[], ssl: number[] }} levels
 * @returns {{ type: 'BSL' | 'SSL', level: number, epoch: number, wickExtreme: number } | null}
 */
export function detectLiquiditySweep(candles, levels) {
  const bars = normalizeCandles(candles);
  if (!bars.length || !levels) return null;

  const last = bars[bars.length - 1];
  if (!last) return null;

  // Check BSL sweeps
  const bslSwept = (levels.bsl ?? []).filter((level) => last.high > level && last.close < level);
  // Check SSL sweeps
  const sslSwept = (levels.ssl ?? []).filter((level) => last.low < level && last.close > level);

  if (!bslSwept.length && !sslSwept.length) return null;

  // Pick most recently swept level — since we have only the last candle, if multiple match
  // we prefer the level closest to the wick extreme (most significant sweep)
  if (bslSwept.length) {
    // For BSL, pick the highest swept level (most significant)
    const level = bslSwept.reduce((a, b) => (a > b ? a : b));
    return { type: 'BSL', level, epoch: last.epoch, wickExtreme: last.high };
  }
  if (sslSwept.length) {
    // For SSL, pick the lowest swept level (most significant)
    const level = sslSwept.reduce((a, b) => (a < b ? a : b));
    return { type: 'SSL', level, epoch: last.epoch, wickExtreme: last.low };
  }

  return null;
}

/**
 * Detect a Break of Structure (BoS) after a liquidity sweep.
 * For SSL sweep (bullish): BoS confirmed when a candle CLOSE breaks above the last swing HIGH before/at the sweep.
 * For BSL sweep (bearish): BoS confirmed when a candle CLOSE breaks below the last swing LOW before/at the sweep.
 * Only looks at up to 10 candles after the sweep candle.
 * @param {Array<{epoch:number, open:number, high:number, low:number, close:number}>} candles
 * @param {number} sweepEpoch
 * @param {'BSL' | 'SSL'} sweepType
 * @returns {{ confirmed: boolean, bosLevel?: number, bosEpoch?: number }}
 */
export function detectBreakOfStructure(candles, sweepEpoch, sweepType) {
  const bars = normalizeCandles(candles);
  if (!bars.length || !Number.isFinite(sweepEpoch)) return { confirmed: false };

  const sweepIdx = bars.findIndex((b) => b.epoch === sweepEpoch);
  // If sweep candle not found, use last candle as sweep point
  const resolvedSweepIdx = sweepIdx >= 0 ? sweepIdx : bars.length - 1;

  const swings = findSwingPoints(bars.slice(0, resolvedSweepIdx + 1), 2);

  const postSweep = bars.slice(resolvedSweepIdx + 1, resolvedSweepIdx + 11);
  if (!postSweep.length) return { confirmed: false };

  if (sweepType === 'SSL') {
    // Bullish setup — look for last swing HIGH before/at the sweep
    const swingHighs = swings.filter((s) => s.kind === 'high');
    if (!swingHighs.length) return { confirmed: false };
    const pivotHigh = swingHighs[swingHighs.length - 1].price;
    for (const candle of postSweep) {
      if (candle.close > pivotHigh) {
        return { confirmed: true, bosLevel: pivotHigh, bosEpoch: candle.epoch };
      }
    }
  } else if (sweepType === 'BSL') {
    // Bearish setup — look for last swing LOW before/at the sweep
    const swingLows = swings.filter((s) => s.kind === 'low');
    if (!swingLows.length) return { confirmed: false };
    const pivotLow = swingLows[swingLows.length - 1].price;
    for (const candle of postSweep) {
      if (candle.close < pivotLow) {
        return { confirmed: true, bosLevel: pivotLow, bosEpoch: candle.epoch };
      }
    }
  }

  return { confirmed: false };
}

/**
 * Full SMC signal computation across H1 (context), M15 (sweep), and M1 (entry/BoS).
 * @param {Array<{epoch:number, open:number, high:number, low:number, close:number}>} m1Candles
 * @param {Array<{epoch:number, open:number, high:number, low:number, close:number}>} m15Candles
 * @param {Array<{epoch:number, open:number, high:number, low:number, close:number}>} h1Candles
 * @param {number} [currentBid]
 * @param {number} [currentAsk]
 */
export function computeSmcSignal(m1Candles, m15Candles, h1Candles, currentBid, currentAsk) {
  const WAIT_SIGNAL = (h1Levels) => ({
    signal: 'WAIT',
    type: null,
    sweepLevel: null,
    sweepLow: null,
    sweepHigh: null,
    bosLevel: null,
    entry: null,
    sl: null,
    tp: null,
    rrRatio: null,
    h1SweepLevel: null,
    confidence: null,
    h1Levels: h1Levels ?? { bsl: [], ssl: [] },
    m15SweepEpoch: null,
    bosEpoch: null,
  });

  // Guard: require at least minimal candle data
  const m1Bars = normalizeCandles(m1Candles);
  const m15Bars = normalizeCandles(m15Candles);
  const h1Bars = normalizeCandles(h1Candles);

  if (!m1Bars.length || !m15Bars.length || !h1Bars.length) {
    return WAIT_SIGNAL({ bsl: [], ssl: [] });
  }

  // Step 1: H1 liquidity levels
  const h1Levels = findLiquidityLevels(h1Bars);

  // Step 2: M15 sweep — first try against H1 levels
  let sweep = detectLiquiditySweep(m15Bars, h1Levels);
  let confidence = null;
  let h1SweepLevel = null;

  if (sweep) {
    confidence = 'HIGH';
    h1SweepLevel = sweep.level;
  } else {
    // Fallback: try M15-level sweep
    const m15Levels = findLiquidityLevels(m15Bars);
    sweep = detectLiquiditySweep(m15Bars, m15Levels);
    if (sweep) {
      confidence = 'MEDIUM';
    }
  }

  if (!sweep) {
    return WAIT_SIGNAL(h1Levels);
  }

  // Step 3: M1 BoS detection
  // Check if sweep epoch exists in M1 candles
  const sweepEpochInM1 = m1Bars.some((b) => b.epoch === sweep.epoch);
  const bosEpoch = sweepEpochInM1
    ? sweep.epoch
    : m1Bars[m1Bars.length - 1]?.epoch ?? sweep.epoch;

  const bos = detectBreakOfStructure(m1Bars, bosEpoch, sweep.type);

  if (!bos.confirmed) {
    return WAIT_SIGNAL(h1Levels);
  }

  // Step 4: Build signal
  const isBuy = sweep.type === 'SSL';
  const isSell = sweep.type === 'BSL';
  const signal = isBuy ? 'BUY' : 'SELL';
  const type = isBuy ? 'SSL_SWEEP_BOS' : 'BSL_SWEEP_BOS';

  // Entry
  let entry = null;
  if (isBuy && typeof currentAsk === 'number' && Number.isFinite(currentAsk) && currentAsk > 0) {
    entry = currentAsk;
  } else if (isSell && typeof currentBid === 'number' && Number.isFinite(currentBid) && currentBid > 0) {
    entry = currentBid;
  } else {
    entry = m1Bars[m1Bars.length - 1]?.close ?? null;
  }

  if (entry == null || !Number.isFinite(entry)) {
    return WAIT_SIGNAL(h1Levels);
  }

  // ATR for SL buffer
  const atr = calculateAtr(m1Bars, 14);
  const atrBuffer = Number.isFinite(atr) && atr > 0 ? atr * 0.3 : 0;

  // SL
  let sl = null;
  if (isBuy) {
    sl = sweep.wickExtreme - atrBuffer; // below the sweep wick
  } else {
    sl = sweep.wickExtreme + atrBuffer; // above the sweep wick
  }

  if (!Number.isFinite(sl)) {
    return WAIT_SIGNAL(h1Levels);
  }

  // TP — nearest opposing H1 level
  let tp = null;
  if (isBuy) {
    // Target nearest BSL above entry
    const targets = h1Levels.bsl.filter((lvl) => lvl > entry).sort((a, b) => a - b);
    tp = targets.length ? targets[0] : entry + Math.abs(entry - sl) * 2;
  } else {
    // Target nearest SSL below entry
    const targets = h1Levels.ssl.filter((lvl) => lvl < entry).sort((a, b) => b - a);
    tp = targets.length ? targets[0] : entry - Math.abs(entry - sl) * 2;
  }

  if (!Number.isFinite(tp)) {
    tp = isBuy ? entry + Math.abs(entry - sl) * 2 : entry - Math.abs(entry - sl) * 2;
  }

  // R:R
  const slDist = Math.abs(entry - sl);
  const tpDist = Math.abs(tp - entry);
  const rrRatio = slDist > 0 && Number.isFinite(tpDist) ? Math.round((tpDist / slDist) * 100) / 100 : null;

  return {
    signal,
    type,
    sweepLevel: sweep.level,
    sweepLow: isBuy ? sweep.wickExtreme : null,
    sweepHigh: isSell ? sweep.wickExtreme : null,
    bosLevel: bos.bosLevel ?? null,
    entry,
    sl,
    tp,
    rrRatio,
    h1SweepLevel,
    confidence,
    h1Levels,
    m15SweepEpoch: sweep.epoch,
    bosEpoch: bos.bosEpoch ?? null,
  };
}

// ── End SMC Signal Engine ────────────────────────────────────────────────────

// ── Layer 1: Trendlines ────────────────────────────────────────────────────

/**
 * Build trendlines through swing points.
 * @param {SwingPoint[]} swings
 * @param {{ bullish: boolean, bearish: boolean }} structure
 * @returns {{ uptrend: Array<{epoch:number,price:number}>|null, downtrend: Array<{epoch:number,price:number}>|null }}
 */
export function buildTrendlines(swings, structure) {
  // For uptrend: filter HL points (swing lows where price > previous swing low)
  const lows = swings.filter((s) => s.kind === 'low');
  const hlPoints = [];
  let prevLow = null;
  for (const s of lows) {
    if (prevLow !== null && s.price > prevLow) {
      hlPoints.push({ epoch: s.epoch, price: s.price });
    }
    prevLow = s.price;
  }
  const uptrendPoints = hlPoints.slice(-3);

  // For downtrend: filter LH points (swing highs where price < previous swing high)
  const highs = swings.filter((s) => s.kind === 'high');
  const lhPoints = [];
  let prevHigh = null;
  for (const s of highs) {
    if (prevHigh !== null && s.price < prevHigh) {
      lhPoints.push({ epoch: s.epoch, price: s.price });
    }
    prevHigh = s.price;
  }
  const downtrendPoints = lhPoints.slice(-3);

  return {
    uptrend: uptrendPoints.length >= 2 ? uptrendPoints : null,
    downtrend: downtrendPoints.length >= 2 ? downtrendPoints : null,
  };
}

// ── Layer 2: Sentiment ─────────────────────────────────────────────────────

/**
 * Compute market sentiment from structure, recent candles, and price position.
 * @param {Array<{epoch:number,open:number,high:number,low:number,close:number}>} candles
 * @param {{ bullish: boolean, bearish: boolean }} structure
 * @returns {{ score: number, label: 'BUYERS IN CONTROL'|'SELLERS IN CONTROL'|'NEUTRAL', bullish: boolean, bearish: boolean, candleRatio: number, aboveMidpoint: boolean }}
 */
export function computeSentiment(candles, structure) {
  const bars = normalizeCandles(candles);
  let score = 0;

  // Structure contribution
  if (structure.bullish) score += 2;
  else if (structure.bearish) score -= 2;

  // Last 10 candles bullish ratio
  const last10 = bars.slice(-10);
  const bullishCount = last10.filter((c) => c.close > c.open).length;
  const candleRatio = last10.length > 0 ? bullishCount / last10.length : 0.5;
  if (candleRatio > 0.6) score += 1;
  else if (candleRatio < 0.4) score -= 1;

  // Price vs midpoint of last swing range
  let aboveMidpoint = false;
  if (bars.length >= 2) {
    const recentBars = bars.slice(-20);
    const lastHigh = Math.max(...recentBars.map((c) => c.high));
    const lastLow = Math.min(...recentBars.map((c) => c.low));
    const midpoint = (lastHigh + lastLow) / 2;
    const lastClose = bars[bars.length - 1].close;
    aboveMidpoint = lastClose > midpoint;
    if (aboveMidpoint) score += 1;
    else score -= 1;
  }

  const bullish = score >= 2;
  const bearish = score <= -2;
  const label = bullish ? 'BUYERS IN CONTROL' : bearish ? 'SELLERS IN CONTROL' : 'NEUTRAL';

  return { score, label, bullish, bearish, candleRatio, aboveMidpoint };
}

// ── Layer 3: Volume Profile ────────────────────────────────────────────────

/**
 * Compute an approximated volume profile (time-at-price) from OHLC candles.
 * @param {Array<{epoch:number,open:number,high:number,low:number,close:number}>} candles
 * @param {number} anchorEpoch - only use candles from this epoch onward
 * @param {number} [buckets=40] - number of price buckets
 * @returns {{ buckets: Array<{price:number,weight:number,isVa:boolean,isPoc:boolean}>, poc: number, vah: number, val: number }}
 */
export function computeVolumeProfile(candles, anchorEpoch, buckets = 40) {
  const bars = normalizeCandles(candles).filter((c) => c.epoch >= anchorEpoch);
  const safeBuckets = Number.isInteger(buckets) && buckets > 1 ? buckets : 40;

  if (bars.length === 0) {
    return { buckets: [], poc: 0, vah: 0, val: 0 };
  }

  const priceMin = Math.min(...bars.map((c) => c.low));
  const priceMax = Math.max(...bars.map((c) => c.high));
  const priceRange = priceMax - priceMin;

  if (priceRange <= 0) {
    const midPrice = priceMin;
    const result = Array.from({ length: safeBuckets }, (_, i) => ({
      price: midPrice,
      weight: i === Math.floor(safeBuckets / 2) ? 1 : 0,
      isVa: false,
      isPoc: false,
    }));
    return { buckets: result, poc: midPrice, vah: midPrice, val: midPrice };
  }

  const bucketSize = priceRange / safeBuckets;
  const weights = new Array(safeBuckets).fill(0);

  for (const candle of bars) {
    const candleRange = candle.high - candle.low;
    if (candleRange <= 0) continue;

    const loIdx = Math.max(0, Math.floor((candle.low - priceMin) / bucketSize));
    const hiIdx = Math.min(safeBuckets - 1, Math.floor((candle.high - priceMin) / bucketSize));

    for (let b = loIdx; b <= hiIdx; b++) {
      const bucketLow = priceMin + b * bucketSize;
      const bucketHigh = bucketLow + bucketSize;
      const overlapLow = Math.max(candle.low, bucketLow);
      const overlapHigh = Math.min(candle.high, bucketHigh);
      const overlap = Math.max(0, overlapHigh - overlapLow);
      weights[b] += (overlap / candleRange) * candleRange; // weight = overlap amount
    }
  }

  // Find POC
  let pocIdx = 0;
  let maxWeight = 0;
  for (let i = 0; i < safeBuckets; i++) {
    if (weights[i] > maxWeight) { maxWeight = weights[i]; pocIdx = i; }
  }

  // Value area: find buckets containing 70% of total weight, expanding from POC
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const valueAreaTarget = totalWeight * 0.70;
  let vaWeight = weights[pocIdx];
  let vaLow = pocIdx;
  let vaHigh = pocIdx;

  while (vaWeight < valueAreaTarget && (vaLow > 0 || vaHigh < safeBuckets - 1)) {
    const expandUp = vaHigh < safeBuckets - 1 ? weights[vaHigh + 1] : -1;
    const expandDown = vaLow > 0 ? weights[vaLow - 1] : -1;
    if (expandUp >= expandDown && vaHigh < safeBuckets - 1) {
      vaHigh++;
      vaWeight += weights[vaHigh];
    } else if (vaLow > 0) {
      vaLow--;
      vaWeight += weights[vaLow];
    } else {
      break;
    }
  }

  const poc = priceMin + (pocIdx + 0.5) * bucketSize;
  const vah = priceMin + (vaHigh + 1) * bucketSize;
  const val = priceMin + vaLow * bucketSize;

  const resultBuckets = weights.map((weight, i) => ({
    price: priceMin + (i + 0.5) * bucketSize,
    weight,
    isVa: i >= vaLow && i <= vaHigh,
    isPoc: i === pocIdx,
  }));

  return { buckets: resultBuckets, poc, vah, val };
}

// ── Layer 4: Trade Setup ───────────────────────────────────────────────────

/**
 * Compute a trade setup from all 4 analysis layers.
 * @param {Array<{epoch:number,open:number,high:number,low:number,close:number}>} m1Candles
 * @param {{ bullish: boolean, bearish: boolean, label: string }} structure
 * @param {{ label: string, bullish: boolean, bearish: boolean }} sentiment
 * @param {{ poc: number, vah: number, val: number, buckets: Array<{price:number,weight:number,isVa:boolean,isPoc:boolean}> }} volumeProfile
 * @param {number|null} livePrice
 * @param {number} atr
 * @returns {{ confluence: number, maxConfluence: number, structureAligned: boolean, sentimentAligned: boolean, nearPoc: boolean, direction: 'BUY'|'SELL'|'WAIT', action: 'WATCH FOR BUY'|'WATCH FOR SELL'|'POSSIBLE BUY'|'POSSIBLE SELL'|'WAIT', poc: number, sl: number|null, tp: number|null, rrRatio: number|null, description: string }}
 */
export function computeTradeSetup(m1Candles, structure, sentiment, volumeProfile, livePrice, atr) {
  const bars = normalizeCandles(m1Candles);
  const swings = findSwingPoints(bars, 2);
  const highs = swings.filter((s) => s.kind === 'high');
  const lows = swings.filter((s) => s.kind === 'low');

  const isBullish = structure.bullish;
  const isBearish = structure.bearish;
  const direction = isBullish ? 'BUY' : isBearish ? 'SELL' : 'WAIT';

  // Confluence scoring
  const structureAligned = isBullish || isBearish;
  const sentimentAligned = (isBullish && sentiment.bullish) || (isBearish && sentiment.bearish);
  const price = typeof livePrice === 'number' && Number.isFinite(livePrice) && livePrice > 0
    ? livePrice
    : bars.length ? bars[bars.length - 1].close : 0;
  const poc = volumeProfile.poc ?? 0;
  const nearPoc = poc > 0 && atr > 0 && Math.abs(price - poc) <= atr;

  let confluence = 0;
  if (structureAligned) confluence += 1;
  if (sentimentAligned) confluence += 1;
  if (nearPoc) confluence += 1;
  const maxConfluence = 3;

  // SL and TP
  let sl = null;
  let tp = null;

  if (isBullish) {
    // SL below last confirmed HL
    // Find HL points: lows where price > previous low
    let lastHlPrice = null;
    let prevLowPrice = null;
    for (const s of lows) {
      if (prevLowPrice !== null && s.price > prevLowPrice) lastHlPrice = s.price;
      prevLowPrice = s.price;
    }
    const lastHh = highs.length ? highs[highs.length - 1].price : null;
    sl = lastHlPrice !== null ? lastHlPrice - atr * 0.3 : price - atr * 1.5;
    tp = lastHh !== null ? lastHh : price + atr * 2;
  } else if (isBearish) {
    // SL above last confirmed LH
    let lastLhPrice = null;
    let prevHighPrice = null;
    for (const s of highs) {
      if (prevHighPrice !== null && s.price < prevHighPrice) lastLhPrice = s.price;
      prevHighPrice = s.price;
    }
    const lastLl = lows.length ? lows[lows.length - 1].price : null;
    sl = lastLhPrice !== null ? lastLhPrice + atr * 0.3 : price + atr * 1.5;
    tp = lastLl !== null ? lastLl : price - atr * 2;
  }

  const slDist = sl !== null ? Math.abs(price - sl) : null;
  const tpDist = tp !== null ? Math.abs(tp - price) : null;
  const rrRatio = slDist !== null && slDist > 0 && tpDist !== null
    ? Math.round((tpDist / slDist) * 100) / 100
    : null;

  // Action label
  let action;
  if (direction === 'WAIT' || confluence < 1) {
    action = 'WAIT';
  } else if (confluence >= 3) {
    action = direction === 'BUY' ? 'WATCH FOR BUY' : 'WATCH FOR SELL';
  } else {
    action = direction === 'BUY' ? 'POSSIBLE BUY' : 'POSSIBLE SELL';
  }

  // Description
  let description = '';
  if (action === 'WAIT') {
    description = 'No clear directional confluence. Wait for structure to develop.';
  } else if (action === 'WATCH FOR BUY') {
    description = poc > 0
      ? `Price is retracing to POC ${poc.toFixed(5)} in a bullish structure. Wait for bullish candle confirmation at POC before entry.`
      : 'Bullish structure with sentiment aligned. Wait for bullish candle confirmation before entry.';
  } else if (action === 'WATCH FOR SELL') {
    description = poc > 0
      ? `Price is rallying to POC ${poc.toFixed(5)} in a bearish structure. Wait for bearish candle confirmation at POC before entry.`
      : 'Bearish structure with sentiment aligned. Wait for bearish candle confirmation before entry.';
  } else if (action === 'POSSIBLE BUY') {
    description = 'Partial bullish confluence. Setup not fully confirmed — proceed with caution.';
  } else {
    description = 'Partial bearish confluence. Setup not fully confirmed — proceed with caution.';
  }

  return {
    confluence,
    maxConfluence,
    structureAligned,
    sentimentAligned,
    nearPoc,
    direction,
    action,
    poc,
    sl,
    tp,
    rrRatio,
    description,
  };
}

// ── End 4-layer analysis ───────────────────────────────────────────────────

export function analyzeForexCandles(candles, options = {}) {
  const bars = normalizeCandles(candles);
  if (!bars.length) {
    return {
      candles: [],
      lastPrice: null,
      atr: 0,
      patterns: [],
      latestPattern: null,
      swings: [],
      structure: { label: "Waiting for candles", detail: "Waiting for real OHLC data.", bullish: false, bearish: false },
      support: [],
      resistance: [],
    };
  }

  const atr = calculateAtr(bars, options.atrPeriod ?? 14);
  const swings = findSwingPoints(bars, options.swingStrength ?? 2);
  const patterns = detectCandlePatterns(bars, options.patternLimit ?? 160);
  const lastPrice = bars[bars.length - 1].close;
  const zones = clusterZones(swings, lastPrice, atr);

  return {
    candles: bars,
    lastPrice,
    atr,
    patterns,
    latestPattern: patterns.length ? patterns[patterns.length - 1] : null,
    swings,
    structure: classifyStructure(swings, atr),
    support: zones.support,
    resistance: zones.resistance,
  };
}
