'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient as createSupabaseBrowserClient } from '../../lib/supabase/client';
import type { BotConfig, BotRun, BotRunState, BotTransaction, BotStatus } from './bot-types';
import {
  loadBotConfigs,
  upsertBotConfig,
  deleteBotConfig,
} from './bot-storage';
import { RunPanel } from './RunPanel';
import { BotDashboard } from './BotDashboard';
import { BotBuilder } from './BotBuilder';
import type { DerivAccount } from '../trading/types';
import styles from '../trading/TradingWorkspace.module.css';

type InnerTab = 'dashboard' | 'builder' | 'ai';
type AILabSection = 'market' | 'testing' | 'risk';


type ServerBotTrade = {
  id: string; run_id: string; user_id: string; account_id: string; state: string;
  contract_type: string; symbol: string; stake: number | string; payout: number | string | null;
  profit: number | string | null; currency: string; contract_id: string | null;
  created_at: string; opened_at: string | null; settled_at: string | null; error_message?: string | null;
};
type ServerBotRun = {
  id: string; user_id: string; account_id: string; bot_id: string; config: BotConfig;
  status: string; stop_reason?: string | null; trade_count: number; wins: number; losses: number;
  realized_pnl: number | string; currency: string; started_at: string | null; ended_at: string | null;
  created_at: string; updated_at: string;
};
const BOT_RUN_HISTORY_KEY = 'tradebridge:bots:server-history:v1';
const VALID_RUN_STATUSES = new Set(['queued', 'running', 'stopping', 'stopped', 'completed', 'failed', 'interrupted', 'reconciliation_required']);

function toDashboardRun(run: ServerBotRun): BotRun {
  const status: BotStatus = run.status === 'queued' ? 'connecting'
    : run.status === 'running' ? 'running'
    : run.status === 'stopping' ? 'stopping'
    : ['failed', 'interrupted', 'reconciliation_required'].includes(run.status) ? 'error'
    : 'stopped';
  return {
    botId: run.bot_id,
    botName: typeof run.config?.name === 'string' ? run.config.name : 'Saved bot',
    startedAt: run.started_at ? Date.parse(run.started_at) : Date.parse(run.created_at),
    endedAt: run.ended_at ? Date.parse(run.ended_at) : null,
    status,
    tradeCount: Number(run.trade_count) || 0,
    wins: Number(run.wins) || 0,
    losses: Number(run.losses) || 0,
    netPnl: Number(run.realized_pnl) || 0,
    currency: run.currency || 'USD',
    error: run.stop_reason ?? null,
  };
}

function loadStoredBotHistory(): { runs: ServerBotRun[]; trades: ServerBotTrade[] } {
  try {
    const raw = window.localStorage.getItem(BOT_RUN_HISTORY_KEY);
    if (!raw) return { runs: [], trades: [] };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || !('runs' in parsed) || !('trades' in parsed)) return { runs: [], trades: [] };
    const value = parsed as { runs?: unknown; trades?: unknown };
    const runs = Array.isArray(value.runs) ? value.runs.filter((item): item is ServerBotRun => {
      if (typeof item !== 'object' || item === null) return false;
      const run = item as Partial<ServerBotRun>;
      return typeof run.id === 'string' && typeof run.bot_id === 'string' && typeof run.config === 'object'
        && run.config !== null && typeof run.status === 'string' && VALID_RUN_STATUSES.has(run.status)
        && typeof run.trade_count === 'number' && typeof run.created_at === 'string';
    }).slice(0, 100).map((run) => {
      if (!['queued', 'running', 'stopping'].includes(run.status)) return run;
      return { ...run, status: 'interrupted' as const, stop_reason: 'The browser session was reloaded. Verify the contract directly in Deriv before restarting.' };
    }) : [];
    const knownRunIds = new Set(runs.map((run) => run.id));
    const trades = Array.isArray(value.trades) ? value.trades.filter((item): item is ServerBotTrade => {
      if (typeof item !== 'object' || item === null) return false;
      const trade = item as Partial<ServerBotTrade>;
      return typeof trade.id === 'string' && typeof trade.run_id === 'string' && knownRunIds.has(trade.run_id)
        && typeof trade.state === 'string' && typeof trade.symbol === 'string';
    }).slice(-500).map((trade) => trade.state === 'open'
      ? { ...trade, state: 'outcome_unknown', error_message: 'The browser session was reloaded before settlement was confirmed. Reconcile in Deriv.' }
      : trade) : [];
    return { runs, trades };
  } catch {
    return { runs: [], trades: [] };
  }
}

