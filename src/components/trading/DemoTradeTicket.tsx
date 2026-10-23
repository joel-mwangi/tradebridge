"use client";

import { useEffect, useState } from "react";
import styles from "./TradingWorkspace.module.css";
import type { DemoQuote, DerivAccount, DigitContractMode, DigitContractType, DigitPrediction, MarketInstrument, MarketSnapshot } from "./types";

const PREDICTIONS: Record<DigitContractMode, Array<{ label: string; value: DigitPrediction }>> = {
  "over-under": [{ label: "Over", value: "OVER" }, { label: "Under", value: "UNDER" }],
  "even-odd": [{ label: "Even", value: "EVEN" }, { label: "Odd", value: "ODD" }],
  "matches-differs": [{ label: "Matches", value: "MATCHES" }, { label: "Differs", value: "DIFFERS" }],
};

function getContractType(mode: DigitContractMode, prediction: DigitPrediction): DigitContractType {
  if (mode === "over-under") return prediction === "UNDER" ? "DIGITUNDER" : "DIGITOVER";
  if (mode === "even-odd") return prediction === "ODD" ? "DIGITODD" : "DIGITEVEN";
  return prediction === "DIFFERS" ? "DIGITDIFF" : "DIGITMATCH";
}

function getContractLabel(contractType: DigitContractType, barrier?: string) {
  switch (contractType) {
    case "DIGITOVER": return `Over ${barrier}`;
    case "DIGITUNDER": return `Under ${barrier}`;
    case "DIGITEVEN": return "Even";
    case "DIGITODD": return "Odd";
    case "DIGITMATCH": return `Matches ${barrier}`;
    case "DIGITDIFF": return `Differs from ${barrier}`;
  }
}

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
  snapshot?: MarketSnapshot;
  windowSize: number;
  mode: DigitContractMode;
  prediction: DigitPrediction;
  onPredictionChange: (prediction: DigitPrediction) => void;
  target: number;
  sessionState: string;
  status: string;
  busy: boolean;
  quote: DemoQuote | null;
  requestQuote: (input: { symbol: string; contractType: DigitContractType; stake: number; duration: number; durationUnit: "t"; barrier?: string }) => void;
  confirmQuote: () => void;
  dismissQuote: () => void;
};

