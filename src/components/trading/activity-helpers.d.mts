import type { AccountActivity, OpenPosition } from "./types";

export const STATEMENT_PAGE_SIZE: number;
export function toPosition(raw: Record<string, unknown>): OpenPosition | null;
export function toActivity(raw: Record<string, unknown>): AccountActivity | null;
export function numeric(value: unknown): number | null;
export function statementPageLimit(loadedCount: number): number;
export function statementHasMore(count: number | undefined, offset: number, receivedCount: number, limit: number): boolean;
export function mergeActivityRows(current: AccountActivity[], incoming: AccountActivity[], maxRows?: number): AccountActivity[];