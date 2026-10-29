"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./ForexOrderPanel.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type OrderSide = "buy" | "sell";
type AccountType = "demo" | "real";

/** Terminal statuses where polling can stop. */
const TERMINAL_STATUSES = new Set([
  "filled", "rejected", "reconciled", "expired", "cancelled",
]);

type TradeOrderStatus =
  | "queued" | "leased" | "submitted" | "accepted"
  | "filled" | "rejected" | "reconciled" | "expired" | "cancelled";

interface TradeOrder {
  id: string;
  broker_symbol: string;
  order_side: OrderSide;
  volume: string;
  status: TradeOrderStatus;
  mt5_order_ticket?: number;
  mt5_deal_ticket?: number;
  fill_price?: number;
  fill_volume?: number;
  fill_time?: string;
  mt5_retcode?: number;
  mt5_retcode_description?: string;
  reject_reason?: string;
  requested_at: string;
  submitted_at?: string;
  accepted_at?: string;
  filled_at?: string;
}

interface Props {
  symbol: string;
  instrumentName: string;
  /** deviceId of the paired MT5 EA. When absent the panel shows a "not paired" notice. */
  deviceId?: string;
  /** 'demo' or 'real' — must match the MT5 account the EA is connected to. */
  accountType?: AccountType;
  lastPrice?: number;
  bid?: number;
  ask?: number;
  pipSize?: number;
  quoteEpoch?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatPrice(
  value: number | undefined,
  symbol: string,
  pipSize?: number,
): string {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return "—";
  let decimals = 5;
  if (typeof pipSize === "number" && pipSize > 0 && pipSize < 1) {
    const raw = pipSize.toString();
    decimals = raw.includes("e-")
      ? Math.min(6, Math.max(1, Number(raw.split("e-")[1])))
      : Math.min(6, Math.max(1, raw.split(".")[1]?.length ?? 2));
  } else if (symbol.startsWith("frx")) {
    decimals = symbol.includes("XAU") || symbol.includes("XPD")
      ? 2
      : symbol.includes("XAG")
      ? 4
      : symbol.includes("JPY")
      ? 3
      : 5;
  } else if (symbol.startsWith("OTC_")) {
    decimals = 2;
  } else if (symbol.startsWith("cry")) {
    decimals = symbol.includes("BTC") ? 2 : 4;
  } else {
    decimals = 2;
  }
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Math.min(decimals, 2),
    maximumFractionDigits: decimals,
  }).format(value);
}

function statusLabel(s: TradeOrderStatus): string {
  const labels: Record<TradeOrderStatus, string> = {
    queued: "Queued — waiting for EA",
    leased: "EA picked up order",
    submitted: "Sent to broker…",
    accepted: "Broker accepted — awaiting fill",
    filled: "Filled ✓",
    rejected: "Rejected",
    reconciled: "Reconciled",
    expired: "Expired",
    cancelled: "Cancelled",
  };
  return labels[s] ?? s;
}

function isTerminal(s: TradeOrderStatus): boolean {
  return TERMINAL_STATUSES.has(s);
}

