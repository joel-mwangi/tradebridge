"use client";

import type { ReactNode } from "react";
import styles from "./EvenOddLab.module.css";

type Model = {
  id: string; model_name?: string; model_version?: string; status?: string;
  market_symbol?: string; created_at?: string; metrics?: Record<string, unknown>;
  training_rows?: number; validation_rows?: number; calibration_rows?: number; test_rows?: number;
  execution_authorized?: boolean;
};
type ResearchRun = {
  id: string; market_symbol?: string; status?: string; started_at?: string;
  completed_at?: string; error_message?: string | null; dataset_rows?: number;
  model_id?: string; evaluation?: Record<string, unknown>;
  partition_sizes?: Record<string, number>; quality_report?: Record<string, unknown>;
};
type Tick = { id: number; tick_epoch: number; last_digit: number };
type Session = { id?: string; status?: string; market_symbol?: string; fixed_stake?: number | string; currency?: string; max_session_loss?: number | string };
type Props = {
  view: "ml" | "entry" | "backtesting" | "performance";
  symbol: string;
  models: Model[];
  runs: ResearchRun[];
  selectedModelId: string;
  onSelectModel: (id: string) => void;
  forecast: Record<string, unknown> | null;
  onLoadForecast: () => void;
  busy: string;
  history: Tick[];
  session: Session | null;
  entryResult: Record<string, unknown> | null;
  planResult: Record<string, unknown> | null;
  onEvaluateEntry: () => void;
  onPlanSequence: () => void;
  onStartSequence: () => void;
};
const workflowUrl = "https://github.com/joel-mwangi/ai-tradingbridge/actions/workflows/even-odd-research.yml";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function pct(value: unknown): string {
  const n = num(value);
  return n === null ? "—" : (n <= 1 ? n * 100 : n).toFixed(2) + "%";
}
function metric(value: unknown, digits = 4): string {
  const n = num(value);
  return n === null ? "—" : n.toFixed(digits);
}
function date(value?: string) {
  return value ? new Date(value).toLocaleString() : "—";
}
function Panel({ title, eyebrow, description, children }: { title: string; eyebrow: string; description?: string; children: ReactNode }) {
  return <section className={styles.panel}>
    <div className={styles.panelHeading}><div><p className={styles.eyebrow}>{eyebrow}</p><h2>{title}</h2>{description && <p>{description}</p>}</div></div>
    {children}
  </section>;
}
function MetricCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return <article className={styles.stat}><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</article>;
}
function Empty({ children }: { children: ReactNode }) {
  return <p className={styles.empty}>{children}</p>;
}

