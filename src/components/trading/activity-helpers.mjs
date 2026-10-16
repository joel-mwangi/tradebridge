export const STATEMENT_PAGE_SIZE = 30;

export function numeric(value) {
  const parsed = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(parsed) ? parsed : null;
}

export function toPosition(raw) {
  const contractId = String(raw.contract_id ?? "");
  if (!contractId) return null;
  return {
    contractId,
    symbol: String(raw.underlying_symbol ?? raw.symbol ?? "—"),
    contractType: String(raw.contract_type ?? "Contract"),
    buyPrice: numeric(raw.buy_price),
    currentSpot: numeric(raw.current_spot ?? raw.current_spot_display_value),
    payout: numeric(raw.payout),
    profit: numeric(raw.profit),
    currency: String(raw.currency ?? "USD"),
    startedAt: numeric(raw.date_start ?? raw.purchase_time),
    expiresAt: numeric(raw.date_expiry ?? raw.expiry_time),
    status: String(raw.status ?? "open"),
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