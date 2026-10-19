export function parseDerivNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
export function isDerivTrue(value) {
  return value === true || value === 1 || value === "1";
}
export function normalizeDerivContract(raw = {}) {
  const contractId = raw.contract_id ?? raw.id;
  const stake = parseDerivNumber(raw.buy_price ?? raw.buyPrice);
  const payout = parseDerivNumber(raw.payout);
  const profit = parseDerivNumber(raw.profit ?? raw.profit_loss);
  const status = String(raw.status ?? "").trim().toLowerCase();
  const sold = isDerivTrue(raw.is_sold), expired = isDerivTrue(raw.is_expired);
  const cancelled = status === "cancelled" || status === "canceled";
  const settled = sold || expired || ["won", "lost", "sold", "expired", "cancelled", "canceled"].includes(status);
  const outcome = cancelled ? "cancelled" : !settled ? "open" : profit === null ? "unknown" : profit > 0 ? "won" : profit < 0 ? "lost" : "breakeven";
  return {
    contractId: contractId == null ? null : String(contractId),
    contractType: String(raw.contract_type ?? raw.contractType ?? "Contract"),
    symbol: String(raw.underlying_symbol ?? raw.underlying ?? raw.symbol ?? "—"),
    currency: String(raw.currency ?? "USD"),
    stake, payout, profit, status: settled ? "settled" : "open",
    providerStatus: status || "unknown", outcome, settled,
    startedAt: parseDerivNumber(raw.date_start ?? raw.purchase_time),
    expiresAt: parseDerivNumber(raw.date_expiry ?? raw.expiry_time), sold, expired
  };
}
