"use client";

import { useMemo, useState } from "react";
import type { DigitContractMode, DigitPrediction, MarketInstrument, MarketSnapshot } from "./types";
import styles from "./DigitAnalysis.module.css";

const DIGITS = Array.from({ length: 10 }, (_, i) => i);

export default function DigitAnalysis({
  snapshot,
  mode,
  onModeChange,
  prediction,
  target,
  onTargetChange,
}: {
  snapshot?: MarketSnapshot;
  mode: DigitContractMode;
  onModeChange: (mode: DigitContractMode) => void;
  prediction: DigitPrediction;
  target: number;
  onTargetChange: (target: number) => void;
}) {
  const [windowSize, setWindowSize] = useState(100);
  const validTargets = mode === "over-under"
    ? DIGITS.filter((digit) => prediction === "UNDER" ? digit >= 1 : digit <= 8)
    : DIGITS;
  const points = useMemo(() => (snapshot?.points ?? []).slice(-windowSize), [snapshot?.points, windowSize]);
  const digits = useMemo(() => points.flatMap((p) =>
    Number.isInteger(p.lastDigit) && p.lastDigit! >= 0 && p.lastDigit! <= 9
      ? [{ digit: p.lastDigit!, time: p.time }] : []
  ), [points]);
  const counts = useMemo(() => DIGITS.map((d) => digits.filter((p) => p.digit === d).length), [digits]);
  const total = digits.length;
  // Frequency rank and newest tick are independent signals.
  const latestDigit = digits.length ? digits[digits.length - 1].digit : null;
  const ranking = useMemo(() => [...DIGITS].sort((a, b) => counts[b] - counts[a] || a - b), [counts]);
  const rank = (d: number) => ranking.indexOf(d) + 1;
  const even = digits.filter((p) => p.digit % 2 === 0).length;
  const odd = total - even;
  const above = digits.filter((p) => p.digit > target).length;
  const below = digits.filter((p) => p.digit < target).length;
  const matches = counts[target];
  const differs = total - matches;
  const percent = (n: number) => total ? (n / total * 100).toFixed(1) + "%" : "—";

  return <section className={styles.root} aria-label="Digit analysis">
    <div className={styles.controls}>
      <label className={styles.control}><span>Contract type</span><select value={mode} onChange={(e) => onModeChange(e.target.value as DigitContractMode)}>
        <option value="over-under">Over / Under</option><option value="even-odd">Even / Odd</option><option value="matches-differs">Matches / Differs</option>
      </select></label>
      <label className={styles.control}><span>Tick window</span><select value={windowSize} onChange={(e) => setWindowSize(Number(e.target.value))}>
        {[50,100,250,500,1000].map((n) => <option key={n} value={n}>{n.toLocaleString()} ticks</option>)}
      </select></label>
      {mode !== "even-odd" && <label className={styles.control}>
        <span>{mode === "over-under" ? "Barrier digit" : "Target digit"}</span>
        <select value={target} onChange={(e) => onTargetChange(Number(e.target.value))}>
          {validTargets.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </label>}
    </div>
    <div className={styles.modeSummary}>
      {mode === "over-under" ? <>
        <div><span>Above {target}</span><strong>{percent(above)}</strong><small>{above} observed ticks</small></div>
        <div><span>Below {target}</span><strong>{percent(below)}</strong><small>{below} observed ticks</small></div>
        <p>Digits equal to the barrier are excluded from both groups.</p>
      </> : mode === "even-odd" ? <>
        <div><span>Even digits</span><strong>{percent(even)}</strong><small>{even} observed ticks</small></div>
        <div><span>Odd digits</span><strong>{percent(odd)}</strong><small>{odd} observed ticks</small></div>
        <p>Even/odd distribution for the selected window.</p>
      </> : <>
        <div><span>Matches {target}</span><strong>{percent(matches)}</strong><small>{matches} matches</small></div>
        <div><span>Differs from {target}</span><strong>{percent(differs)}</strong><small>{differs} other digits</small></div>
        <p>Historical match rate does not predict the next tick.</p>
      </>}
    </div>
    <section className={styles.panel}>
      <div className={styles.panelTitle}><div><h3>Digit frequency</h3><p>Final digits · {total} valid ticks in selected window</p></div></div>
      <div className={styles.frequencyGrid}>{DIGITS.map((d) => {
        const r = rank(d);
        const cls = r === 1 ? styles.top : r === 2 ? styles.second : r === 10 ? styles.low : r === 9 ? styles.secondLow : "";
        return <div className={styles.frequencyItem} key={d}>
          <div className={[styles.ring, cls, d === latestDigit ? styles.latestDigitRing : ""].filter(Boolean).join(" ")} aria-label={`Digit ${d}, ${percent(counts[d])} of observed ticks`}><strong className={styles.digitNumber}>{d}</strong><span className={styles.digitPercent}>{percent(counts[d])}</span>{d === latestDigit && <span className={styles.star} aria-label="Latest incoming tick digit" title="Latest incoming tick">★</span>}</div>
          <span className={styles.count}>{counts[d]} ticks</span>
          <span className={styles.rank}>{r === 1 ? "Highest" : r === 2 ? "2nd high" : r === 9 ? "2nd low" : r === 10 ? "Lowest" : " "}</span>
        </div>;
      })}</div>
    </section>
    <div className={styles.lowerGrid}>
    </div>
  </section>;
}