interface MarketAnalysisResponse {
  symbol: string;
  source: "supabase.market_ticks";
  requested_limit: number;
  returned_ticks: number;
  analysis: {
    sample_size: number;
    counts: Record<string, number>;
    frequencies: Record<string, number>;
    most_observed_digits: number[];
    least_observed_digits: number[];
    chi_square_statistic: number;
    interpretation: string;
  };
  warning: string;
}

interface BotsWorkspaceProps {
  connected: boolean;
  account: DerivAccount | null;
  sharedSocketRef: React.RefObject<WebSocket | null>;
  nextSharedSeqId: () => number;
  sessionState: string;
}

const aiTabStyle: React.CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 10, padding: '9px 12px',
  background: 'transparent', color: 'var(--muted)', fontSize: 12, fontWeight: 600,
  cursor: 'pointer',
};
const aiTabActiveStyle: React.CSSProperties = {
  ...aiTabStyle, borderColor: 'var(--accent, #16a085)',
  background: 'var(--surface, rgba(22,160,133,0.12))', color: 'var(--foreground, inherit)',
};
const aiContentStyle: React.CSSProperties = { display: 'grid', gap: 16 };
const aiHeadingStyle: React.CSSProperties = { margin: 0, fontSize: 18, fontWeight: 700 };
const aiDescriptionStyle: React.CSSProperties = { margin: '6px 0 0', color: 'var(--muted)', fontSize: 12, lineHeight: 1.65 };
const aiGridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12 };
const aiCardStyle: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 12, padding: 16, background: 'var(--card, transparent)', display: 'flex', flexDirection: 'column', gap: 4, minHeight: 150 };
const aiStatusStyle: React.CSSProperties = { marginTop: 'auto', paddingTop: 10, color: 'var(--muted)', fontSize: 11 };
const aiNoticeStyle: React.CSSProperties = { margin: 0, border: '1px solid var(--border)', borderRadius: 10, padding: 12, color: 'var(--muted)', fontSize: 12, lineHeight: 1.6 };

