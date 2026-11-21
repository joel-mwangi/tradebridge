"use client";

import styles from "./EvenOddLab.module.css";

type Tick = { id: number; tick_epoch: number; last_digit: number };
type Model = { id: string; model_name?: string; model_version?: string; status?: string; market_symbol?: string };
type ResearchRun = {
  id: string; market_symbol?: string; status?: string; started_at?: string;
  completed_at?: string; error_message?: string | null; dataset_rows?: number;
  evaluation?: Record<string, unknown>; partition_sizes?: Record<string, number>;
};
type Props = {
  symbol: string;
  history: Tick[];
  models: Model[];
  runs: ResearchRun[];
  selectedModelId: string;
  forecast: Record<string, unknown> | null;
  busy: string;
  onLoadForecast: () => void;
};

const WINDOWS = [50, 100, 250, 500, 1000];
const workflowUrl = "https://github.com/joel-mwangi/ai-tradingbridge/actions/workflows/even-odd-research.yml";

function parity(digit: number) { return digit % 2 === 0 ? "Even" : "Odd"; }
function pct(value: number) { return value.toFixed(1) + "%"; }
function pp(value: number) { return (value > 0 ? "+" : "") + value.toFixed(1) + " pp"; }
function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}
function getEvenRate(rows: Tick[]) {
  return rows.length ? rows.filter((row) => row.last_digit % 2 === 0).length / rows.length * 100 : null;
}
function getDigitRate(rows: Tick[], digit: number) {
  return rows.length ? rows.filter((row) => row.last_digit === digit).length / rows.length * 100 : null;
}

