"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./ForexOrderPanel.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type OrderSide = "buy" | "sell";
type OrderCategory = "market" | "limit" | "stop";
type AccountType = "demo" | "real";
type PositionCommandType = "close" | "modify";

type OrderType =
  | "market"
  | "buy_limit" | "sell_limit"
  | "buy_stop"  | "sell_stop";

const TERMINAL_STATUSES = new Set([
  "filled", "rejected", "reconciled", "expired", "cancelled", "cancelled_pending",
]);

type TradeOrderStatus =
  | "queued" | "leased" | "submitted" | "accepted"
  | "placed"
  | "filled" | "rejected" | "reconciled" | "expired"
  | "cancelled" | "cancelled_pending";

type PositionCommandStatus =
  | "queued" | "leased" | "submitted" | "done" | "rejected" | "expired" | "cancelled";

interface TradeOrder {
  id: string;
  broker_symbol: string;
  order_side: OrderSide;
  order_type?: OrderType;
  entry_price?: number;
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
  placed_at?: string;
  filled_at?: string;
}

interface PositionCommand {
  id: string;
  command_type: PositionCommandType;
  mt5_position_ticket: number;
  status: PositionCommandStatus;
  mt5_retcode?: number;
  mt5_retcode_description?: string;
  reject_reason?: string;
}

interface Props {
  symbol: string;
  instrumentName: string;
  deviceId?: string;
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
function formatPrice(value: number | undefined, symbol: string, pipSize?: number): string {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return "—";
  let decimals = 5;
  if (typeof pipSize === "number" && pipSize > 0 && pipSize < 1) {
    const raw = pipSize.toString();
    decimals = raw.includes("e-")
      ? Math.min(6, Math.max(1, Number(raw.split("e-")[1])))
      : Math.min(6, Math.max(1, raw.split(".")[1]?.length ?? 2));
  } else if (symbol.startsWith("frx")) {
    decimals = symbol.includes("XAU") || symbol.includes("XPD") ? 2
      : symbol.includes("XAG") ? 4
      : symbol.includes("JPY") ? 3 : 5;
  } else if (symbol.startsWith("OTC_")) decimals = 2;
  else if (symbol.startsWith("cry")) decimals = symbol.includes("BTC") ? 2 : 4;
  else decimals = 2;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Math.min(decimals, 2),
    maximumFractionDigits: decimals,
  }).format(value);
}

function statusLabel(s: TradeOrderStatus): string {
  const map: Record<TradeOrderStatus, string> = {
    queued:            "Queued — waiting for EA",
    leased:            "EA picked up order",
    submitted:         "Sent to broker…",
    accepted:          "Broker accepted — awaiting fill",
    placed:            "Pending at broker — waiting to trigger",
    filled:            "Filled ✓",
    rejected:          "Rejected",
    reconciled:        "Reconciled",
    expired:           "Expired",
    cancelled:         "Cancelled",
    cancelled_pending: "Pending order cancelled",
  };
  return map[s] ?? s;
}

function posStatusLabel(s: PositionCommandStatus): string {
  const map: Record<PositionCommandStatus, string> = {
    queued:    "Queued — waiting for EA",
    leased:    "EA picked up command",
    submitted: "Sent to MT5…",
    done:      "Done ✓",
    rejected:  "Rejected",
    expired:   "Expired",
    cancelled: "Cancelled",
  };
  return map[s] ?? s;
}

function isTerminal(s: TradeOrderStatus): boolean { return TERMINAL_STATUSES.has(s); }
function isPosTerminal(s: PositionCommandStatus): boolean {
  return ["done", "rejected", "expired", "cancelled"].includes(s);
}

function providerToBrokerSymbol(sym: string): string {
  // Strip Deriv provider prefixes to get the broker-side symbol:
  //   frx  → forex   (frxEURUSD  → EURUSD)
  //   cry  → crypto  (cryBTCUSD  → BTCUSD)
  //   OTC_ → stocks  (OTC_AAPL   → AAPL)
  if (sym.startsWith("frx") || sym.startsWith("cry")) return sym.slice(3);
  if (sym.startsWith("OTC_")) return sym.slice(4);
  return sym;
}

