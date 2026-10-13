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
