/**
 * Deterministic, testable signal and backtest core for TradeBridge's Demo bot runner.
 *
 * This module deliberately does not turn a signal score into a probability.
 * Entry is permitted only when historical out-of-sample results clear a
 * conservative Wilson lower-confidence-bound gate using the current quote.
 */

/** @typedef {"trend_following"|"mean_reversion"|"breakout"|"momentum"} StrategyType */
/** @typedef {"CALL"|"PUT"} Direction */
/** @typedef {{direction: Direction, score: number, reason: string, price: number}} Signal */
/** @typedef {{prices: number[], times: number[]}} PriceHistory */

export const STRATEGY_ENGINE_VERSION = "tb-signal-v1";
export const MIN_BACKTEST_TRADES = 40;

const MIN_HISTORY = 30;
const EPSILON = 1e-12;

/** Convert only completed OHLC candles into a time-aligned close-price series. */
export function completedCandleSeries(candles, granularity, nowEpoch) {
  if (!Array.isArray(candles) || !Number.isInteger(granularity) || granularity < 1
    || !Number.isFinite(nowEpoch)) return { prices: [], times: [] };
  const byEpoch = new Map();
  for (const candle of candles) {
    const epoch = Number(candle?.epoch);
    const close = Number(candle?.close);
    if (!Number.isFinite(epoch) || !Number.isFinite(close) || close <= 0
      || epoch < 0 || epoch + granularity > nowEpoch) continue;
    byEpoch.set(epoch, close);
  }
  const ordered = [...byEpoch.entries()].sort((left, right) => left[0] - right[0]);
  return {
    prices: ordered.map(([, close]) => close),
    // A close becomes available at the end of its candle, not at the open epoch.
    times: ordered.map(([epoch]) => epoch + granularity),
  };
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function safeReturns(prices) {
  const returns = [];
  for (let index = 1; index < prices.length; index += 1) {
    const previous = prices[index - 1];
    const current = prices[index];
    if (previous <= 0 || current <= 0) continue;
    returns.push(current / previous - 1);
  }
  return returns;
}

function validatePrices(prices) {
  return Array.isArray(prices)
    && prices.length >= MIN_HISTORY
    && prices.every((price) => Number.isFinite(price) && price > 0);
}

/**
 * Analyze only the supplied price history. The caller must include no future data.
 * A null signal is the expected result when conditions are not clear.
 *
 * @param {number[]} prices
 * @param {StrategyType|string} strategy
 * @returns {Signal|null}
 */
export function analyzeSignal(prices, strategy) {
  if (!validatePrices(prices)) return null;

  const recent = prices.slice(-64);
  const current = recent[recent.length - 1];
  const previous = recent.slice(0, -1);
  const returns = safeReturns(recent);
  const recentReturns = returns.slice(-20);
  const volatility = standardDeviation(recentReturns);
  if (!Number.isFinite(volatility) || volatility < EPSILON) return null;

  const fastMean = mean(recent.slice(-8));
  const slowMean = mean(recent.slice(-24));
  const normalizedTrend = ((fastMean - slowMean) / Math.abs(slowMean))
    / (volatility * Math.sqrt(8) + EPSILON);

  if (strategy === "trend_following") {
    if (Math.abs(normalizedTrend) < 0.45) return null;
    return {
      direction: normalizedTrend > 0 ? "CALL" : "PUT",
      score: Math.min(1, Math.abs(normalizedTrend) / 2),
      reason: normalizedTrend > 0 ? "fast_mean_above_slow_mean" : "fast_mean_below_slow_mean",
      price: current,
    };
  }

  if (strategy === "momentum") {
    const lookback = recent.length - 6;
    if (lookback < 0) return null;
    const momentum = current / recent[lookback] - 1;
    const normalizedMomentum = momentum / (volatility * Math.sqrt(5) + EPSILON);
    if (Math.abs(normalizedMomentum) < 1.1) return null;
    return {
      direction: normalizedMomentum > 0 ? "CALL" : "PUT",
      score: Math.min(1, Math.abs(normalizedMomentum) / 2.5),
      reason: normalizedMomentum > 0 ? "positive_short_horizon_momentum" : "negative_short_horizon_momentum",
      price: current,
    };
  }

  if (strategy === "mean_reversion") {
    const window = recent.slice(-20);
    const average = mean(window);
    const priceDeviation = standardDeviation(window);
    if (priceDeviation < EPSILON) return null;
    const zScore = (current - average) / priceDeviation;
    // Avoid trying to fade an extreme that is still moving sharply in the same direction.
    const shortMomentum = current / recent[recent.length - 6] - 1;
    const normalizedShortMomentum = shortMomentum / (volatility * Math.sqrt(5) + EPSILON);
    if (zScore <= -1.8 && normalizedShortMomentum > -1.4) {
      return {
        direction: "CALL",
        score: Math.min(1, Math.abs(zScore) / 3),
        reason: "price_below_recent_mean",
        price: current,
      };
    }
    if (zScore >= 1.8 && normalizedShortMomentum < 1.4) {
      return {
        direction: "PUT",
        score: Math.min(1, Math.abs(zScore) / 3),
        reason: "price_above_recent_mean",
        price: current,
      };
    }
    return null;
  }

  if (strategy === "breakout") {
    const priorWindow = previous.slice(-20);
    if (priorWindow.length < 20) return null;
    const priorHigh = Math.max(...priorWindow);
    const priorLow = Math.min(...priorWindow);
    const breakoutBuffer = current * volatility * 0.15;
    if (current > priorHigh + breakoutBuffer) {
      return { direction: "CALL", score: 0.6, reason: "recent_high_breakout", price: current };
    }
    if (current < priorLow - breakoutBuffer) {
      return { direction: "PUT", score: 0.6, reason: "recent_low_breakout", price: current };
    }
    return null;
  }

  return null;
}

/**
 * Wilson lower bound for a binomial win rate. The default uses a 95% confidence
 * interval. It is a conservative historical estimate, not a guarantee of future success.
 * @param {number} wins
 * @param {number} trades
 * @param {number} [z]
 */
export function wilsonLowerBound(wins, trades, z = 1.96) {
  if (!Number.isInteger(wins) || !Number.isInteger(trades) || trades <= 0 || wins < 0 || wins > trades) return 0;
  const p = wins / trades;
  const z2 = z * z;
  const denominator = 1 + z2 / trades;
  const center = p + z2 / (2 * trades);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * trades)) / trades);
  return Math.max(0, (center - margin) / denominator);
}

