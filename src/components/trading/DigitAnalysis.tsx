"use client";

import { useMemo } from "react";
import type { DigitContractMode, DigitPrediction, MarketInstrument, MarketSnapshot } from "./types";
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
  const below = digits.filter((p) => p.digit < target).length;
  const matches = counts[target];
  const differs = total - matches;
  const outcomeClass = (digit: number) => {
    if (mode === "over-under" || mode === "matches-differs") {
      if (digit === target) return styles.contractBarrier;
    }
    const qualifies = mode === "over-under"
      ? (prediction === "UNDER" ? digit < target : digit > target)
      : mode === "even-odd"
        ? (prediction === "EVEN" ? digit % 2 === 0 : digit % 2 !== 0)
        : (prediction === "MATCHES" ? digit === target : digit !== target);
    return qualifies ? styles.contractQualifies : styles.contractOther;
  };
  const outcomeLabel = (digit: number) => {
    if ((mode === "over-under" || mode === "matches-differs") && digit === target) return "barrier digit";
    const qualifies = mode === "over-under"
      ? (prediction === "UNDER" ? digit < target : digit > target)
      : mode === "even-odd"
        ? (prediction === "EVEN" ? digit % 2 === 0 : digit % 2 !== 0)
        : (prediction === "MATCHES" ? digit === target : digit !== target);
    return qualifies ? "qualifies for selected contract" : "does not qualify for selected contract";
  };
  const percent = (digit: number) => {
    const value = frequency?.percentages[String(digit)];
    return typeof value === "number" ? value.toFixed(1) + "%" : "—";
  };

  return <section className={styles.root} aria-label="Digit analysis">
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
          <div className={[styles.ring, cls, outcomeClass(d), d === latestDigit ? styles.latestDigitRing : ""].filter(Boolean).join(" ")} aria-label={`Digit ${d}, ${percent(d)} of observed ticks; ${outcomeLabel(d)}`}><strong className={styles.digitNumber}>{d}</strong><span className={styles.digitPercent}>{percent(d)}</span>{d === latestDigit && <span className={styles.star} aria-label="Latest incoming tick digit" title="Latest incoming tick">★</span>}</div>
          <span className={styles.count}>{frequency ? `${counts[d]} ticks` : "Waiting for backend"}</span>
          <span className={styles.rank}>{!total ? " " : r === 1 ? "Highest" : r === 2 ? "2nd high" : r === 9 ? "2nd low" : r === 10 ? "Lowest" : " "}</span>
        </div>;
      })}</div>
    </section>
    <div className={styles.lowerGrid}>
    </div>
  </section>;
}
