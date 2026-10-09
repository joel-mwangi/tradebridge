"use client";

import { useEffect, useState } from "react";
import styles from "./TradingWorkspace.module.css";
import type { DemoQuote, DerivAccount, MarketInstrument } from "./types";

type Props = {
  connected: boolean;
  account: DerivAccount | null;
  realTradingEnabled: boolean;
  maxRealStake: number;
  maxDailyLoss: number;
  realizedProfit: number | null;
  market: MarketInstrument | null;
  sessionState: string;
  status: string;
  busy: boolean;
  quote: DemoQuote | null;
  requestQuote: (input: { symbol: string; contractType: "CALL" | "PUT"; stake: number; duration: number }) => void;
  confirmQuote: () => void;
};

export default function DemoTradeTicket({
  connected, account, realTradingEnabled, maxRealStake, maxDailyLoss, realizedProfit,
  market, sessionState, status, busy, quote, requestQuote, confirmQuote,
}: Props) {
  const [direction, setDirection] = useState<"CALL" | "PUT">("CALL");
  const [stake, setStake] = useState("1");
  const [duration, setDuration] = useState("60");
  const [now, setNow] = useState(Date.now());
  const accountType = (account?.account_type ?? "").toLowerCase();
  const isDemo = accountType === "demo";
  const isRealAccount = accountType === "real";
  const canTrade = connected && (isDemo || (isRealAccount && realTradingEnabled));
  const expectedSessionState = isRealAccount ? "Real trading connected" : "Demo trading connected";
  const dailyLossReached = isRealAccount && realizedProfit !== null && realizedProfit <= -maxDailyLoss;
  const ready = canTrade && sessionState === expectedSessionState && Boolean(market) && !dailyLossReached;
  const maxStake = isRealAccount ? maxRealStake : 1000;

  useEffect(() => {
    if (!quote) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [quote]);

  function submitQuote() {
    if (!ready || !market) return;
    const stakeValue = Number(stake);
    const durationValue = Number(duration);
    requestQuote({ symbol: market.symbol, contractType: direction, stake: stakeValue, duration: durationValue });
  }

  const quoteMatchesForm = Boolean(
    quote && quote.symbol === market?.symbol && quote.contractType === direction
    && quote.stake === Number(stake) && quote.duration === Number(duration),
  );
  const quoteSecondsRemaining = quote ? Math.max(0, Math.ceil((30_000 - (now - quote.receivedAt)) / 1000)) : 0;
  const quoteExpired = Boolean(quote && quoteSecondsRemaining <= 0);

  return <section className={styles.ticketPanel} id="ticket">
    <div className={styles.panelHeading}>
      <div>
        <p className={styles.eyebrow}>ORDER ENTRY</p>
        <h2>{isRealAccount ? "Real trade ticket" : "Demo trade ticket"}</h2>
        <p className={styles.panelSubtext}>Get a fresh Deriv quote first. Submit only after checking the terms.</p>
      </div>
      <span className={isRealAccount ? (realTradingEnabled ? styles.realLock : styles.realModeLocked) : styles.demoLock}>
        {isRealAccount ? (realTradingEnabled ? "REAL MONEY" : "LOCKED") : "DEMO ONLY"}
      </span>
    </div>

    {isRealAccount && <div className={styles.accountModeNotice} role="note">
      <strong>{realTradingEnabled ? "Real-money account" : "Live trading is locked"}</strong>
      <span>{realTradingEnabled
        ? "Every confirmed order uses real funds. You can lose the full stake. Review the quoted purchase price and potential payout before confirming."
        : "Use the Live Account Controls panel to acknowledge the risks and enable real-money order entry for this account."}</span>
    </div>}
    {dailyLossReached && <div className={styles.riskStopNotice} role="alert">
      <strong>Daily loss stop reached</strong>
      <span>Today's reported realized P/L is {realizedProfit} {account?.currency ?? ""}. TradeBridge is blocking new live entries at your configured stop of {maxDailyLoss} {account?.currency ?? ""}.</span>
    </div>}

    <div className={styles.tradeMarket}>
      <span className={styles.tradeMarketIcon}>{market?.market === "forex" ? "FX" : "↗"}</span>
      <div><strong>{market?.name ?? "Select a market"}</strong><small>{market?.symbol ?? "No active market selected"}</small></div>
    </div>

    <fieldset className={styles.directionField} disabled={!ready || busy}>
      <legend>Contract direction</legend>
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
      <input id="tradebridge-stake" type="number" inputMode="decimal" min="1" max={maxStake} step="1" value={stake} onChange={(event) => setStake(event.target.value)} aria-describedby="stake-note" disabled={!ready || busy} />
    </div>
    <div className={styles.presets} aria-label="Stake presets">
      {(isRealAccount ? [1, 2, 5, 10].filter((value) => value <= maxStake) : [1, 5, 10, 25]).map((value) => <button key={value} type="button" className={stake === String(value) ? styles.presetActive : styles.preset} onClick={() => setStake(String(value))} disabled={!ready || busy}>{value} {account?.currency ?? ""}</button>)}
    </div>
    <p className={styles.fieldHint} id="stake-note">{isRealAccount ? "Per-trade limit: " + maxStake + " " + (account?.currency ?? "") + ". The entire stake may be lost; never trade money you cannot afford to lose." : "Use virtual funds only. Deriv validates minimum stakes for the selected market and currency."}</p>

    <label className={styles.fieldLabel} htmlFor="tradebridge-duration">Contract duration</label>
    <div className={styles.inputShell}>
      <input id="tradebridge-duration" type="number" inputMode="numeric" min="1" max="86400" step="1" value={duration} onChange={(event) => setDuration(event.target.value)} aria-describedby="duration-note" disabled={!ready || busy} />
      <span>seconds</span>
    </div>
    <div className={styles.presets} aria-label="Duration presets">
      {[{ label: "1 min", value: "60" }, { label: "5 min", value: "300" }, { label: "10 min", value: "600" }].map((value) => <button key={value.value} type="button" className={duration === value.value ? styles.presetActive : styles.preset} onClick={() => setDuration(value.value)} disabled={!ready || busy}>{value.label}</button>)}
    </div>
    <p className={styles.fieldHint} id="duration-note">Duration is in seconds. Deriv returns the actual offered price and potential payout for the selected contract.</p>

    {quote && quoteMatchesForm && <div className={isRealAccount ? styles.liveQuoteCard : styles.quoteCard} role="status">
      <div className={styles.quoteCardHeader}><span>DERIV QUOTE</span><strong>{quoteExpired ? "Expired" : quoteSecondsRemaining + "s remaining"}</strong></div>
      <div className={styles.quoteMetrics}>
        <div><small>Stake</small><strong>{quote.stake.toLocaleString()} {quote.currency}</strong></div>
        <div><small>Purchase price</small><strong>{quote.askPrice.toLocaleString()} {quote.currency}</strong></div>
        <div><small>Potential payout</small><strong>{quote.payout === null ? "Not returned" : quote.payout.toLocaleString() + " " + quote.currency}</strong></div>
      </div>
      <p>{quote.contractType === "CALL" ? "Higher" : "Lower"} · {quote.symbol} · {quote.duration} seconds</p>
      <button type="button" className={isRealAccount ? styles.confirmLiveButton : styles.confirmButton} onClick={confirmQuote} disabled={!ready || busy || quoteExpired}>
        {isRealAccount ? "Confirm real-money trade" : "Confirm demo trade"} <span>→</span>
      </button>
      <small className={styles.quoteWarning}>{isRealAccount
        ? "This action sends a live order to Deriv and can immediately lose real money. Review the quoted stake and potential payout. Confirmation cannot guarantee a profit."
        : "Confirmation sends an order to your Deriv demo account and can change your virtual balance."}</small>
    </div>}

    <div className={styles.ticketStatus} role="status">
      <span className={sessionState === expectedSessionState ? styles.statusDotConnected : styles.statusDot} />
      <div><strong>{sessionState}</strong>{status && <p>{status}</p>}</div>
    </div>
    <button type="button" className={isRealAccount ? styles.getLiveQuoteButton : styles.getQuoteButton} onClick={submitQuote} disabled={!ready || busy || !market || Number(stake) < 1 || Number(stake) > maxStake || !Number.isFinite(Number(stake)) || !Number.isInteger(Number(duration)) || Number(duration) < 1 || Number(duration) > 86400}>
      {busy ? "Waiting for Deriv…" : quoteMatchesForm && !quoteExpired ? "Request a new quote" : isRealAccount ? "Get live quote" : "Get demo quote"}
    </button>
    {!connected && <p className={styles.inlineHint}>Connect Deriv above to activate trading.</p>}
    {connected && !account && <p className={styles.inlineHint}>Select an account before requesting a quote.</p>}
    {connected && isRealAccount && !realTradingEnabled && <p className={styles.inlineHint}>Live order entry is locked. Enable it in Live Account Controls after reviewing the risk disclosure.</p>}
    {connected && isRealAccount && realTradingEnabled && realizedProfit === null && <p className={styles.inlineHint}>Live entry waits until Deriv's daily realized P/L has loaded.</p>}
  </section>;
}
