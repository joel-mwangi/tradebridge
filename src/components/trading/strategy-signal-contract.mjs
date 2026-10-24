/**
 * Validate a backend strategy signal against the exact UI configuration for
 * the currently armed run. A status from a stale run must never place an order.
 */
export function validateRunnableStrategySignal(status, config) {
  if (!status || !config) return { ok: false, reason: "missing_signal_or_config" };
  if (status.signal_generated !== true) return { ok: false, reason: "signal_not_generated" };
  if (status.symbol !== config.symbol) return { ok: false, reason: "market_mismatch" };
  if (status.barrier !== config.barrier) return { ok: false, reason: "barrier_mismatch" };
  if (status.digit_window_size !== config.windowSize) return { ok: false, reason: "window_mismatch" };
  const expectedDirection = String(config.direction ?? "").toLowerCase();
  if (!["over", "under"].includes(expectedDirection) || status.requested_direction !== expectedDirection) {
    return { ok: false, reason: "requested_direction_mismatch" };
  }
  if (status.selected_group !== expectedDirection) return { ok: false, reason: "selected_group_mismatch" };
  const barrier = status.barrier;
  if (!Number.isInteger(barrier) || barrier < 0 || barrier > 9) return { ok: false, reason: "invalid_barrier" };
  if (expectedDirection === "over" && barrier > 8) return { ok: false, reason: "invalid_over_barrier" };
  if (expectedDirection === "under" && barrier < 1) return { ok: false, reason: "invalid_under_barrier" };
  return { ok: true, reason: null };
}