export default function EvenOddPatternIntelligence(props: Props) {
  const rows = props.history;
  const selectedModel = props.models.find((model) => model.id === props.selectedModelId) ?? null;
  const latest = rows.at(-1);
  const latestParity = latest ? parity(latest.last_digit) : "—";
  const evenCount = rows.filter((row) => row.last_digit % 2 === 0).length;
  const oddCount = rows.length - evenCount;
  const overallEvenRate = getEvenRate(rows);
  const windows = WINDOWS.map((size) => {
    if (rows.length < size) return null;
    const sample = rows.slice(-size);
    const half = Math.floor(sample.length / 2);
    const prior = sample.slice(0, half);
    const recent = sample.slice(half);
    const priorRate = getEvenRate(prior);
    const recentRate = getEvenRate(recent);
    return { size, sample, prior, recent, evenRate: getEvenRate(sample) ?? 0, momentum: priorRate === null || recentRate === null ? null : recentRate - priorRate };
  }).filter((item) => item !== null);
  const digitSample = rows.slice(-Math.min(1000, rows.length));
  const digitHalf = Math.floor(digitSample.length / 2);
  const digitPrior = digitSample.slice(0, digitHalf);
  const digitRecent = digitSample.slice(digitHalf);
  const digitStats = Array.from({ length: 10 }, (_, digit) => {
    const count = digitSample.filter((row) => row.last_digit === digit).length;
    const share = getDigitRate(digitSample, digit) ?? 0;
    const priorRate = getDigitRate(digitPrior, digit);
    const recentRate = getDigitRate(digitRecent, digit);
    return { digit, count, share, momentum: priorRate === null || recentRate === null ? null : recentRate - priorRate };
  });
  const transitionCounts = Array.from({ length: 10 }, () => Array(10).fill(0) as number[]);
  for (let index = 1; index < rows.length; index++) transitionCounts[rows[index - 1].last_digit][rows[index].last_digit] += 1;
  const suffixStats = [2, 3, 4, 5].map((length) => {
    const suffix = rows.slice(-length).map((row) => row.last_digit % 2).join("");
    let matches = 0, nextEven = 0, nextOdd = 0;
    for (let index = 0; index + length < rows.length; index++) {
      const candidate = rows.slice(index, index + length).map((row) => row.last_digit % 2).join("");
      if (candidate !== suffix) continue;
      matches++;
      if (rows[index + length].last_digit % 2 === 0) nextEven++;
      else nextOdd++;
    }
    return { length, suffix: suffix.split("").map((value) => value === "0" ? "E" : "O").join(" · "), matches, nextEven, nextOdd, evenRate: matches ? nextEven / matches * 100 : null };
  });
  let currentStreak = 0;
  if (latest) for (let index = rows.length - 1; index >= 0; index--) {
    if (parity(rows[index].last_digit) !== latestParity) break;
    currentStreak++;
  }
  const forecastEven = numeric(props.forecast?.probability_even);
  const forecastOdd = numeric(props.forecast?.probability_odd);

  return <div className={styles.patternWorkspace}>
    <section className={styles.panel}>
      <div className={styles.panelHeading}>
        <div><p className={styles.eyebrow}>PATTERN INTELLIGENCE · {props.symbol}</p><h2>Observed market behaviour</h2><p>Parity and digit statistics are calculated from the persisted, chronologically ordered live sample. They describe the sample; they are not proof of next-tick predictability.</p></div>
      </div>
      <div className={styles.statusGrid}>
        <article className={styles.stat}><span>OBSERVATIONS</span><strong>{rows.length.toLocaleString()}</strong><small>Loaded live-captured rows</small></article>
        <article className={styles.stat}><span>EVEN / ODD</span><strong>{overallEvenRate === null ? "—" : pct(overallEvenRate) + " / " + pct(100 - overallEvenRate)}</strong><small>{evenCount.toLocaleString()} even · {oddCount.toLocaleString()} odd</small></article>
        <article className={styles.stat}><span>LATEST PARITY</span><strong>{latestParity}</strong><small>{latest ? "Digit " + latest.last_digit : "No latest digit"}</small></article>
        <article className={styles.stat}><span>CURRENT STREAK</span><strong>{currentStreak || "—"}</strong><small>{latest ? latestParity + " consecutive observations" : "No observations"}</small></article>
      </div>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHeading}><div><p className={styles.eyebrow}>MULTI-WINDOW ANALYSIS</p><h2>Parity percentage and momentum</h2><p>Momentum compares the first and second half of each window. Values are percentage-point changes, not predicted returns.</p></div></div>
      {windows.length ? <div className={styles.tableWrap}><table><thead><tr><th>Window</th><th>Sample</th><th>Even</th><th>Odd</th><th>Even momentum</th><th>Direction</th></tr></thead><tbody>
        {windows.map((window) => <tr key={window.size}><td>{window.size.toLocaleString()}</td><td>{window.sample.length.toLocaleString()}</td><td>{pct(window.evenRate)}</td><td>{pct(100 - window.evenRate)}</td><td>{window.momentum === null ? "—" : pp(window.momentum)}</td><td>{window.momentum === null || Math.abs(window.momentum) < 0.05 ? "Flat / unavailable" : window.momentum > 0 ? "Even share rising" : "Even share falling"}</td></tr>)}
      </tbody></table></div> : <p className={styles.empty}>Collect at least 50 live ticks to populate rolling-window analysis.</p>}
      <p className={styles.helper}>The same sample is examined at 50, 100, 250, 500 and 1,000 observations. A change in frequency can be random variation; confirm any apparent effect with walk-forward tests.</p>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHeading}><div><p className={styles.eyebrow}>INDIVIDUAL DIGIT INTELLIGENCE</p><h2>Digit frequency and percentage movement</h2><p>Digit share and its change between the earlier and more recent half of the latest 1,000 observations (or all available observations).</p></div></div>
      <div className={styles.tableWrap}><table><thead><tr><th>Digit</th><th>Count</th><th>Share</th><th>Change</th><th>Movement</th></tr></thead><tbody>
        {digitStats.map((item) => <tr key={item.digit}><td><strong>{item.digit}</strong></td><td>{item.count.toLocaleString()}</td><td>{pct(item.share)}</td><td>{item.momentum === null ? "—" : pp(item.momentum)}</td><td>{item.momentum === null || Math.abs(item.momentum) < 0.05 ? "Flat / unavailable" : item.momentum > 0 ? "Increasing" : "Decreasing"}</td></tr>)}
      </tbody></table></div>
      <p className={styles.helper}>Individual digit rates sum to 100% within the displayed sample. Momentum is a descriptive comparison, not an entry rule.</p>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHeading}><div><p className={styles.eyebrow}>CONDITIONAL SEQUENCES</p><h2>Parity suffix patterns</h2><p>For each suffix, the dashboard counts historical occurrences before the current end of the sample and the parity observed immediately afterwards.</p></div></div>
      <div className={styles.tableWrap}><table><thead><tr><th>Pattern length</th><th>Current suffix</th><th>Historical matches</th><th>Next Even</th><th>Next Odd</th><th>Observed next Even</th></tr></thead><tbody>
        {suffixStats.map((item) => <tr key={item.length}><td>{item.length}</td><td>{item.suffix || "—"}</td><td>{item.matches}</td><td>{item.nextEven}</td><td>{item.nextOdd}</td><td>{item.evenRate === null ? "Insufficient matches" : pct(item.evenRate)}</td></tr>)}
      </tbody></table></div>
      <p className={styles.helper}>Conditional rates are historical sample frequencies and can be unstable when match counts are small. They are not calibrated model probabilities.</p>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHeading}><div><p className={styles.eyebrow}>DIGIT-TO-DIGIT TRANSITIONS</p><h2>10 × 10 transition matrix</h2><p>Each cell shows the number of observed transitions from the row digit to the column digit. Row percentages show conditional frequency given the previous digit.</p></div></div>
      <div className={styles.tableWrap}><table className={styles.transitionTable}><thead><tr><th>From ↓ / To →</th>{Array.from({ length: 10 }, (_, digit) => <th key={digit}>{digit}</th>)}</tr></thead><tbody>
        {transitionCounts.map((counts, from) => {
          const total = counts.reduce((sum, value) => sum + value, 0);
          return <tr key={from}><th>{from}</th>{counts.map((count, to) => <td key={to} title={total ? pct(count / total * 100) + " of transitions after digit " + from : "No observed transitions"}>{count}{total ? <small>{pct(count / total * 100)}</small> : <small>—</small>}</td>)}</tr>;
        })}
      </tbody></table></div>
      <p className={styles.helper}>This is a first-order descriptive transition table. It does not imply that the next digit depends on the previous digit.</p>
    </section>

    <section className={styles.overviewGrid}>
      <div className={styles.panel}>
        <div className={styles.panelHeading}><div><p className={styles.eyebrow}>PROBABILITY FORECAST</p><h2>Model probability inspection</h2><p>Uses the existing backend forecast endpoint for the selected stored model.</p></div></div>
        <div className={styles.formGrid}>
          <div className={styles.field}><span>Selected model</span><strong>{selectedModel ? (selectedModel.model_version ?? selectedModel.id.slice(0, 8)) + " · " + (selectedModel.status ?? "unknown") : "No model selected"}</strong></div>
          <div className={styles.actionField}><span>Forecast source</span><button type="button" className={styles.secondaryButton} onClick={props.onLoadForecast} disabled={!selectedModel || !!props.busy}>{props.busy === "forecast" ? "Calculating…" : "Refresh probability forecast"}</button></div>
        </div>
        {props.forecast ? <div className={styles.statusGrid}>
          <article className={styles.stat}><span>PROBABILITY EVEN</span><strong>{forecastEven === null ? "—" : pct(forecastEven * 100)}</strong><small>Backend forecast</small></article>
          <article className={styles.stat}><span>PROBABILITY ODD</span><strong>{forecastOdd === null ? "—" : pct(forecastOdd * 100)}</strong><small>Backend forecast</small></article>
        </div> : <p className={styles.empty}>No forecast loaded. Select a model in ML Predictions, then request a forecast here.</p>}
        <p className={styles.helper}>{String(props.forecast?.warning ?? "A point probability is not an actionable entry signal. The backend entry gates remain authoritative.")}</p>
        {props.forecast && <p className={styles.helper}>Model lean: {forecastEven === null || forecastOdd === null ? "Unavailable" : forecastEven > forecastOdd ? "Even" : forecastOdd > forecastEven ? "Odd" : "No directional difference"}. This is not a trade instruction.</p>}
      </div>
      <div className={styles.panel}>
        <div className={styles.panelHeading}><div><p className={styles.eyebrow}>MODEL FEATURE MAP</p><h2>What the learning pipeline examines</h2><p>Feature families represented in the research design. The exact active vector is determined by the backend model artifact.</p></div></div>
        <ul className={styles.featureList}>
          <li><strong>Rolling parity rates</strong><span>Even/odd percentages at 50, 100, 250, 500 and 1,000 observations.</span></li>
          <li><strong>Parity momentum and acceleration</strong><span>Changes in rates between recent and earlier sub-windows.</span></li>
          <li><strong>Per-digit frequencies and momentum</strong><span>Distribution and percentage movement for digits 0–9.</span></li>
          <li><strong>Transition behaviour</strong><span>Parity transitions and digit-conditioned next-digit distributions.</span></li>
          <li><strong>Repeated suffix patterns</strong><span>Recent parity sequences of lengths 2–5 and their historical outcomes.</span></li>
          <li><strong>Cross-window divergence</strong><span>How short and long observation windows differ.</span></li>
        </ul>
        <p className={styles.helper}>The expanded feature implementation is in backend PR #64 and must be merged and deployed before newly trained models can use that expanded schema. Existing model artifacts retain their original feature schema.</p>
      </div>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHeading}><div><p className={styles.eyebrow}>MANUAL TRAINING & EXPERIMENT HISTORY</p><h2>Research run monitor</h2><p>Training runs are manually dispatched in GitHub Actions and write their final research reports to the dedicated database.</p></div></div>
      <div className={styles.sessionActions}><a className={styles.primaryButton} href={workflowUrl} target="_blank" rel="noreferrer">Open manual training workflow ↗</a><span className={styles.helper}>No always-on worker is required. The GitHub-hosted runner executes the experiment after manual dispatch.</span></div>
      {props.runs.length ? <div className={styles.list}>{props.runs.slice(0, 8).map((run) => {
        const ev = asObject(run.evaluation);
        const wf = asObject(ev.walk_forward);
        return <article key={run.id}><div><strong>{run.market_symbol ?? props.symbol} · {run.status ?? "unknown"}</strong><small>{formatDate(run.started_at)} · {Number(run.dataset_rows ?? 0).toLocaleString()} source rows · {numeric(wf.fold_count) ?? 0} walk-forward folds</small>{run.completed_at && <small>Completed: {formatDate(run.completed_at)}</small>}{run.error_message && <small className={styles.runError}>{run.error_message}</small>}</div><span className={styles.runId}>{run.id.slice(0, 8)}</span></article>;
      })}</div> : <p className={styles.empty}>No research runs have been recorded for {props.symbol}. Collect enough observations, then manually dispatch a workflow.</p>}
      <p className={styles.helper}>The current workflow records run-level status and final evaluation. It does not expose reliable per-epoch or per-fold live progress in this UI; no progress percentage is fabricated. Refresh the Lab after a run to load its persisted report.</p>
    </section>
  </div>;
}
