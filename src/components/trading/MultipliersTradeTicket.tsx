"use client";

import { useEffect, useState } from "react";
import styles from "./TradingWorkspace.module.css";
import type { DerivAccount, MarketInstrument } from "./types";
import type { MultipliersInput, MultipliersQuote } from "./useMultipliersTrading";

type Props = {
  connected: boolean;
  account: DerivAccount | null;
  realTradingEnabled: boolean;
  realSessionConfirmed: boolean;
  maxRealStake: number;
  maxDailyLoss: number;
  realizedProfit: number | null;
  orderResolutionRequired: boolean;
  acknowledgeOrderResolution: () => void;
  market: MarketInstrument | null;
  sessionState: string;
  status: string;
  busy: boolean;
  quote: MultipliersQuote | null;
  requestQuote: (input: MultipliersInput) => void;
  confirmQuote: () => void;
  dismissQuote: () => void;
};

const CANCELLATIONS = ["5m", "10m", "15m", "30m", "60m"];

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export default function MultipliersTradeTicket({
  connected, account, realTradingEnabled, realSessionConfirmed, maxRealStake, maxDailyLoss,
  realizedProfit, orderResolutionRequired, acknowledgeOrderResolution, market, sessionState,
  status, busy, quote, requestQuote, confirmQuote, dismissQuote,
}: Props) {
  const [direction, setDirection] = useState<"MULTUP" | "MULTDOWN">("MULTUP");
  const [stake, setStake] = useState("1");
  const [multiplier, setMultiplier] = useState("20");
  const [riskMode, setRiskMode] = useState<"none" | "limits" | "cancellation">("none");
  const [takeProfit, setTakeProfit] = useState("10");
  const [stopLoss, setStopLoss] = useState("5");
  const [cancellation, setCancellation] = useState("30m");
  const [now, setNow] = useState(Date.now());

  const isReal = (account?.account_type ?? "").toLowerCase() === "real";
  const maxStake = isReal ? maxRealStake : 1000;
  const dailyLossReached = isReal && realizedProfit !== null && realizedProfit <= -maxDailyLoss;
  const canTrade = connected && Boolean(account) && (!isReal || (realTradingEnabled && realSessionConfirmed));
  const ready = canTrade && sessionState === (isReal ? "Real trading connected" : "Demo trading connected")
    && Boolean(market) && !busy && !orderResolutionRequired && !dailyLossReached;
  const quoteValid = Boolean(quote && quote.symbol === market?.symbol && quote.direction === direction
    && quote.stake === Number(stake) && quote.multiplier === Number(multiplier)
    && quote.cancellation === (riskMode === "cancellation" ? cancellation : undefined)
    && quote.takeProfit === (riskMode === "limits" ? Number(takeProfit) : undefined)
    && quote.stopLoss === (riskMode === "limits" ? Number(stopLoss) : undefined));
  const quoteExpired = Boolean(quote && now - quote.receivedAt >= 30_000);

  useEffect(() => {
    if (!quote) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [quote]);

  useEffect(() => {
    if (quoteExpired) dismissQuote();
  }, [quoteExpired, dismissQuote]);

  function submitQuote() {
    if (!ready || !market) return;
    const stakeValue = Number(stake);
    const multiplierValue = Number(multiplier);
    if (!Number.isFinite(stakeValue) || stakeValue < 1 || stakeValue > maxStake) return;
    if (!Number.isInteger(multiplierValue) || multiplierValue < 1 || multiplierValue > 2000) return;
    const input: MultipliersInput = {
      symbol: market.symbol,
      direction,
      stake: stakeValue,
      multiplier: multiplierValue,
      currency: account?.currency ?? "USD",
      ...(riskMode === "limits" ? { takeProfit: Number(takeProfit), stopLoss: Number(stopLoss) } : {}),
      ...(riskMode === "cancellation" ? { cancellation } : {}),
    };
    requestQuote(input);
  }

  return <section className={styles.ticketPanel + " " + styles.ticketPanelCompact} aria-label="Multipliers order ticket">
    <div className={styles.panelHeading}>
      <div><p className={styles.eyebrow}>DERIV MULTIPLIERS</p><h2>Order ticket</h2></div>
      <span className={isReal ? styles.realLock : styles.demoLock}>{isReal ? "REAL" : "DEMO"}</span>
    </div>
    <div className={styles.multipliersMarket}>
      <strong>{market?.name ?? "Select a market"}</strong>
      <span>{market?.symbol ?? "No instrument selected"} · {account?.currency ?? "—"}</span>
    </div>

    {orderResolutionRequired && <div className={styles.riskStopNotice} role="alert">
      <strong>Previous order outcome unknown</strong>
      <span>Reconcile open positions and account activity directly with Deriv before unlocking orders.</span>
      <button type="button" className={styles.secondaryButton} onClick={acknowledgeOrderResolution}>I reconciled the order</button>
    </div>}
    {isReal && !realTradingEnabled && <p className={styles.inlineHint} role="status">Enable and acknowledge Real trading in Settings before requesting quotes.</p>}
    {isReal && realTradingEnabled && !realSessionConfirmed && <p className={styles.inlineHint} role="status">Waiting for the backend to verify this account&apos;s consent and risk limits.</p>}
    {dailyLossReached && <div className={styles.riskStopNotice} role="alert"><strong>Daily loss limit reached</strong><span>Real quotes are blocked for this account today.</span></div>}

    <div className={styles.multiplierDirection} role="group" aria-label="Multipliers direction">
      <button type="button" className={direction === "MULTUP" ? styles.callSelected : styles.callButton} onClick={() => setDirection("MULTUP")} disabled={!ready || busy} aria-pressed={direction === "MULTUP"}>↗ Up</button>
      <button type="button" className={direction === "MULTDOWN" ? styles.putSelected : styles.putButton} onClick={() => setDirection("MULTDOWN")} disabled={!ready || busy} aria-pressed={direction === "MULTDOWN"}>↘ Down</button>
    </div>

    <div className={styles.compactInputsGrid}>
      <label className={styles.compactFieldGroup}>
        <span className={styles.fieldLabel}>Stake</span>
        <span className={styles.inputShell}><span>{account?.currency ?? "USD"}</span><input type="number" min="1" max={maxStake} step="1" value={stake} onChange={(event) => setStake(event.target.value)} disabled={!ready || busy} /></span>
      </label>
      <label className={styles.compactFieldGroup}>
        <span className={styles.fieldLabel}>Multiplier</span>
        <span className={styles.inputShell}><input type="number" min="1" max="2000" step="1" value={multiplier} onChange={(event) => setMultiplier(event.target.value)} disabled={!ready || busy} /><span>x</span></span>
      </label>
    </div>

    <fieldset className={styles.multiplierRiskField} disabled={!ready || busy}>
      <legend>Risk controls</legend>
      <div className={styles.multiplierRiskModes}>
        <button type="button" className={riskMode === "none" ? styles.presetActive : styles.preset} onClick={() => setRiskMode("none")} aria-pressed={riskMode === "none"}>None</button>
        <button type="button" className={riskMode === "limits" ? styles.presetActive : styles.preset} onClick={() => setRiskMode("limits")} aria-pressed={riskMode === "limits"}>TP / SL</button>
        <button type="button" className={riskMode === "cancellation" ? styles.presetActive : styles.preset} onClick={() => setRiskMode("cancellation")} aria-pressed={riskMode === "cancellation"}>Cancel</button>
      </div>
      {riskMode === "limits" && <div className={styles.compactInputsGrid}>
        <label className={styles.compactFieldGroup}><span className={styles.fieldLabel}>Take profit</span><span className={styles.inputShell}><span>{account?.currency ?? "USD"}</span><input type="number" min="0.01" step="0.01" value={takeProfit} onChange={(event) => setTakeProfit(event.target.value)} /></span></label>
        <label className={styles.compactFieldGroup}><span className={styles.fieldLabel}>Stop loss</span><span className={styles.inputShell}><span>{account?.currency ?? "USD"}</span><input type="number" min="0.01" step="0.01" value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} /></span></label>
      </div>}
      {riskMode === "cancellation" && <label className={styles.compactFieldGroup}><span className={styles.fieldLabel}>Cancellation period</span><span className={styles.inputShell}><select value={cancellation} onChange={(event) => setCancellation(event.target.value)}>{CANCELLATIONS.map((period) => <option key={period} value={period}>{period}</option>)}</select></span></label>}
    </fieldset>
    <p className={styles.compactRiskNote}>Deal cancellation cannot be combined with take profit or stop loss. Losses are limited to stake, subject to Deriv contract terms.</p>

    {status && <p className={styles.inlineHint} role="status">{status}</p>}
    {!quote && <button type="button" className={styles.getQuoteButton} onClick={submitQuote} disabled={!ready || busy || !market || Number(stake) < 1 || Number(stake) > maxStake || !Number.isInteger(Number(multiplier)) || Number(multiplier) < 1 || Number(multiplier) > 2000}>
      {busy ? "Requesting quote…" : `Get ${direction === "MULTUP" ? "Up" : "Down"} quote`}
    </button>}
    {quote && <div className={styles.multiplierQuote}>
      <strong>{quote.direction === "MULTUP" ? "Up" : "Down"} · {quote.multiplier}x</strong>
      <span>Stake {money(quote.stake, quote.currency)} · Quote {money(quote.askPrice, quote.currency)}</span>
      {quote.takeProfit !== undefined && <small>TP {money(quote.takeProfit, quote.currency)} · SL {money(quote.stopLoss ?? 0, quote.currency)}</small>}
      {quote.cancellation && <small>Deal cancellation {quote.cancellation}</small>}
      <div className={styles.multiplierQuoteActions}>
        <button type="button" className={styles.confirmButton} onClick={confirmQuote} disabled={!quoteValid || quoteExpired || busy || !ready}>Confirm buy</button>
        <button type="button" className={styles.secondaryButton} onClick={dismissQuote} disabled={busy}>Dismiss</button>
      </div>
      <small>Quote expires in {Math.max(0, Math.ceil((30_000 - (now - quote.receivedAt)) / 1000))}s</small>
    </div>}
    <small className={styles.multiplierSessionState}>{sessionState}</small>
  </section>;
}