export default function DemoTradeTicket({
  connected, account, realTradingEnabled, maxRealStake, maxDailyLoss, realizedProfit,
  orderResolutionRequired, acknowledgeOrderResolution,
  market, snapshot, windowSize, mode, prediction, onPredictionChange, target, sessionState, status, busy, quote, requestQuote, confirmQuote, dismissQuote,
}: Props) {
  const [stake, setStake] = useState("1");
  const [duration, setDuration] = useState("5");
  const [now, setNow] = useState(Date.now());
  const accountType = (account?.account_type ?? "").toLowerCase();
  const isDemo = accountType === "demo";
  const isRealAccount = accountType === "real";
  const canTrade = connected && (isDemo || (isRealAccount && realTradingEnabled));
  const expectedSessionState = isRealAccount ? "Real trading connected" : "Demo trading connected";
  const visibleStatus = status
    && status !== "Connected to your selected Deriv demo account. Quotes and balances come from Deriv."
    && status !== "Connected to your selected real Deriv account. Live orders use real funds; review every order carefully."
    ? status
    : "";
  const dailyLossReached = isRealAccount && realizedProfit !== null && realizedProfit <= -maxDailyLoss;
  const ready = canTrade && sessionState === expectedSessionState && Boolean(market) && !dailyLossReached && !orderResolutionRequired;
  const maxStake = isRealAccount ? maxRealStake : 1000;
  const predictionOptions = PREDICTIONS[mode];
  const activePrediction = predictionOptions.some((option) => option.value === prediction)
    ? prediction
    : predictionOptions[0].value;
  const contractType = getContractType(mode, activePrediction);
  const requiresTarget = mode !== "even-odd";
  const recentFrequency = snapshot?.digitFrequency?.windows?.["100"];
  const observedDigits = (snapshot?.points ?? []).slice(-windowSize).map((point) => point.lastDigit).filter((digit): digit is number => Number.isInteger(digit) && digit! >= 0 && digit! <= 9);
  // Keep the prediction summaries based on the observed digit stream, but all per-digit frequency percentages use backend values.
  const aboveCount = observedDigits.filter((digit) => digit > target).length;
  const belowCount = observedDigits.filter((digit) => digit < target).length;
  const percent = (count: number) => observedDigits.length ? (count / observedDigits.length * 100).toFixed(1) + "%" : "—";
  const digitFrequencyCounts = Array.from({ length: 10 }, (_, digit) => recentFrequency?.counts[String(digit)] ?? 0);
  const digitOutcomeClass = (digit: number) => {
    if ((mode === "over-under" || mode === "matches-differs") && digit === target) return styles.ticketDigitBarrier;
    const qualifies = mode === "over-under"
      ? (activePrediction === "UNDER" ? digit < target : digit > target)
      : mode === "even-odd"
        ? (activePrediction === "EVEN" ? digit % 2 === 0 : digit % 2 !== 0)
        : (activePrediction === "MATCHES" ? digit === target : digit !== target);
    return qualifies ? styles.ticketDigitQualifies : styles.ticketDigitOther;
  };
  const digitOutcomeLabel = (digit: number) => {
    if ((mode === "over-under" || mode === "matches-differs") && digit === target) return "barrier digit";
    const qualifies = mode === "over-under"
      ? (activePrediction === "UNDER" ? digit < target : digit > target)
      : mode === "even-odd"
        ? (activePrediction === "EVEN" ? digit % 2 === 0 : digit % 2 !== 0)
        : (activePrediction === "MATCHES" ? digit === target : digit !== target);
    return qualifies ? "qualifies for selected contract" : "does not qualify for selected contract";
  };
  const digitFrequencyPercent = (digit: number) => {
    const value = recentFrequency?.percentages[String(digit)];
    return typeof value === "number" ? value.toFixed(1) + "%" : "—";
  };

  useEffect(() => {
    setDuration("5");
  }, [mode]);

  useEffect(() => {
    if (!quote) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [quote]);

  function submitQuote() {
    if (!ready || !market) return;
    const stakeValue = Number(stake);
    const durationValue = Number(duration);
    requestQuote({ symbol: market.symbol, contractType, stake: stakeValue, duration: durationValue, durationUnit: "t", ...(requiresTarget ? { barrier: String(target) } : {}) });
  }

  const quoteMatchesForm = Boolean(
    quote && quote.symbol === market?.symbol
    && quote.contractType === contractType
    && quote.stake === Number(stake) && quote.duration === Number(duration)
    && quote.durationUnit === "t"
    && quote.barrier === (requiresTarget ? String(target) : undefined),
  );
  const quoteSecondsRemaining = quote ? Math.max(0, Math.ceil((30_000 - (now - quote.receivedAt)) / 1000)) : 0;
  const quoteExpired = Boolean(quote && quoteSecondsRemaining <= 0);

  // One-click Buy: submit a fresh quote automatically after the quote response
  // has cleared the request's busy state. confirmQuote keeps the existing
  // account, expiry, risk, and unresolved-order guards.
  useEffect(() => {
    if (!quote || !quoteMatchesForm || busy) return;
    if (quoteExpired) {
      dismissQuote();
      return;
    }
    confirmQuote();
  }, [quote, quoteMatchesForm, busy, quoteExpired, confirmQuote, dismissQuote]);

  return <section className={styles.ticketPanel + " " + styles.ticketPanelCompact} id="ticket">
    <div className={styles.panelHeading}>
      <div>
        <h2>{isRealAccount ? "Real account · read-only" : "Buy"}</h2>
      </div>
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
      <span>Today&apos;s reported realized P/L is {realizedProfit} {account?.currency ?? ""}. TradeBridge is blocking new live entries at your configured stop of {maxDailyLoss} {account?.currency ?? ""}.</span>
    </div>}

     <fieldset className={styles.directionField + (mode === "over-under" ? " " + styles.overUnderDirectionField : "")} disabled={!ready || busy}>
      <legend>{mode === "over-under" ? "Over / Under prediction" : mode === "even-odd" ? "Even / Odd prediction" : "Matches / Differs prediction"}</legend>
      <div className={styles.directionChoices}>
        {predictionOptions.map((option, index) => {
          const selected = activePrediction === option.value;
          const affirmative = index === 0;
          return <button
            key={option.value}
            type="button"
            className={selected ? (affirmative ? styles.callSelected : styles.putSelected) : (affirmative ? styles.callButton : styles.putButton)}
            onClick={() => onPredictionChange(option.value)}
            aria-pressed={selected}
          >
            <span className={mode === "over-under" ? styles.predictionOptionLabel : undefined}>{option.label}</span>
            {mode === "over-under" && <strong className={styles.predictionPercentage}>{percent(option.value === "OVER" ? aboveCount : belowCount)}</strong>}
          </button>;
        })}
      </div>
    </fieldset>
    {mode === "over-under" && <p className={styles.compactControlsHint}>Barrier digit: <strong>{target}</strong>. Over wins above the barrier; Under wins below it. An equal digit satisfies neither prediction.</p>}

    {mode === "over-under" && <section className={styles.ticketDigitFrequency} aria-label="Digit frequency">
      <div className={styles.ticketDigitFrequencyHeading}>
        <strong>Digit frequency</strong>
        <span>{recentFrequency ? `${recentFrequency.sample_size} recent ticks` : "Waiting for backend"}</span>
      </div>
      <div className={styles.ticketDigitFrequencyGrid}>
        {digitFrequencyCounts.map((_count, digit) => <div className={styles.ticketDigitFrequencyItem} key={digit} aria-label={`Digit ${digit}: ${digitFrequencyPercent(digit)}`}>
          <span className={styles.ticketDigitCircle}>{digit}</span>
          <span className={styles.ticketDigitPercent}>{digitFrequencyPercent(digit)}</span>
        </div>)}
      </div>
    </section>}

    {mode === "matches-differs" && <p className={styles.compactControlsHint}>Target digit: <strong>{target}</strong>. Matches wins on that digit; Differs wins on any other digit.</p>}
    <div className={styles.compactInputsGrid}>
      <div className={styles.compactFieldGroup}>
        <label className={styles.fieldLabel} htmlFor="tradebridge-stake">Stake</label>
        <div className={styles.inputShell}>
          <span>{account?.currency ?? "—"}</span>
          <input id="tradebridge-stake" type="number" inputMode="decimal" min="1" max={maxStake} step="1" value={stake} onChange={(event) => setStake(event.target.value)} disabled={!ready || busy} />
        </div>
        <div className={styles.presets + " " + styles.compactPresets} aria-label="Stake presets">
          {(isRealAccount ? [1, 2, 5, 10].filter((value) => value <= maxStake) : [1, 5, 10, 25]).map((value) => <button key={value} type="button" className={stake === String(value) ? styles.presetActive : styles.preset} onClick={() => setStake(String(value))} disabled={!ready || busy}>{value}</button>)}
        </div>
      </div>
      <div className={styles.compactFieldGroup}>
        <label className={styles.fieldLabel} htmlFor="tradebridge-duration">Duration</label>
        <div className={styles.inputShell}>
          <input id="tradebridge-duration" type="number" inputMode="numeric" min="1" max={10} step="1" value={duration} onChange={(event) => setDuration(event.target.value)} disabled={!ready || busy} />
          <span>ticks</span>
        </div>
        <div className={styles.presets + " " + styles.compactPresets + " " + styles.durationPresets} aria-label="Duration presets">
          {[{ label: "1 tick", value: "1" }, { label: "5 ticks", value: "5" }, { label: "10 ticks", value: "10" }].map((value) => <button key={value.value} type="button" className={duration === value.value ? styles.presetActive : styles.preset} onClick={() => setDuration(value.value)} disabled={!ready || busy}>{value.label}</button>)}
        </div>
      </div>
    </div>
    {visibleStatus && <p className={styles.inlineHint} role="status">{visibleStatus}</p>}
    <button type="button" className={styles.buyButton + " " + styles["buyButton" + (activePrediction === "OVER" ? "Over" : activePrediction === "UNDER" ? "Under" : activePrediction === "EVEN" ? "Even" : activePrediction === "ODD" ? "Odd" : activePrediction === "MATCHES" ? "Matches" : "Differs")]} onClick={submitQuote} disabled={!ready || busy || !market || Number(stake) < 1 || Number(stake) > maxStake || !Number.isFinite(Number(stake)) || !Number.isInteger(Number(duration)) || Number(duration) < 1 || Number(duration) > 10} aria-label={"Buy " + getContractLabel(contractType, requiresTarget ? String(target) : undefined)}>
      {busy ? "Processing…" : "Buy"}
    </button>
    {!connected && <p className={styles.inlineHint}>Connect Deriv to enable Buy.</p>}
    {connected && !account && <p className={styles.inlineHint}>Select an account to continue.</p>}
    {connected && isRealAccount && realTradingEnabled && realizedProfit === null && <p className={styles.inlineHint}>Waiting for verified daily P/L before enabling live orders.</p>}
  </section>;
}
