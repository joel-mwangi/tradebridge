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
function probability(value: unknown) {
  const number = numeric(value);
  return number === null ? "—" : pct(number * 100);
}
function interval(value: unknown) {
  const item = asObject(value);
  const lower = numeric(item.lower);
  const upper = numeric(item.upper);
  return lower === null || upper === null ? "—" : pct(lower * 100) + "–" + pct(upper * 100);
}
function patternLabel(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export default function EvenOddPatternIntelligence(props: Props) {
  const rows = props.history;
  const latest = rows.at(-1);
  const latestParity = latest ? parity(latest.last_digit) : "—";
  const evenCount = rows.filter((row) => row.last_digit % 2 === 0).length;
  const oddCount = rows.length - evenCount;
  const overallEvenRate = getEvenRate(rows);
  const windows = WINDOWS.map((size) => {
    if (rows.length < size) return null;
    const sample = rows.slice(-size);
    const half = Math.floor(sample.length / 2);
    const priorRate = getEvenRate(sample.slice(0, half));
    const recentRate = getEvenRate(sample.slice(half));
    return { size, sample, evenRate: getEvenRate(sample) ?? 0, momentum: priorRate === null || recentRate === null ? null : recentRate - priorRate };
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
  let currentStreak = 0;
  if (latest) for (let index = rows.length - 1; index >= 0; index--) {
    if (parity(rows[index].last_digit) !== latestParity) break;
    currentStreak++;
  }

  const latestPatternRun = props.runs.find((run) => {
    const discovery = asObject(asObject(run.evaluation).pattern_discovery);
    return Object.keys(discovery).length > 0;
  });
  const discovery = asObject(asObject(latestPatternRun?.evaluation).pattern_discovery);
  const search = asObject(discovery.adaptive_search);
  const patterns = Array.isArray(discovery.patterns) ? discovery.patterns.map(asObject) : [];
  const patternStatus = String(discovery.status ?? "not_run");
  const horizonsForSearch = Array.isArray(search.future_horizons_tested) ? search.future_horizons_tested : [];
  const contextLengths = Array.isArray(search.parity_sequence_lengths_tested) ? search.parity_sequence_lengths_tested : [];
  const digitLengths = Array.isArray(search.digit_sequence_lengths_tested) ? search.digit_sequence_lengths_tested : [];
  const frequencyWindows = Array.isArray(search.frequency_windows_tested) ? search.frequency_windows_tested : [];

  return <div className={styles.patternWorkspace}>
    <section className={styles.panel}>
      <div className={styles.panelHeading}>
        <div><p className={styles.eyebrow}>PATTERN INTELLIGENCE · {props.symbol}</p><h2>Observed market behaviour</h2><p>Analysis uses the persisted, chronologically ordered live sample. The objective is to discover recurring contexts and estimate outcome distributions over multiple future horizons—not to classify only the next tick.</p></div>
      </div>
      <div className={styles.statusGrid}>
        <article className={styles.stat}><span>OBSERVATIONS</span><strong>{rows.length.toLocaleString()}</strong><small>Loaded live-captured rows</small></article>
        <article className={styles.stat}><span>EVEN / ODD</span><strong>{overallEvenRate === null ? "—" : pct(overallEvenRate) + " / " + pct(100 - overallEvenRate)}</strong><small>{evenCount.toLocaleString()} even · {oddCount.toLocaleString()} odd</small></article>
        <article className={styles.stat}><span>LATEST PARITY</span><strong>{latestParity}</strong><small>{latest ? "Digit " + latest.last_digit : "No latest digit"}</small></article>
        <article className={styles.stat}><span>CURRENT STREAK</span><strong>{currentStreak || "—"}</strong><small>{latest ? latestParity + " consecutive observations" : "No observations"}</small></article>
      </div>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHeading}><div><p className={styles.eyebrow}>ADAPTIVE PATTERN DISCOVERY</p><h2>Patterns the research run has found</h2><p>The engine tests parity suffixes, exact digit sequences, parity-frequency regimes, and individual-digit frequency/momentum regimes. It adapts context lengths and future horizons to the available sample.</p></div></div>
      {patternStatus === "exploratory" ? <>
        <div className={styles.statusGrid}>
          <article className={styles.stat}><span>CONTEXT PATTERNS TESTED</span><strong>{numeric(discovery.patterns_examined)?.toLocaleString() ?? "—"}</strong><small>Across all enabled pattern families</small></article>
          <article className={styles.stat}><span>WITH HISTORICAL MATCHES</span><strong>{numeric(discovery.patterns_with_historical_matches)?.toLocaleString() ?? "—"}</strong><small>Current contexts with comparable history</small></article>
          <article className={styles.stat}><span>MAX FUTURE HORIZON</span><strong>{horizonsForSearch.length ? String(horizonsForSearch[horizonsForSearch.length - 1]) : "—"}</strong><small>Ticks evaluated per occurrence</small></article>
          <article className={styles.stat}><span>RESEARCH SAMPLE</span><strong>{numeric(discovery.observations)?.toLocaleString() ?? "—"}</strong><small>Ticks used by this discovery run</small></article>
        </div>
        <div className={styles.resultBox}>
          <strong>Adaptive search space</strong>
          <p><b>Parity sequence lengths:</b> {contextLengths.join(", ") || "—"}</p>
          <p><b>Digit sequence lengths:</b> {digitLengths.join(", ") || "—"}</p>
          <p><b>Frequency/momentum windows:</b> {frequencyWindows.join(", ") || "—"}</p>
          <p><b>Future horizons:</b> {horizonsForSearch.join(", ") || "—"}</p>
          <small>{String(search.selection_method ?? "Data-driven context and horizon search")}</small>
        </div>
        {patterns.length ? <div className={styles.list}>{patterns.slice(0, 12).map((pattern, index) => {
          const horizons = Array.isArray(pattern.horizons) ? pattern.horizons.map(asObject) : [];
          const holdout = asObject(pattern.holdout_horizon_selection);
          const selectedHorizonByEvent = asObject(holdout.selected_horizon_by_event);
          const selectedOddHorizon = numeric(asObject(selectedHorizonByEvent.three_or_more_odd).horizon_ticks);
          const sampleHorizon = (selectedOddHorizon === null ? undefined : horizons.find((item) => Number(item.horizon_ticks) === selectedOddHorizon)) ?? horizons.find((item) => Number(item.horizon_ticks) === 5) ?? horizons.find((item) => Number(item.horizon_ticks) === 3) ?? horizons[0] ?? {};
          const oddEvent = asObject(sampleHorizon.probability_at_least_3_odd);
          const consecutiveEvent = asObject(sampleHorizon.probability_3_consecutive_odd);
          const digitEvents = Array.isArray(sampleHorizon.digit_occurrence_probabilities) ? sampleHorizon.digit_occurrence_probabilities.map(asObject) : [];
          const selectedHorizonText = Object.entries(selectedHorizonByEvent).map(([event, value]) => event.replace(/_/g, " ") + ": " + String(asObject(value).horizon_ticks) + " ticks").join(" · ");
          return <article key={String(pattern.family) + "-" + String(pattern.context_ticks) + "-" + index}>
            <div className={styles.panelHeading}>
              <div><strong>{String(pattern.family).replace(/_/g, " ")}</strong><small>{String(pattern.description ?? "")}</small><small>Context: {String(pattern.context_ticks)} ticks · Historical matches: {String(pattern.historical_matches)} · Support: {String(pattern.support_status)}</small><small>Pattern: {patternLabel(pattern.pattern)}</small></div>
              <span className={styles.runId}>Exploratory</span>
            </div>
            <div className={styles.statusGrid}>
              <article className={styles.stat}><span>3+ ODD · {String(sampleHorizon.horizon_ticks ?? "—")} TICKS</span><strong>{probability(oddEvent.probability)}</strong><small>95% Wilson interval: {interval(oddEvent.confidence_95)}</small></article>
              <article className={styles.stat}><span>3 CONSECUTIVE ODD</span><strong>{probability(consecutiveEvent.probability)}</strong><small>95% Wilson interval: {interval(consecutiveEvent.confidence_95)}</small></article>
              <article className={styles.stat}><span>ODD OCCURRENCES</span><strong>{numeric(sampleHorizon.mean_odd_count)?.toFixed(2) ?? "—"}</strong><small>Mean Odd count over displayed horizon</small></article>
              <article className={styles.stat}><span>3+ ODD LIFT</span><strong>{numeric(sampleHorizon.lift_at_least_3_odd) === null ? "—" : pp(Number(sampleHorizon.lift_at_least_3_odd) * 100)}</strong><small>Versus unconditional historical frequency</small></article>
            </div>
            <p className={styles.helper}>Chronological holdout horizon selection: {selectedHorizonText || "No horizon showed positive holdout Brier improvement"} · {String(holdout.status ?? "not evaluated")}</p>
            <details>
              <summary>Inspect all future horizons and digit occurrence probabilities</summary>
              <div className={styles.tableWrap}><table><thead><tr><th>Horizon</th><th>Matches</th><th>P(3+ Odd)</th><th>95% interval</th><th>P(3 consecutive Odd)</th><th>Lift vs baseline</th></tr></thead><tbody>
                {horizons.map((item) => {
                  const odd = asObject(item.probability_at_least_3_odd);
                  const consecutive = asObject(item.probability_3_consecutive_odd);
                  return <tr key={String(item.horizon_ticks)}><td>{String(item.horizon_ticks)}</td><td>{String(item.sample_size ?? 0)}</td><td>{probability(odd.probability)}</td><td>{interval(odd.confidence_95)}</td><td>{probability(consecutive.probability)}</td><td>{numeric(item.lift_at_least_3_odd) === null ? "—" : pp(Number(item.lift_at_least_3_odd) * 100)}</td></tr>;
                })}
              </tbody></table></div>
              <div className={styles.tableWrap}><table><thead><tr><th>Digit</th><th>Probability of at least one occurrence</th><th>Mean occurrences</th></tr></thead><tbody>
                {digitEvents.map((item) => <tr key={String(item.digit)}><td>{String(item.digit)}</td><td>{probability(item.probability)}</td><td>{numeric(item.mean_occurrences)?.toFixed(2) ?? "—"}</td></tr>)}
              </tbody></table></div>
            </details>
          </article>;
        })}</div> : <p className={styles.empty}>The latest research run did not find historical matches for the active contexts.</p>}
        <p className={styles.helper}>{String(asObject(discovery.interpretation).warning ?? "These are exploratory conditional frequencies, not validated trading signals.")}</p>
      </> : <div className={styles.empty}>
        <strong>{patternStatus === "insufficient_data" ? "More observations are required" : "No pattern-discovery report is available yet"}</strong>
        <p>{String(discovery.warning ?? "Collect live observations, then manually run the Even/Odd research workflow. The report will be persisted and displayed here.")}</p>
        <a className={styles.primaryButton} href={workflowUrl} target="_blank" rel="noreferrer">Open manual pattern research workflow ↗</a>
      </div>}
      {latestPatternRun && <p className={styles.helper}>Pattern report from research run {latestPatternRun.id.slice(0, 8)} · {formatDate(latestPatternRun.completed_at ?? latestPatternRun.started_at)} · {String(latestPatternRun.market_symbol ?? props.symbol)}</p>}
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHeading}><div><p className={styles.eyebrow}>MULTI-WINDOW DESCRIPTIVE ANALYSIS</p><h2>Parity percentage and momentum</h2><p>Momentum compares the first and second half of each window. Values are percentage-point changes, not predicted returns.</p></div></div>
      {windows.length ? <div className={styles.tableWrap}><table><thead><tr><th>Window</th><th>Sample</th><th>Even</th><th>Odd</th><th>Even momentum</th><th>Direction</th></tr></thead><tbody>
        {windows.map((window) => <tr key={window.size}><td>{window.size.toLocaleString()}</td><td>{window.sample.length.toLocaleString()}</td><td>{pct(window.evenRate)}</td><td>{pct(100 - window.evenRate)}</td><td>{window.momentum === null ? "—" : pp(window.momentum)}</td><td>{window.momentum === null || Math.abs(window.momentum) < 0.05 ? "Flat / unavailable" : window.momentum > 0 ? "Even share rising" : "Even share falling"}</td></tr>)}
      </tbody></table></div> : <p className={styles.empty}>Collect at least 50 live ticks to populate rolling-window analysis.</p>}
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHeading}><div><p className={styles.eyebrow}>INDIVIDUAL DIGIT INTELLIGENCE</p><h2>Digit frequency and percentage movement</h2><p>Digit share and its change between the earlier and more recent half of the latest 1,000 observations (or all available observations).</p></div></div>
      <div className={styles.tableWrap}><table><thead><tr><th>Digit</th><th>Count</th><th>Share</th><th>Change</th><th>Movement</th></tr></thead><tbody>
        {digitStats.map((item) => <tr key={item.digit}><td><strong>{item.digit}</strong></td><td>{item.count.toLocaleString()}</td><td>{pct(item.share)}</td><td>{item.momentum === null ? "—" : pp(item.momentum)}</td><td>{item.momentum === null || Math.abs(item.momentum) < 0.05 ? "Flat / unavailable" : item.momentum > 0 ? "Increasing" : "Decreasing"}</td></tr>)}
      </tbody></table></div>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHeading}><div><p className={styles.eyebrow}>DIGIT-TO-DIGIT TRANSITIONS</p><h2>10 × 10 transition matrix</h2><p>Each cell shows the number of observed transitions from the row digit to the column digit. Row percentages show conditional frequency given the previous digit.</p></div></div>
      <div className={styles.tableWrap}><table className={styles.transitionTable}><thead><tr><th>From ↓ / To →</th>{Array.from({ length: 10 }, (_, digit) => <th key={digit}>{digit}</th>)}</tr></thead><tbody>
        {transitionCounts.map((counts, from) => {
          const total = counts.reduce((sum, value) => sum + value, 0);
          return <tr key={from}><th>{from}</th>{counts.map((count, to) => <td key={to} title={total ? pct(count / total * 100) + " of transitions after digit " + from : "No observed transitions"}>{count}{total ? <small>{pct(count / total * 100)}</small> : <small>—</small>}</td>)}</tr>;
        })}
      </tbody></table></div>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHeading}><div><p className={styles.eyebrow}>LEARNING SCOPE</p><h2>What the discovery engine examines</h2><p>Candidate patterns are generated from the observed history; context lengths and future horizons expand or contract with sample size.</p></div></div>
      <ul className={styles.featureList}>
        <li><strong>Parity sequences</strong><span>Current Odd/Even suffixes across multiple historical lengths.</span></li>
        <li><strong>Exact digit sequences</strong><span>Recurring sequences built from the last digits 0–9.</span></li>
        <li><strong>Parity frequency and momentum</strong><span>Frequency bands, percentage-point movement and current streak state.</span></li>
        <li><strong>Individual digit frequency and momentum</strong><span>All ten digits, including their rolling frequency and movement.</span></li>
        <li><strong>Future occurrence distributions</strong><span>Odd/Even counts, consecutive runs and per-digit occurrence probabilities over multiple horizons.</span></li>
        <li><strong>Baseline comparison</strong><span>Conditional pattern probabilities compared with unconditional historical occurrence rates.</span></li>
      </ul>
      <p className={styles.helper}>The stored next-tick classifier is retained only as a legacy diagnostic for compatibility. Pattern discovery is the primary research output. Neither output is an approved trading signal.</p>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHeading}><div><p className={styles.eyebrow}>MANUAL TRAINING & EXPERIMENT HISTORY</p><h2>Research run monitor</h2><p>Runs are manually dispatched in GitHub Actions. The report, including adaptive pattern discovery, is persisted to the dedicated database.</p></div></div>
      <div className={styles.sessionActions}><a className={styles.primaryButton} href={workflowUrl} target="_blank" rel="noreferrer">Open manual training workflow ↗</a><span className={styles.helper}>No always-on worker is required. The GitHub-hosted runner executes after manual dispatch.</span></div>
      {props.runs.length ? <div className={styles.list}>{props.runs.slice(0, 8).map((run) => {
        const ev = asObject(run.evaluation);
        const wf = asObject(asObject(ev.legacy_next_tick_classifier).walk_forward ?? ev.walk_forward);
        const pd = asObject(ev.pattern_discovery);
        return <article key={run.id}><div><strong>{run.market_symbol ?? props.symbol} · {run.status ?? "unknown"}</strong><small>{formatDate(run.started_at)} · {Number(run.dataset_rows ?? 0).toLocaleString()} source rows · {numeric(pd.patterns_examined) ?? 0} pattern candidates</small>{run.completed_at && <small>Completed: {formatDate(run.completed_at)}</small>}{run.error_message && <small className={styles.runError}>{run.error_message}</small>}</div><span className={styles.runId}>{run.id.slice(0, 8)}</span></article>;
      })}</div> : <p className={styles.empty}>No research runs have been recorded for {props.symbol}. Collect enough observations, then manually dispatch a workflow.</p>}
      <p className={styles.helper}>The discovery report is generated when a manual research run completes; it is not a live-updating model-training process.</p>
    </section>
  </div>;
}
