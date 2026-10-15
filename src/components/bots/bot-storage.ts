'use client';

import type { BotConfig, BotRun } from './bot-types';

const CONFIGS_KEY = 'tradebridge:bots:configs';
export const BOT_RUNS_STORAGE_KEY = 'tradebridge:bots:runs';
export const BOT_RUNS_UPDATED_EVENT = 'tradebridge:bots:runs-updated';

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
    const raw = localStorage.getItem(BOT_RUNS_STORAGE_KEY);
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
    localStorage.setItem(BOT_RUNS_STORAGE_KEY, JSON.stringify(trimmed));
    window.dispatchEvent(new Event(BOT_RUNS_UPDATED_EVENT));
  } catch {
    // Silently ignore storage errors
  }
}

export function clearBotRuns(): boolean {
  try {
    localStorage.removeItem(BOT_RUNS_STORAGE_KEY);
    window.dispatchEvent(new Event(BOT_RUNS_UPDATED_EVENT));
    return true;
  } catch {
    return false;
  }
}
