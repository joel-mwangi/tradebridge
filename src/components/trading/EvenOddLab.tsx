"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./EvenOddLab.module.css";

type LabStatus = {
  module?: string; status?: string; data_source?: string; storage_configured?: boolean;
  execution_enabled?: boolean; predictive_model_available?: boolean;
  research_pipeline_available?: boolean; persistent_session_management_available?: boolean;
  order_execution_enabled?: boolean; warning?: string;
};
type TickRow = { id: number; symbol: string; tick_epoch: number; quote?: string | number; last_digit: number; collection_id?: string };
type ModelRow = { id: string; model_version?: string; status?: string; market_symbol?: string; created_at?: string };
type ResearchRun = { id: string; market_symbol?: string; status?: string; started_at?: string; completed_at?: string; error_message?: string | null };
type ApiResult = Record<string, unknown>;
const SYMBOLS = ["R_50", "R_75", "1HZ100V", "1HZ75V"] as const;

function messageOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "detail" in value) {
    const detail = (value as { detail?: unknown }).detail;
    return typeof detail === "string" ? detail : JSON.stringify(detail);
  }
  return "The request could not be completed.";
}
function formatTime(epoch?: number | string) {
  if (epoch === undefined || epoch === null || epoch === "") return "—";
  const date = new Date(Number(epoch) * 1000);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}
function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className={styles.stat}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

