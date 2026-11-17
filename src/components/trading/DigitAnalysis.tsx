"use client";

import { useMemo } from "react";
import type { DigitContractMode, DigitPrediction, MarketInstrument, MarketSnapshot, MaziwaMarketResult } from "./types";
import styles from "./DigitAnalysis.module.css";

const DIGITS = Array.from({ length: 10 }, (_, i) => i);

export default function DigitAnalysis({
  snapshot,
  windowSize,
  onWindowSizeChange,
  mode,
  onModeChange,
  prediction,
  target,
  onTargetChange,
  maziwaResults,
  maziwaScanning,
  onScanMaziwaMarkets,
  onUseMaziwaRecommendation,
}: {
  market: MarketInstrument | null;
  snapshot?: MarketSnapshot;
  windowSize: number;
  onWindowSizeChange: (size: number) => void;
  mode: DigitContractMode;
  onModeChange: (mode: DigitContractMode) => void;
  prediction: DigitPrediction;
  onPredictionChange?: (prediction: DigitPrediction) => void;
  target: number;
  onTargetChange: (target: number) => void;
  maziwaResults: MaziwaMarketResult[];
  maziwaScanning: boolean;
  onScanMaziwaMarkets: () => boolean;
  onUseMaziwaRecommendation: (result: MaziwaMarketResult) => void;
}) {
  const validTargets = mode === "over-under"
    ? DIGITS.filter((digit) => prediction === "UNDER" ? digit >= 1 : digit <= 8)
    : DIGITS;
  const points = useMemo(() => (snapshot?.points ?? []).slice(-windowSize), [snapshot?.points, windowSize]);
  const digits = useMemo(() => points.flatMap((p) =>
    Number.isInteger(p.lastDigit) && p.lastDigit! >= 0 && p.lastDigit! <= 9
      ? [{ digit: p.lastDigit!, time: p.time }] : []
  ), [points]);
  // Frequency percentages/counts come only from the backend snapshot; never recalculate in the browser.
  const frequency = snapshot?.digitFrequency?.windows?.[String(windowSize)];
  const counts = DIGITS.map((d) => frequency?.counts[String(d)] ?? 0);
  const total = frequency?.sample_size ?? 0;
  const localTotal = digits.length;
  // Frequency rank and newest tick are independent signals.
  const latestDigit = digits.length ? digits[digits.length - 1].digit : null;
  const ranking = useMemo(() => [...DIGITS].sort((a, b) => counts[b] - counts[a] || a - b), [counts]);
  const rank = (d: number) => total ? ranking.indexOf(d) + 1 : 0;
  const even = digits.filter((p) => p.digit % 2 === 0).length;
  const odd = localTotal - even;
  const above = digits.filter((p) => p.digit > target).length;
  const matches = counts[target];
  const percent = (digit: number) => {
    const value = frequency?.percentages[String(digit)];
    return typeof value === "number" ? value.toFixed(1) + "%" : "—";
  };

  return <section className={styles.root} aria-label="Digit analysis">
    <section className={styles.panel} style={{ marginBottom: 12 }}>
      <div className={styles.panelTitle}>
        <div><h3>Maziwa market scan</h3><p>Compare 1,000-tick EVEN/ODD setups without starting execution.</p></div>
        <button type="button" onClick={onScanMaziwaMarkets} disabled={maziwaScanning} aria-label="Scan markets for the best Maziwa EVEN ODD setup">
          {maziwaScanning ? "Scanning…" : "Scan markets"}
        </button>
      </div>
      {maziwaResults.length > 0 ? maziwaResults.map((result) => (
        <div key={`${result.symbol}-${result.contract_type}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 0", borderTop: "1px solid var(--line)", flexWrap: "wrap" }}>
          <div><strong>{result.symbol} · {result.contract_type === "DIGITEVEN" ? "EVEN" : "ODD"}</strong><p style={{ margin: "3px 0 0", color: "var(--muted)", fontSize: 11 }}>{result.parity_power.toFixed(1)}% power · {result.status.replaceAll("_", " ")} · score {result.score.toFixed(0)}</p></div>
          <button type="button" onClick={() => onUseMaziwaRecommendation(result)}>Use {result.contract_type === "DIGITEVEN" ? "EVEN" : "ODD"}</button>
        </div>
      )) : <p style={{ color: "var(--muted)", fontSize: 11 }}>Scan to find the strongest market and recommended side.</p>}
    </section>
    <div className={styles.controls}>
      <label className={styles.control}><span>Contract type</span><select value={mode} onChange={(e) => onModeChange(e.target.value as DigitContractMode)}>
        <option value="over-under">Over / Under</option><option value="even-odd">Even / Odd</option><option value="matches-differs">Matches / Differs</option>
      </select></label>
      <label className={styles.control}><span>Tick window</span><select value={windowSize} onChange={(e) => onWindowSizeChange(Number(e.target.value))}>
        {[50,100,250,500,1000].map((n) => <option key={n} value={n}>{n.toLocaleString()} ticks</option>)}
      </select></label>
      {mode !== "even-odd" && <label className={styles.control}>
        <span>{mode === "over-under" ? "Barrier digit" : "Target digit"}</span>
        <select value={target} onChange={(e) => onTargetChange(Number(e.target.value))}>
          {validTargets.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </label>}
    </div>
    <section className={styles.panel}>
      <div className={styles.panelTitle}><div><h3>Digit frequency</h3><p>Backend-calculated final digits · {total} valid ticks in selected window</p></div></div>
      <div className={styles.frequencyGrid}>{DIGITS.map((d) => {
        const r = rank(d);
        const cls = r === 1 ? styles.top : r === 2 ? styles.second : r === 10 ? styles.low : r === 9 ? styles.secondLow : "";
        return <div className={styles.frequencyItem} key={d}>
          <div className={[styles.ring, cls, d === latestDigit ? styles.latestDigitRing : ""].filter(Boolean).join(" ")} aria-label={`Digit ${d}, ${percent(d)} of observed ticks`}><strong className={styles.digitNumber}>{d}</strong><span className={styles.digitPercent}>{percent(d)}</span>{d === latestDigit && <span className={styles.star} aria-label="Latest incoming tick digit" title="Latest incoming tick">★</span>}</div>
          <span className={styles.count}>{frequency ? `${counts[d]} ticks` : "Waiting for backend"}</span>
          <span className={styles.rank}>{!total ? " " : r === 1 ? "Highest" : r === 2 ? "2nd high" : r === 9 ? "2nd low" : r === 10 ? "Lowest" : " "}</span>
        </div>;
      })}</div>
    </section>
    <div className={styles.lowerGrid}>
    </div>
  </section>;
}