/**
 * Run a chronological holdout backtest. Features use only prices available at
 * the entry time; outcomes use the first observation at/after expiry.
 * Non-overlapping trade windows reduce (but do not eliminate) dependence.
 *
 * payoutPerStake is the gross payout divided by actual purchase price from
 * the current proposal. It is an assumption for historical trades, not historical
 * payout data, so callers must label/report that limitation.
 *
 * @param {{prices:number[], times:number[], strategy:StrategyType|string, durationSeconds:number, payoutPerStake:number, holdoutFraction?:number}} input
 */
export function backtestStrategy({
  prices,
  times,
  strategy,
  durationSeconds,
  payoutPerStake,
  holdoutFraction = 0.3,
}) {
  if (!validatePrices(prices)
    || !Array.isArray(times)
    || times.length !== prices.length
    || !times.every((time) => Number.isFinite(time))
    || !Number.isInteger(durationSeconds)
    || durationSeconds < 1
    || !Number.isFinite(payoutPerStake)
    || payoutPerStake <= 1
    || holdoutFraction < 0.2
    || holdoutFraction > 0.5) {
    return {
      valid: false, trades: 0, wins: 0, losses: 0, winRate: 0,
      wilsonLower95: 0, expectedReturnPerStake: -1, netReturnPerStake: 0,
      profitFactor: 0, maxDrawdown: 0, reason: "invalid_backtest_inputs",
      payoutAssumption: payoutPerStake,
    };
  }

  const points = prices.map((price, index) => ({ price, time: times[index], index }))
    .filter((point) => point.time >= 0 && point.price > 0)
    .sort((left, right) => left.time - right.time || left.index - right.index);
  const cleanPrices = points.map((point) => point.price);
  const cleanTimes = points.map((point) => point.time);
  const holdoutStart = Math.floor(cleanPrices.length * (1 - holdoutFraction));
  if (holdoutStart < MIN_HISTORY) {
    return {
      valid: true, trades: 0, wins: 0, losses: 0, winRate: 0,
      wilsonLower95: 0, expectedReturnPerStake: -1, netReturnPerStake: 0,
      profitFactor: 0, maxDrawdown: 0, reason: "insufficient_history",
      payoutAssumption: payoutPerStake,
    };
  }

  let nextEligibleTime = -Infinity;
  let wins = 0;
  let losses = 0;
  let netReturnPerStake = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let equity = 0;
  let peakEquity = 0;
  let maxDrawdown = 0;
  let firstEntryTime = null;
  let lastEntryTime = null;

  for (let index = Math.max(MIN_HISTORY - 1, holdoutStart); index < cleanPrices.length - 1; index += 1) {
    const entryTime = cleanTimes[index];
    if (entryTime < nextEligibleTime) continue;

    const targetTime = entryTime + durationSeconds;
    let targetIndex = index + 1;
    while (targetIndex < cleanTimes.length && cleanTimes[targetIndex] < targetTime) targetIndex += 1;
    if (targetIndex >= cleanTimes.length) break;

    const signal = analyzeSignal(cleanPrices.slice(0, index + 1), strategy);
    nextEligibleTime = targetTime;
    if (!signal) continue;

    const entryPrice = cleanPrices[index];
    const exitPrice = cleanPrices[targetIndex];
    const won = signal.direction === "CALL" ? exitPrice > entryPrice : exitPrice < entryPrice;
    const tradeReturn = won ? payoutPerStake - 1 : -1;
    if (won) {
      wins += 1;
      grossProfit += tradeReturn;
    } else {
      losses += 1;
      grossLoss += 1;
    }
    netReturnPerStake += tradeReturn;
    equity += tradeReturn;
    peakEquity = Math.max(peakEquity, equity);
    maxDrawdown = Math.max(maxDrawdown, peakEquity - equity);
    if (firstEntryTime === null) firstEntryTime = entryTime;
    lastEntryTime = entryTime;
  }

  const trades = wins + losses;
  const winRate = trades > 0 ? wins / trades : 0;
  const expectedReturnPerStake = winRate * payoutPerStake - 1;
  return {
    valid: true,
    trades,
    wins,
    losses,
    winRate,
    wilsonLower95: wilsonLowerBound(wins, trades),
    expectedReturnPerStake,
    netReturnPerStake,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    maxDrawdown,
    firstEntryTime,
    lastEntryTime,
    reason: trades >= MIN_BACKTEST_TRADES ? "evaluated" : "insufficient_independent_trades",
    payoutAssumption: payoutPerStake,
  };
}

