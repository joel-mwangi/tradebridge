// Pure types file — no 'use client' needed

export type BotStatus =
  | 'idle'
  | 'connecting'
  | 'running'
  | 'cooldown'
  | 'stopping'
  | 'stopped'
  | 'error';

export type StakeStrategy =
  | { type: 'fixed'; amount: number }
  | { type: 'martingale'; base: number; multiplier: number; maxStake: number }
  | { type: 'dalembert'; unit: number; maxStake: number };

export type StopCondition =
  | { type: 'profit'; target: number }
  | { type: 'loss'; limit: number }
  | { type: 'tradeCount'; max: number }
  | { type: 'time'; seconds: number };

export interface BotConfig {
  id: string;
  name: string;
  symbol: string;
  contractType: string;
  barrier?: string;
  duration: number;
  durationUnit: 't' | 's';
  stakeStrategy: StakeStrategy;
  stopConditions: StopCondition[];
  cooldownSeconds: number;
  maxTradesPerDay: number;
  maxConsecutiveLosses: number;
  createdAt: number;
  updatedAt: number;
}

export interface BotRun {
  botId: string;
  botName: string;
  startedAt: number;
  endedAt: number | null;
  status: BotStatus;
  tradeCount: number;
  wins: number;
  losses: number;
  netPnl: number;
  currency: string;
  error?: string | null;
}

export interface BotTransaction {
  id: string;
  contractId: string;
  contractType: string;
  symbol: string;
  stake: number;
  payout: number | null;
  profit: number | null;
  currency: string;
  startedAt: number;
  settledAt: number | null;
  status: string;
}

export interface JournalEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface BotRunState {
  status: BotStatus;
  currentStake: number;
  tradeCount: number;
  wins: number;
  losses: number;
  netPnl: number;
  currency: string;
  transactions: BotTransaction[];
  journal: JournalEntry[];
  startedAt: number | null;
  lastError: string | null;
}


const BOT_CONTRACT_TYPES = new Set([
  'DIGITOVER',
  'DIGITUNDER',
  'DIGITEVEN',
  'DIGITODD',
  'DIGITMATCH',
  'DIGITDIFF',
]);

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Imported/localStorage bot configurations are untrusted input. Validate the
 * complete execution shape before a config can be loaded or sent to Deriv.
 */
export function isBotConfig(value: unknown): value is BotConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const config = value as Record<string, unknown>;

  if (
    typeof config.id !== 'string' || !config.id.trim() || config.id.length > 128 ||
    typeof config.name !== 'string' || !config.name.trim() || config.name.length > 80 ||
    typeof config.symbol !== 'string' || !/^[A-Za-z0-9_]{1,32}$/.test(config.symbol) ||
    typeof config.contractType !== 'string' || !BOT_CONTRACT_TYPES.has(config.contractType) ||
    (config.durationUnit !== 't' && config.durationUnit !== 's') ||
    typeof config.duration !== 'number' || !Number.isInteger(config.duration) ||
    config.duration < 1 || config.duration > (config.durationUnit === 't' ? 10 : 3600) ||
    !Array.isArray(config.stopConditions) ||
    typeof config.cooldownSeconds !== 'number' || !Number.isFinite(config.cooldownSeconds) ||
    config.cooldownSeconds < 0 || config.cooldownSeconds > 3600 ||
    typeof config.maxTradesPerDay !== 'number' || !Number.isInteger(config.maxTradesPerDay) ||
    config.maxTradesPerDay < 1 || config.maxTradesPerDay > 10000 ||
    typeof config.maxConsecutiveLosses !== 'number' || !Number.isInteger(config.maxConsecutiveLosses) ||
    config.maxConsecutiveLosses < 1 || config.maxConsecutiveLosses > 1000 ||
    typeof config.createdAt !== 'number' || !Number.isFinite(config.createdAt) ||
    typeof config.updatedAt !== 'number' || !Number.isFinite(config.updatedAt)
  ) return false;

  const needsBarrier = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(config.contractType);
  if (needsBarrier) {
    if (typeof config.barrier !== 'string' || !/^\d$/.test(config.barrier)) return false;
    const barrier = Number(config.barrier);
    if (config.contractType === 'DIGITOVER' && barrier > 8) return false;
    if (config.contractType === 'DIGITUNDER' && barrier < 1) return false;
  } else if (config.barrier !== undefined) {
    return false;
  }

  const strategy = config.stakeStrategy;
  if (typeof strategy !== 'object' || strategy === null || Array.isArray(strategy)) return false;
  const stake = strategy as Record<string, unknown>;
  if (stake.type === 'fixed') {
    if (!isPositiveFinite(stake.amount)) return false;
  } else if (stake.type === 'martingale') {
    if (
      !isPositiveFinite(stake.base) ||
      typeof stake.multiplier !== 'number' || !Number.isFinite(stake.multiplier) || stake.multiplier < 1 ||
      !isPositiveFinite(stake.maxStake) || stake.maxStake < stake.base
    ) return false;
  } else if (stake.type === 'dalembert') {
    if (!isPositiveFinite(stake.unit) || !isPositiveFinite(stake.maxStake) || stake.maxStake < stake.unit) return false;
  } else {
    return false;
  }

  return config.stopConditions.every((condition) => {
    if (typeof condition !== 'object' || condition === null || Array.isArray(condition)) return false;
    const stop = condition as Record<string, unknown>;
    if (stop.type === 'profit') return isPositiveFinite(stop.target);
    if (stop.type === 'loss') return isPositiveFinite(stop.limit);
    if (stop.type === 'tradeCount') return typeof stop.max === 'number' && Number.isInteger(stop.max) && stop.max >= 1 && stop.max <= 10000;
    if (stop.type === 'time') return typeof stop.seconds === 'number' && Number.isFinite(stop.seconds) && stop.seconds >= 1 && stop.seconds <= 86400;
    return false;
  });
}
