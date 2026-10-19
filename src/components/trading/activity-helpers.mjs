import { normalizeDerivContract, parseDerivNumber } from "./contract-normalization.mjs";

export const STATEMENT_PAGE_SIZE = 30;

export function numeric(value) {
  return parseDerivNumber(value);
}

export function toPosition(raw) {
  const normalized = normalizeDerivContract(raw);
  if (!normalized.contractId) return null;
  return {
    contractId: normalized.contractId,
    symbol: normalized.symbol,
    contractType: normalized.contractType,
    buyPrice: normalized.stake,
    currentSpot: numeric(raw.current_spot ?? raw.current_spot_display_value),
    payout: normalized.payout,
    profit: normalized.profit,
    outcome: normalized.outcome,
    currency: normalized.currency,
    startedAt: normalized.startedAt,
    expiresAt: normalized.expiresAt,
    status: normalized.status,
    providerStatus: normalized.providerStatus,
    longcode: String(raw.longcode ?? raw.display_name ?? ""),
  };
}

export function toActivity(raw) {
  const id = String(raw.transaction_id ?? raw.id ?? "");
  if (!id) return null;
  return {
    id,
    time: numeric(raw.transaction_time ?? raw.time ?? raw.transaction_timestamp),
    action: String(raw.action_type ?? raw.action ?? raw.type ?? "transaction"),
    description: String(raw.longcode ?? raw.description ?? raw.shortcode ?? "Account transaction"),
    amount: numeric(raw.amount),
    balance: numeric(raw.balance_after ?? raw.balance),
    currency: String(raw.currency ?? "USD"),
    contractId: raw.contract_id === undefined ? undefined : String(raw.contract_id),
    profit: numeric(raw.profit),
  };
}

export function statementPageLimit(loadedCount) {
  return Math.max(STATEMENT_PAGE_SIZE, Math.min(loadedCount, 999));
}

export function statementHasMore(count, offset, receivedCount, limit) {
  return typeof count === "number"
    ? offset + receivedCount < count
    : receivedCount >= limit;
}

export function mergeActivityRows(current, incoming, maxRows = 500) {
  const unique = new Map();
  for (const item of [...current, ...incoming]) unique.set(item.id, item);
  return [...unique.values()]
    .sort((left, right) => (right.time ?? 0) - (left.time ?? 0))
    .slice(0, maxRows);
}