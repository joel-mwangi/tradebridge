type LogValue = string | number | boolean | null | undefined;

export const logger: {
  error(event: string, fields?: Record<string, LogValue>, error?: unknown): void;
  warn(event: string, fields?: Record<string, LogValue>, error?: unknown): void;
};