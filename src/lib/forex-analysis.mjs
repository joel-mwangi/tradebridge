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
