"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import styles from "./EvenOddLab.module.css";
import EvenOddResearchPanels from "./EvenOddResearchPanels";

type LabStatus = {
  module?: string; status?: string; data_source?: string; storage_configured?: boolean;
  execution_enabled?: boolean; predictive_model_available?: boolean;
  research_pipeline_available?: boolean; persistent_session_management_available?: boolean;
  order_execution_enabled?: boolean; warning?: string;
};
type TickRow = { id: number; symbol: string; tick_epoch: number; quote?: string | number; last_digit: number; collection_id?: string };
type ModelRow = {
  id: string; model_name?: string; model_version?: string; status?: string; market_symbol?: string;
  created_at?: string; validated_at?: string; metrics?: Record<string, unknown>;
  training_rows?: number; validation_rows?: number; calibration_rows?: number; test_rows?: number;
  execution_authorized?: boolean;
};
type ResearchRun = { id: string; market_symbol?: string; status?: string; started_at?: string; completed_at?: string; error_message?: string | null; dataset_rows?: number; model_id?: string; evaluation?: Record<string, unknown>; partition_sizes?: Record<string, number>; quality_report?: Record<string, unknown> };
type SessionRecord = Record<string, unknown> & { id?: string; market_symbol?: string; status?: string; account_mode?: string; currency?: string; fixed_stake?: string | number; max_session_loss?: string | number; completed_trades?: number; consecutive_losses?: number; realized_profit?: string | number };
type SequenceRecord = Record<string, unknown> & { id?: string; status?: string; planned_trades?: number; completed_trades?: number };
type ApiResult = Record<string, unknown>;
type PayoutQuote = { payout?: string | number; ask_price?: string | number; profit_if_win?: string | number; loss_if_lose?: string | number };
type CollectionJob = { id: string; market_symbol: string; target_ticks: number; received_ticks: number; status: string; last_error?: string | null; created_at?: string; updated_at?: string };
const SYMBOLS = ["R_50", "R_75", "1HZ100V", "1HZ75V"] as const;
const CURRENCIES = ["USD", "EUR", "GBP"] as const;

function messageOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "detail" in value) {
    const detail = (value as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object" && "message" in detail) return String((detail as { message: unknown }).message);
    return JSON.stringify(detail);
  }
  return "The request could not be completed.";
}
function formatTime(epoch?: number | string) {
  if (epoch === undefined || epoch === null || epoch === "") return "—";
  const numeric = Number(epoch);
  const date = new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}
function formatMoney(value: unknown, currency = "USD") {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 4 }).format(amount) : "—";
}
function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className={styles.stat}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className={styles.field}><span>{label}</span>{children}</label>;
}
function JsonPanel({ value }: { value: unknown }) {
  return <pre className={styles.json}>{JSON.stringify(value, null, 2)}</pre>;
}

