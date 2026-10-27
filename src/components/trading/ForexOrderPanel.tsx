"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./ForexOrderPanel.module.css";

type OrderSide = "buy" | "sell";
type OrderType = "market" | "limit" | "stop";

type Props = {
  symbol: string;
  instrumentName: string;
  lastPrice?: number;
  bid?: number;
  ask?: number;
  pipSize?: number;
  quoteEpoch?: number;
};

function formatPrice(value: number | undefined, symbol: string, pipSize?: number) {
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

export default function ForexOrderPanel({
  symbol,
  instrumentName,
  lastPrice,
  bid,
  ask,
  pipSize,
  quoteEpoch,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const quoteFresh = typeof quoteEpoch === "number" && now >= quoteEpoch * 1000 - 5000 && now - quoteEpoch * 1000 < 60_000;
  const [side, setSide] = useState<OrderSide>("buy");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [volume, setVolume] = useState("0.10");
  const [entryPrice, setEntryPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);

  const spread = useMemo(
    () => bid !== undefined && ask !== undefined && ask >= bid ? ask - bid : undefined,
    [bid, ask],
  );
  const validVolume = Number.isFinite(Number(volume)) && Number(volume) > 0;
  const validProtection = (value: string) => value.trim() === "" || (Number.isFinite(Number(value)) && Number(value) > 0);
  const canReview = quoteFresh && validVolume && validProtection(stopLoss) && validProtection(takeProfit)
    && (orderType === "market" || (Number.isFinite(Number(entryPrice)) && Number(entryPrice) > 0));

  return (
    <aside className={styles.panel} aria-label="Forex order ticket">
      <div className={styles.header}>
        <div>
          <span className={styles.eyebrow}>ORDER TICKET</span>
          <h2>Trade {symbol}</h2>
          <p>{instrumentName}</p>
        </div>
        <span className={quoteFresh ? styles.liveBadge : styles.staleBadge}>
          <i /> {quoteFresh ? "QUOTE LIVE" : "QUOTE STALE"}
        </span>
      </div>

      <div className={styles.quoteGrid}>
        <div>
          <span>SELL / BID</span>
          <strong className={styles.sellPrice}>{formatPrice(bid, symbol, pipSize)}</strong>
        </div>
        <div>
          <span>BUY / ASK</span>
          <strong className={styles.buyPrice}>{formatPrice(ask, symbol, pipSize)}</strong>
        </div>
      </div>
      <div className={styles.quoteMeta}>
        <span>Last {formatPrice(lastPrice, symbol, pipSize)}</span>
        <span>Spread {spread === undefined ? "—" : formatPrice(spread, symbol, pipSize)}</span>
      </div>

      <div className={styles.sideSwitch} role="group" aria-label="Order direction">
        <button type="button" className={side === "sell" ? styles.sellActive : styles.sideButton} aria-pressed={side === "sell"} onClick={() => setSide("sell")}>Sell</button>
        <button type="button" className={side === "buy" ? styles.buyActive : styles.sideButton} aria-pressed={side === "buy"} onClick={() => setSide("buy")}>Buy</button>
      </div>

      <label className={styles.field}>
        <span>Order type</span>
        <select value={orderType} onChange={(event) => setOrderType(event.target.value as OrderType)}>
          <option value="market">Market order</option>
          <option value="limit">Limit order</option>
          <option value="stop">Stop order</option>
        </select>
      </label>

      {orderType !== "market" && (
        <label className={styles.field}>
          <span>Entry price</span>
          <input inputMode="decimal" value={entryPrice} onChange={(event) => setEntryPrice(event.target.value)} placeholder="Enter trigger price" />
        </label>
      )}

      <label className={styles.field}>
        <span>Volume (lots)</span>
        <input inputMode="decimal" value={volume} onChange={(event) => setVolume(event.target.value)} aria-invalid={!validVolume} />
        {!validVolume && <small className={styles.validation}>Enter a volume greater than zero.</small>}
      </label>

      <div className={styles.protectionGrid}>
        <label className={styles.field}>
          <span>Stop loss</span>
          <input inputMode="decimal" value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} placeholder="Optional price" />
          {!validProtection(stopLoss) && <small className={styles.validation}>Use a positive price.</small>}
        </label>
        <label className={styles.field}>
          <span>Take profit</span>
          <input inputMode="decimal" value={takeProfit} onChange={(event) => setTakeProfit(event.target.value)} placeholder="Optional price" />
          {!validProtection(takeProfit) && <small className={styles.validation}>Use a positive price.</small>}
        </label>
      </div>

      <button type="button" className={side === "buy" ? styles.reviewBuy : styles.reviewSell} disabled={!canReview} onClick={() => setReviewOpen(true)}>
        Review {side === "buy" ? "Buy" : "Sell"} order
      </button>
      {!quoteFresh && <p className={styles.warning}>Order review is unavailable until a fresh provider quote arrives.</p>}

      {reviewOpen && (
        <div className={styles.reviewCard} role="status" aria-live="polite">
          <strong>Review only — order not submitted</strong>
          <p>{side === "buy" ? "Buy" : "Sell"} {volume} lot(s) of {symbol} at {orderType === "market" ? "market price" : formatPrice(Number(entryPrice), symbol, pipSize)}.</p>
          <p>Stop loss: {stopLoss ? formatPrice(Number(stopLoss), symbol, pipSize) : "Not set"} · Take profit: {takeProfit ? formatPrice(Number(takeProfit), symbol, pipSize) : "Not set"}</p>
          <p className={styles.blockedNote}>Forex order routing is not connected in this build. TradeBridge currently supports confirmed Deriv digit Options orders, not forex CFD/margin orders. No order will be sent.</p>
          <button type="button" className={styles.dismissButton} onClick={() => setReviewOpen(false)}>Close review</button>
        </div>
      )}

      <div className={styles.pendingSection}>
        <div className={styles.pendingHeading}>
          <strong>Pending orders</strong>
          <span>0</span>
        </div>
        <p>No pending orders are being tracked by this analyst.</p>
      </div>

      <p className={styles.disclaimer}>Prices are market-data quotes, not an executable broker quote. Spread is shown in price units until pip conversion is verified. Stop-loss and take-profit fields are not sent to a broker.</p>
    </aside>
  );
}
