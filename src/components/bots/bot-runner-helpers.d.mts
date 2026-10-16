import type { BotConfig, BotRunState, StakeStrategy } from "./bot-types";

export function makeInitialState(currency: string): BotRunState;
export function nextStakeAmount(strategy: StakeStrategy, lastProfit: number | null, previousStake: number): number;
export function classifySettlement(status: unknown, profit: number | null): {
  isCancelled: boolean;
  isWin: boolean;
  isLoss: boolean;
};
export function findBotStopReason(config: BotConfig, state: BotRunState, elapsedSeconds: number, isLoss: boolean): string | null;