export default function EvenOddResearchPanels(props: Props) {
  const selected = props.models.find((model) => model.id === props.selectedModelId) ?? null;
  const validated = props.models.filter((model) => model.status === "validated");
  const latestRun = props.runs.find((run) => run.status === "completed" && run.evaluation);
  const evaluation = object(latestRun?.evaluation);
  const walk = object(evaluation.walk_forward);
  const modelMetrics = object(walk.aggregate_model_metrics ?? evaluation.test_metrics);
  const constantMetrics = object(walk.aggregate_constant_baseline_metrics ?? evaluation.constant_baseline_metrics);
  const rollingMetrics = object(walk.aggregate_rolling_frequency_baseline_metrics ?? evaluation.rolling_frequency_baseline_metrics);
  const comparisons = object(walk.statistical_comparisons);
  const modelComparison = object(comparisons.vs_constant_baseline);
  const rollingComparison = object(comparisons.vs_rolling_frequency_baseline);
  const freshTicks = props.history.slice(-3).length === 3 && props.history.slice(-3).every((tick) => Date.now() / 1000 - tick.tick_epoch <= 10);
  const sessionMatchesMarket = Boolean(props.session?.market_symbol === props.symbol);
  const modelMatchesMarket = Boolean(selected?.market_symbol === props.symbol);
  const entryReady = Boolean(props.session?.id && props.session.status === "active" && sessionMatchesMarket && selected?.status === "validated" && modelMatchesMarket && freshTicks);
  const forecast = props.forecast ?? {};
  const forecastExists = props.forecast !== null;
  const forecastProb = num(forecast.probability_even);
  const forecastOdd = num(forecast.probability_odd);
  const metrics = (source: Record<string, unknown>) => {
    const matrix = object(source.confusion_matrix);
    const tp = num(matrix.true_even_predicted_even) ?? 0;
    const fp = num(matrix.true_odd_predicted_even) ?? 0;
    const precisionEven = tp + fp > 0 ? tp / (tp + fp) : null;
    return [
      ["Accuracy", pct(source.accuracy)],
      ["Balanced accuracy", pct(source.balanced_accuracy)],
      ["Even precision", precisionEven === null ? "—" : pct(precisionEven)],
      ["Brier score", metric(source.brier_score)],
      ["Log loss", metric(source.log_loss)],
      ["Calibration error", metric(source.expected_calibration_error)],
    ] as Array<[string, string]>;
  };
  const fmt = (rows: Array<[string, string]>) => rows.map(([label, value]) => <div className={styles.metricLine} key={label}><span>{label}</span><strong>{value}</strong></div>);

  if (props.view === "ml") return <>
    <Panel eyebrow="MODEL REGISTRY" title="ML predictions" description="Research forecasts are separated from validated evidence. Candidate models cannot qualify an entry.">
      <div className={styles.modelSummary}>
        <div><strong>{props.models.length}</strong><span>Stored models</span></div>
        <div><strong>{props.models.filter((m) => m.status === "candidate").length}</strong><span>Candidates</span></div>
        <div><strong>{validated.length}</strong><span>Validated</span></div>
        <div><strong>{props.runs.length}</strong><span>Experiments</span></div>
      </div>
      {props.models.length ? <div className={styles.tableWrap}><table><thead><tr><th>Model</th><th>Version</th><th>Status</th><th>Train</th><th>Validation</th><th>Calibration</th><th>Test</th><th>Execution</th></tr></thead><tbody>
        {props.models.map((model) => <tr key={model.id}><td>{model.model_name ?? "Logistic regression"}</td><td>{model.model_version ?? "—"}</td><td><span className={model.status === "validated" ? styles.validated : styles.candidate}>{model.status ?? "unknown"}</span></td><td>{model.training_rows ?? "—"}</td><td>{model.validation_rows ?? "—"}</td><td>{model.calibration_rows ?? "—"}</td><td>{model.test_rows ?? "—"}</td><td>{model.execution_authorized ? "Not enabled" : "Disabled"}</td></tr>)}
      </tbody></table></div> : <Empty>No stored models for {props.symbol}. Collect sufficient history and run a chronological experiment.</Empty>}
      <div className={styles.formGrid}>
        <label className={styles.field}><span>Model for forecast inspection</span><select value={props.selectedModelId} onChange={(event) => props.onSelectModel(event.target.value)}><option value="">Select model</option>{props.models.map((model) => <option key={model.id} value={model.id}>{model.model_version ?? model.id.slice(0, 8)} · {model.status}</option>)}</select></label>
        <div className={styles.actionField}><span>Research-only forecast</span><button type="button" className={styles.secondaryButton} onClick={props.onLoadForecast} disabled={!selected || !!props.busy}>{props.busy === "forecast" ? "Evaluating…" : "Inspect latest forecast"}</button></div>
      </div>
      {forecastExists && <div className={styles.forecastPanel}>
        <MetricCard label="MODEL STATUS" value={String(forecast.model_status ?? selected?.status ?? "unknown")} />
        <MetricCard label="EVEN PROBABILITY" value={forecastProb === null ? "—" : pct(forecastProb)} />
        <MetricCard label="ODD PROBABILITY" value={forecastOdd === null ? "—" : pct(forecastOdd)} />
        <MetricCard label="DATA AGE" value={num(forecast.data_age_seconds) === null ? "—" : metric(forecast.data_age_seconds, 2) + "s"} />
        <p>{String(forecast.warning ?? "Research forecast only. This is not a trading signal.")}</p>
        {forecast.calibration_interval && <pre className={styles.json}>{JSON.stringify(forecast.calibration_interval, null, 2)}</pre>}
      </div>}
    </Panel>
    <div className={styles.warning}><span className={styles.warningIcon}>!</span><div><strong>Prediction is not proof of edge</strong><p>A probability estimate is not an entry instruction. Validation requires repeatable out-of-sample performance, calibration, payout-adjusted positive expected value and independent review.</p></div></div>
  </>;

  if (props.view === "entry") return <>
    <Panel eyebrow="HYBRID ENTRY ENGINE" title="Entry intelligence" description="The backend independently recomputes probabilities, uncertainty, freshness, payout and risk. The browser cannot override those gates.">
      <div className={styles.statusGrid}>
        <MetricCard label="SESSION" value={props.session?.status ?? "Not loaded"} note={props.session?.id ? String(props.session.id).slice(0, 8) : "Create or load a ledger session"} />
        <MetricCard label="MODEL" value={selected?.status ?? "Not selected"} note={selected?.model_version ?? "Choose a stored model"} />
        <MetricCard label="CONFIRMATION TICKS" value={String(props.history.slice(-3).length) + " / 3"} note={freshTicks ? "Latest observations within 10 seconds" : "Fresh consecutive ticks required"} />
        <MetricCard label="BROKER EXECUTION" value="Disabled" note="Research and ledger only" />
      </div>
      <div className={styles.entryDecision}>
        <span className={entryReady ? styles.candidate : styles.waitTag}>{entryReady ? "READY FOR SERVER EVALUATION" : "WAIT"}</span>
        <strong>{entryReady ? "Preconditions are present; backend gates still decide." : !props.session?.id ? "Create or load an active session." : props.session.status !== "active" ? "The selected session is not active." : !sessionMatchesMarket ? "The loaded session belongs to a different market. Load a matching session." : !selected ? "Select a model to inspect the evidence." : !modelMatchesMarket ? "The selected model belongs to a different market." : selected.status !== "validated" ? "No validated model is available. Candidate models are blocked." : "Collect three fresh, consecutive persisted ticks."}</strong>
        <p>Ready status only enables a request. It does not indicate a positive edge and does not place an order.</p>
      </div>
      <div className={styles.sessionActions}>
        <button type="button" className={styles.secondaryButton} onClick={props.onEvaluateEntry} disabled={!entryReady || !!props.busy}>{props.busy === "entry" ? "Evaluating…" : "Evaluate entry evidence"}</button>
        <button type="button" className={styles.secondaryButton} onClick={props.onPlanSequence} disabled={!entryReady || !!props.busy}>{props.busy === "plan" ? "Planning…" : "Calculate sequence upper bound"}</button>
      </div>
      {props.entryResult && <div className={styles.resultBox}><strong>Server entry decision · {String(props.entryResult.status ?? "unknown").toUpperCase()}</strong><p>{String(props.entryResult.reason ?? "No additional explanation supplied.")}</p><pre className={styles.json}>{JSON.stringify(props.entryResult, null, 2)}</pre></div>}
      {props.planResult && <div className={styles.resultBox}><strong>Risk-bounded sequence plan · {String(props.planResult.status ?? "WAIT").toUpperCase()}</strong><div><span>Planned upper bound</span><b>{String(props.planResult.planned_trades ?? 0)} / 7</b></div><p>{String(props.planResult.plan_reason ?? props.planResult.reason ?? "No qualifying plan.")}</p><button type="button" className={styles.primaryButton} onClick={props.onStartSequence} disabled={props.planResult.status !== "plan" || Number(props.planResult.planned_trades) < 1 || !!props.busy}>Confirm sequence ledger</button><small>Starting a sequence records a research plan only. It does not execute a contract.</small></div>}
    </Panel>
    <Panel eyebrow="ENTRY GATES" title="What the engine must verify">
      <div className={styles.gateGrid}>
        {["Validated model and version","Out-of-sample uncertainty interval","Three consecutive confirmations","Persisted tick identity and freshness","Current Even/Odd payout terms","Conservative edge above break-even","Positive conservative expected value","Remaining session risk budget"].map((label) => <div key={label}><span>•</span>{label}</div>)}
      </div>
      <p className={styles.helper}>The backend is authoritative. A failed or missing gate must return WAIT or an explicit rejection; the frontend must not manufacture a candidate state.</p>
    </Panel>
  </>;

  if (props.view === "backtesting") return <>
    <Panel eyebrow="CHRONOLOGICAL RESEARCH" title="Backtesting & walk-forward experiments" description="Each completed run stores the untouched chronological test results, expanding walk-forward folds and baseline comparisons.">
      <div className={styles.sessionActions}><a className={styles.secondaryButton} href={workflowUrl} target="_blank" rel="noreferrer">Open research workflow ↗</a><span className={styles.helper}>Runs are manually dispatched outside the Vercel request lifecycle.</span></div>
      {props.runs.length ? <div className={styles.list}>{props.runs.map((run) => {
        const ev = object(run.evaluation);
        const wf = object(ev.walk_forward);
        const pm = object(wf.aggregate_model_metrics ?? ev.test_metrics);
        return <article key={run.id}><div><strong>{run.market_symbol ?? props.symbol} · {run.status ?? "unknown"}</strong><small>{date(run.started_at)} · {run.dataset_rows ?? "—"} source rows · {num(wf.fold_count) ?? 0} walk-forward folds · model accuracy {pct(pm.accuracy)}</small>{run.error_message && <small className={styles.runError}>{run.error_message}</small>}</div><span className={styles.runId}>{run.id.slice(0, 8)}</span></article>;
      })}</div> : <Empty>No research experiments have been persisted for this market.</Empty>}
    </Panel>
    {latestRun && <Panel eyebrow="LATEST COMPLETED RUN" title="Chronological partition report">
      <div className={styles.statusGrid}>{Object.entries(latestRun.partition_sizes ?? {}).map(([key, value]) => <MetricCard key={key} label={key.toUpperCase()} value={String(value)} note="Rows in chronological partition" />)}</div>
      <div className={styles.overviewGrid}>
        <div><h3 className={styles.subheading}>Model · out-of-sample</h3>{fmt(metrics(modelMetrics))}</div>
        <div><h3 className={styles.subheading}>50% baseline</h3>{fmt(metrics(constantMetrics))}</div>
        <div><h3 className={styles.subheading}>Rolling-frequency baseline</h3>{fmt(metrics(rollingMetrics))}</div>
      </div>
      <p className={styles.helper}>A backtest report is evidence for review, not model promotion. A single holdout or one favorable fold is insufficient.</p>
    </Panel>}
  </>;

  return <>
    <Panel eyebrow="OUT-OF-SAMPLE PERFORMANCE" title="Performance & model comparison" description="Metrics are read from persisted research reports. No simulated profitability is inferred where no payout replay exists.">
      {latestRun ? <>
        <div className={styles.statusGrid}>
          <MetricCard label="OOS ACCURACY" value={pct(modelMetrics.accuracy)} />
          <MetricCard label="BALANCED ACCURACY" value={pct(modelMetrics.balanced_accuracy)} />
          <MetricCard label="BRIER SCORE" value={metric(modelMetrics.brier_score)} note="Lower is better" />
          <MetricCard label="LOG LOSS" value={metric(modelMetrics.log_loss)} note="Lower is better" />
          <MetricCard label="CALIBRATION ERROR" value={metric(modelMetrics.expected_calibration_error)} note="Lower is better" />
          <MetricCard label="OOS ROWS" value={String(walk.evaluated_rows ?? latestRun.dataset_rows ?? "—")} />
          <MetricCard label="WALK-FORWARD FOLDS" value={String(walk.fold_count ?? 0)} />
          <MetricCard label="VALIDATION STATUS" value="Candidate" note="Independent approval required" />
        </div>
        <div className={styles.overviewGrid}>
          <div><h3 className={styles.subheading}>Model vs 50% baseline</h3>{fmt([["Log-loss improvement", pct(modelComparison.relative_improvement)],["Bootstrap interval", JSON.stringify(modelComparison.confidence_interval ?? "—")],["Statistical result", String(modelComparison.status ?? "Not reported")]])}</div>
          <div><h3 className={styles.subheading}>Model vs rolling frequency</h3>{fmt([["Log-loss improvement", pct(rollingComparison.relative_improvement)],["Bootstrap interval", JSON.stringify(rollingComparison.confidence_interval ?? "—")],["Statistical result", String(rollingComparison.status ?? "Not reported")]])}</div>
        </div>
        <div className={styles.warning}><span className={styles.warningIcon}>!</span><div><strong>Profitability has not been established by these metrics</strong><p>The current research pipeline evaluates predictive probabilities. It does not run a full historical payout replay, slippage simulation or realized-return backtest. Do not interpret accuracy alone as positive expected value.</p></div></div>
      </> : <Empty>Performance metrics will appear after a completed chronological research run has been saved.</Empty>}
    </Panel>
    <Panel eyebrow="MODEL GOVERNANCE" title="Promotion requirements">
      <div className={styles.gateGrid}>{["Repeated walk-forward improvement over simple baselines","Stable performance across time blocks and market regimes","Reliable probability calibration and uncertainty bounds","Payout-aware positive expected value after costs","Drawdown and risk-budget analysis","Independent review before validation"].map((item) => <div key={item}><span>•</span>{item}</div>)}</div>
      <p className={styles.helper}>No model is promoted automatically. The current registry contains candidates unless an independent validation process has explicitly changed their status.</p>
    </Panel>
  </>;
}