function deriveOrderType(side: OrderSide, cat: OrderCategory): OrderType {
  if (cat === "market") return "market";
  if (cat === "limit")  return side === "buy" ? "buy_limit"  : "sell_limit";
  return side === "buy" ? "buy_stop" : "sell_stop";
}

function historyStatusColor(s: TradeOrderStatus): string {
  if (s === "filled") return "#22c985";
  if (s === "rejected" || s === "expired" || s === "cancelled" || s === "cancelled_pending") return "#ff7b87";
  if (s === "reconciled") return "#f4bb55";
  return "var(--fx-muted)";
}

function shortDate(iso: string): string {
  try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
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
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const quoteFresh =
    typeof quoteEpoch === "number" &&
    now >= quoteEpoch * 1000 - 5000 &&
    now - quoteEpoch * 1000 < 60_000;

  // ── Order form state ──────────────────────────────────────────────────────
  const [side, setSide]               = useState<OrderSide>("buy");
  const [orderCat, setOrderCat]       = useState<OrderCategory>("market");
  const [volume, setVolume]           = useState("0.10");
  const [entryPrice, setEntryPrice]   = useState("");
  const [stopLoss, setStopLoss]       = useState("");
  const [takeProfit, setTakeProfit]   = useState("");
  const [deviationPoints, setDeviation] = useState("");
  // SL/TP offset mode: "price" = absolute price, "pips" = pip offset from entry
  const [slTpMode, setSlTpMode]       = useState<"price" | "pips">("pips");
  // SL/TP pip inputs (converted to absolute price on submit)
  const [slPips, setSlPips]           = useState("");
  const [tpPips, setTpPips]           = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ── Active trade order state ──────────────────────────────────────────────
  const [submitting, setSubmitting]   = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [activeOrder, setActiveOrder] = useState<TradeOrder | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Placed pending orders list ────────────────────────────────────────────
  const [placedOrders, setPlacedOrders] = useState<TradeOrder[]>([]);

  // ── Order history ─────────────────────────────────────────────────────────
  const [history, setHistory]         = useState<TradeOrder[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  // ── Position command state ────────────────────────────────────────────────
  const [posCommandType, setPosCommandType] = useState<PositionCommandType>("close");
  const [posTicket, setPosTicket]   = useState("");
  const [posVolume, setPosVolume]   = useState("");   // for partial close
  const [posNewSl, setPosNewSl]     = useState("");
  const [posNewTp, setPosNewTp]     = useState("");
  const [posSubmitting, setPosSubmitting] = useState(false);
  const [posError, setPosError]     = useState<string | null>(null);
  const [posCommand, setPosCommand] = useState<PositionCommand | null>(null);
  const posPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const brokerSymbol = useMemo(() => providerToBrokerSymbol(symbol), [symbol]);
  const orderType    = useMemo(() => deriveOrderType(side, orderCat), [side, orderCat]);

  const spread = useMemo(
    () => bid !== undefined && ask !== undefined && ask >= bid ? ask - bid : undefined,
    [bid, ask],
  );

  // ── Pip-to-price helpers ──────────────────────────────────────────────────
  // Reference price for SL/TP calculations: ask for buys, bid for sells (market);
  // entry price for pending orders when filled in.
  const refPrice = useMemo(() => {
    if (orderCat !== "market" && entryPrice.trim() && Number(entryPrice) > 0)
      return Number(entryPrice);
    return side === "buy" ? (ask ?? lastPrice) : (bid ?? lastPrice);
  }, [side, orderCat, entryPrice, ask, bid, lastPrice]);

  const pipValue = pipSize && pipSize > 0 ? pipSize : 0.0001;

  // Convert a pip string to an absolute SL/TP price
  const pipsToPrice = useCallback((pipsStr: string, isSl: boolean): number | undefined => {
    const pips = Number(pipsStr);
    if (!pipsStr.trim() || !Number.isFinite(pips) || pips <= 0) return undefined;
    if (!refPrice) return undefined;
    const offset = pips * pipValue;
    // SL: below entry for buy, above for sell. TP: above for buy, below for sell.
    if (isSl) return side === "buy" ? refPrice - offset : refPrice + offset;
    return side === "buy" ? refPrice + offset : refPrice - offset;
  }, [refPrice, side, pipValue]);

  // Derived absolute prices for preview and submission
  const computedSl = useMemo(() => slTpMode === "pips" ? pipsToPrice(slPips, true)  : (stopLoss.trim()   ? Number(stopLoss)   : undefined), [slTpMode, slPips, stopLoss, pipsToPrice]);
  const computedTp = useMemo(() => slTpMode === "pips" ? pipsToPrice(tpPips, false) : (takeProfit.trim() ? Number(takeProfit) : undefined), [slTpMode, tpPips, takeProfit, pipsToPrice]);

  const validVolume       = Number.isFinite(Number(volume)) && Number(volume) > 0;
  const validOptPrice     = (v: string) => v.trim() === "" || (Number.isFinite(Number(v)) && Number(v) > 0);
  const validEntryPrice   = orderCat === "market" || (Number.isFinite(Number(entryPrice)) && Number(entryPrice) > 0);
  const validDeviation    = (v: string) => v.trim() === "" || (Number.isInteger(Number(v)) && Number(v) >= 0);

  const canSubmit = !!deviceId && quoteFresh && validVolume && validEntryPrice &&
    (slTpMode === "pips" || (validOptPrice(stopLoss) && validOptPrice(takeProfit))) &&
    validDeviation(deviationPoints) && !submitting && !activeOrder;

  // ── Load placed + history on mount / deviceId change ─────────────────────
  const loadOrders = useCallback(async () => {
    if (!deviceId) return;
    try {
      const res = await fetch(`/api/mt5/devices/${deviceId}/trade-orders?limit=100`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { orders: TradeOrder[] };
      const orders = data.orders ?? [];
      setPlacedOrders(orders.filter((o) => o.status === "placed"));
      setHistory(orders.filter((o) => isTerminal(o.status)));
    } catch { /* network hiccup */ }
  }, [deviceId]);

  useEffect(() => { void loadOrders(); }, [loadOrders]);

  // ── Polling helpers ───────────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);
  const stopPosPolling = useCallback(() => {
    if (posPollRef.current !== null) { clearInterval(posPollRef.current); posPollRef.current = null; }
  }, []);
  useEffect(() => () => { stopPolling(); stopPosPolling(); }, [stopPolling, stopPosPolling]);

  const pollOrder = useCallback(async (orderId: string, devId: string) => {
    try {
      const res = await fetch(`/api/mt5/devices/${devId}/trade-orders/${orderId}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { order: TradeOrder };
      setActiveOrder(data.order);
      if (isTerminal(data.order.status)) { stopPolling(); void loadOrders(); }
    } catch { /* keep polling */ }
  }, [stopPolling, loadOrders]);

  const pollPosCommand = useCallback(async (cmdId: string, devId: string) => {
    try {
      const res = await fetch(`/api/mt5/devices/${devId}/position-commands/${cmdId}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { command: PositionCommand };
      setPosCommand(data.command);
      if (isPosTerminal(data.command.status)) stopPosPolling();
    } catch { /* keep polling */ }
  }, [stopPosPolling]);

  // ── Submit trade order ────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !deviceId) return;

    // Extra confirmation for real-account orders
    if (accountType === "real") {
      const confirmed = window.confirm(
        `⚠ REAL ACCOUNT — This will place a real-money ${orderType.replace("_", " ")} order for ${volume} lot(s) of ${brokerSymbol}. Losses are real. Proceed?`
      );
      if (!confirmed) return;
    }

    setSubmitting(true);
    setSubmitError(null);

    const idempotencyKey = `forex-${brokerSymbol}-${orderType}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const body: Record<string, unknown> = {
      broker_symbol: brokerSymbol,
      order_side: side,
      order_type: orderType,
      volume: Number(volume),
      account_type: accountType,
      idempotency_key: idempotencyKey,
      expires_in_seconds: 60,
    };
    // Auto-fill entry price from current quote for pending orders if not manually set
    const resolvedEntryPrice = orderCat !== "market"
      ? (entryPrice.trim() ? Number(entryPrice) : (side === "buy" ? ask : bid))
      : undefined;
    if (resolvedEntryPrice && resolvedEntryPrice > 0) body.entry_price = resolvedEntryPrice;
    if (computedSl && computedSl > 0)  body.stop_loss   = computedSl;
    if (computedTp && computedTp > 0)  body.take_profit  = computedTp;
    if (deviationPoints.trim()) body.deviation_points = Number(deviationPoints);

    try {
      const res = await fetch(`/api/mt5/devices/${deviceId}/trade-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let payload: { order?: TradeOrder; error?: string; detail?: string };
      try { payload = await res.json(); } catch { payload = {}; }

      if (!res.ok) {
        setSubmitError(typeof payload.detail === "string" ? payload.detail : typeof payload.error === "string" ? payload.error : `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      const order = payload.order;
      if (!order?.id) { setSubmitError("Unexpected response from server."); setSubmitting(false); return; }

      setActiveOrder(order);
      setSubmitting(false);
      if (!isTerminal(order.status)) {
        pollRef.current = setInterval(() => void pollOrder(order.id, deviceId), 2000);
      }
    } catch {
      setSubmitError("Network error — could not reach the server.");
      setSubmitting(false);
    }
  }, [canSubmit, deviceId, brokerSymbol, side, orderType, orderCat, volume, entryPrice, accountType, computedSl, computedTp, ask, bid, deviationPoints, pollOrder]);

  // ── Cancel queued trade order ─────────────────────────────────────────────
  const handleCancelOrder = useCallback(async () => {
    if (!activeOrder || !deviceId || activeOrder.status !== "queued") return;
    try {
      const res = await fetch(`/api/mt5/devices/${deviceId}/trade-orders/${activeOrder.id}/cancel`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (res.ok) { const d = (await res.json()) as { order: TradeOrder }; setActiveOrder(d.order); stopPolling(); }
    } catch { /* best-effort */ }
  }, [activeOrder, deviceId, stopPolling]);

  // ── Cancel placed pending order ───────────────────────────────────────────
  const handleCancelPending = useCallback(async (orderId: string) => {
    if (!deviceId) return;
    try {
      const res = await fetch(`/api/mt5/devices/${deviceId}/trade-orders/${orderId}/cancel`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (res.ok) { void loadOrders(); }
    } catch { /* best-effort */ }
  }, [deviceId, loadOrders]);

  const handleDismiss = useCallback(() => { stopPolling(); setActiveOrder(null); setSubmitError(null); }, [stopPolling]);

  // ── Submit position command ───────────────────────────────────────────────
  const canSubmitPos = !!deviceId && posTicket.trim() !== "" && Number(posTicket) > 0 && !posSubmitting && !posCommand;

  const handlePosSubmit = useCallback(async () => {
    if (!canSubmitPos || !deviceId) return;

    // Extra confirmation for real-account position commands
    if (accountType === "real") {
      const action = posCommandType === "close" ? `close position #${posTicket}` : `modify position #${posTicket}`;
      const confirmed = window.confirm(
        `⚠ REAL ACCOUNT — This will ${action} on a real-money account. Proceed?`
      );
      if (!confirmed) return;
    }

    setPosSubmitting(true); setPosError(null);
    const idempotencyKey = `pos-${posCommandType}-${posTicket}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const body: Record<string, unknown> = {
      command_type: posCommandType,
      mt5_position_ticket: Number(posTicket),
      account_type: accountType,
      idempotency_key: idempotencyKey,
      expires_in_seconds: 60,
    };
    if (posCommandType === "close" && posVolume.trim()) body.volume = Number(posVolume);
    if (posCommandType === "modify") {
      if (posNewSl.trim())  body.new_stop_loss   = Number(posNewSl);
      if (posNewTp.trim())  body.new_take_profit  = Number(posNewTp);
    }
    try {
      const res = await fetch(`/api/mt5/devices/${deviceId}/position-commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let payload: { command?: PositionCommand; error?: string; detail?: string };
      try { payload = await res.json(); } catch { payload = {}; }
      if (!res.ok) {
        setPosError(typeof payload.detail === "string" ? payload.detail : `HTTP ${res.status}`);
        setPosSubmitting(false); return;
      }
      const cmd = payload.command;
      if (!cmd?.id) { setPosError("Unexpected response."); setPosSubmitting(false); return; }
      setPosCommand(cmd);
      setPosSubmitting(false);
      if (!isPosTerminal(cmd.status)) {
        posPollRef.current = setInterval(() => void pollPosCommand(cmd.id, deviceId), 2000);
      }
    } catch { setPosError("Network error."); setPosSubmitting(false); }
  }, [canSubmitPos, deviceId, posCommandType, posTicket, posVolume, posNewSl, posNewTp, accountType, pollPosCommand]);

  const handlePosDismiss = useCallback(() => { stopPosPolling(); setPosCommand(null); setPosError(null); }, [stopPosPolling]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <aside className={styles.panel} aria-label="Forex order ticket">

      {/* Header */}
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

      {/* Account / device badge */}
      <div className={styles.quoteMeta}>
        <span style={{ fontWeight: 600, color: accountType === "real" ? "var(--color-sell, #ff7b87)" : "#22c985" }}>
          {accountType === "real" ? "⚠ REAL ACCOUNT" : "DEMO ACCOUNT"}
        </span>
        {deviceId
          ? <span style={{ opacity: 0.6, fontSize: "0.75rem" }}>EA paired</span>
          : <span style={{ color: "#ff7b87", fontSize: "0.75rem" }}>No EA paired</span>}
      </div>

      {/* Quote */}
      <div className={styles.quoteGrid}>
        <div><span>SELL / BID</span><strong className={styles.sellPrice}>{formatPrice(bid, symbol, pipSize)}</strong></div>
        <div><span>BUY / ASK</span><strong className={styles.buyPrice}>{formatPrice(ask, symbol, pipSize)}</strong></div>
      </div>
      <div className={styles.quoteMeta}>
        <span>Last {formatPrice(lastPrice, symbol, pipSize)}</span>
        <span>Spread {spread === undefined ? "—" : formatPrice(spread, symbol, pipSize)}</span>
      </div>

      {/* Order type + direction */}
      <div className={styles.orderTypeBar} role="group" aria-label="Order category">
        {(["market", "limit", "stop"] as OrderCategory[]).map((cat) => (
          <button key={cat} type="button"
            className={orderCat === cat ? styles.orderTypeBtnActive : styles.orderTypeBtn}
            aria-pressed={orderCat === cat}
            onClick={() => setOrderCat(cat)}
            disabled={!!activeOrder}>
            {cat.charAt(0).toUpperCase() + cat.slice(1)}
          </button>
        ))}
      </div>

      <div className={styles.sideSwitch} role="group" aria-label="Order direction">
        <button type="button" className={side === "sell" ? styles.sellActive : styles.sideButton}
          aria-pressed={side === "sell"} onClick={() => setSide("sell")} disabled={!!activeOrder}>
          {orderCat === "limit" ? "Sell Limit" : orderCat === "stop" ? "Sell Stop" : "Sell"}
        </button>
        <button type="button" className={side === "buy" ? styles.buyActive : styles.sideButton}
          aria-pressed={side === "buy"} onClick={() => setSide("buy")} disabled={!!activeOrder}>
          {orderCat === "limit" ? "Buy Limit" : orderCat === "stop" ? "Buy Stop" : "Buy"}
        </button>
      </div>

      {/* Entry price for pending orders — defaults to current quote */}
      {orderCat !== "market" && (
        <label className={styles.field}>
          <span>Entry price <small className={styles.fieldHint}>(blank = current {side === "buy" ? "ask" : "bid"})</small></span>
          <input inputMode="decimal" value={entryPrice}
            onChange={(e) => setEntryPrice(e.target.value)}
            placeholder={refPrice ? String(refPrice) : "Price to trigger order"}
            disabled={!!activeOrder} />
          {!validEntryPrice && <small className={styles.validation}>Enter a valid entry price.</small>}
        </label>
      )}

      {/* Volume — quick presets + custom input */}
      <div className={styles.field}>
        <span>Volume (lots)</span>
        <div className={styles.volumePresets}>
          {["0.01","0.05","0.10","0.25","0.50","1.00"].map((v) => (
            <button key={v} type="button"
              className={volume === v ? styles.presetBtnActive : styles.presetBtn}
              onClick={() => setVolume(v)} disabled={!!activeOrder}>{v}</button>
          ))}
        </div>
        <input inputMode="decimal" value={volume} onChange={(e) => setVolume(e.target.value)}
          aria-invalid={!validVolume} disabled={!!activeOrder} placeholder="Custom lots" />
        {!validVolume && <small className={styles.validation}>Enter a volume greater than zero.</small>}
      </div>

      {/* SL / TP with pip or price mode */}
      <div className={styles.slTpSection}>
        <div className={styles.slTpHeader}>
          <span className={styles.slTpTitle}>Stop Loss &amp; Take Profit</span>
          <div className={styles.slTpModeToggle} role="group" aria-label="SL/TP input mode">
            <button type="button"
              className={slTpMode === "pips" ? styles.modeActive : styles.modeBtn}
              onClick={() => setSlTpMode("pips")} disabled={!!activeOrder}>Pips</button>
            <button type="button"
              className={slTpMode === "price" ? styles.modeActive : styles.modeBtn}
              onClick={() => setSlTpMode("price")} disabled={!!activeOrder}>Price</button>
          </div>
        </div>
        <div className={styles.protectionGrid}>
          <div className={styles.slTpField}>
            <label className={styles.field}>
              <span>Stop loss</span>
              {slTpMode === "pips"
                ? <input inputMode="decimal" value={slPips} onChange={(e) => setSlPips(e.target.value)}
                    placeholder="e.g. 20 pips" disabled={!!activeOrder} />
                : <input inputMode="decimal" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)}
                    placeholder="Absolute price" disabled={!!activeOrder} />}
            </label>
            {computedSl !== undefined && computedSl > 0 &&
              <small className={styles.slPreview}>→ {formatPrice(computedSl, symbol, pipSize)}</small>}
          </div>
          <div className={styles.slTpField}>
            <label className={styles.field}>
              <span>Take profit</span>
              {slTpMode === "pips"
                ? <input inputMode="decimal" value={tpPips} onChange={(e) => setTpPips(e.target.value)}
                    placeholder="e.g. 40 pips" disabled={!!activeOrder} />
                : <input inputMode="decimal" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)}
                    placeholder="Absolute price" disabled={!!activeOrder} />}
            </label>
            {computedTp !== undefined && computedTp > 0 &&
              <small className={styles.tpPreview}>→ {formatPrice(computedTp, symbol, pipSize)}</small>}
          </div>
        </div>
      </div>

      {/* Advanced — deviation hidden by default */}
      <div className={styles.advancedSection}>
        <button type="button" className={styles.advancedToggle}
          onClick={() => setShowAdvanced((v) => !v)} aria-expanded={showAdvanced}>
          <span>Advanced settings</span>
          <span>{showAdvanced ? "▲" : "▼"}</span>
        </button>
        {showAdvanced && (
          <label className={styles.field} style={{ marginTop: 6 }}>
            <span>Max deviation (points) <small className={styles.fieldHint}>— blank = broker default</small></span>
            <input inputMode="numeric" value={deviationPoints} onChange={(e) => setDeviation(e.target.value)}
              placeholder="Leave blank for broker default" disabled={!!activeOrder} />
            {!validDeviation(deviationPoints) && <small className={styles.validation}>Enter a non-negative whole number.</small>}
          </label>
        )}
      </div>

      {/* Submit */}
      {!activeOrder && (
        <>
          <button type="button" className={side === "buy" ? styles.reviewBuy : styles.reviewSell}
            disabled={!canSubmit} onClick={() => void handleSubmit()}>
            {submitting ? "Sending…"
              : !deviceId ? "No EA paired"
              : orderCat === "market"
                ? `${side === "buy" ? "Buy" : "Sell"} ${brokerSymbol} at market`
                : `Place ${orderType.replace("_", " ")} on ${brokerSymbol}`}
          </button>
          {!quoteFresh && <p className={styles.warning}>Quote stale — waiting for live price.</p>}
          {!deviceId && <p className={styles.warning}>Pair an MT5 EA in the MT5 Bridge panel before placing orders.</p>}
          {submitError && <p className={styles.warning} role="alert">{submitError}</p>}
        </>
      )}

      {/* Active order status card */}
      {activeOrder && (
        <div className={styles.reviewCard} role="status" aria-live="polite">
          <strong>{statusLabel(activeOrder.status)}</strong>
          <p>
            {activeOrder.order_type && activeOrder.order_type !== "market"
              ? `${activeOrder.order_type.replace("_", " ")} `
              : `${activeOrder.order_side === "buy" ? "Buy" : "Sell"} `}
            {activeOrder.volume} lot(s) of {activeOrder.broker_symbol}
            {activeOrder.entry_price ? ` @ ${formatPrice(activeOrder.entry_price, symbol, pipSize)}` : " at market"}
            {" · "}{accountType === "real" ? "Real" : "Demo"} account
          </p>
          {activeOrder.mt5_order_ticket && <p>Order ticket: {activeOrder.mt5_order_ticket}</p>}
          {activeOrder.status === "filled" && (
            <p>Filled {activeOrder.fill_volume} lot(s) at {formatPrice(activeOrder.fill_price, symbol, pipSize)}
              {activeOrder.mt5_deal_ticket ? ` · Deal #${activeOrder.mt5_deal_ticket}` : ""}</p>
          )}
          {activeOrder.status === "placed" && (
            <p>Pending order in broker book — waiting for price to reach {formatPrice(activeOrder.entry_price, symbol, pipSize)}.</p>
          )}
          {(activeOrder.status === "rejected" || activeOrder.status === "expired" || activeOrder.status === "cancelled_pending") && (
            <p>{activeOrder.reject_reason ?? activeOrder.mt5_retcode_description ?? "No detail provided."}
              {activeOrder.mt5_retcode ? ` (retcode ${activeOrder.mt5_retcode})` : ""}</p>
          )}
          {activeOrder.status === "queued" && (
            <button type="button" className={styles.dismissButton} onClick={() => void handleCancelOrder()}>Cancel order</button>
          )}
          {isTerminal(activeOrder.status) && (
            <button type="button" className={styles.dismissButton} onClick={handleDismiss}>Place another order</button>
          )}
          {!isTerminal(activeOrder.status) && activeOrder.status !== "placed" && (
            <p style={{ opacity: 0.6, fontSize: "0.75rem" }}>Polling for updates…</p>
          )}
        </div>
      )}

      {/* ── Placed pending orders ─────────────────────────────────────────── */}
      <div className={styles.pendingSection}>
        <div className={styles.pendingHeading}>
          <strong>Pending orders</strong>
          <span>{placedOrders.length}</span>
        </div>
        {placedOrders.length === 0
          ? <p>No pending orders in broker book.</p>
          : placedOrders.map((o) => (
            <div key={o.id} className={styles.pendingRow}>
              <div className={styles.pendingRowMeta}>
                <strong>{o.order_type?.replace("_", " ")} {o.broker_symbol} · {o.volume} lot(s)</strong>
                <span>@ {formatPrice(o.entry_price, symbol, pipSize)} · #{o.mt5_order_ticket ?? "—"} · {shortDate(o.requested_at)}</span>
              </div>
              <button type="button" className={styles.cancelPendingBtn}
                onClick={() => void handleCancelPending(o.id)}>
                Cancel
              </button>
            </div>
          ))
        }
      </div>

      {/* ── Position close / modify ──────────────────────────────────────── */}
      <div className={styles.posSection}>
        <p className={styles.posHeading}>Close / Modify position</p>
        {posCommand ? (
          <div className={styles.reviewCard} role="status" aria-live="polite">
            <strong>{posStatusLabel(posCommand.status)}</strong>
            <p>{posCommand.command_type === "close" ? "Close" : "Modify"} position #{posCommand.mt5_position_ticket}</p>
            {(posCommand.status === "rejected") && (
              <p>{posCommand.reject_reason ?? posCommand.mt5_retcode_description ?? "No detail."}</p>
            )}
            {isPosTerminal(posCommand.status)
              ? <button type="button" className={styles.dismissButton} onClick={handlePosDismiss}>Dismiss</button>
              : <p style={{ opacity: 0.6, fontSize: "0.75rem" }}>Polling for updates…</p>}
          </div>
        ) : (
          <div className={styles.posForm}>
            <div className={styles.posTypeBar} role="group" aria-label="Position command type">
              {(["close", "modify"] as PositionCommandType[]).map((t) => (
                <button key={t} type="button"
                  className={posCommandType === t ? styles.posTypeBtnActive : styles.posTypeBtn}
                  onClick={() => setPosCommandType(t)}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            <label className={styles.field}>
              <span>MT5 position ticket</span>
              <input inputMode="numeric" value={posTicket} onChange={(e) => setPosTicket(e.target.value)} placeholder="e.g. 5819158396" />
            </label>
            {posCommandType === "close" && (
              <label className={styles.field}>
                <span>Volume (lots) — blank for full close</span>
                <input inputMode="decimal" value={posVolume} onChange={(e) => setPosVolume(e.target.value)} placeholder="Optional partial volume" />
              </label>
            )}
            {posCommandType === "modify" && (
              <div className={styles.protectionGrid}>
                <label className={styles.field}>
                  <span>New stop loss</span>
                  <input inputMode="decimal" value={posNewSl} onChange={(e) => setPosNewSl(e.target.value)} placeholder="0 = remove" />
                </label>
                <label className={styles.field}>
                  <span>New take profit</span>
                  <input inputMode="decimal" value={posNewTp} onChange={(e) => setPosNewTp(e.target.value)} placeholder="0 = remove" />
                </label>
              </div>
            )}
            {!deviceId && <p className={styles.warning}>No EA paired.</p>}
            {posError && <p className={styles.warning} role="alert">{posError}</p>}
            <button type="button" className={styles.posSubmitBtn} disabled={!canSubmitPos}
              onClick={() => void handlePosSubmit()}>
              {posSubmitting ? "Sending…" : posCommandType === "close" ? "Close position" : "Modify position"}
            </button>
          </div>
        )}
      </div>

      {/* ── Order history ─────────────────────────────────────────────────── */}
      <div className={styles.historySection}>
        <button type="button" className={styles.historyToggle}
          onClick={() => setHistoryOpen((v) => !v)} aria-expanded={historyOpen}>
          <strong>Order history</strong>
          <span>{historyOpen ? "▲ Hide" : `▼ Show ${history.length}`}</span>
        </button>
        {historyOpen && (
          history.length === 0
            ? <p style={{ color: "var(--fx-muted)", fontSize: "9px" }}>No completed orders yet.</p>
            : history.slice(0, 30).map((o) => (
              <div key={o.id} className={styles.historyRow}>
                <div className={styles.historyRowMeta}>
                  <strong>
                    {(o.order_type ?? "market").replace("_", " ")} ·{" "}
                    {o.order_side === "buy" ? "Buy" : "Sell"} {o.volume} {o.broker_symbol}
                  </strong>
                  <span>
                    {o.status === "filled"
                      ? `Filled @ ${formatPrice(o.fill_price, symbol, pipSize)}`
                      : o.reject_reason ?? o.mt5_retcode_description ?? ""}
                    {" · "}{shortDate(o.requested_at)}
                  </span>
                </div>
                <span className={styles.historyRowStatus} style={{ color: historyStatusColor(o.status) }}>
                  {statusLabel(o.status)}
                </span>
              </div>
            ))
        )}
      </div>

      <p className={styles.disclaimer}>
        Prices are market-data quotes, not executable broker quotes. Orders are routed to MT5 via the
        paired EA and are subject to broker conditions and available liquidity.
        {accountType === "real" ? " Real account — losses are real." : ""}
      </p>
    </aside>
  );
}
