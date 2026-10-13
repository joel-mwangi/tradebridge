'use client';

import type { BotConfig, BotRun } from './bot-types';

const CONFIGS_KEY = 'tradebridge:bots:configs';
const RUNS_KEY = 'tradebridge:bots:runs';

export function loadBotConfigs(): BotConfig[] {
  try {
    const raw = localStorage.getItem(CONFIGS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as BotConfig[];
  } catch {
    return [];
  }
}

export function saveBotConfigs(configs: BotConfig[]): void {
  try {
    localStorage.setItem(CONFIGS_KEY, JSON.stringify(configs));
  } catch {
    // Silently ignore storage errors (quota exceeded, private browsing, etc.)
  }
}

export function upsertBotConfig(config: BotConfig): void {
  const configs = loadBotConfigs();
  const idx = configs.findIndex((c) => c.id === config.id);
  if (idx >= 0) {
    configs[idx] = config;
  } else {
    configs.push(config);
  }
  saveBotConfigs(configs);
}

export function deleteBotConfig(id: string): void {
  const configs = loadBotConfigs();
  saveBotConfigs(configs.filter((c) => c.id !== id));
}

export function loadBotRuns(): BotRun[] {
  try {
    const raw = localStorage.getItem(RUNS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as BotRun[];
  } catch {
    return [];
  }
}

export function saveNewRun(run: BotRun): void {
  try {
    const runs = loadBotRuns();
    const trimmed = [run, ...runs].slice(0, 50);
    localStorage.setItem(RUNS_KEY, JSON.stringify(trimmed));
  } catch {
    // Silently ignore storage errors
  }
}