/**
 * Pure entry gate shared by the worker and tests.
 * @param {{
 *  signal:Signal|null, backtest:ReturnType<typeof backtestStrategy>,
 *  askPrice:number, payout:number, configuredStake:number, balance:number,
 *  dailyPnl:number, dailyLossLimit:number, tradesToday:number, maxTradesPerDay:number,
 *  consecutiveLosses:number, maxConsecutiveLosses:number, openPositionCount:number,
 *  lastTradeAt:number|null, now:number, cooldownSeconds:number,
 *  maxStakeFraction?:number, minExpectedReturn?:number
 * }} input
 */
export function evaluateEntry(input) {
  const {
    signal, backtest, askPrice, payout, configuredStake, balance, dailyPnl,
    dailyLossLimit, tradesToday, maxTradesPerDay, consecutiveLosses,
    maxConsecutiveLosses, openPositionCount, lastTradeAt, now, cooldownSeconds,
    maxStakeFraction = 0.01, minExpectedReturn = 0.02,
  } = input;

  const reject = (reason) => ({ allowed: false, reason, expectedReturnAtLowerBound: null });
  if (!signal) return reject("no_signal");
  if (!backtest?.valid || backtest.trades < MIN_BACKTEST_TRADES) return reject("insufficient_backtest");
  if (!Number.isFinite(askPrice) || askPrice <= 0 || !Number.isFinite(payout) || payout <= askPrice) {
    return reject("invalid_proposal");
  }
  if (!Number.isFinite(configuredStake) || configuredStake <= 0 || askPrice > configuredStake * 1.05) return reject("stake_or_price_out_of_bounds");
  if (!Number.isFinite(balance) || balance <= 0 || askPrice > balance * maxStakeFraction) return reject("stake_exceeds_balance_fraction");
  if (!Number.isFinite(dailyLossLimit) || dailyLossLimit <= 0 || dailyPnl <= -dailyLossLimit) return reject("daily_loss_limit");
  if (!Number.isInteger(tradesToday) || tradesToday >= maxTradesPerDay) return reject("daily_trade_limit");
  if (!Number.isInteger(consecutiveLosses) || consecutiveLosses >= maxConsecutiveLosses) return reject("consecutive_loss_limit");
  if (!Number.isInteger(openPositionCount) || openPositionCount > 0) return reject("open_position_exists");
  if (lastTradeAt !== null && now - lastTradeAt < cooldownSeconds * 1000) return reject("cooldown_active");

  const payoutPerStake = payout / askPrice;
  const expectedReturnAtLowerBound = backtest.wilsonLower95 * payoutPerStake - 1;
  if (expectedReturnAtLowerBound <= minExpectedReturn) return { allowed: false, reason: "edge_not_proven", expectedReturnAtLowerBound };
  return { allowed: true, reason: "edge_and_risk_gates_passed", expectedReturnAtLowerBound };
}
