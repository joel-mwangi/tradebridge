export type RunnableStrategyStatus = {
  signal_generated?: boolean;
  symbol?: string | null;
  requested_direction?: string | null;
  selected_group?: string | null;
  barrier?: number;
  digit_window_size?: number;
};
export type RunnableStrategyConfig = {
  symbol: string;
  direction: "OVER" | "UNDER";
  barrier: number;
  windowSize: number;
};
export function validateRunnableStrategySignal(
  status: RunnableStrategyStatus | null | undefined,
  config: RunnableStrategyConfig | null | undefined
): { ok: boolean; reason: string | null };
