/** Deterministic engine for Deriv digit contracts. No promise of profitability. */
export const DIGIT_CONTRACTS = Object.freeze({
  DIGITOVER: { barrier: true, wins: (digit, barrier) => digit > barrier },
  DIGITUNDER: { barrier: true, wins: (digit, barrier) => digit < barrier },
  DIGITEVEN: { barrier: false, wins: (digit) => digit % 2 === 0 },
  DIGITODD: { barrier: false, wins: (digit) => digit % 2 === 1 },
  DIGITMATCH: { barrier: true, wins: (digit, barrier) => digit === barrier },
  DIGITDIFF: { barrier: true, wins: (digit, barrier) => digit !== barrier },
});

export function validateDigitStrategy(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, errors: ["strategy_must_be_object"] };
  if (value.version !== 1) errors.push("unsupported_schema_version");
  if (typeof value.market !== "string" || !/^[A-Za-z0-9_]{2,32}$/.test(value.market)) errors.push("invalid_market_symbol");
  const contract = DIGIT_CONTRACTS[value.contract_type];
  if (!contract) errors.push("unsupported_contract_type");
  const barrier = value.barrier === null ? null : Number(value.barrier);
  if (contract?.barrier && (!Number.isInteger(barrier) || barrier < 0 || barrier > 9)) errors.push("barrier_must_be_digit_0_to_9");
  if (contract && !contract.barrier && value.barrier !== null) errors.push("barrier_must_be_null_for_even_odd");
  if (!Number.isInteger(value.duration_ticks) || value.duration_ticks < 1 || value.duration_ticks > 10_000) errors.push("invalid_duration_ticks");
  if (typeof value.stake !== "number" || !Number.isFinite(value.stake) || value.stake <= 0 || value.stake > 100) errors.push("stake_out_of_bounds");
  if (!["manual_review", "last_digit_frequency"].includes(value.entry_rule)) errors.push("unsupported_entry_rule");
  if (!Number.isInteger(value.frequency_window) || value.frequency_window < 10 || value.frequency_window > 5000) errors.push("invalid_frequency_window");
  for (const key of ["max_session_loss", "session_profit_target"]) {
    if (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] < 0 || value[key] > 100000) errors.push("invalid_" + key);
  }
  if (errors.length) return { valid: false, errors };
  return { valid: true, errors: [], strategy: {
    version: 1, market: value.market, contract_type: value.contract_type, barrier,
    duration_ticks: value.duration_ticks, stake: value.stake, entry_rule: value.entry_rule,
    frequency_window: value.frequency_window, max_session_loss: value.max_session_loss,
    session_profit_target: value.session_profit_target,
  } };
}

export function extractLastDigit(quote, pipSize) {
  const value = Number(quote);
  if (!Number.isFinite(value)) return null;

  const raw = String(quote ?? "").trim();
  const hasPrecision = Number.isInteger(pipSize) && pipSize >= 0 && pipSize <= 12;
  const inferredPrecision = typeof quote === "string" && raw.includes(".")
    ? raw.split(".")[1]?.length
    : undefined;
  const precision = hasPrecision ? pipSize : inferredPrecision;
  if (precision === undefined || precision < 0 || precision > 12) {
    if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
    const decimals = raw.includes(".") ? raw.split(".")[1] : "";
    const digit = decimals.length ? decimals[decimals.length - 1] : raw[raw.length - 1];
    return Number(digit);
  }

  const formatted = value.toFixed(precision);
  const fraction = formatted.split(".")[1] ?? "";
  const character = precision > 0 ? fraction.charAt(precision - 1) : formatted.slice(-1);
  const digit = Number(character);
  return Number.isInteger(digit) && digit >= 0 && digit <= 9 ? digit : null;
}

export function wilsonLowerBound(wins, total, z = 1.96) {
  if (!Number.isInteger(wins) || !Number.isInteger(total) || total <= 0 || wins < 0 || wins > total) return 0;
  const p = wins / total, z2 = z * z, denominator = 1 + z2 / total;
  return Math.max(0, (p + z2 / (2 * total) - z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / denominator);
}

/** Evaluate a chronological holdout, with each signal using only preceding ticks. */
export function backtestDigitContract(digits, strategy, payoutPerStake, minTrades = 100) {
  if (!Array.isArray(digits) || digits.length < minTrades + 20 ||
      !digits.every((d) => Number.isInteger(d) && d >= 0 && d <= 9) ||
      !Number.isFinite(payoutPerStake) || payoutPerStake <= 1) {
    return { valid: false, trades: 0, wins: 0, wilsonLower95: 0, expectedReturnLowerBound: -Infinity, reason: "insufficient_or_invalid_history" };
  }
  const contract = DIGIT_CONTRACTS[strategy.contract_type];
  if (!contract) return { valid: false, trades: 0, wins: 0, wilsonLower95: 0, expectedReturnLowerBound: -Infinity, reason: "unsupported_contract" };
  const window = strategy.frequency_window;
  let wins = 0, trades = 0;
  // Reserve the final 30% as a chronological holdout; don't use future ticks to select signals.
  const holdoutStart = Math.max(window, Math.floor(digits.length * 0.7));
  for (let i = holdoutStart; i < digits.length; i++) {
    const prior = digits.slice(i - window, i);
    if (strategy.entry_rule === "last_digit_frequency") {
      const counts = Array(10).fill(0);
      for (const digit of prior) counts[digit] += 1;
      const maxCount = Math.max(...counts);
      // No entry when the window has no clear mode; ties are not a signal.
      if (counts.filter((count) => count === maxCount).length !== 1) continue;
      const modalDigit = counts.indexOf(maxCount);
      // Require a modest deviation from uniform frequency to avoid firing on noise.
      if (maxCount / window < 0.15) continue;
      // This is a filter, not a claim that the modal digit predicts the next digit.
      if (strategy.contract_type === "DIGITMATCH" && strategy.barrier !== modalDigit) continue;
    } else {
      continue;
    }
    trades += 1;
    if (contract.wins(digits[i], strategy.barrier)) wins += 1;
  }
  const lower = wilsonLowerBound(wins, trades);
  return {
    valid: trades >= minTrades,
    trades,
    wins,
    losses: trades - wins,
    winRate: trades ? wins / trades : 0,
    wilsonLower95: lower,
    expectedReturnLowerBound: lower * payoutPerStake - 1,
    reason: trades < minTrades ? "insufficient_holdout_trades" : lower * payoutPerStake - 1 > 0 ? "edge_gate_passed" : "edge_not_proven",
  };
}

export function sessionRiskDecision({ sessionPnl, maxSessionLoss, sessionProfitTarget, openContractCount }) {
  if (!Number.isFinite(sessionPnl) || !Number.isFinite(maxSessionLoss) || !Number.isFinite(sessionProfitTarget)) return { allowed: false, reason: "risk_state_unavailable" };
  if (openContractCount !== 0) return { allowed: false, reason: "open_contract_must_reconcile" };
  if (maxSessionLoss > 0 && sessionPnl <= -maxSessionLoss) return { allowed: false, reason: "session_loss_limit" };
  if (sessionProfitTarget > 0 && sessionPnl >= sessionProfitTarget) return { allowed: false, reason: "session_profit_target" };
  return { allowed: true, reason: "risk_gates_passed" };
}