export function BotsWorkspace({ connected, account }: BotsWorkspaceProps) {
  const [innerTab, setInnerTab] = useState<InnerTab>('dashboard');
  const [aiSection, setAiSection] = useState<AILabSection>('market');
  const [marketSymbol, setMarketSymbol] = useState('1HZ100V');
  const [marketLimit, setMarketLimit] = useState('1000');
  const [marketRefreshNonce, setMarketRefreshNonce] = useState(0);
  const [marketAnalysis, setMarketAnalysis] = useState<MarketAnalysisResponse | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [configs, setConfigs] = useState<BotConfig[]>([]);
  const [runs, setRuns] = useState<BotRun[]>([]);
  const [serverRuns, setServerRuns] = useState<ServerBotRun[]>([]);
  const [serverTrades, setServerTrades] = useState<ServerBotTrade[]>([]);
  const [activeServerRunId, setActiveServerRunId] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverBusy, setServerBusy] = useState(false);
  const botSocketRef = useRef<WebSocket | null>(null);
  const [liveJournal, setLiveJournal] = useState<BotRunState['journal']>([]);
  const [activeConfigId, setActiveConfigId] = useState<string | null>(null);
  const [historyHydrated, setHistoryHydrated] = useState(false);

  useEffect(() => {
    setConfigs(loadBotConfigs());
    const savedHistory = loadStoredBotHistory();
    setServerRuns(savedHistory.runs);
    setServerTrades(savedHistory.trades);
    if (savedHistory.runs.length > 0) setActiveServerRunId(savedHistory.runs[0].id);
    setHistoryHydrated(true);
    return () => {
      const socket = botSocketRef.current;
      if (socket && socket.readyState <= WebSocket.OPEN) socket.close(1000, 'Bot workspace unmounted');
      botSocketRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!historyHydrated) return;
    try {
      window.localStorage.setItem(BOT_RUN_HISTORY_KEY, JSON.stringify({
        version: 1,
        runs: serverRuns.slice(0, 100),
        trades: serverTrades.slice(-500),
      }));
    } catch {
      // Local history is a convenience cache; Deriv remains authoritative for financial records.
    }
  }, [historyHydrated, serverRuns, serverTrades]);

  useEffect(() => {
    setRuns(serverRuns.map(toDashboardRun).slice(0, 100));
  }, [serverRuns]);

  useEffect(() => {
    if (innerTab !== 'ai' || aiSection !== 'market') return;

    const controller = new AbortController();
    async function loadMarketAnalysis() {
      setMarketLoading(true);
      setMarketError(null);
      try {
        const params = new URLSearchParams({ symbol: marketSymbol, limit: marketLimit });
        const response = await fetch(`/api/ai-lab/market-analysis?${params.toString()}`, {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(typeof payload?.error === 'string' ? payload.error : `Market analysis failed (${response.status})`);
        }
        if (
          !payload || payload.symbol !== marketSymbol ||
          payload.source !== 'supabase.market_ticks' ||
          !payload.analysis || !Number.isInteger(payload.analysis.sample_size) ||
          !payload.analysis.counts || !payload.analysis.frequencies
        ) {
          throw new Error('The research API returned an invalid response.');
        }
        setMarketAnalysis(payload as MarketAnalysisResponse);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        setMarketAnalysis(null);
        setMarketError(error instanceof Error ? error.message : 'Could not load market analysis.');
      } finally {
        if (!controller.signal.aborted) setMarketLoading(false);
      }
    }

    void loadMarketAnalysis();
    return () => controller.abort();
  }, [innerTab, aiSection, marketSymbol, marketLimit, marketRefreshNonce]);

  const activeConfig = configs.find((c) => c.id === activeConfigId) ?? null;
  const activeServerRun = serverRuns.find((run) => run.id === activeServerRunId) ?? null;
  const activeTradeRows = activeServerRun ? serverTrades : [];
  const mappedStatus: BotStatus = activeServerRun
    ? ({ queued: 'connecting', running: 'running', stopping: 'stopping', stopped: 'stopped', completed: 'stopped', failed: 'error', interrupted: 'error', reconciliation_required: 'error' } as Record<string, BotStatus>)[activeServerRun.status] ?? 'idle'
    : 'idle';
  const runState: BotRunState = {
    status: mappedStatus,
    currentStake: activeServerRun?.config?.stakeStrategy?.type === 'fixed' ? Number(activeServerRun.config.stakeStrategy.amount) : activeConfig?.stakeStrategy.type === 'fixed' ? activeConfig.stakeStrategy.amount : 0,
    tradeCount: Number(activeServerRun?.trade_count ?? 0), wins: Number(activeServerRun?.wins ?? 0),
    losses: Number(activeServerRun?.losses ?? 0), netPnl: Number(activeServerRun?.realized_pnl ?? 0),
    currency: activeServerRun?.currency ?? account?.currency ?? 'USD',
    transactions: activeTradeRows.filter((trade) => trade.contract_id).map((trade) => ({
      id: trade.id, contractId: String(trade.contract_id), contractType: trade.contract_type, symbol: trade.symbol,
      stake: Number(trade.stake), payout: trade.payout === null ? null : Number(trade.payout),
      profit: trade.profit === null ? null : Number(trade.profit), currency: trade.currency,
      startedAt: Date.parse(trade.opened_at ?? trade.created_at), settledAt: trade.settled_at ? Date.parse(trade.settled_at) : null,
      status: trade.state,
    } satisfies BotTransaction)),
    journal: liveJournal,
    startedAt: activeServerRun?.started_at ? Date.parse(activeServerRun.started_at) : null,
    lastError: ['failed', 'interrupted', 'reconciliation_required'].includes(activeServerRun?.status ?? '') ? activeServerRun?.stop_reason ?? 'Server run requires attention.' : null,
  };
  const orderRecoveryRequired = activeTradeRows.some((trade) => trade.state === 'outcome_unknown');
  function updateRunById(runId: string, patch: Partial<ServerBotRun>) {
    setServerRuns((current) => current.map((run) => run.id === runId ? { ...run, ...patch, updated_at: new Date().toISOString() } : run));
  }
  function updateActiveRun(patch: Partial<ServerBotRun>) {
    if (activeServerRunId) updateRunById(activeServerRunId, patch);
  }
  async function start() {
    if (!connected || !account || !activeConfig) { setServerError('Connect a verified Demo account and select a bot configuration first.'); return; }
    if ((account.account_type ?? '').toLowerCase() !== 'demo') { setServerError('Automated execution is Demo-only. Real-account automation is disabled.'); return; }
    if (activeConfig.stakeStrategy.type !== 'fixed') { setServerError('The server runner supports fixed stake only. Select a fixed-stake strategy.'); return; }
    // Capture the narrowed fixed stake before asynchronous WebSocket callbacks.
    const fixedStake = activeConfig.stakeStrategy.amount;
    if (activeConfig.durationUnit !== 't' || !['DIGITOVER', 'DIGITUNDER', 'DIGITEVEN', 'DIGITODD', 'DIGITMATCH', 'DIGITDIFF'].includes(activeConfig.contractType)) { setServerError('The server runner supports digit contracts with a duration of 1–10 ticks only.'); return; }
    if (!activeConfig.stopConditions.some((condition) => condition.type === 'loss' || condition.type === 'tradeCount' || condition.type === 'time')) { setServerError('Add a loss limit, maximum trade count, or time limit before starting this bot.'); return; }
    if (serverBusy || ['queued', 'running', 'stopping'].includes(activeServerRun?.status ?? '')) return;
    if (botSocketRef.current && botSocketRef.current.readyState < WebSocket.CLOSING) { setServerError('A bot session is already connected. Stop or wait for it to finish.'); return; }
    setServerBusy(true); setServerError(null); setServerTrades([]);
    setLiveJournal([{ timestamp: Date.now(), level: 'info', message: 'Requesting a short-lived server WebSocket ticket…' }]);
    try {
      const backendWs = process.env.NEXT_PUBLIC_TRADEBRIDGE_BACKEND_WS_URL?.trim();
      if (!backendWs) throw new Error('Bot WebSocket is not configured. Set NEXT_PUBLIC_TRADEBRIDGE_BACKEND_WS_URL.');
      const supabase = createSupabaseBrowserClient();
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) throw new Error('Sign in again before starting a bot.');
      const ticketUrl = new URL(backendWs);
      ticketUrl.protocol = ticketUrl.protocol === 'wss:' ? 'https:' : 'http:';
      ticketUrl.pathname = '/deriv/ws-ticket'; ticketUrl.search = '';
      const ticketResponse = await fetch(ticketUrl.toString(), { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, Accept: 'application/json' }, cache: 'no-store' });
      const ticketPayload = await ticketResponse.json().catch(() => null);
      if (!ticketResponse.ok || typeof ticketPayload?.ticket !== 'string') throw new Error(typeof ticketPayload?.detail === 'string' ? ticketPayload.detail : 'Could not obtain a bot session ticket.');
      const socketUrl = new URL(backendWs);
      socketUrl.pathname = '/bots/run'; socketUrl.search = ''; socketUrl.searchParams.set('account_id', account.account_id);
      const socket = new WebSocket(socketUrl.toString(), ['tradebridge', ticketPayload.ticket]);
      botSocketRef.current = socket;
      const runId = crypto.randomUUID(); const now = new Date().toISOString();
      const localRun: ServerBotRun = { id: runId, user_id: '', account_id: account.account_id, bot_id: activeConfig.id, config: activeConfig, status: 'queued', trade_count: 0, wins: 0, losses: 0, realized_pnl: 0, currency: account.currency ?? 'USD', started_at: now, ended_at: null, created_at: now, updated_at: now };
      setServerRuns((current) => [localRun, ...current].slice(0, 100)); setActiveServerRunId(runId);
      socket.onopen = () => {
        setServerBusy(false); updateRunById(runId, { status: 'running' });
        setLiveJournal((current) => [...current, { timestamp: Date.now(), level: 'info', message: 'Connected to FastAPI; sending validated Demo configuration.' }]);
        socket.send(JSON.stringify({ id: activeConfig.id, name: activeConfig.name, symbol: activeConfig.symbol, contractType: activeConfig.contractType, ...(activeConfig.barrier !== undefined ? { barrier: activeConfig.barrier } : {}), duration: activeConfig.duration, durationUnit: activeConfig.durationUnit, stakeStrategy: activeConfig.stakeStrategy, stopConditions: activeConfig.stopConditions, cooldownSeconds: Math.max(1, Math.min(activeConfig.cooldownSeconds, 60)), maxTradesPerDay: Math.min(activeConfig.maxTradesPerDay, 20), maxConsecutiveLosses: Math.min(activeConfig.maxConsecutiveLosses, 3) }));
      };
      socket.onmessage = (message) => {
        let event: Record<string, unknown>;
        try { event = JSON.parse(String(message.data)) as Record<string, unknown>; } catch { setLiveJournal((v) => [...v, { timestamp: Date.now(), level: 'error', message: 'Malformed server event received.' }]); return; }
        const name = String(event.event ?? '');
        if (name === 'started') setLiveJournal((v) => [...v, { timestamp: Date.now(), level: 'info', message: 'Bot execution started on FastAPI.' }]);
        else if (name === 'trade_opened') {
          const id = String(event.contract_id ?? '');
          setServerTrades((v) => [...v, { id: id || crypto.randomUUID(), run_id: runId, user_id: '', account_id: account.account_id, state: 'open', contract_type: activeConfig.contractType, symbol: activeConfig.symbol, stake: Number(event.stake ?? fixedStake), payout: null, profit: null, currency: account.currency ?? 'USD', contract_id: id || null, created_at: new Date().toISOString(), opened_at: new Date().toISOString(), settled_at: null }]);
          setLiveJournal((v) => [...v, { timestamp: Date.now(), level: 'info', message: `Trade opened · contract ${id || 'pending'}` }]);
        } else if (name === 'trade_settled') {
          const id = String(event.contract_id ?? ''); const profit = Number(event.profit ?? 0); const count = Number(event.trade_count ?? 0);
          setServerTrades((v) => v.map((t) => String(t.contract_id) === id ? { ...t, state: 'settled', payout: Number(event.payout ?? 0), profit, settled_at: new Date().toISOString() } : t));
          updateRunById(runId, { status: 'running', trade_count: count, wins: profit > 0 ? Number(activeServerRun?.wins ?? 0) + 1 : Number(activeServerRun?.wins ?? 0), losses: profit < 0 ? Number(activeServerRun?.losses ?? 0) + 1 : Number(activeServerRun?.losses ?? 0), realized_pnl: Number(event.total_profit ?? 0) });
          setLiveJournal((v) => [...v, { timestamp: Date.now(), level: profit >= 0 ? 'info' : 'warn', message: `Trade settled · P/L ${profit.toFixed(2)} ${account.currency ?? 'USD'}` }]);
        } else if (name === 'error') {
          const reason = String(event.reason ?? 'Bot execution error');
          setLiveJournal((v) => [...v, { timestamp: Date.now(), level: 'error', message: reason }]);
          if (/unknown|timeout|reconcil/i.test(reason)) setServerTrades((v) => v.map((t) => t.state === 'open' ? { ...t, state: 'outcome_unknown', error_message: reason } : t));
          updateRunById(runId, { status: 'failed', stop_reason: reason, ended_at: new Date().toISOString() });
          setServerError(`Bot stopped: ${reason}. Do not restart until any uncertain purchase outcome is resolved.`);
        } else if (name === 'done') {
          updateRunById(runId, { status: 'stopped', stop_reason: String(event.stop_reason ?? 'completed'), trade_count: Number(event.trade_count ?? 0), realized_pnl: Number(event.total_profit ?? 0), ended_at: new Date().toISOString() });
          setLiveJournal((v) => [...v, { timestamp: Date.now(), level: 'info', message: `Bot finished · ${String(event.stop_reason ?? 'completed')}` }]);
        }
      };
      socket.onerror = () => { setServerBusy(false); setServerError('Bot WebSocket failed. Check the deployed FastAPI service and allowed origin configuration.'); setLiveJournal((v) => [...v, { timestamp: Date.now(), level: 'error', message: 'WebSocket transport error; broker status may be uncertain.' }]); };
      socket.onclose = (event) => {
        setServerBusy(false); if (botSocketRef.current === socket) botSocketRef.current = null;
        if (event.code !== 1000 && event.code !== 1001) {
          setServerError(`Bot WebSocket closed unexpectedly (code ${event.code}). Verify broker state before restarting.`);
          setServerTrades((v) => v.map((t) => t.state === 'open' ? { ...t, state: 'outcome_unknown', error_message: 'WebSocket disconnected before settlement confirmation.' } : t));
          updateRunById(runId, { status: 'interrupted', stop_reason: `WebSocket closed (${event.code})`, ended_at: new Date().toISOString() });
        }
      };
    } catch (error) {
      setServerBusy(false); setServerError(error instanceof Error ? error.message : 'Could not start server bot run.');
      setLiveJournal((v) => [...v, { timestamp: Date.now(), level: 'error', message: error instanceof Error ? error.message : 'Could not start bot.' }]);
    }
  }
  async function stop() {
    const socket = botSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || serverBusy) { setServerError('No active bot WebSocket is available to receive the stop request.'); return; }
    setServerBusy(true); setServerError(null); updateActiveRun({ status: 'stopping' });
    try { socket.send(JSON.stringify({ action: 'stop' })); setLiveJournal((v) => [...v, { timestamp: Date.now(), level: 'info', message: 'Stop requested; server will finish the current trade before stopping.' }]); }
    catch { setServerError('Stop request could not be sent. Verify broker state before another run.'); }
    finally { setServerBusy(false); }
  }
  function handleSaveConfig(config: BotConfig) {
    upsertBotConfig(config);
    setConfigs((prev) => {
      const idx = prev.findIndex((c) => c.id === config.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = config;
        return next;
      }
      return [...prev, config];
    });
    setActiveConfigId(config.id);
  }

  function handleDeleteConfig(id: string) {
    deleteBotConfig(id);
    setConfigs((prev) => prev.filter((c) => c.id !== id));
    if (activeConfigId === id) setActiveConfigId(null);
  }

  function handleImportConfig(config: BotConfig) {
    upsertBotConfig(config);
    setConfigs((prev) => {
      const idx = prev.findIndex((c) => c.id === config.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = config;
        return next;
      }
      return [...prev, config];
    });
  }

  function handleSelectConfig(id: string) {
    setActiveConfigId(id);
  }

  function handleNewConfig(config: BotConfig) {
    handleSaveConfig(config);
  }

  return (
    <section className={styles.botsPage} aria-label="Automated bots">
      {serverError && <div role="alert" style={{ border: '1px solid var(--danger, #b45353)', borderRadius: 10, padding: 12, color: 'var(--foreground, inherit)', fontSize: 12 }}>
        <strong>Server bot service</strong><p style={{ margin: '5px 0 0' }}>{serverError}</p>
      </div>}
      {serverBusy && <p role="status" style={{ margin: 0, color: 'var(--muted)', fontSize: 12 }}>Waiting for server confirmation…</p>}
      {/* Inner tab bar */}
      <div className={styles.tabNavWrap}>
        <div className={styles.workspaceTabs} role="tablist">
          <button
            role="tab"
            aria-selected={innerTab === 'dashboard'}
            className={
              innerTab === 'dashboard'
                ? `${styles.workspaceTab} ${styles.workspaceTabActive}`
                : styles.workspaceTab
            }
            onClick={() => setInnerTab('dashboard')}
          >
            <span className={styles.workspaceTabIcon}>📋</span>
            Dashboard
          </button>
          <button
            role="tab"
            aria-selected={innerTab === 'builder'}
            className={
              innerTab === 'builder'
                ? `${styles.workspaceTab} ${styles.workspaceTabActive}`
                : styles.workspaceTab
            }
            onClick={() => setInnerTab('builder')}
          >
            <span className={styles.workspaceTabIcon}>🧩</span>
            Bot Builder
          </button>
          <button
            role="tab"
            aria-selected={innerTab === 'ai'}
            className={
              innerTab === 'ai'
                ? `${styles.workspaceTab} ${styles.workspaceTabActive}`
                : styles.workspaceTab
            }
            onClick={() => setInnerTab('ai')}
          >
            <span className={styles.workspaceTabIcon}>🧠</span>
            AI Lab
          </button>
        </div>
      </div>

      {/* Layout: main content + run panel */}
      <div className={styles.botsLayout}>
        <div className={styles.workspaceTabPanel} role="tabpanel">
          {innerTab === 'dashboard' && (
            <BotDashboard
              configs={configs}
              runs={runs}
              activeConfigId={activeConfigId}
              onSelectConfig={handleSelectConfig}
              onNewConfig={handleNewConfig}
              onDeleteConfig={handleDeleteConfig}
              onImportConfig={handleImportConfig}
            />
          )}
          {innerTab === 'builder' && (
            <BotBuilder onSaveConfig={handleSaveConfig} />
          )}
          {innerTab === 'ai' && (
            <section aria-label="AI Lab" style={{ display: 'grid', gap: 20 }}>
              <header style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span aria-hidden="true" style={{ fontSize: 24 }}>🧠</span>
                  <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>AI Lab</h2>
                  <span style={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 999, padding: '4px 8px', color: 'var(--muted)' }}>Research only</span>
                </div>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
                  Investigate market data, evaluate strategies, and review risk evidence. This workspace does not place trades.
                </p>
              </header>

              <div role="tablist" aria-label="AI Lab sections" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                <button type="button" role="tab" aria-selected={aiSection === 'market'} onClick={() => setAiSection('market')} style={aiSection === 'market' ? aiTabActiveStyle : aiTabStyle}>📊 Market Analysis</button>
                <button type="button" role="tab" aria-selected={aiSection === 'testing'} onClick={() => setAiSection('testing')} style={aiSection === 'testing' ? aiTabActiveStyle : aiTabStyle}>🧪 Strategy Testing</button>
                <button type="button" role="tab" aria-selected={aiSection === 'risk'} onClick={() => setAiSection('risk')} style={aiSection === 'risk' ? aiTabActiveStyle : aiTabStyle}>🛡️ Risk &amp; Evidence</button>
              </div>

              {aiSection === 'market' && (
                <div style={aiContentStyle}>
                  <div>
                    <h3 style={aiHeadingStyle}>Market Analysis</h3>
                    <p style={aiDescriptionStyle}>Digit distributions, tick statistics, and sample sizes from validated market history.</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'end', gap: 12, flexWrap: 'wrap', padding: 14, border: '1px solid var(--border)', borderRadius: 12 }}>
                    <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
                      Market symbol
                      <select value={marketSymbol} onChange={(event) => setMarketSymbol(event.target.value)} style={{ minWidth: 170, padding: '9px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card, transparent)', color: 'var(--foreground, inherit)' }}>
                        <option value="1HZ100V">Volatility 100 (1s)</option>
                        <option value="1HZ75V">Volatility 75 (1s)</option>
                        <option value="1HZ50V">Volatility 50 (1s)</option>
                        <option value="1HZ25V">Volatility 25 (1s)</option>
                        <option value="1HZ10V">Volatility 10 (1s)</option>
                      </select>
                    </label>
                    <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
                      Requested sample
                      <select value={marketLimit} onChange={(event) => setMarketLimit(event.target.value)} style={{ minWidth: 130, padding: '9px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card, transparent)', color: 'var(--foreground, inherit)' }}>
                        <option value="100">100 ticks</option>
                        <option value="500">500 ticks</option>
                        <option value="1000">1,000 ticks</option>
                        <option value="2500">2,500 ticks</option>
                        <option value="5000">5,000 ticks</option>
                        <option value="10000">10,000 ticks</option>
                      </select>
                    </label>
                    <button type="button" onClick={() => setMarketRefreshNonce((value) => value + 1)} disabled={marketLoading} style={{ ...aiTabActiveStyle, opacity: marketLoading ? 0.65 : 1 }}>
                      {marketLoading ? 'Loading…' : 'Refresh analysis'}
                    </button>
                  </div>

                  {marketError && (
                    <div role="alert" style={{ ...aiNoticeStyle, borderColor: 'var(--danger, #b45353)' }}>
                      <strong>Market data unavailable</strong>
                      <p style={{ margin: '6px 0 0' }}>{marketError}</p>
                      <p style={{ margin: '6px 0 0' }}>Check that the AI service is deployed, server environment variables are configured, and Supabase has stored ticks for this symbol.</p>
                    </div>
                  )}

                  {marketLoading && !marketAnalysis && <p role="status" style={aiNoticeStyle}>Loading validated tick history from the research API…</p>}

                  {marketAnalysis && (
                    <>
                      <div style={aiGridStyle}>
                        <div style={aiCardStyle}><span style={aiDescriptionStyle}>Validated observations</span><strong style={{ fontSize: 26 }}>{marketAnalysis.analysis.sample_size.toLocaleString()}</strong><span style={aiStatusStyle}>Returned from {marketAnalysis.source}</span></div>
                        <div style={aiCardStyle}><span style={aiDescriptionStyle}>Requested sample</span><strong style={{ fontSize: 26 }}>{marketAnalysis.requested_limit.toLocaleString()}</strong><span style={aiStatusStyle}>{marketAnalysis.returned_ticks < marketAnalysis.requested_limit ? 'Fewer rows available than requested' : 'Sample limit reached'}</span></div>
                        <div style={aiCardStyle}><span style={aiDescriptionStyle}>Chi-square statistic</span><strong style={{ fontSize: 26 }}>{marketAnalysis.analysis.chi_square_statistic.toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong><span style={aiStatusStyle}>Descriptive uniformity diagnostic only</span></div>
                      </div>
                      <div style={{ ...aiCardStyle, minHeight: 0 }}>
                        <strong>Observed last-digit distribution</strong>
                        <p style={aiDescriptionStyle}>Frequency of each last digit in the returned historical sample. Percentages describe this sample only.</p>
                        <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                          {Array.from({ length: 10 }, (_, digit) => {
                            const key = String(digit);
                            const count = marketAnalysis.analysis.counts[key] ?? 0;
                            const frequency = marketAnalysis.analysis.frequencies[key] ?? 0;
                            return (
                              <div key={key} style={{ display: 'grid', gridTemplateColumns: '22px minmax(50px, 1fr) 78px', gap: 10, alignItems: 'center', fontSize: 12 }}>
                                <strong>{digit}</strong>
                                <div style={{ height: 10, borderRadius: 999, overflow: 'hidden', background: 'var(--border)' }}>
                                  <div style={{ width: `${Math.max(0, Math.min(100, frequency * 100))}%`, height: '100%', background: 'var(--accent, #16a085)' }} />
                                </div>
                                <span style={{ textAlign: 'right', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{count.toLocaleString()} · {(frequency * 100).toFixed(2)}%</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <p style={aiNoticeStyle}>Source: Supabase market_ticks via the authenticated Python research API. {marketAnalysis.warning} {marketAnalysis.analysis.interpretation}</p>
                    </>
                  )}
                </div>
              )}

              {aiSection === 'testing' && (
                <div style={aiContentStyle}>
                  <div>
                    <h3 style={aiHeadingStyle}>Strategy Testing</h3>
                    <p style={aiDescriptionStyle}>Replay historical ticks, compare contract rules, and reserve separate unseen data for evaluation.</p>
                  </div>
                  <div style={aiGridStyle}>
                    <div style={aiCardStyle}><strong>Historical backtests</strong><p style={aiDescriptionStyle}>Define a strategy and replay historical observations with payout assumptions and fees.</p><span style={aiStatusStyle}>Backtest runner not connected</span></div>
                    <div style={aiCardStyle}><strong>Out-of-sample results</strong><p style={aiDescriptionStyle}>Evaluate on a later, untouched period to reduce overfitting and data leakage.</p><span style={aiStatusStyle}>No test results yet</span></div>
                    <div style={aiCardStyle}><strong>Baseline comparison</strong><p style={aiDescriptionStyle}>Compare results against simple baselines, including a no-edge or random benchmark where appropriate.</p><span style={aiStatusStyle}>Awaiting test engine</span></div>
                  </div>
                  <p style={aiNoticeStyle}>A strategy will not be labelled successful from an in-sample result alone. This panel is currently a UI scaffold.</p>
                </div>
              )}

              {aiSection === 'risk' && (
                <div style={aiContentStyle}>
                  <div>
                    <h3 style={aiHeadingStyle}>Risk &amp; Evidence</h3>
                    <p style={aiDescriptionStyle}>Assess uncertainty, drawdown, and the strength of evidence before considering any strategy for use.</p>
                  </div>
                  <div style={aiGridStyle}>
                    <div style={aiCardStyle}><strong>Uncertainty</strong><p style={aiDescriptionStyle}>Show sample size, confidence intervals where suitable, and limitations of statistical tests.</p><span style={aiStatusStyle}>Awaiting analysis results</span></div>
                    <div style={aiCardStyle}><strong>Drawdown &amp; exposure</strong><p style={aiDescriptionStyle}>Track losing streaks, stake exposure, and peak-to-trough losses during simulation.</p><span style={aiStatusStyle}>Risk metrics not connected</span></div>
                    <div style={aiCardStyle}><strong>Evidence review</strong><p style={aiDescriptionStyle}>Record assumptions, baseline comparisons, out-of-sample performance, and reasons to reject a strategy.</p><span style={aiStatusStyle}>Evidence ledger not connected</span></div>
                  </div>
                  <p style={aiNoticeStyle}>Historical digit frequency alone does not establish that the next outcome is predictable. Any future signal must be validated on unseen data.</p>
                </div>
              )}
            </section>
          )}
        </div>
        <aside>
          <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: 12 }}>
            Bot run metadata is saved in this browser. Deriv remains the source of truth for contract and account history; verify uncertain outcomes there.
          </p>
          <RunPanel
            runState={runState}
            onStart={start}
            onStop={stop}
            orderRecoveryRequired={orderRecoveryRequired}
            onAcknowledgeOrderReconciled={undefined}
            config={activeConfig}
          />
        </aside>
      </div>
    </section>
  );
}

export default BotsWorkspace;