export default function EvenOddLab() {
  const [symbol, setSymbol] = useState<(typeof SYMBOLS)[number]>("R_50");
  const [collectionJob, setCollectionJob] = useState<CollectionJob | null>(null);
  const [collectionTarget, setCollectionTarget] = useState(1000);
  const collectionSocketRef = useRef<WebSocket | null>(null);
  const collectionStopRef = useRef(false);
  const collectionProcessingRef = useRef<Promise<void>>(Promise.resolve());
  const [status, setStatus] = useState<LabStatus | null>(null);
  const [history, setHistory] = useState<TickRow[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [runs, setRuns] = useState<ResearchRun[]>([]);
  const [quality, setQuality] = useState<ApiResult | null>(null);
  const [sampleAnalysis, setSampleAnalysis] = useState<ApiResult | null>(null);
  const [payout, setPayout] = useState<ApiResult | null>(null);
  const [forecast, setForecast] = useState<ApiResult | null>(null);
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [sessionIdInput, setSessionIdInput] = useState("");
  const [sequence, setSequence] = useState<SequenceRecord | null>(null);
  const [sequenceDetails, setSequenceDetails] = useState<ApiResult | null>(null);
  const [entryResult, setEntryResult] = useState<ApiResult | null>(null);
  const [planResult, setPlanResult] = useState<ApiResult | null>(null);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [activeView, setActiveView] = useState<"overview" | "ml" | "entry" | "backtesting" | "performance" | "session">("overview");
  const [stake, setStake] = useState("1.00");
  const [maxLoss, setMaxLoss] = useState("10.00");
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>("USD");
  const [accountMode, setAccountMode] = useState<"research" | "demo" | "real">("research");
  const [settlement, setSettlement] = useState({
    tradeNumber: "1", side: "even" as "even" | "odd", outcome: "win" as "win" | "loss",
    profitIfWin: "", lossIfLose: "", evenProbability: "", lowerEvenProbability: "",
    upperEvenProbability: "", conservativeExpectedValue: "", realizedProfit: "",
    externalContractId: "",
  });
  const [revalidation, setRevalidation] = useState({
    model_validated: false, uncertainty_validated: false, signal_valid: false,
    data_fresh: false, risk_budget_available: false,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const request = useCallback(async (path: string, init?: RequestInit): Promise<ApiResult> => {
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
        request("history?symbol=" + encodeURIComponent(selectedSymbol) + "&limit=5000"),
        request("models?symbol=" + encodeURIComponent(selectedSymbol) + "&limit=100"),
        request("research-runs?symbol=" + encodeURIComponent(selectedSymbol) + "&limit=100"),
        request("quality?symbol=" + encodeURIComponent(selectedSymbol) + "&limit=5000"),
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
  const refreshCollectionJob = useCallback(async (selectedSymbol = symbol) => {
    try {
      const result = await request("collection-jobs/active?symbol=" + encodeURIComponent(selectedSymbol));
      setCollectionJob(result.job && typeof result.job === "object" ? result.job as CollectionJob : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh collection status.");
    }
  }, [request, symbol]);
  useEffect(() => {
    void refreshCollectionJob();
    const timer = window.setInterval(() => { void refreshCollectionJob(); }, 2000);
    return () => window.clearInterval(timer);
  }, [refreshCollectionJob]);
  useEffect(() => {
    if (!models.some((model) => model.id === selectedModelId)) {
      setSelectedModelId(models.find((model) => model.status === "validated")?.id ?? models[0]?.id ?? "");
    }
  }, [models, selectedModelId]);

  const parity = useMemo(() => {
    const even = history.filter((tick) => tick.last_digit % 2 === 0).length;
    const odd = history.length - even;
    return { even, odd, evenPct: history.length ? even / history.length * 100 : 0, oddPct: history.length ? odd / history.length * 100 : 0 };
  }, [history]);
  const selectedModel = models.find((model) => model.id === selectedModelId) ?? null;
  const latestTicks = history.slice(-7);
  const latestThree = history.slice(-3);
  const qualityData = quality?.quality && typeof quality.quality === "object" ? quality.quality as Record<string, unknown> : null;
  const candidateModels = models.filter((model) => model.status === "candidate");
  const validatedModels = models.filter((model) => model.status === "validated");
  const sequenceRows = sequenceDetails?.sequences;
  const activeSequences = Array.isArray(sequenceRows)
    ? sequenceRows as SequenceRecord[]
    : [];

  async function runAction(key: string, action: () => Promise<void>) {
    setBusy(key); setError(""); setNotice("");
    try { await action(); }
    catch (err) { setError(err instanceof Error ? err.message : "The request failed."); }
    finally { setBusy(""); }
  }

  async function startTickCollection() {
    await runAction("collection-start", async () => {
      if (collectionSocketRef.current && collectionSocketRef.current.readyState < WebSocket.CLOSING) {
        throw new Error("A browser collection is already running in this tab.");
      }
      collectionStopRef.current = false;
      collectionProcessingRef.current = Promise.resolve();
      const created = await request("collection-jobs", {
        method: "POST",
        body: JSON.stringify({ symbol, target_ticks: collectionTarget }),
      });
      const job = created.job as CollectionJob;
      setCollectionJob(job);
      setNotice("Connecting to Deriv. Keep this tab open and your computer awake until collection finishes.");
      const ws = new WebSocket("wss://api.derivws.com/trading/v1/options/ws/public");
      collectionSocketRef.current = ws;
      let received = 0;
      let batch: Record<string, unknown>[] = [];
      let finished = false;
      const flush = async () => {
        if (!batch.length) return;
        const outgoing = batch;
        batch = [];
        const saved = await request("collection-jobs/" + encodeURIComponent(job.id) + "/batch", {
          method: "POST", body: JSON.stringify({ ticks: outgoing }),
        });
        setCollectionJob(saved.job as CollectionJob);
        received = Number((saved.job as CollectionJob).received_ticks ?? received + outgoing.length);
        await refresh(symbol);
      };
      ws.onopen = () => {
        ws.send(JSON.stringify({ ticks: symbol, subscribe: 1, req_id: 8801 }));
        setNotice("Connected to Deriv. Receiving live ticks; keep this tab open.");
      };
      ws.onmessage = (event) => {
        collectionProcessingRef.current = collectionProcessingRef.current.then(async () => {
          if (finished || collectionStopRef.current) return;
          const message = JSON.parse(String(event.data)) as { msg_type?: string; error?: { message?: string }; tick?: Record<string, unknown>; subscription?: { id?: string } };
          if (message.error) throw new Error(message.error.message ?? "Deriv subscription failed.");
          if (message.msg_type !== "tick" || !message.tick || message.tick.symbol !== symbol) return;
          batch.push({
            tick: message.tick,
            subscription_id: message.subscription?.id == null ? null : String(message.subscription.id),
          });
          received += 1;
          if (batch.length >= 100 || received >= collectionTarget) {
            await flush();
          }
          if (received >= collectionTarget) {
            finished = true;
            ws.close(1000, "Target reached");
          }
        }).catch((error) => {
          collectionStopRef.current = true;
          setError(error instanceof Error ? error.message : "Browser collection failed.");
          ws.close(1011, "Collection failed");
        });
      };
      ws.onerror = () => { collectionStopRef.current = true; setError("Deriv WebSocket connection failed. Check your connection and retry."); ws.close(1011, "Connection error"); };
      ws.onclose = () => {
        collectionProcessingRef.current = collectionProcessingRef.current.then(async () => {
          await flush();
          if (collectionStopRef.current && !finished) {
            const stopped = await request("collection-jobs/" + encodeURIComponent(job.id) + "/stop", { method: "POST" });
            setCollectionJob(stopped.job as CollectionJob);
            setNotice("Collection stopped. Successfully persisted ticks are retained.");
          } else if (received >= collectionTarget) {
            setNotice("Collection completed. All target ticks were persisted.");
          } else if (!finished) {
            const stopped = await request("collection-jobs/" + encodeURIComponent(job.id) + "/stop", { method: "POST" });
            setCollectionJob(stopped.job as CollectionJob);
            setError("The Deriv connection closed before the target was reached. The job is stopped with a partial sample.");
          }
          collectionSocketRef.current = null;
          await refresh(symbol);
        }).catch((error) => setError(error instanceof Error ? error.message : "Could not finalize collection."));
      };
    });
  }

  async function stopTickCollection() {
    if (!collectionJob?.id) return;
    await runAction("collection-stop", async () => {
      collectionStopRef.current = true;
      const socket = collectionSocketRef.current;
      if (socket && socket.readyState < WebSocket.CLOSING) {
        socket.close(1000, "User requested stop");
      } else {
        const result = await request("collection-jobs/" + encodeURIComponent(collectionJob.id) + "/stop", { method: "POST" });
        setCollectionJob(result.job as CollectionJob);
      }
      setNotice("Stop requested. The browser will persist its current batch and close the Deriv connection.");
    });
  }

  async function analyzeSample() {
    if (!history.length) throw new Error("Collect or load persisted ticks before running the descriptive analysis.");
    await runAction("analyze", async () => {
      const result = await request("analyze", { method: "POST", body: JSON.stringify({ digits: history.slice(-5000).map((tick) => tick.last_digit) }) });
      setSampleAnalysis(result);
    });
  }

  async function loadPayout() {
    await runAction("payout", async () => {
      const result = await request("payouts?symbol=" + encodeURIComponent(symbol) + "&currency=" + currency + "&stake=" + encodeURIComponent(stake));
      setPayout(result);
      const selectedQuote = result.even as PayoutQuote | undefined;
      if (selectedQuote) setSettlement((previous) => ({ ...previous, profitIfWin: String(selectedQuote.profit_if_win ?? previous.profitIfWin), lossIfLose: String(selectedQuote.loss_if_lose ?? previous.lossIfLose) }));
    });
  }

  async function loadForecast() {
    if (!selectedModel) return;
    await runAction("forecast", async () => {
      const result = await request("forecast?symbol=" + encodeURIComponent(symbol) + "&model_id=" + encodeURIComponent(selectedModel.id));
      setForecast(result);
    });
  }

  async function createSession() {
    await runAction("create-session", async () => {
      const result = await request("sessions", {
        method: "POST",
        body: JSON.stringify({
          symbol, account_mode: accountMode, currency, fixed_stake: stake,
          max_session_loss: maxLoss, max_trades_per_session: 10, max_consecutive_losses: 2,
        }),
      });
      const created = result.session as SessionRecord;
      setSession(created);
      setSessionIdInput(String(created.id ?? ""));
      setStake(String(created.fixed_stake ?? stake));
      if (typeof created.currency === "string" && CURRENCIES.includes(created.currency as (typeof CURRENCIES)[number])) setCurrency(created.currency as (typeof CURRENCIES)[number]);
      setSequence(null); setSequenceDetails(null); setPlanResult(null); setEntryResult(null);
      setNotice("Research ledger session created. No broker account was connected and no order was placed.");
      setActiveView("session");
    });
  }

  async function loadSession(id = sessionIdInput) {
    if (!id.trim()) throw new Error("Enter a session ID or create a session first.");
    await runAction("load-session", async () => {
      const result = await request("sessions/" + encodeURIComponent(id.trim()));
      const loadedSession = result.session as SessionRecord;
      setSession(loadedSession);
      setStake(String(loadedSession.fixed_stake ?? stake));
      if (typeof loadedSession.currency === "string" && CURRENCIES.includes(loadedSession.currency as (typeof CURRENCIES)[number])) setCurrency(loadedSession.currency as (typeof CURRENCIES)[number]);
      if (loadedSession.account_mode === "research" || loadedSession.account_mode === "demo" || loadedSession.account_mode === "real") setAccountMode(loadedSession.account_mode);
      setSessionIdInput(id.trim());
      setSequenceDetails(result);
      const seqs = Array.isArray(result.sequences) ? result.sequences as SequenceRecord[] : [];
      setSequence(seqs.find((item) => item.status === "active") ?? seqs[0] ?? null);
      setNotice("Session and sequence ledger refreshed.");
    });
  }

  function observations(rows: TickRow[]) {
    return rows.map((row) => ({ tick_row_id: row.id, tick_epoch: row.tick_epoch }));
  }

  async function evaluateEntry() {
    if (!session?.id || !selectedModel) throw new Error("Select a model and load an active session.");
    if (selectedModel.status !== "validated") throw new Error("Entry evaluation requires a validated model.");
    if (latestThree.length !== 3) throw new Error("At least three persisted ticks are required.");
    if (latestThree.some((tick) => Date.now() / 1000 - tick.tick_epoch > 10)) throw new Error("The three confirmation ticks are stale. Collect fresh ticks and retry.");
    await runAction("entry", async () => {
      const result = await request("entry-check", {
        method: "POST",
        body: JSON.stringify({
          session_id: session.id,
          observations: latestThree.map((row) => ({
            tick_row_id: row.id, tick_epoch: row.tick_epoch,
            model_id: selectedModel.id, model_version: selectedModel.model_version,
          })),
        }),
      });
      setEntryResult(result);
      setNotice(result.status === "candidate"
        ? "Entry evidence passed the backend research gates. This is not an order instruction."
        : "Backend returned WAIT. No order was placed.");
    });
  }

  async function planSequence() {
    if (!session?.id || !selectedModel) throw new Error("Select a model and load an active session.");
    if (selectedModel.status !== "validated") throw new Error("Sequence planning requires a validated model.");
    if (latestTicks.length < 3) throw new Error("At least three consecutive persisted ticks are required.");
    await runAction("plan", async () => {
      const result = await request("sequence-plan", {
        method: "POST",
        body: JSON.stringify({
          session_id: session.id, model_id: selectedModel.id, model_version: selectedModel.model_version,
          observations: observations(latestTicks),
        }),
      });
      setPlanResult(result);
      setNotice(result.status === "plan"
        ? "The backend produced a risk-bounded sequence upper bound. Starting it requires a separate confirmation."
        : "No sequence plan was approved. Review the backend reason.");
    });
  }

  async function startSequence() {
    if (!session?.id || !selectedModel) throw new Error("Session and model are required.");
    if (planResult?.status !== "plan" || Number(planResult.planned_trades) < 1) throw new Error("There is no approved plan to start.");
    await runAction("start-sequence", async () => {
      const result = await request("sequences", {
        method: "POST",
        body: JSON.stringify({
          session_id: session.id, model_id: selectedModel.id, model_version: selectedModel.model_version,
          observations: observations(latestTicks),
        }),
      });
      if (result.sequence_started && result.sequence) {
        setSequence(result.sequence as SequenceRecord);
        setNotice("Sequence ledger started. This records a plan only; it does not submit a Deriv order.");
      } else {
        setNotice(String(result.reason ?? "The backend did not start the sequence."));
      }
      await loadSession(session.id);
    });
  }

  async function loadSequence(id?: string) {
    const sequenceId = id ?? sequence?.id;
    if (!sequenceId) throw new Error("No sequence ID is available.");
    await runAction("load-sequence", async () => {
      const result = await request("sequences/" + encodeURIComponent(sequenceId));
      setSequence(result.sequence as SequenceRecord);
      setSequenceDetails((previous) => ({ ...(previous ?? {}), sequenceDetail: result }));
      setNotice("Sequence and recorded settlement history refreshed.");
    });
  }

  async function recordSettlement() {
    if (!sequence?.id) throw new Error("Load an active sequence first.");
    await runAction("settlement", async () => {
      const payload = {
        sequence_id: sequence.id, trade_number: Number(settlement.tradeNumber), side: settlement.side,
        stake: String(session?.fixed_stake ?? stake), profit_if_win: settlement.profitIfWin, loss_if_lose: settlement.lossIfLose,
        even_probability: settlement.evenProbability, lower_even_probability: settlement.lowerEvenProbability,
        upper_even_probability: settlement.upperEvenProbability,
        conservative_expected_value: settlement.conservativeExpectedValue,
        revalidation, outcome: settlement.outcome, realized_profit: settlement.realizedProfit,
        external_contract_id: settlement.externalContractId || null,
      };
      await request("settlements", { method: "POST", body: JSON.stringify(payload) });
      setNotice("Settlement recorded in the research ledger. This action did not place or close a broker contract.");
      if (session?.id) await loadSession(session.id);
      await loadSequence(sequence.id);
      setSettlement((previous) => ({ ...previous, tradeNumber: String(Number(previous.tradeNumber) + 1) }));
    });
  }

  const payoutEven = payout?.even as PayoutQuote | undefined;
  const payoutOdd = payout?.odd as PayoutQuote | undefined;
  const forecastProbability = Number(forecast?.probability_even);
  const sessionActive = session?.status === "active";
  const entryFresh = latestThree.length === 3 && latestThree.every((tick) => Date.now() / 1000 - tick.tick_epoch <= 10);

  return <section className={styles.lab} aria-label="Even/Odd Lab">
    <div className={styles.header}>
      <div><p className={styles.eyebrow}>INDEPENDENT RESEARCH MODULE</p><h1>Even/Odd Lab</h1><p className={styles.subtitle}>A separate research and risk-management workspace for parity data, model evaluation and session records.</p></div>
      <div className={styles.headerActions}>
        <label className={styles.marketSelect}><span>MARKET</span><select value={symbol} onChange={(event) => { setSymbol(event.target.value as (typeof SYMBOLS)[number]); setPayout(null); setForecast(null); }}>{
          SYMBOLS.map((item) => <option value={item} key={item}>{item}</option>)
        }</select></label>
        <button type="button" className={styles.secondaryButton} onClick={() => void refresh(symbol)} disabled={loading || !!busy}>Refresh data</button>
      </div>
    </div>

    <div className={styles.warning}><span className={styles.warningIcon}>!</span><div><strong>Research and ledger mode · broker execution disabled</strong><p>{status?.warning ?? "No trading signal is produced."} Session creation, entry evaluation, sequence planning and settlement logging do not place, buy or close Deriv contracts.</p></div></div>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {notice && <div className={styles.notice} role="status">{notice}</div>}

    <div className={styles.statusGrid}>
      <Stat label="MODULE" value={status?.status ?? (loading ? "Checking…" : "Unavailable")} detail="Dedicated Even/Odd service" />
      <Stat label="DATA STORAGE" value={status?.storage_configured ? "Configured" : "Not configured"} detail="Isolated research database" />
      <Stat label="VALIDATED MODELS" value={String(validatedModels.length)} detail={candidateModels.length + " candidate model(s)"} />
      <Stat label="ORDER EXECUTION" value="Disabled" detail="No orders can be submitted" />
    </div>

    <div className={styles.tabs} role="tablist" aria-label="Even/Odd Lab sections">
      {([
        ["overview", "Overview"], ["ml", "ML Predictions"], ["entry", "Entry Intelligence"],
        ["backtesting", "Backtesting"], ["performance", "Performance"], ["session", "Sessions & risk"],
      ] as const).map(([view, label]) =>
        <button type="button" role="tab" aria-selected={activeView === view} className={activeView === view ? styles.tabActive : ""} onClick={() => setActiveView(view)} key={view}>{label}</button>
      )}
    </div>

    {activeView === "overview" && <>
      <div className={styles.overviewGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><p className={styles.eyebrow}>LIVE MARKET DATA</p><h2>Manual tick collection</h2><p>Collect a bounded sample directly from the live Deriv feed.</p></div><span className={styles.livePill}>LIVE ONLY</span></div>
          <div className={styles.formGrid}>
            <Field label="Ticks to collect">
              <select value={collectionTarget} onChange={(event) => setCollectionTarget(Number(event.target.value))} disabled={!!collectionJob && ["queued", "collecting"].includes(collectionJob.status)}>
                <option value={500}>500 ticks</option><option value={1000}>1,000 ticks</option><option value={2500}>2,500 ticks</option><option value={5000}>5,000 ticks</option>
              </select>
            </Field>
            <div className={styles.field}><span>Selected market</span><strong>{symbol}</strong></div>
          </div>
          <div className={styles.statusGrid}>
            <Stat label="JOB STATUS" value={collectionJob?.status ?? "Idle"} detail={collectionJob?.id ? "Collection job " + collectionJob.id.slice(0, 8) : "No job for this market"} />
            <Stat label="TICKS RECEIVED" value={String(collectionJob?.received_ticks ?? 0)} detail={"Target: " + String(collectionJob?.target_ticks ?? collectionTarget)} />
            <Stat label="PROGRESS" value={collectionJob ? Math.min(100, collectionJob.received_ticks / collectionJob.target_ticks * 100).toFixed(1) + "%" : "0%"} detail="Persisted browser progress" />
          </div>
          <div className={styles.bar}><span style={{ width: (collectionJob ? Math.min(100, collectionJob.received_ticks / collectionJob.target_ticks * 100) : 0) + "%" }} /></div>
          {collectionJob?.last_error && <div className={styles.warning}><span className={styles.warningIcon}>!</span><div><strong>Collection error</strong><p>{collectionJob.last_error}</p></div></div>}
          <div className={styles.sessionActions}>
            <button type="button" className={styles.primaryButton} onClick={() => void startTickCollection()} disabled={!!busy || !!collectionJob && ["queued", "collecting"].includes(collectionJob.status)}>{busy === "collection-start" ? "Starting…" : "Start collection"}</button>
            <button type="button" className={styles.secondaryButton} onClick={() => void stopTickCollection()} disabled={!!busy || !collectionJob || !["queued", "collecting"].includes(collectionJob.status)}>{busy === "collection-stop" ? "Stopping…" : "Stop collection"}</button>
          </div>
          <p className={styles.helper}>Collection runs in this browser tab. Keep the tab open and your computer awake. Closing the tab, losing network connectivity or suspending the browser can interrupt collection. Only newly received live ticks are stored; no historical backfill is used.</p>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><p className={styles.eyebrow}>OBSERVED DISTRIBUTION</p><h2>Parity snapshot</h2><p>{history.length} live-captured observations for {symbol}.</p></div></div>
          <div className={styles.parityRow}>
            <div><span className={styles.evenDot} /><strong>Even</strong><b>{parity.evenPct.toFixed(1)}%</b><small>{parity.even} observations</small></div>
            <div><span className={styles.oddDot} /><strong>Odd</strong><b>{parity.oddPct.toFixed(1)}%</b><small>{parity.odd} observations</small></div>
          </div>
          <div className={styles.bar}><span style={{ width: parity.evenPct + "%" }} /></div>
          <p className={styles.helper}>Observed live frequency is descriptive. It does not establish next-tick predictability or profitability.</p>
          <button type="button" className={styles.secondaryButton} onClick={() => void analyzeSample()} disabled={!!busy || history.length === 0}>{busy === "analyze" ? "Analyzing…" : "Run descriptive sample analysis"}</button>
          {sampleAnalysis && <div className={styles.resultBox}><strong>Descriptive analysis · {String(sampleAnalysis.returned_ticks ?? "—")} observations</strong><JsonPanel value={sampleAnalysis.analysis ?? sampleAnalysis} /></div>}
        </section>
      </div>

      <div className={styles.overviewGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><p className={styles.eyebrow}>LIVE PRICE TERMS</p><h2>Read-only payout quote</h2><p>Request current DIGITEVEN and DIGITODD proposal terms. No proposal is purchased.</p></div></div>
          <div className={styles.formGrid}>
            <Field label="Currency"><select value={currency} onChange={(event) => setCurrency(event.target.value as (typeof CURRENCIES)[number])}>{CURRENCIES.map((item) => <option key={item}>{item}</option>)}</select></Field>
            <Field label="Stake amount"><input type="number" min="0.35" step="0.01" value={stake} onChange={(event) => setStake(event.target.value)} /></Field>
          </div>
          <button type="button" className={styles.secondaryButton} onClick={() => void loadPayout()} disabled={!!busy || !stake || Number(stake) <= 0}>{busy === "payout" ? "Fetching quote…" : "Fetch payout quote"}</button>
          {payout && <div className={styles.quoteGrid}>
            <div><strong>EVEN</strong><b>{formatMoney(payoutEven?.payout, currency)}</b><small>Ask {formatMoney(payoutEven?.ask_price, currency)} · profit {formatMoney(payoutEven?.profit_if_win, currency)}</small></div>
            <div><strong>ODD</strong><b>{formatMoney(payoutOdd?.payout, currency)}</b><small>Ask {formatMoney(payoutOdd?.ask_price, currency)} · profit {formatMoney(payoutOdd?.profit_if_win, currency)}</small></div>
          </div>}
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><p className={styles.eyebrow}>DATA INTEGRITY</p><h2>Live data quality audit</h2><p>Structural checks on live-captured observations; possible same-second repeats are reported, not discarded.</p></div><span className={styles.auditBadge}>{qualityData ? "AUDIT LOADED" : "PENDING"}</span></div>
          {qualityData ? <JsonPanel value={qualityData} /> : <p className={styles.empty}>Quality information is not available yet.</p>}
        </section>
      </div>
    </>}

    {activeView === "overview" && <section className={styles.panel}>
      <div className={styles.panelHeading}><div><p className={styles.eyebrow}>DIGIT STRUCTURE</p><h2>Digit frequency & sequence behaviour</h2><p>Descriptive statistics from {history.length} live-captured observations. Frequencies do not predict the next tick.</p></div></div>
      <div className={styles.digitGrid}>{Array.from({ length: 10 }, (_, digit) => {
        const count = history.filter((tick) => tick.last_digit === digit).length;
        const share = history.length ? count / history.length * 100 : 0;
        return <div className={styles.digitCell} key={digit}><div><b>{digit}</b><strong>{share.toFixed(1)}%</strong></div><span><i style={{ width: share + "%" }} /></span><small>{count} observations</small></div>;
      })}</div>
      <div className={styles.sequenceSummary}>
        <div><span>Latest 12 digits</span><strong>{history.slice(-12).map((tick) => tick.last_digit).join(" · ") || "—"}</strong></div>
        <div><span>Current parity streak</span><strong>{(() => { const rows = history.slice().reverse(); if (!rows.length) return "—"; const parity = rows[0].last_digit % 2; let count = 0; for (const row of rows) { if (row.last_digit % 2 !== parity) break; count++; } return count + " " + (parity === 0 ? "Even" : "Odd"); })()}</strong></div>
        <div><span>Longest observed streak</span><strong>{(() => { let best = 0, current = 0, last = -1; for (const row of history) { const p = row.last_digit % 2; current = p === last ? current + 1 : 1; last = p; best = Math.max(best, current); } return best ? String(best) + " ticks" : "—"; })()}</strong></div>
      </div>
      <div className={styles.sequenceSummary}>
        <div><span>Last 20 parity frequency</span><strong>{(() => { const rows = history.slice(-20); const even = rows.filter((row) => row.last_digit % 2 === 0).length; return rows.length ? ((even / rows.length) * 100).toFixed(1) + "% Even · " + (100 - even / rows.length * 100).toFixed(1) + "% Odd" : "—"; })()}</strong></div>
        <div><span>Prior 20 parity frequency</span><strong>{(() => { const rows = history.slice(-40, -20); const even = rows.filter((row) => row.last_digit % 2 === 0).length; return rows.length ? ((even / rows.length) * 100).toFixed(1) + "% Even · " + (100 - even / rows.length * 100).toFixed(1) + "% Odd" : "Insufficient history"; })()}</strong></div>
        <div><span>Momentum shift</span><strong>{(() => { const recent = history.slice(-20); const prior = history.slice(-40, -20); if (recent.length < 20 || prior.length < 20) return "Insufficient sample"; const a = recent.filter((row) => row.last_digit % 2 === 0).length / 20; const b = prior.filter((row) => row.last_digit % 2 === 0).length / 20; const delta = (a - b) * 100; return (delta > 0 ? "+" : "") + delta.toFixed(1) + " pp Even"; })()}</strong></div>
      </div>
      <div className={styles.tableWrap}><table><thead><tr><th>Transition</th><th>Count</th></tr></thead><tbody>{(() => { const counts = { "Even → Even": 0, "Even → Odd": 0, "Odd → Even": 0, "Odd → Odd": 0 }; for (let i = 1; i < history.length; i++) { const from = history[i - 1].last_digit % 2 === 0 ? "Even" : "Odd"; const to = history[i].last_digit % 2 === 0 ? "Even" : "Odd"; counts[`${from} → ${to}` as keyof typeof counts]++; } return Object.entries(counts).map(([label, count]) => <tr key={label}><td>{label}</td><td>{count}</td></tr>); })()}</tbody></table></div>
      <p className={styles.helper}>Momentum and transition counts are descriptive sample diagnostics. They are not regime forecasts and do not establish serial dependence or a next-tick edge.</p>
      <div className={styles.tableWrap}><table><thead><tr><th>Recent time</th><th>Quote</th><th>Digit</th><th>Parity</th></tr></thead><tbody>{history.slice(-12).reverse().map((tick) => <tr key={tick.id}><td>{formatTime(tick.tick_epoch)}</td><td>{tick.quote ?? "—"}</td><td><b>{tick.last_digit}</b></td><td>{tick.last_digit % 2 === 0 ? "Even" : "Odd"}</td></tr>)}</tbody></table></div>
      <p className={styles.helper}>This view describes the sample only. A streak, frequency imbalance or transition count is not evidence of a predictive edge without chronological out-of-sample testing.</p>
    </section>}

    {(["ml", "entry", "backtesting", "performance"] as const).includes(activeView as "ml" | "entry" | "backtesting" | "performance") && <EvenOddResearchPanels
      view={activeView as "ml" | "entry" | "backtesting" | "performance"}
      symbol={symbol} models={models} runs={runs} selectedModelId={selectedModelId}
      onSelectModel={(id) => { setSelectedModelId(id); setForecast(null); }}
      forecast={forecast} onLoadForecast={() => void loadForecast()} busy={busy}
      history={history} session={session} entryResult={entryResult} planResult={planResult}
      onEvaluateEntry={() => void evaluateEntry()} onPlanSequence={() => void planSequence()}
      onStartSequence={() => void startSequence()}
    />}

    {activeView === "session" && <>
      <div className={styles.overviewGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><p className={styles.eyebrow}>SESSION CONFIGURATION</p><h2>Create risk-bounded session</h2><p>Creates a persistent research ledger. “Demo” and “real” are labels only; neither connects to an account or executes orders.</p></div></div>
          <div className={styles.formGrid}>
            <Field label="Account mode"><select value={accountMode} onChange={(event) => setAccountMode(event.target.value as typeof accountMode)}><option value="research">Research</option><option value="demo">Demo ledger</option><option value="real">Real-account ledger (no execution)</option></select></Field>
            <Field label="Currency"><select value={currency} onChange={(event) => setCurrency(event.target.value as (typeof CURRENCIES)[number])}>{CURRENCIES.map((item) => <option key={item}>{item}</option>)}</select></Field>
            <Field label="Fixed stake"><input type="number" min="0.01" step="0.01" value={stake} onChange={(event) => setStake(event.target.value)} /></Field>
            <Field label="Maximum session loss"><input type="number" min="0.01" step="0.01" value={maxLoss} onChange={(event) => setMaxLoss(event.target.value)} /></Field>
          </div>
          <button type="button" className={styles.primaryButton} onClick={() => void createSession()} disabled={!!busy || !status?.storage_configured || Number(stake) <= 0 || Number(maxLoss) <= 0}>{busy === "create-session" ? "Creating…" : "Create session ledger"}</button>
          <p className={styles.helper}>Backend-enforced limits: maximum 10 trades per session, maximum 7 trades per sequence and stop after 2 consecutive losses.</p>
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><p className={styles.eyebrow}>EXISTING SESSION</p><h2>Load session</h2><p>Retrieve a session by its UUID to continue reviewing its ledger.</p></div></div>
          <Field label="Session ID"><input value={sessionIdInput} onChange={(event) => setSessionIdInput(event.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></Field>
          <button type="button" className={styles.secondaryButton} onClick={() => void loadSession()} disabled={!!busy || !sessionIdInput.trim()}>{busy === "load-session" ? "Loading…" : "Load session"}</button>
        </section>
      </div>

      {session && <section className={styles.panel}>
        <div className={styles.panelHeading}><div><p className={styles.eyebrow}>PERSISTENT RISK LEDGER</p><h2>Session overview</h2><p>{String(session.id)} · {session.market_symbol ?? symbol}</p></div><span className={session.status === "active" ? styles.validated : styles.candidate}>{session.status ?? "unknown"}</span></div>
        <div className={styles.statusGrid}>
          <Stat label="FIXED STAKE" value={formatMoney(session.fixed_stake, String(session.currency ?? currency))} detail={String(session.account_mode ?? "research") + " ledger"} />
          <Stat label="LOSS LIMIT" value={formatMoney(session.max_session_loss, String(session.currency ?? currency))} detail="Configured session cap" />
          <Stat label="COMPLETED TRADES" value={String(session.completed_trades ?? 0)} detail="Maximum 10 per session" />
          <Stat label="CONSECUTIVE LOSSES" value={String(session.consecutive_losses ?? 0)} detail="Stop threshold: 2" />
        </div>
        <div className={styles.sessionActions}>
          <button type="button" className={styles.secondaryButton} onClick={() => void loadSession(String(session.id))} disabled={!!busy}>Refresh session</button>
          <button type="button" className={styles.secondaryButton} onClick={() => void evaluateEntry()} disabled={!!busy || !sessionActive || !selectedModel || selectedModel.status !== "validated" || !entryFresh || latestThree.length !== 3}>Evaluate latest 3 ticks</button>
          <button type="button" className={styles.secondaryButton} onClick={() => void planSequence()} disabled={!!busy || !sessionActive || !selectedModel || selectedModel.status !== "validated" || latestTicks.length < 3}>Plan adaptive sequence</button>
        </div>
        <p className={styles.helper}>Entry checks require three consecutive persisted ticks, fresh data (maximum 10 seconds), a validated model and the backend’s payout-adjusted risk gates. Wait for fresh live ticks to be persisted before evaluation.</p>
        {!selectedModel && <p className={styles.empty}>No model selected. Open Models & research to select one.</p>}
        {selectedModel && selectedModel.status !== "validated" && <p className={styles.empty}>Selected model is {selectedModel.status}. Entry evaluation and sequence planning remain unavailable until independent validation.</p>}
        {entryResult && <div className={styles.resultBox}><strong>Entry evaluation · {String(entryResult.status ?? "unknown").toUpperCase()}</strong><p>{String(entryResult.reason ?? "Backend evaluation completed. No order was placed.")}</p><JsonPanel value={entryResult} /></div>}
        {planResult && <div className={styles.resultBox}><strong>Adaptive sequence plan · {String(planResult.status ?? "unknown").toUpperCase()}</strong><div><span>Planned upper bound</span><b>{String(planResult.planned_trades ?? 0)} trade(s), max 7</b></div><p>{String(planResult.plan_reason ?? planResult.reason ?? "")}</p><p className={styles.helper}>{String(planResult.warning ?? "No order was placed.")}</p><JsonPanel value={planResult} />
          <button type="button" className={styles.primaryButton} onClick={() => void startSequence()} disabled={!!busy || planResult.status !== "plan" || Number(planResult.planned_trades) < 1}>{busy === "start-sequence" ? "Starting ledger…" : "Confirm and start sequence ledger"}</button>
        </div>}
        {activeSequences.length > 0 && <div className={styles.list}>{activeSequences.map((item) => <article key={String(item.id)}><div><strong>Sequence {String(item.id).slice(0, 8)} · {item.status}</strong><small>{item.completed_trades ?? 0} / {item.planned_trades ?? "—"} trades recorded</small></div><button type="button" className={styles.textButton} onClick={() => void loadSequence(String(item.id))}>View details</button></article>)}</div>}
      </section>}

      {sequence && <section className={styles.panel}>
        <div className={styles.panelHeading}><div><p className={styles.eyebrow}>SEQUENCE LEDGER</p><h2>Trade settlement records</h2><p>Sequence {sequence.id} · {sequence.status}</p></div></div>
        <div className={styles.warning}><span className={styles.warningIcon}>!</span><div><strong>External settlement recording only</strong><p>Only record a result after a trade has actually been settled outside this module. This form does not submit, buy, sell or close any contract.</p></div></div>
        <div className={styles.formGrid}>
          <Field label="Trade number"><input type="number" min="1" max="7" value={settlement.tradeNumber} onChange={(event) => setSettlement({ ...settlement, tradeNumber: event.target.value })} /></Field>
          <Field label="Selected side"><select value={settlement.side} onChange={(event) => { const side = event.target.value as "even" | "odd"; const quote = (side === "even" ? payout?.even : payout?.odd) as PayoutQuote | undefined; setSettlement({ ...settlement, side, profitIfWin: String(quote?.profit_if_win ?? ""), lossIfLose: String(quote?.loss_if_lose ?? "") }); }}><option value="even">Even</option><option value="odd">Odd</option></select></Field>
          <Field label="Outcome"><select value={settlement.outcome} onChange={(event) => setSettlement({ ...settlement, outcome: event.target.value as "win" | "loss" })}><option value="win">Win</option><option value="loss">Loss</option></select></Field>
          <Field label="Stake"><input type="number" min="0.01" step="0.01" value={stake} onChange={(event) => setStake(event.target.value)} /></Field>
          <Field label="Profit if win"><input type="number" min="0.0001" step="0.0001" value={settlement.profitIfWin} onChange={(event) => setSettlement({ ...settlement, profitIfWin: event.target.value })} /></Field>
          <Field label="Loss if lose"><input type="number" min="0.0001" step="0.0001" value={settlement.lossIfLose} onChange={(event) => setSettlement({ ...settlement, lossIfLose: event.target.value })} /></Field>
          <Field label="Even probability (0–1)"><input type="number" min="0" max="1" step="0.0001" value={settlement.evenProbability} onChange={(event) => setSettlement({ ...settlement, evenProbability: event.target.value })} /></Field>
          <Field label="Lower even probability"><input type="number" min="0" max="1" step="0.0001" value={settlement.lowerEvenProbability} onChange={(event) => setSettlement({ ...settlement, lowerEvenProbability: event.target.value })} /></Field>
          <Field label="Upper even probability"><input type="number" min="0" max="1" step="0.0001" value={settlement.upperEvenProbability} onChange={(event) => setSettlement({ ...settlement, upperEvenProbability: event.target.value })} /></Field>
          <Field label="Conservative expected value"><input type="number" step="0.0001" value={settlement.conservativeExpectedValue} onChange={(event) => setSettlement({ ...settlement, conservativeExpectedValue: event.target.value })} /></Field>
          <Field label="Realized profit (positive or negative)"><input type="number" step="0.0001" value={settlement.realizedProfit} onChange={(event) => setSettlement({ ...settlement, realizedProfit: event.target.value })} /></Field>
          <Field label="External contract ID (optional)"><input value={settlement.externalContractId} onChange={(event) => setSettlement({ ...settlement, externalContractId: event.target.value })} /></Field>
        </div>
        <div className={styles.checkGrid}><strong>Confirm the evidence was revalidated before the external trade:</strong>
          {([
            ["model_validated", "Model validation confirmed"], ["uncertainty_validated", "Uncertainty calibration confirmed"],
            ["signal_valid", "Entry signal gates confirmed"], ["data_fresh", "Market data freshness confirmed"],
            ["risk_budget_available", "Remaining risk budget confirmed"],
          ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={revalidation[key]} onChange={(event) => setRevalidation({ ...revalidation, [key]: event.target.checked })} />{label}</label>)}
        </div>
        <button type="button" className={styles.primaryButton} onClick={() => void recordSettlement()} disabled={!!busy || sequence.status !== "active" || !Object.values(revalidation).every(Boolean) || !settlement.profitIfWin || !settlement.lossIfLose || !settlement.evenProbability || !settlement.lowerEvenProbability || !settlement.upperEvenProbability || !settlement.conservativeExpectedValue || !settlement.realizedProfit}>Record external settlement</button>
        <p className={styles.helper}>All evidence fields must come from the actual evaluation and quote. Do not mark checks true or enter estimates just to bypass validation.</p>
        {Boolean(sequenceDetails?.sequenceDetail) && <div className={styles.resultBox}><strong>Sequence details</strong><JsonPanel value={sequenceDetails?.sequenceDetail} /></div>}
      </section>}
    </>}
  </section>;
}
