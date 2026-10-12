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
  orderResolutionRequired: boolean;
  acknowledgeOrderResolution: () => void;
  market: MarketInstrument | null;
  sessionState: string;
  status: string;
  busy: boolean;
  quote: DemoQuote | null;
  requestQuote: (input: { symbol: string; contractType: "CALL" | "PUT" | "DIGITOVER" | "DIGITUNDER"; stake: number; duration: number; durationUnit: "s" | "t"; barrier?: string }) => void;
  confirmQuote: () => void;
};

export default function DemoTradeTicket({
  connected, account, realTradingEnabled, maxRealStake, maxDailyLoss, realizedProfit,
  orderResolutionRequired, acknowledgeOrderResolution,
  market, sessionState, status, busy, quote, requestQuote, confirmQuote,
}: Props) {
  const [contractMode, setContractMode] = useState<"directional" | "digit">("directional");
  const [direction, setDirection] = useState<"CALL" | "PUT">("CALL");
  const [digitDirection, setDigitDirection] = useState<"DIGITOVER" | "DIGITUNDER">("DIGITOVER");
  const [barrier, setBarrier] = useState("5");
  const [stake, setStake] = useState("1");
  const [duration, setDuration] = useState("60");
  const [takeProfit, setTakeProfit] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [now, setNow] = useState(Date.now());
  const accountType = (account?.account_type ?? "").toLowerCase();
  const isDemo = accountType === "demo";
  const isRealAccount = accountType === "real";
  const canTrade = connected && (isDemo || (isRealAccount && realTradingEnabled));
  const expectedSessionState = isRealAccount ? "Real trading connected" : "Demo trading connected";
  const dailyLossReached = isRealAccount && realizedProfit !== null && realizedProfit <= -maxDailyLoss;
  const ready = canTrade && sessionState === expectedSessionState && Boolean(market) && !dailyLossReached && !orderResolutionRequired;
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
    requestQuote({ symbol: market.symbol, contractType: contractMode === "digit" ? digitDirection : direction, stake: stakeValue, duration: durationValue, durationUnit: contractMode === "digit" ? "t" : "s", ...(contractMode === "digit" ? { barrier } : {}) });
  }

  const quoteMatchesForm = Boolean(
    quote && quote.symbol === market?.symbol
    && quote.contractType === (contractMode === "digit" ? digitDirection : direction)
    && quote.stake === Number(stake) && quote.duration === Number(duration)
    && quote.durationUnit === (contractMode === "digit" ? "t" : "s")
    && (contractMode !== "digit" || quote.barrier === barrier),
  );
  const quoteSecondsRemaining = quote ? Math.max(0, Math.ceil((30_000 - (now - quote.receivedAt)) / 1000)) : 0;
  const quoteExpired = Boolean(quote && quoteSecondsRemaining <= 0);

  return <section className={styles.ticketPanel + " " + styles.ticketPanelCompact} id="ticket">
    <div className={styles.panelHeading}>
      <div>
        <p className={styles.eyebrow}>ORDER ENTRY</p>
        <h2>{isRealAccount ? "Real account · read-only" : "Demo trade ticket"}</h2>
      </div>
      <span className={isRealAccount ? (realTradingEnabled ? styles.realLock : styles.realModeLocked) : styles.demoLock}>
        {isRealAccount ? (realTradingEnabled ? "REAL MONEY" : "LOCKED") : "DEMO ONLY"}
      </span>
    </div>

    {isRealAccount && <div className={styles.accountModeNotice} role="note">
      <strong>{realTradingEnabled ? "Real-money account" : "Live trading is locked"}</strong>
      <span>{realTradingEnabled
        ? "Real-money order entry is disabled until server-side risk controls are available. Use a Demo account to place trades."
        : "This linked Real account is read-only in TradeBridge. Select a Demo account to place trades."}</span>
    </div>}
    {orderResolutionRequired && <div className={styles.riskStopNotice} role="alert">
      <strong>Previous order outcome unknown — entry paused</strong>
      <span>The previous order status is unconfirmed. Reconcile recent transactions and open contracts on your account before retrying.</span>
      <button type="button" className={styles.secondaryButton} onClick={acknowledgeOrderResolution}>I checked account activity</button>
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
      <legend>Contract type</legend>
      <div className={styles.directionChoices}>
        <button type="button" className={contractMode === "directional" ? styles.callSelected : styles.callButton} onClick={() => { setContractMode("directional"); setDuration("60"); }} aria-pressed={contractMode === "directional"}>
          <span>↗</span><span><strong>Higher / Lower</strong></span>
        </button>
        <button type="button" className={contractMode === "digit" ? styles.putSelected : styles.putButton} onClick={() => { setContractMode("digit"); setDuration("5"); }} aria-pressed={contractMode === "digit"}>
          <span>0–9</span><span><strong>Digit Over / Under</strong></span>
        </button>
      </div>
    </fieldset>
    {contractMode === "directional" ? (
      <fieldset className={styles.directionField} disabled={!ready || busy}>
        <legend>Price direction</legend>
        <div className={styles.directionChoices}>
          <button type="button" className={direction === "CALL" ? styles.callSelected : styles.callButton} onClick={() => setDirection("CALL")} aria-pressed={direction === "CALL"}>
            <span>↗</span><span><strong>Higher</strong></span>
          </button>
          <button type="button" className={direction === "PUT" ? styles.putSelected : styles.putButton} onClick={() => setDirection("PUT")} aria-pressed={direction === "PUT"}>
            <span>↘</span><span><strong>Lower</strong></span>
          </button>
        </div>
      </fieldset>
    ) : (
      <fieldset className={styles.directionField} disabled={!ready || busy}>
        <legend>Last digit prediction</legend>
        <div className={styles.directionChoices}>
          <button type="button" className={digitDirection === "DIGITOVER" ? styles.callSelected : styles.callButton} onClick={() => setDigitDirection("DIGITOVER")} aria-pressed={digitDirection === "DIGITOVER"}>
            <span>↑</span><span><strong>Over</strong></span>
          </button>
          <button type="button" className={digitDirection === "DIGITUNDER" ? styles.putSelected : styles.putButton} onClick={() => setDigitDirection("DIGITUNDER")} aria-pressed={digitDirection === "DIGITUNDER"}>
            <span>↓</span><span><strong>Under</strong></span>
          </button>
        </div>
        <div className={styles.compactFieldGroup}>
          <label className={styles.fieldLabel} htmlFor="tradebridge-digit-barrier">Barrier digit (0–9)</label>
          <select id="tradebridge-digit-barrier" value={barrier} onChange={(event) => setBarrier(event.target.value)} disabled={!ready || busy}>
            {Array.from({ length: 10 }, (_, digit) => <option key={digit} value={String(digit)}>{digit}</option>)}
          </select>
          <p className={styles.compactControlsHint}>Over wins when the last digit is greater than the barrier; Under wins when it is lower. Equal digits do not satisfy either prediction.</p>
        </div>
      </fieldset>
    )}

    <div className={styles.compactInputsGrid}>
      <div className={styles.compactFieldGroup}>
        <label className={styles.fieldLabel} htmlFor="tradebridge-stake">Stake</label>
        <div className={styles.inputShell}>
          <span>{account?.currency ?? "—"}</span>
          <input id="tradebridge-stake" type="number" inputMode="decimal" min="1" max={maxStake} step="1" value={stake} onChange={(event) => setStake(event.target.value)} aria-describedby="ticket-inputs-note" disabled={!ready || busy} />
        </div>
        <div className={styles.presets + " " + styles.compactPresets} aria-label="Stake presets">
          {(isRealAccount ? [1, 2, 5, 10].filter((value) => value <= maxStake) : [1, 5, 10, 25]).map((value) => <button key={value} type="button" className={stake === String(value) ? styles.presetActive : styles.preset} onClick={() => setStake(String(value))} disabled={!ready || busy}>{value}</button>)}
        </div>
      </div>
      <div className={styles.compactFieldGroup}>
        <label className={styles.fieldLabel} htmlFor="tradebridge-duration">Duration</label>
        <div className={styles.inputShell}>
          <input id="tradebridge-duration" type="number" inputMode="numeric" min="1" max={contractMode === "digit" ? 10 : 86400} step="1" value={duration} onChange={(event) => setDuration(event.target.value)} aria-describedby="ticket-inputs-note" disabled={!ready || busy} />
          <span>{contractMode === "digit" ? "ticks" : "sec"}</span>
        </div>
        <div className={styles.presets + " " + styles.compactPresets + " " + styles.durationPresets} aria-label="Duration presets">
          {(contractMode === "digit" ? [{ label: "1 tick", value: "1" }, { label: "5 ticks", value: "5" }, { label: "10 ticks", value: "10" }] : [{ label: "1m", value: "60" }, { label: "5m", value: "300" }, { label: "10m", value: "600" }]).map((value) => <button key={value.value} type="button" className={duration === value.value ? styles.presetActive : styles.preset} onClick={() => setDuration(value.value)} disabled={!ready || busy}>{value.label}</button>)}
        </div>
      </div>
    </div>
    <p className={styles.compactControlsHint} id="ticket-inputs-note">{isRealAccount ? "Read-only: real-money order entry is disabled." : "Demo funds only · quotes expire after 30 seconds."}</p>

    <details className={styles.advancedRisk}>
      <summary>Advanced risk settings <span>Optional</span></summary>
      <p className={styles.compactRiskNote}>These thresholds are for reference only; they are not sent to Deriv or automatically enforced by the current order flow.</p>
      <div className={styles.compactRiskFields}>
        <div>
          <label className={styles.fieldLabel} htmlFor="tradebridge-tp">Take Profit</label>
          <div className={styles.inputShell}>
            <input id="tradebridge-tp" type="number" placeholder="Target P/L" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} disabled={!ready || busy} />
          </div>
        </div>
        <div>
          <label className={styles.fieldLabel} htmlFor="tradebridge-sl">Stop Loss</label>
          <div className={styles.inputShell}>
            <input id="tradebridge-sl" type="number" placeholder="Max loss" value={stopLoss} onChange={e => setStopLoss(e.target.value)} disabled={!ready || busy} />
          </div>
        </div>
      </div>
    </details>

    {quote && quoteMatchesForm && <div className={isRealAccount ? styles.liveQuoteCard : styles.quoteCard} role="status">
      <div className={styles.quoteCardHeader}><span>LIVE QUOTE</span><strong>{quoteExpired ? "Expired" : quoteSecondsRemaining + "s remaining"}</strong></div>
      <div className={styles.quoteMetrics}>
        <div><small>Stake</small><strong>{quote.stake.toLocaleString()} {quote.currency}</strong></div>
        <div><small>Purchase price</small><strong>{quote.askPrice.toLocaleString()} {quote.currency}</strong></div>
        <div><small>Potential payout</small><strong>{quote.payout === null ? "Not returned" : quote.payout.toLocaleString() + " " + quote.currency}</strong></div>
      </div>
      <p>{quote.contractType === "CALL" ? "Higher" : quote.contractType === "PUT" ? "Lower" : quote.contractType === "DIGITOVER" ? `Digit Over ${quote.barrier}` : `Digit Under ${quote.barrier}`} · {quote.symbol} · {quote.duration} {quote.durationUnit === "t" ? "ticks" : "seconds"}</p>
      <button type="button" className={isRealAccount ? styles.confirmLiveButton : styles.confirmButton} onClick={confirmQuote} disabled={!ready || busy || quoteExpired}>
        {isRealAccount ? "Confirm real-money trade" : "Confirm demo trade"} <span>→</span>
      </button>
      <small className={styles.quoteWarning}>{isRealAccount
        ? "This action sends a live order and can immediately lose real money. Review the quoted stake and potential payout. Confirmation cannot guarantee a profit."
        : "Confirmation sends an order to your demo account and updates your virtual balance."}</small>
    </div>}

    <div className={styles.ticketStatus} role="status">
      <span className={sessionState === expectedSessionState ? styles.statusDotConnected : styles.statusDot} />
      <div><strong>{sessionState}</strong>{status && <p>{status}</p>}</div>
    </div>
    <button type="button" className={isRealAccount ? styles.getLiveQuoteButton : styles.getQuoteButton} onClick={submitQuote} disabled={!ready || busy || !market || Number(stake) < 1 || Number(stake) > maxStake || !Number.isFinite(Number(stake)) || !Number.isInteger(Number(duration)) || Number(duration) < 1 || Number(duration) > (contractMode === "digit" ? 10 : 86400)}>
      {busy ? "Waiting for Deriv…" : quoteMatchesForm && !quoteExpired ? "Request a new quote" : isRealAccount ? "Get live quote" : "Get demo quote"}
    </button>
    {!connected && <p className={styles.inlineHint}>Connect Deriv above to activate trading.</p>}
    {connected && !account && <p className={styles.inlineHint}>Select an account before requesting a quote.</p>}
    {connected && isRealAccount && !realTradingEnabled && <p className={styles.inlineHint}>Real account order entry is read-only and disabled until server-side risk controls are available. Select a Demo account to place trades.</p>}
    {connected && isRealAccount && realTradingEnabled && realizedProfit === null && <p className={styles.inlineHint}>Live entry waits until Deriv's daily realized P/L has loaded.</p>}
  </section>;
}
