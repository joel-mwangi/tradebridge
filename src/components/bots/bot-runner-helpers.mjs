export function makeInitialState(currency) {
  return {
    status: "idle",
    currentStake: 0,
    tradeCount: 0,
    wins: 0,
    losses: 0,
    netPnl: 0,
    currency,
    transactions: [],
    journal: [],
    startedAt: null,
    lastError: null,
  };
}

export function nextStakeAmount(strategy, lastProfit, previousStake) {
  switch (strategy.type) {
    case "fixed":
      return strategy.amount;
    case "martingale":
      if (lastProfit === null) return strategy.base;
      return lastProfit < 0
        ? Math.min(previousStake * strategy.multiplier, strategy.maxStake)
        : strategy.base;
    case "dalembert":
      if (lastProfit === null) return strategy.unit;
      return lastProfit < 0
        ? Math.min(previousStake + strategy.unit, strategy.maxStake)
        : Math.max(previousStake - strategy.unit, strategy.unit);
  }
}

export function classifySettlement(status, profit) {
  const normalizedStatus = String(status ?? "").toLowerCase();
  const isCancelled = normalizedStatus === "cancelled";
  const isWin = normalizedStatus === "won"
    || (normalizedStatus !== "lost" && !isCancelled && (profit ?? 0) > 0);
  return { isCancelled, isWin, isLoss: !isWin && !isCancelled };
}

export function findBotStopReason(config, state, elapsedSeconds, isLoss) {
  for (const condition of config.stopConditions) {
    if (condition.type === "profit" && state.netPnl >= condition.target) {
      return `Profit target reached (+${state.netPnl.toFixed(2)})`;
    }
    if (condition.type === "loss" && state.netPnl <= -Math.abs(condition.limit)) {
      return `Loss limit reached (${state.netPnl.toFixed(2)})`;
    }
    if (condition.type === "tradeCount" && state.tradeCount >= condition.max) {
      return `Max trades reached (${state.tradeCount})`;
    }
    if (condition.type === "time" && elapsedSeconds >= condition.seconds) {
      return `Time limit reached (${Math.round(elapsedSeconds)}s)`;
    }
  }

  if (config.maxTradesPerDay > 0 && state.tradeCount >= config.maxTradesPerDay) {
    return `Daily trade cap reached (${state.tradeCount})`;
  }
  if (isLoss) {
    let consecutiveLosses = 0;
    for (const transaction of state.transactions) {
      if (transaction.status.toLowerCase() === "cancelled") break;
      if ((transaction.profit ?? 0) < 0) consecutiveLosses += 1;
      else break;
    }
    if (consecutiveLosses >= config.maxConsecutiveLosses) {
      return `Max consecutive losses (${consecutiveLosses})`;
    }
  }
  return null;
}