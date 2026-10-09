"use client";

import { useState } from "react";
import styles from "./TradingWorkspace.module.css";
import type { DemoQuote, DerivAccount, MarketInstrument } from "./types";

type Props = {
  connected: boolean;
  account: DerivAccount | null;
  market: MarketInstrument | null;
  sessionState: string;
  status: string;
  busy: boolean;
  quote: DemoQuote | null;
  requestQuote: (input: { symbol: string; contractType: "CALL" | "PUT"; stake: number; duration: number }) => void;
  confirmQuote: () => void;
};

export default function DemoTradeTicket({
  connected, account, market, sessionState, status, busy, quote, requestQuote, confirmQuote,
}: Props) {
  const [direction, setDirection] = useState<"CALL" | "PUT">("CALL");
  const [stake, setStake] = useState("1");
  const [duration, setDuration] = useState("60");
  const accountType = (account?.account_type ?? "").toLowerCase();
  const isDemo = accountType === "demo";
  const isRealAccount = accountType === "real";
  const ready = connected && isDemo && sessionState === "Demo trading connected" && Boolean(market);

  function submitQuote() {
    if (!connected || !isDemo || !market) return;
    const stakeValue = Number(stake);
    const durationValue = Number(duration);
    requestQuote({ symbol: market.symbol, contractType: direction, stake: stakeValue, duration: durationValue });
  }

  const quoteMatchesForm = Boolean(quote && quote.symbol === market?.symbol && quote.contractType === direction && quote.stake === Number(stake) && quote.duration === Number(duration));

  return <section className={styles.ticketPanel} id="ticket">
    <div className={styles.panelHeading}>
      <div><p className={styles.eyebrow}>ORDER ENTRY</p><h2>{isRealAccount ? "Real account · read-only" : "Demo trade ticket"}</h2><p className={styles.panelSubtext}>{isRealAccount ? "Real-money order placement is disabled." : "Quote first. Confirm second."}</p></div>
      <span className={isRealAccount ? styles.realLock : styles.demoLock}>{isRealAccount ? "READ-ONLY" : "DEMO ONLY"}</span>
    </div>
    {isRealAccount && <div className={styles.accountModeNotice} role="note"><strong>Real account is view-only</strong><span>Your account is listed for visibility, but TradeBridge does not send real-money orders. Switch to a Demo account to request quotes and trade using virtual funds.</span></div>}
    <div className={styles.tradeMarket}>
      <span className={styles.tradeMarketIcon}>{market?.market === "forex" ? "FX" : "↗"}</span>
      <div><strong>{market?.name ?? "Select a market"}</strong><small>{market?.symbol ?? "No active market selected"}</small></div>
    </div>
    <fieldset className={styles.directionField} disabled={!connected || !isDemo}>
      <legend>Market direction</legend>
      <div className={styles.directionChoices}>
        <button type="button" className={direction === "CALL" ? styles.callSelected : styles.callButton} onClick={() => setDirection("CALL")} aria-pressed={direction === "CALL"}>
          <span>↗</span><span><strong>Higher</strong><small>Call</small></span>
        </button>
        <button type="button" className={direction === "PUT" ? styles.putSelected : styles.putButton} onClick={() => setDirection("PUT")} aria-pressed={direction === "PUT"}>
          <span>↘</span><span><strong>Lower</strong><small>Put</small></span>
        </button>
      </div>
    </fieldset>

    <label className={styles.fieldLabel} htmlFor="tradebridge-stake">Stake amount</label>
    <div className={styles.inputShell}>
      <span>{account?.currency ?? "—"}</span>
      <input id="tradebridge-stake" type="number" inputMode="decimal" min="1" max="1000" step="1" value={stake} onChange={(event) => setStake(event.target.value)} aria-describedby="stake-note" disabled={!connected || !isDemo} />
    </div>
    <div className={styles.presets} aria-label="Stake presets">
      {["1", "5", "10", "25"].map((value) => <button key={value} type="button" className={stake === value ? styles.presetActive : styles.preset} onClick={() => setStake(value)} disabled={!connected || !isDemo}>{value} {account?.currency ?? ""}</button>)}
    </div>
    <p className={styles.fieldHint} id="stake-note">Use virtual funds only. Deriv validates the minimum stake for the selected market and currency.</p>

    <label className={styles.fieldLabel} htmlFor="tradebridge-duration">Contract duration</label>
    <div className={styles.inputShell}>
      <input id="tradebridge-duration" type="number" inputMode="numeric" min="1" max="86400" step="1" value={duration} onChange={(event) => setDuration(event.target.value)} aria-describedby="duration-note" disabled={!connected || !isDemo} />
      <span>seconds</span>
    </div>
    <div className={styles.presets} aria-label="Duration presets">
      {[{ label: "1 min", value: "60" }, { label: "5 min", value: "300" }, { label: "10 min", value: "600" }].map((value) => <button key={value.value} type="button" className={duration === value.value ? styles.presetActive : styles.preset} onClick={() => setDuration(value.value)} disabled={!connected || !isDemo}>{value.label}</button>)}
    </div>
    <p className={styles.fieldHint} id="duration-note">Duration must be between 1 and 86,400 seconds. The quote response determines the actual offered price and payout.</p>

    {quote && quoteMatchesForm && <div className={styles.quoteCard} role="status">
      <div className={styles.quoteCardHeader}><span>DERIV QUOTE</span><strong>Fresh quote</strong></div>
      <div className={styles.quoteMetrics}>
        <div><small>Stake</small><strong>{quote.stake.toLocaleString()} {quote.currency}</strong></div>
        <div><small>Price</small><strong>{quote.askPrice.toLocaleString()} {quote.currency}</strong></div>
        <div><small>Potential payout</small><strong>{quote.payout === null ? "Not returned" : quote.payout.toLocaleString() + " " + quote.currency}</strong></div>
      </div>
      <p>{quote.contractType === "CALL" ? "Higher" : "Lower"} · {quote.symbol} · {quote.duration} seconds</p>
      <button type="button" className={styles.confirmButton} onClick={confirmQuote} disabled={!ready || busy}>Confirm demo trade <span>→</span></button>
      <small className={styles.quoteWarning}>Confirmation sends a real order to your Deriv demo account. It uses virtual funds but can still change your demo balance.</small>
    </div>}

    <div className={styles.ticketStatus} role="status">
      <span className={sessionState === "Demo trading connected" ? styles.statusDotConnected : styles.statusDot} />
      <div><strong>{sessionState}</strong>{status && <p>{status}</p>}</div>
    </div>
    <button type="button" className={styles.getQuoteButton} onClick={submitQuote} disabled={!ready || busy || !market}>
      {busy ? "Waiting for Deriv…" : quoteMatchesForm ? "Request a new quote" : "Get demo quote"}
    </button>
    {!connected && <p className={styles.inlineHint}>Connect Deriv above to activate demo trading.</p>}
    {connected && !account && <p className={styles.inlineHint}>Select an eligible demo account before requesting a quote.</p>}
    {connected && isRealAccount && <p className={styles.inlineHint}>Real-money quotes and orders are disabled. Switch to a Demo account to trade with virtual funds.</p>}
    {connected && account && !isDemo && !isRealAccount && <p className={styles.inlineHint}>This account type is not eligible for trading. Select a Demo account.</p>}
  </section>;
}