/** Derive a broker symbol from the provider symbol used in ForexAnalyst. */
function providerToBrokerSymbol(providerSymbol: string): string {
  // Strip "frx" prefix (e.g. frxEURUSD → EURUSD, frxXAUUSD → XAUUSD).
  // OTC and crypto symbols are left as-is; the user must ensure their broker
  // uses the same naming. Phase 1 keeps it simple — if it doesn't match the
  // EA's InpSymbolMappings the EA will reject with BROKER_SYMBOL_NOT_FOUND.
  if (providerSymbol.startsWith("frx")) return providerSymbol.slice(3);
  return providerSymbol;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ForexOrderPanel({
  symbol,
  instrumentName,
  deviceId,
  accountType = "demo",
  lastPrice,
  bid,
  ask,
  pipSize,
  quoteEpoch,
}: Props) {
  // ── Quote freshness ───────────────────────────────────────────────────────
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const quoteFresh =
    typeof quoteEpoch === "number" &&
    now >= quoteEpoch * 1000 - 5000 &&
    now - quoteEpoch * 1000 < 60_000;

  // ── Form state ────────────────────────────────────────────────────────────
  const [side, setSide] = useState<OrderSide>("buy");
  const [volume, setVolume] = useState("0.10");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [deviationPoints, setDeviationPoints] = useState("");

  // ── Submission state ──────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [activeOrder, setActiveOrder] = useState<TradeOrder | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Computed values ───────────────────────────────────────────────────────
  const spread = useMemo(
    () =>
      bid !== undefined && ask !== undefined && ask >= bid
        ? ask - bid
        : undefined,
    [bid, ask],
  );
  const validVolume =
    Number.isFinite(Number(volume)) && Number(volume) > 0;
  const validOptionalPrice = (v: string) =>
    v.trim() === "" ||
    (Number.isFinite(Number(v)) && Number(v) > 0);
  const validDeviation = (v: string) =>
    v.trim() === "" ||
    (Number.isInteger(Number(v)) && Number(v) >= 0);
  const brokerSymbol = providerToBrokerSymbol(symbol);

  const canSubmit =
    !!deviceId &&
    quoteFresh &&
    validVolume &&
    validOptionalPrice(stopLoss) &&
    validOptionalPrice(takeProfit) &&
    validDeviation(deviationPoints) &&
    !submitting &&
    !activeOrder;

  // ── Polling ───────────────────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollOrder = useCallback(
    async (orderId: string, devId: string) => {
      try {
        const res = await fetch(
          `/api/mt5/devices/${devId}/trade-orders/${orderId}`,
          { cache: "no-store" },
        );
        if (!res.ok) return; // network hiccup; keep polling
        const data = (await res.json()) as { order: TradeOrder };
        setActiveOrder(data.order);
        if (isTerminal(data.order.status)) stopPolling();
      } catch {
        // Transient failure; keep polling
      }
    },
    [stopPolling],
  );

  // Clean up polling on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !deviceId) return;
    setSubmitting(true);
    setSubmitError(null);

    // Generate a per-submission idempotency key so double-clicks are safe
    const idempotencyKey = `forex-${brokerSymbol}-${side}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 9)}`;

    const body: Record<string, unknown> = {
      broker_symbol: brokerSymbol,
      order_side: side,
      volume: Number(volume),
      account_type: accountType,
      idempotency_key: idempotencyKey,
      expires_in_seconds: 60,
    };
    if (stopLoss.trim()) body.stop_loss = Number(stopLoss);
    if (takeProfit.trim()) body.take_profit = Number(takeProfit);
    if (deviationPoints.trim()) body.deviation_points = Number(deviationPoints);

    try {
      const res = await fetch(`/api/mt5/devices/${deviceId}/trade-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      let payload: { order?: TradeOrder; error?: string; detail?: string };
      try {
        payload = await res.json();
      } catch {
        payload = {};
      }

      if (!res.ok) {
        const detail =
          typeof payload.detail === "string"
            ? payload.detail
            : typeof payload.error === "string"
            ? payload.error
            : `HTTP ${res.status}`;
        setSubmitError(detail);
        setSubmitting(false);
        return;
      }

      const order = payload.order;
      if (!order?.id) {
        setSubmitError("Unexpected response from server.");
        setSubmitting(false);
        return;
      }

      setActiveOrder(order);
      setSubmitting(false);

      // Start polling every 2 s until terminal
      if (!isTerminal(order.status)) {
        pollRef.current = setInterval(
          () => void pollOrder(order.id, deviceId),
          2000,
        );
      }
    } catch {
      setSubmitError("Network error — could not reach the server.");
      setSubmitting(false);
    }
  }, [
    canSubmit,
    deviceId,
    brokerSymbol,
    side,
    volume,
    accountType,
    stopLoss,
    takeProfit,
    deviationPoints,
    pollOrder,
  ]);

  // ── Cancel ────────────────────────────────────────────────────────────────
  const handleCancel = useCallback(async () => {
    if (!activeOrder || !deviceId || activeOrder.status !== "queued") return;
    try {
      const res = await fetch(
        `/api/mt5/devices/${deviceId}/trade-orders/${activeOrder.id}/cancel`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      if (res.ok) {
        const data = (await res.json()) as { order: TradeOrder };
        setActiveOrder(data.order);
        stopPolling();
      }
    } catch {
      // Best-effort; the order will expire naturally
    }
  }, [activeOrder, deviceId, stopPolling]);

  const handleDismiss = useCallback(() => {
    stopPolling();
    setActiveOrder(null);
    setSubmitError(null);
  }, [stopPolling]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <aside className={styles.panel} aria-label="Forex order ticket">
      <div className={styles.header}>
        <div>
          <span className={styles.eyebrow}>ORDER TICKET</span>
          <h2>Trade {brokerSymbol}</h2>
          <p>{instrumentName}</p>
        </div>
        <span className={quoteFresh ? styles.liveBadge : styles.staleBadge}>
          <i /> {quoteFresh ? "QUOTE LIVE" : "QUOTE STALE"}
        </span>
      </div>

      {/* Account type badge */}
      <div className={styles.quoteMeta} style={{ marginBottom: "0.25rem" }}>
        <span
          style={{
            fontWeight: 600,
            color: accountType === "real" ? "var(--color-sell, #e74c3c)" : "var(--color-buy, #2ecc71)",
          }}
        >
          {accountType === "real" ? "⚠ REAL ACCOUNT" : "DEMO ACCOUNT"}
        </span>
        {deviceId ? (
          <span style={{ opacity: 0.6, fontSize: "0.75rem" }}>
            EA paired
          </span>
        ) : (
          <span style={{ color: "var(--color-sell, #e74c3c)", fontSize: "0.75rem" }}>
            No EA paired
          </span>
        )}
      </div>

      <div className={styles.quoteGrid}>
        <div>
          <span>SELL / BID</span>
          <strong className={styles.sellPrice}>
            {formatPrice(bid, symbol, pipSize)}
          </strong>
        </div>
        <div>
          <span>BUY / ASK</span>
          <strong className={styles.buyPrice}>
            {formatPrice(ask, symbol, pipSize)}
          </strong>
        </div>
      </div>
      <div className={styles.quoteMeta}>
        <span>Last {formatPrice(lastPrice, symbol, pipSize)}</span>
        <span>
          Spread{" "}
          {spread === undefined ? "—" : formatPrice(spread, symbol, pipSize)}
        </span>
      </div>

      <div
        className={styles.sideSwitch}
        role="group"
        aria-label="Order direction"
      >
        <button
          type="button"
          className={side === "sell" ? styles.sellActive : styles.sideButton}
          aria-pressed={side === "sell"}
          onClick={() => setSide("sell")}
          disabled={!!activeOrder}
        >
          Sell
        </button>
        <button
          type="button"
          className={side === "buy" ? styles.buyActive : styles.sideButton}
          aria-pressed={side === "buy"}
          onClick={() => setSide("buy")}
          disabled={!!activeOrder}
        >
          Buy
        </button>
      </div>

      <label className={styles.field}>
        <span>Volume (lots)</span>
        <input
          inputMode="decimal"
          value={volume}
          onChange={(e) => setVolume(e.target.value)}
          aria-invalid={!validVolume}
          disabled={!!activeOrder}
        />
        {!validVolume && (
          <small className={styles.validation}>
            Enter a volume greater than zero.
          </small>
        )}
      </label>

      <div className={styles.protectionGrid}>
        <label className={styles.field}>
          <span>Stop loss</span>
          <input
            inputMode="decimal"
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
            placeholder="Optional price"
            disabled={!!activeOrder}
          />
          {!validOptionalPrice(stopLoss) && (
            <small className={styles.validation}>Use a positive price.</small>
          )}
        </label>
        <label className={styles.field}>
          <span>Take profit</span>
          <input
            inputMode="decimal"
            value={takeProfit}
            onChange={(e) => setTakeProfit(e.target.value)}
            placeholder="Optional price"
            disabled={!!activeOrder}
          />
          {!validOptionalPrice(takeProfit) && (
            <small className={styles.validation}>Use a positive price.</small>
          )}
        </label>
      </div>

      <label className={styles.field}>
        <span>Max deviation (points)</span>
        <input
          inputMode="numeric"
          value={deviationPoints}
          onChange={(e) => setDeviationPoints(e.target.value)}
          placeholder="Optional — broker default if blank"
          disabled={!!activeOrder}
        />
        {!validDeviation(deviationPoints) && (
          <small className={styles.validation}>
            Enter a non-negative whole number.
          </small>
        )}
      </label>

      {/* Submit button */}
      {!activeOrder && (
        <>
          <button
            type="button"
            className={
              side === "buy" ? styles.reviewBuy : styles.reviewSell
            }
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
          >
            {submitting
              ? "Sending…"
              : !deviceId
              ? "No EA paired"
              : `${side === "buy" ? "Buy" : "Sell"} ${brokerSymbol} at market`}
          </button>
          {!quoteFresh && (
            <p className={styles.warning}>
              Order submission is unavailable until a fresh quote arrives.
            </p>
          )}
          {!deviceId && (
            <p className={styles.warning}>
              Pair an MT5 EA in the MT5 Bridge panel before placing orders.
            </p>
          )}
          {submitError && (
            <p className={styles.warning} role="alert">
              {submitError}
            </p>
          )}
        </>
      )}

      {/* Active order status card */}
      {activeOrder && (
        <div className={styles.reviewCard} role="status" aria-live="polite">
          <strong>{statusLabel(activeOrder.status)}</strong>

          <p>
            {activeOrder.order_side === "buy" ? "Buy" : "Sell"}{" "}
            {activeOrder.volume} lot(s) of {activeOrder.broker_symbol} at
            market · {accountType === "real" ? "Real" : "Demo"} account
          </p>

          {activeOrder.mt5_order_ticket && (
            <p>Order ticket: {activeOrder.mt5_order_ticket}</p>
          )}

          {activeOrder.status === "filled" && (
            <p>
              Filled {activeOrder.fill_volume} lot(s) at{" "}
              {formatPrice(activeOrder.fill_price, symbol, pipSize)}
              {activeOrder.mt5_deal_ticket
                ? ` · Deal #${activeOrder.mt5_deal_ticket}`
                : ""}
            </p>
          )}

          {activeOrder.status === "reconciled" && (
            <p>
              Reconciled via MT5 position query
              {activeOrder.fill_price
                ? ` at ${formatPrice(activeOrder.fill_price, symbol, pipSize)}`
                : ""}
              {activeOrder.reject_reason
                ? ` — ${activeOrder.reject_reason}`
                : ""}
            </p>
          )}

          {(activeOrder.status === "rejected" ||
            activeOrder.status === "expired") && (
            <p>
              {activeOrder.reject_reason ?? activeOrder.mt5_retcode_description ?? "No detail provided."}
              {activeOrder.mt5_retcode
                ? ` (retcode ${activeOrder.mt5_retcode})`
                : ""}
            </p>
          )}

          {/* In-progress actions */}
          {activeOrder.status === "queued" && (
            <button
              type="button"
              className={styles.dismissButton}
              onClick={() => void handleCancel()}
            >
              Cancel order
            </button>
          )}

          {isTerminal(activeOrder.status) && (
            <button
              type="button"
              className={styles.dismissButton}
              onClick={handleDismiss}
            >
              Place another order
            </button>
          )}

          {!isTerminal(activeOrder.status) && (
            <p style={{ opacity: 0.6, fontSize: "0.75rem", marginTop: "0.5rem" }}>
              Polling for updates…
            </p>
          )}
        </div>
      )}

      <div className={styles.pendingSection}>
        <div className={styles.pendingHeading}>
          <strong>Pending orders</strong>
          <span>0</span>
        </div>
        <p>
          Pending (limit/stop) orders are Phase 2. Only market orders are
          supported in this build.
        </p>
      </div>

      <p className={styles.disclaimer}>
        Prices are market-data quotes, not an executable broker quote. Spread
        is shown in price units until pip conversion is verified. Orders are
        routed to MT5 via the paired EA; execution is subject to broker
        conditions and available liquidity.
      </p>
    </aside>
  );
}