export default function EvenOddLab() {
  const [symbol, setSymbol] = useState<(typeof SYMBOLS)[number]>("R_50");
  const [tickCount, setTickCount] = useState(100);
  const [timeoutSeconds, setTimeoutSeconds] = useState(60);
  const [status, setStatus] = useState<LabStatus | null>(null);
  const [history, setHistory] = useState<TickRow[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [runs, setRuns] = useState<ResearchRun[]>([]);
  const [quality, setQuality] = useState<ApiResult | null>(null);
  const [collection, setCollection] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeView, setActiveView] = useState<"overview" | "history" | "research">("overview");

  const request = useCallback(async (path: string, init?: RequestInit) => {
    const response = await fetch("/api/even-odd/" + path, {
      ...init, cache: "no-store",
      headers: { ...(init?.headers ?? {}), ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(messageOf(data));
    return data as ApiResult;
  }, []);

  const refresh = useCallback(async (selectedSymbol = symbol) => {
    setLoading(true); setError("");
    try {
      const [statusData, historyData, modelData, runData, qualityData] = await Promise.all([
        request("status"),
        request("history?symbol=" + encodeURIComponent(selectedSymbol) + "&limit=500"),
        request("models?symbol=" + encodeURIComponent(selectedSymbol)),
        request("research-runs?symbol=" + encodeURIComponent(selectedSymbol)),
        request("quality?symbol=" + encodeURIComponent(selectedSymbol) + "&limit=500"),
      ]);
      setStatus(statusData as LabStatus);
      setHistory(Array.isArray(historyData.rows) ? historyData.rows as TickRow[] : []);
      setModels(Array.isArray(modelData.models) ? modelData.models as ModelRow[] : []);
      setRuns(Array.isArray(runData.research_runs) ? runData.research_runs as ResearchRun[] : []);
      setQuality(qualityData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Even/Odd Lab.");
    } finally { setLoading(false); }
  }, [request, symbol]);

  useEffect(() => { void refresh(); }, [refresh]);
  const parity = useMemo(() => {
    const even = history.filter((tick) => tick.last_digit % 2 === 0).length;
    const odd = history.length - even;
    return { even, odd, evenPct: history.length ? even / history.length * 100 : 0, oddPct: history.length ? odd / history.length * 100 : 0 };
  }, [history]);

  async function collectTicks() {
    setCollecting(true); setError(""); setNotice(""); setCollection(null);
    try {
      const result = await request("collect", { method: "POST", body: JSON.stringify({ symbol, tick_count: tickCount, timeout_seconds: timeoutSeconds }) });
      setCollection(result);
      setNotice("Collection finished. Returned data is descriptive research data only.");
      await refresh(symbol);
    } catch (err) { setError(err instanceof Error ? err.message : "Tick collection failed."); }
    finally { setCollecting(false); }
  }

  const qualityData = quality?.quality && typeof quality.quality === "object" ? quality.quality as Record<string, unknown> : null;
  const candidateModels = models.filter((model) => model.status === "candidate");
  const validatedModels = models.filter((model) => model.status === "validated");

  return <section className={styles.lab} aria-label="Even/Odd Lab">
    <div className={styles.header}>
      <div><p className={styles.eyebrow}>INDEPENDENT RESEARCH MODULE</p><h1>Even/Odd Lab</h1><p className={styles.subtitle}>Collect, inspect and evaluate parity data from a dedicated Deriv public market-data feed.</p></div>
      <div className={styles.headerActions}>
        <label className={styles.marketSelect}><span>MARKET</span><select value={symbol} onChange={(event) => setSymbol(event.target.value as (typeof SYMBOLS)[number])}>{SYMBOLS.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
        <button type="button" className={styles.secondaryButton} onClick={() => void refresh(symbol)} disabled={loading || collecting}>Refresh data</button>
      </div>
    </div>
    <div className={styles.warning}><span className={styles.warningIcon}>!</span><div><strong>Research mode · No order execution</strong><p>{status?.warning ?? "Observed parity frequencies are descriptive. No trading signal is produced."} This module cannot place trades.</p></div></div>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {notice && <div className={styles.notice} role="status">{notice}</div>}
    <div className={styles.statusGrid}>
      <Stat label="MODULE" value={status?.status ?? (loading ? "Checking…" : "Unavailable")} detail="Dedicated Even/Odd service" />
      <Stat label="DATA STORAGE" value={status?.storage_configured ? "Configured" : "Not configured"} detail="Isolated research database" />
      <Stat label="PREDICTIVE MODEL" value={status?.predictive_model_available ? "Available" : "Not validated"} detail="No forecast promoted as a signal" />
      <Stat label="EXECUTION" value="Disabled" detail="No orders can be submitted" />
    </div>
    <div className={styles.tabs} role="tablist" aria-label="Even/Odd Lab views">
      <button type="button" role="tab" aria-selected={activeView === "overview"} className={activeView === "overview" ? styles.tabActive : ""} onClick={() => setActiveView("overview")}>Overview</button>
      <button type="button" role="tab" aria-selected={activeView === "history"} className={activeView === "history" ? styles.tabActive : ""} onClick={() => setActiveView("history")}>Tick history</button>
      <button type="button" role="tab" aria-selected={activeView === "research"} className={activeView === "research" ? styles.tabActive : ""} onClick={() => setActiveView("research")}>Models & research</button>
    </div>
    {activeView === "overview" && <>
      <div className={styles.overviewGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><p className={styles.eyebrow}>MARKET DATA</p><h2>Collect tick history</h2><p>Request a bounded collection from the dedicated Deriv public WebSocket.</p></div><span className={styles.livePill}>PUBLIC FEED</span></div>
          <div className={styles.formGrid}>
            <label><span>Ticks to collect</span><select value={tickCount} onChange={(event) => setTickCount(Number(event.target.value))}><option value={50}>50 ticks</option><option value={100}>100 ticks</option><option value={250}>250 ticks</option><option value={300}>300 ticks</option></select></label>
            <label><span>Receive timeout</span><select value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(Number(event.target.value))}><option value={15}>15 seconds</option><option value={30}>30 seconds</option><option value={60}>60 seconds</option><option value={80}>80 seconds</option></select></label>
          </div>
          <button type="button" className={styles.primaryButton} onClick={() => void collectTicks()} disabled={collecting || loading || !status?.storage_configured}>{collecting ? "Collecting ticks…" : "Start data collection"}</button>
          <p className={styles.helper}>Allowed by the backend: 10–300 ticks and a 5–80 second timeout. A timeout may return a partial collection.</p>
          {collection && <div className={styles.resultBox}><strong>Latest collection</strong><div><span>Received</span><b>{String(collection.returned_ticks ?? "—")} / {String(collection.requested_ticks ?? "—")}</b></div><div><span>Status</span><b>{String(collection.status ?? "—")}</b></div><div><span>Persisted</span><b>{collection.persisted ? "Yes" : "Not confirmed"}</b></div><small>ID: {String(collection.collection_id ?? "—")}</small></div>}
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><p className={styles.eyebrow}>OBSERVED DISTRIBUTION</p><h2>Parity snapshot</h2><p>Calculated from the latest {history.length} persisted ticks for {symbol}.</p></div></div>
          <div className={styles.parityRow}>
            <div><span className={styles.evenDot} /><strong>Even</strong><b>{parity.evenPct.toFixed(1)}%</b><small>{parity.even} observations</small></div>
            <div><span className={styles.oddDot} /><strong>Odd</strong><b>{parity.oddPct.toFixed(1)}%</b><small>{parity.odd} observations</small></div>
          </div>
          <div className={styles.bar}><span style={{ width: parity.evenPct + "%" }} /></div>
          <p className={styles.helper}>A historical imbalance does not establish next-tick predictability or a profitable edge.</p>
        </section>
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHeading}><div><p className={styles.eyebrow}>DATA INTEGRITY</p><h2>History quality audit</h2><p>Structural checks on persisted observations. Overlapping collection windows can contain duplicates.</p></div><span className={styles.auditBadge}>{qualityData ? "AUDIT LOADED" : "PENDING"}</span></div>
        {qualityData ? <pre className={styles.json}>{JSON.stringify(qualityData, null, 2)}</pre> : <p className={styles.empty}>Quality information is not available yet.</p>}
      </section>
    </>}
    {activeView === "history" && <section className={styles.panel}>
      <div className={styles.panelHeading}><div><p className={styles.eyebrow}>PERSISTED MARKET OBSERVATIONS</p><h2>Tick history · {symbol}</h2><p>Latest 500 rows returned in chronological order.</p></div><span className={styles.auditBadge}>{history.length} ROWS</span></div>
      {history.length ? <div className={styles.tableWrap}><table><thead><tr><th>Time</th><th>Quote</th><th>Last digit</th><th>Parity</th><th>Row ID</th></tr></thead><tbody>{history.slice().reverse().map((tick) => <tr key={tick.id}><td>{formatTime(tick.tick_epoch)}</td><td>{tick.quote ?? "—"}</td><td><b>{tick.last_digit}</b></td><td><span className={tick.last_digit % 2 === 0 ? styles.evenTag : styles.oddTag}>{tick.last_digit % 2 === 0 ? "EVEN" : "ODD"}</span></td><td>{tick.id}</td></tr>)}</tbody></table></div> : <p className={styles.empty}>{loading ? "Loading persisted history…" : "No persisted ticks found. Start a collection to populate history."}</p>}
    </section>}
    {activeView === "research" && <>
      <div className={styles.researchGrid}>
        <section className={styles.panel}><div className={styles.panelHeading}><div><p className={styles.eyebrow}>MODEL REGISTRY</p><h2>Models</h2><p>Candidate artifacts and validated metadata for {symbol}.</p></div></div>
          <div className={styles.modelSummary}><div><strong>{candidateModels.length}</strong><span>Candidate</span></div><div><strong>{validatedModels.length}</strong><span>Validated</span></div></div>
          {models.length ? <div className={styles.list}>{models.map((model) => <article key={model.id}><div><strong>{model.model_version ?? "Model version"}</strong><small>{model.id}</small></div><span className={model.status === "validated" ? styles.validated : styles.candidate}>{model.status ?? "unknown"}</span></article>)}</div> : <p className={styles.empty}>No model records yet. Candidate models are created by the local research runner, not this page.</p>}
        </section>
        <section className={styles.panel}><div className={styles.panelHeading}><div><p className={styles.eyebrow}>EXPERIMENT LOG</p><h2>Research runs</h2><p>Model-training and evaluation attempts.</p></div></div>
          {runs.length ? <div className={styles.list}>{runs.map((run) => <article key={run.id}><div><strong>{run.market_symbol ?? symbol} · {run.status ?? "unknown"}</strong><small>{formatTime(run.started_at)}{run.completed_at ? " → " + formatTime(run.completed_at) : ""}</small>{run.error_message && <small className={styles.runError}>{run.error_message}</small>}</div><span className={styles.runId}>{run.id.slice(0, 8)}</span></article>)}</div> : <p className={styles.empty}>No research runs recorded. Run the backend research pipeline locally when enough quality-checked data is available.</p>}
        </section>
      </div>
      <div className={styles.warning}><span className={styles.warningIcon}>i</span><div><strong>Research pipeline is not a live prediction service</strong><p>Candidate models must pass chronological holdout and walk-forward evaluation before validation. The frontend does not train, promote or approve models.</p></div></div>
    </>}
  </section>;
}
