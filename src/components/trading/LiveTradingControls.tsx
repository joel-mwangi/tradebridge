"use client";

import { useEffect, useState } from "react";
import styles from "./TradingWorkspace.module.css";
import type { DerivAccount } from "./types";

type Props = {
  account: DerivAccount;
  enabled: boolean;
  loading: boolean;
  busy: boolean;
  maxStake: number;
  maxDailyLoss: number;
  message: string;
  onEnable: (maxStake: number, maxDailyLoss: number) => void;
  onDisable: () => void;
};

export default function LiveTradingControls({
  account, enabled, loading, busy, maxStake: initialMaxStake, maxDailyLoss: initialMaxDailyLoss,
  message, onEnable, onDisable,
}: Props) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [maxStake, setMaxStake] = useState(String(initialMaxStake));
  const [maxDailyLoss, setMaxDailyLoss] = useState(String(initialMaxDailyLoss));

  useEffect(() => {
    setAcknowledged(false);
    setMaxStake(String(initialMaxStake));
    setMaxDailyLoss(String(initialMaxDailyLoss));
  }, [account.account_id, initialMaxStake, initialMaxDailyLoss, enabled]);

  const stakeLimit = Number(maxStake);
  const lossLimit = Number(maxDailyLoss);
  const limitsValid = Number.isFinite(stakeLimit) && stakeLimit >= 1 && stakeLimit <= 10000
    && Number.isFinite(lossLimit) && lossLimit >= 1 && lossLimit <= 100000;

  return <section className={styles.liveControls} aria-labelledby="live-trading-heading">
    <div className={styles.liveControlsHeader}>
      <div>
        <p className={styles.eyebrow}>LIVE ACCOUNT CONTROLS</p>
        <h2 id="live-trading-heading">Real-money trading</h2>
        <p className={styles.panelSubtext}>Account {account.account_id} · {account.currency ?? "account currency"}</p>
      </div>
      <span className={enabled ? styles.realModeEnabled : styles.realModeLocked}>{enabled ? "LIVE ENABLED" : "LOCKED"}</span>
    </div>

    {enabled ? <div className={styles.liveEnabledMessage} role="status">
      <strong>Live order entry is enabled for this account.</strong>
      <p>Your configured TradeBridge entry cap is {stakeLimit.toLocaleString()} {account.currency ?? ""} per trade; the app also blocks new entries if today's reported realized P/L reaches the {lossLimit.toLocaleString()} {account.currency ?? ""} loss stop. These are app-level guardrails, not broker-enforced account limits.</p>
      <button type="button" className={styles.secondaryButton} onClick={onDisable} disabled={busy || loading}>{busy ? "Updating…" : "Disable live trading"}</button>
    </div> : <>
      <div className={styles.riskFields}>
        <label className={styles.fieldLabel} htmlFor="live-max-stake">Maximum stake per trade</label>
        <div className={styles.inputShell}>
          <span>{account.currency ?? "—"}</span>
          <input id="live-max-stake" type="number" min="1" max="10000" step="1" value={maxStake} onChange={(event) => setMaxStake(event.target.value)} disabled={busy || loading} />
        </div>
        <p className={styles.fieldHint}>Default: 10. TradeBridge rejects larger stakes in its live order ticket.</p>

        <label className={styles.fieldLabel} htmlFor="live-daily-loss">Daily loss stop</label>
        <div className={styles.inputShell}>
          <span>{account.currency ?? "—"}</span>
          <input id="live-daily-loss" type="number" min="1" max="100000" step="1" value={maxDailyLoss} onChange={(event) => setMaxDailyLoss(event.target.value)} disabled={busy || loading} />
        </div>
        <p className={styles.fieldHint}>Default: 25. New live entries are blocked at this realized daily loss in TradeBridge. It is not a broker-side stop.</p>
      </div>

      <label className={styles.riskAcknowledgement}>
        <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={busy || loading} />
        <span>I understand this account uses real money. I may lose the entire stake, prices and payouts can change, and selling early may return less than I paid.</span>
      </label>
      <button type="button" className={styles.enableLiveButton} onClick={() => onEnable(stakeLimit, lossLimit)} disabled={!acknowledged || !limitsValid || busy || loading}>
        {busy ? "Saving live-trading consent…" : "Acknowledge risk and enable live trading"}
      </button>
    </>}

    {message && <p className={styles.liveControlMessage} role="status">{message}</p>}
    <p className={styles.liveControlDisclaimer}>Enabling this switch does not place an order. Every entry still requires a fresh Deriv quote and a separate order confirmation. You can disable live trading here at any time.</p>
  </section>;
}
