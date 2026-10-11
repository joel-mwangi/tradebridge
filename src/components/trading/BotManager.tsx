"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createClient } from "../../lib/supabase/client";

type StrategyType = "trend_following" | "mean_reversion" | "breakout" | "momentum";

interface TradingBot {
  id: string;
  user_id: string;
  bot_name: string;
  strategy_type: StrategyType;
  symbol: string;
  stake_amount: number | string;
  take_profit_pips: number | string;
  stop_loss_pips: number | string;
  is_active: boolean;
  total_trades: number;
  total_profit_loss: number | string;
  created_at: string;
  updated_at: string;
}

interface BotLog {
  id: string;
  bot_id: string;
  action: string;
  details: Record<string, unknown> | string | null;
  profit_loss: number | string | null;
  timestamp: string;
}

type BrowserSupabaseClient = ReturnType<typeof createClient>;

interface BotFormState {
  bot_name: string;
  strategy_type: StrategyType;
  symbol: string;
  stake_amount: string;
  take_profit_pips: string;
  stop_loss_pips: string;
}

const INITIAL_FORM: BotFormState = {
  bot_name: "",
  strategy_type: "trend_following",
  symbol: "frxEURUSD",
  stake_amount: "1",
  take_profit_pips: "0",
  stop_loss_pips: "0",
};

const STRATEGIES: Array<{ value: StrategyType; label: string; description: string }> = [
  { value: "trend_following", label: "Trend following", description: "Follow directional momentum" },
  { value: "mean_reversion", label: "Mean reversion", description: "Trade a return toward an average" },
  { value: "breakout", label: "Breakout", description: "React to a level break" },
  { value: "momentum", label: "Momentum", description: "Prioritise price acceleration" },
];

function asNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatPnl(value: number | string | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(asNumber(value));
}

function pnlClass(value: number | string | null | undefined): string {
  const amount = asNumber(value);
  return amount > 0 ? "pnl positive" : amount < 0 ? "pnl negative" : "pnl";
}

function strategyLabel(strategy: StrategyType): string {
  return STRATEGIES.find((item) => item.value === strategy)?.label ?? strategy.replace(/_/g, " ");
}

function logDetails(details: BotLog["details"]): string {
  if (!details) return "";
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details);
  } catch {
    return "Details unavailable";
  }
}

function friendlyError(message: string): string {
  if (message.includes("trading_bots") || message.includes("bot_logs")) {
    return "The bot tables are not available yet. Apply migration 20261011120000_add_trading_bots.sql to the TradeBridge Supabase project, then reload.";
  }
  if (message.toLowerCase().includes("row-level security")) {
    return "Supabase rejected this operation. Confirm that you are signed in to the correct TradeBridge account.";
  }
  return message;
}

export default function BotManager({ theme }: { theme: "dark" | "light" }) {
  const [client, setClient] = useState<BrowserSupabaseClient | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [bots, setBots] = useState<TradingBot[]>([]);
  const [logs, setLogs] = useState<BotLog[]>([]);
  const [form, setForm] = useState<BotFormState>(INITIAL_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyBotId, setBusyBotId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadData = useCallback(async (supabase: BrowserSupabaseClient, currentUserId: string) => {
    const { data: botRows, error: botError } = await supabase
      .from("trading_bots")
      .select("*")
      .eq("user_id", currentUserId)
      .order("created_at", { ascending: false });

    if (botError) throw new Error(botError.message);

    const nextBots = (botRows ?? []) as unknown as TradingBot[];
    setBots(nextBots);

    if (nextBots.length === 0) {
      setLogs([]);
      return;
    }

    const botIds = nextBots.map((bot) => bot.id);
    const { data: logRows, error: logsError } = await supabase
      .from("bot_logs")
      .select("*")
      .in("bot_id", botIds)
      .order("timestamp", { ascending: false })
      .limit(25);

    if (logsError) throw new Error(logsError.message);
    setLogs((logRows ?? []) as unknown as BotLog[]);
  }, []);

  useEffect(() => {
    let alive = true;
    let disposeChannel: (() => void) | null = null;

    const initialize = async () => {
      try {
        const supabase = createClient();
        if (!alive) return;
        setClient(supabase);

        const { data, error: authError } = await supabase.auth.getUser();
        if (authError) throw new Error(authError.message);
        if (!data.user) {
          setError("Sign in to your TradeBridge account to manage trading bots.");
          return;
        }

        const currentUserId = data.user.id;
        setUserId(currentUserId);
        await loadData(supabase, currentUserId);
        if (!alive) return;

        const channel = supabase
          .channel("trading-bots-" + currentUserId)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "trading_bots" },
            () => {
              void loadData(supabase, currentUserId).catch((loadError: unknown) => {
                if (alive) setError(friendlyError(loadError instanceof Error ? loadError.message : "Could not refresh bot data."));
              });
            },
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "bot_logs" },
            () => {
              void loadData(supabase, currentUserId).catch((loadError: unknown) => {
                if (alive) setError(friendlyError(loadError instanceof Error ? loadError.message : "Could not refresh bot activity."));
              });
            },
          )
          .subscribe((status) => {
            if (status === "CHANNEL_ERROR" && alive) {
              setError((current) => current ?? "Live updates are unavailable. Use Refresh to reload bot status and P&L.");
            }
          });

        disposeChannel = () => {
          void supabase.removeChannel(channel);
        };
      } catch (initializationError: unknown) {
        if (alive) {
          setError(friendlyError(
            initializationError instanceof Error
              ? initializationError.message
              : "Could not connect to Supabase. Check your connection and configuration.",
          ));
        }
      } finally {
        if (alive) setLoading(false);
      }
    };

    void initialize();
    return () => {
      alive = false;
      disposeChannel?.();
    };
  }, [loadData]);

  const activeCount = useMemo(() => bots.filter((bot) => bot.is_active).length, [bots]);
  const totalPnl = useMemo(
    () => bots.reduce((total, bot) => total + asNumber(bot.total_profit_loss), 0),
    [bots],
  );
  const totalTrades = useMemo(
    () => bots.reduce((total, bot) => total + (Number.isFinite(bot.total_trades) ? bot.total_trades : 0), 0),
    [bots],
  );
  const botNames = useMemo(() => new Map(bots.map((bot) => [bot.id, bot.bot_name])), [bots]);

  function updateForm<Key extends keyof BotFormState>(key: Key, value: BotFormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || !userId) {
      setError("Sign in to your TradeBridge account before creating a bot.");
      return;
    }

    const stake = Number(form.stake_amount);
    const takeProfit = Number(form.take_profit_pips);
    const stopLoss = Number(form.stop_loss_pips);
    const trimmedName = form.bot_name.trim();
    const trimmedSymbol = form.symbol.trim();

    if (trimmedName.length < 2 || trimmedName.length > 80) {
      setError("Bot name must contain between 2 and 80 characters.");
      return;
    }
    if (!/^[A-Za-z0-9_]{2,32}$/.test(trimmedSymbol)) {
      setError("Enter a valid Deriv symbol, for example frxEURUSD.");
      return;
    }
    if (!Number.isFinite(stake) || stake <= 0 || stake > 10000) {
      setError("Stake must be greater than 0 and no more than 10,000.");
      return;
    }
    if (!Number.isFinite(takeProfit) || takeProfit < 0 || !Number.isFinite(stopLoss) || stopLoss < 0) {
      setError("Take-profit and stop-loss values must be zero or greater.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { error: insertError } = await client.from("trading_bots").insert({
        user_id: userId,
        bot_name: trimmedName,
        strategy_type: form.strategy_type,
        symbol: trimmedSymbol,
        stake_amount: stake,
        take_profit_pips: takeProfit,
        stop_loss_pips: stopLoss,
        is_active: false,
      });

      if (insertError) throw new Error(insertError.message);
      setForm(INITIAL_FORM);
      await loadData(client, userId);
      setMessage("Bot configuration saved as inactive. Review the strategy and risk parameters before enabling it.");
    } catch (createError: unknown) {
      setError(friendlyError(createError instanceof Error ? createError.message : "Could not create this bot."));
    } finally {
      setSaving(false);
    }
  }

  async function toggleBot(bot: TradingBot) {
    if (!client || !userId) {
      setError("Sign in to manage your bot configurations.");
      return;
    }

    setBusyBotId(bot.id);
    setError(null);
    setMessage(null);
    try {
      const { data, error: updateError } = await client
        .from("trading_bots")
        .update({ is_active: !bot.is_active })
        .eq("id", bot.id)
        .eq("user_id", userId)
        .select("id")
        .maybeSingle();

      if (updateError) throw new Error(updateError.message);
      if (!data) throw new Error("No bot was updated. Refresh and confirm that this bot belongs to your signed-in account.");

      await loadData(client, userId);
      setMessage(
        !bot.is_active
          ? "Bot configuration marked enabled. No trades will be placed until a trusted server-side bot runner is connected."
          : "Bot configuration paused. Verify any open Deriv positions separately in your trading account.",
      );
    } catch (toggleError: unknown) {
      setError(friendlyError(toggleError instanceof Error ? toggleError.message : "Could not update this bot."));
    } finally {
      setBusyBotId(null);
    }
  }

  async function refresh() {
    if (!client || !userId) return;
    setError(null);
    try {
      await loadData(client, userId);
      setMessage("Bot data refreshed.");
    } catch (refreshError: unknown) {
      setError(friendlyError(refreshError instanceof Error ? refreshError.message : "Could not refresh bot data."));
    }
  }

  return (
    <section className="botManager" data-theme={theme} aria-labelledby="bot-manager-title">
      <style jsx>{`
        .botManager {
          color-scheme: dark;
          --bot-page: #0b1320;
          --bot-panel: #131c2e;
          --bot-surface: #1a2438;
          --bot-card: #101a2b;
          --bot-ink: #f1f5f9;
          --bot-muted: #b5c3d5;
          --bot-line: #35445c;
          --bot-border: #52637a;
          --bot-label: #cbd5e1;
          --bot-placeholder: #94a3b8;
          --bot-teal: #10b981;
          --bot-teal-ink: #10b981;
          --bot-focus: #10b981;
          --bot-teal-soft: rgba(16, 185, 129, .12);
          --bot-red: #ef4444;
          --bot-danger-text: #fca5a5;
          --bot-danger-bg: rgba(239, 68, 68, .08);
          --bot-danger-border: rgba(239, 68, 68, .35);
          --bot-success: #6ee7b7;
          --bot-success-border: rgba(16, 185, 129, .25);
          --bot-warning: #fbbf24;
          --bot-warning-muted: #cbd5e1;
          --bot-warning-bg: rgba(245, 158, 11, .08);
          --bot-warning-border: rgba(245, 158, 11, .35);
          --bot-neutral-status-bg: rgba(148, 163, 184, .12);
          --bot-neutral-status: #cbd5e1;
          --bot-neutral-dot: #94a3b8;
          --bot-badge-bg: rgba(99, 102, 241, .13);
          --bot-badge-text: #c7d2fe;
          --bot-positive: #34d399;
          --bot-negative: #f87171;
          --bot-shadow: 0 8px 30px rgba(0, 0, 0, .2);
          color: var(--bot-ink);
          font-family: "DM Sans", Inter, system-ui, sans-serif;
          display: grid;
          gap: 18px;
          width: 100%;
          min-width: 0;
        }
        .botManager[data-theme="light"] {
          color-scheme: light;
          --bot-page: #f8fafc;
          --bot-panel: #ffffff;
          --bot-surface: #ffffff;
          --bot-card: #f8fafc;
          --bot-ink: #0f172a;
          --bot-muted: #475569;
          --bot-line: #e2e8f0;
          --bot-border: #cbd5e1;
          --bot-label: #334155;
          --bot-placeholder: #64748b;
          --bot-teal-ink: #047857;
          --bot-focus: #047857;
          --bot-danger-text: #b91c1c;
          --bot-danger-bg: rgba(220, 38, 38, .07);
          --bot-danger-border: rgba(185, 28, 28, .3);
          --bot-success: #047857;
          --bot-success-border: rgba(4, 120, 87, .3);
          --bot-warning: #92400e;
          --bot-warning-muted: #78350f;
          --bot-warning-bg: rgba(245, 158, 11, .12);
          --bot-warning-border: rgba(180, 83, 9, .3);
          --bot-neutral-status-bg: #e2e8f0;
          --bot-neutral-status: #334155;
          --bot-neutral-dot: #64748b;
          --bot-badge-bg: #eef2ff;
          --bot-badge-text: #4338ca;
          --bot-positive: #047857;
          --bot-negative: #b91c1c;
          --bot-shadow: 0 8px 24px rgba(15, 23, 42, .06);
        }
        .panel { min-width: 0; border: 1px solid var(--bot-line); border-radius: 14px; background: var(--bot-panel); padding: 22px; box-shadow: var(--bot-shadow); }
        .heading { display:flex; justify-content:space-between; align-items:flex-start; gap:14px; margin-bottom:18px; }
        .eyebrow { margin:0 0 7px; color:var(--bot-teal); font-size:10px; font-weight:800; letter-spacing:1.4px; text-transform:uppercase; }
        h2 { margin:0; color:var(--bot-ink); font-size:17px; font-weight:800; letter-spacing:-.3px; }
        .sub { margin:6px 0 0; max-width:720px; color:var(--bot-muted); font-size:12px; line-height:1.6; }
        .grid { display:grid; grid-template-columns:minmax(260px,.85fr) minmax(0,1.4fr); align-items:start; gap:18px; }
        .notice { display:flex; align-items:flex-start; gap:11px; padding:14px 16px; border:1px solid var(--bot-warning-border); border-radius:11px; background:var(--bot-warning-bg); color:var(--bot-warning); }
        .notice strong { display:block; margin-bottom:4px; font-size:12px; }
        .notice p { margin:0; color:var(--bot-warning-muted); font-size:11px; line-height:1.65; }
        .stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
        .stat { min-width:0; padding:16px; border:1px solid var(--bot-line); border-radius:11px; background:var(--bot-panel); }
        .stat span { color:var(--bot-muted); font-size:11px; font-weight:700; }
        .stat strong { display:block; margin-top:9px; font-size:23px; font-weight:800; letter-spacing:-.5px; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
        .stat small { display:block; margin-top:5px; color:var(--bot-muted); font-size:10px; }
        form { display:grid; gap:13px; }
        .field { display:grid; gap:7px; min-width:0; }
        label { color:var(--bot-label); font-size:11px; font-weight:700; }
        input, select { width:100%; min-height:40px; border:1px solid var(--bot-border); border-radius:8px; background:var(--bot-surface); color:var(--bot-ink); padding:9px 11px; font:inherit; font-size:12px; }
        input::placeholder { color:var(--bot-placeholder); }
        input:focus, select:focus, button:focus-visible { outline:2px solid var(--bot-focus); outline-offset:2px; }
        .formRow { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
        .hint { margin:0; color:var(--bot-muted); font-size:10px; line-height:1.5; }
        .primary, .secondary, .toggle { display:inline-flex; justify-content:center; align-items:center; gap:8px; min-height:38px; padding:0 13px; border:1px solid transparent; border-radius:8px; font:inherit; font-size:11px; font-weight:800; transition:background .15s ease,border-color .15s ease; }
        .primary { background:var(--bot-teal); color:#062319; }
        .primary:hover:not(:disabled) { background:#34d399; }
        .secondary { border-color:var(--bot-border); background:var(--bot-surface); color:var(--bot-ink); }
        .secondary:hover:not(:disabled) { border-color:var(--bot-teal); }
        button:disabled { opacity:.55; cursor:not-allowed; }
        .alert { padding:10px 12px; border:1px solid var(--bot-danger-border); border-radius:8px; background:var(--bot-danger-bg); color:var(--bot-danger-text); font-size:11px; line-height:1.5; overflow-wrap:anywhere; }
        .success { padding:10px 12px; border:1px solid var(--bot-success-border); border-radius:8px; background:var(--bot-teal-soft); color:var(--bot-success); font-size:11px; line-height:1.5; }
        .botList { display:grid; gap:10px; }
        .botCard { min-width:0; padding:15px; border:1px solid var(--bot-line); border-radius:11px; background:var(--bot-card); }
        .botTop { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
        .botTitle { display:flex; align-items:center; gap:9px; min-width:0; }
        .botTitle h3 { margin:0; color:var(--bot-ink); font-size:13px; font-weight:800; overflow-wrap:anywhere; }
        .symbol { display:inline-flex; flex-shrink:0; padding:5px 7px; border:1px solid var(--bot-border); border-radius:6px; color:var(--bot-label); background:var(--bot-surface); font-size:10px; font-weight:700; }
        .status { display:inline-flex; align-items:center; gap:6px; flex-shrink:0; padding:5px 8px; border-radius:99px; background:var(--bot-neutral-status-bg); color:var(--bot-neutral-status); font-size:9px; font-weight:800; white-space:nowrap; }
        .status::before { content:""; width:6px; height:6px; border-radius:50%; background:var(--bot-neutral-dot); }
        .status.enabled { background:var(--bot-teal-soft); color:var(--bot-success); }
        .status.enabled::before { background:var(--bot-teal); box-shadow:0 0 7px rgba(16,185,129,.45); }
        .meta { display:flex; flex-wrap:wrap; align-items:center; gap:7px; margin-top:10px; }
        .badge { display:inline-flex; align-items:center; padding:5px 8px; border-radius:6px; background:var(--bot-badge-bg); color:var(--bot-badge-text); font-size:10px; font-weight:700; }
        .metaText { color:var(--bot-muted); font-size:10px; }
        .metrics { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin-top:14px; padding-top:13px; border-top:1px solid var(--bot-line); }
        .metric span { display:block; color:var(--bot-muted); font-size:9px; font-weight:700; }
        .metric strong { display:block; margin-top:5px; color:var(--bot-ink); font-size:12px; font-weight:800; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
        .pnl.positive { color:var(--bot-positive); }
        .pnl.negative { color:var(--bot-negative); }
        .botFooter { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-top:13px; }
        .botFooter small { color:var(--bot-muted); font-size:9px; line-height:1.5; }
        .toggle { border-color:var(--bot-border); background:var(--bot-surface); color:var(--bot-ink); flex-shrink:0; }
        .toggle.enabled { border-color:var(--bot-danger-border); color:var(--bot-danger-text); }
        .toggle:not(.enabled) { border-color:var(--bot-success-border); color:var(--bot-success); }
        .empty { min-height:130px; display:grid; place-items:center; padding:24px; border:1px dashed var(--bot-border); border-radius:10px; text-align:center; }
        .empty strong { display:block; color:var(--bot-ink); font-size:12px; }
        .empty p { margin:7px 0 0; color:var(--bot-muted); font-size:11px; line-height:1.5; }
        .logs { display:grid; gap:0; }
        .log { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:start; gap:12px; padding:12px 0; border-top:1px solid var(--bot-line); }
        .log:first-child { border-top:0; }
        .log strong { display:block; color:var(--bot-ink); font-size:11px; font-weight:800; }
        .log p { margin:5px 0 0; color:var(--bot-muted); font-size:10px; line-height:1.5; overflow-wrap:anywhere; }
        .log small { display:block; margin-top:5px; color:var(--bot-muted); font-size:9px; }
        .muted { color:var(--bot-muted); font-size:11px; line-height:1.6; }
        .sectionTitle { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:12px; }
        .sectionTitle h2 { font-size:14px; }
        @media (max-width: 920px) { .grid { grid-template-columns:1fr; } }
        @media (max-width: 600px) {
          .panel { padding:15px; }
          .stats { grid-template-columns:1fr; }
          .stat { padding:13px; }
          .stat strong { font-size:21px; }
          .botTop { align-items:flex-start; flex-direction:column; }
          .metrics { grid-template-columns:1fr 1fr; }
          .botFooter { align-items:stretch; flex-direction:column; }
          .toggle { width:100%; }
          .log { grid-template-columns:1fr; gap:5px; }
          .formRow { grid-template-columns:1fr; }
        }
      `}</style>

      <div className="heading">
        <div>
          <p className="eyebrow">Automation workspace</p>
          <h2 id="bot-manager-title">Automated trading bots</h2>
          <p className="sub">Create and monitor strategy configurations, recent activity, and reported P&amp;L in one place.</p>
        </div>
        <button className="secondary" type="button" onClick={() => void refresh()} disabled={loading || !client || !userId}>
          ↻ Refresh
        </button>
      </div>

      <div className="notice" role="note">
        <span aria-hidden="true">⚠</span>
        <div>
          <strong>Execution engine not connected</strong>
          <p>These controls save bot configuration and its enabled flag only. This module does not place trades. Keep bots inactive until a trusted server-side runner validates every order, enforces risk limits, and reconciles uncertain Deriv responses. Browser-side automation is not a safe substitute.</p>
        </div>
      </div>

      {error && <div className="alert" role="alert">{error}</div>}
      {message && <div className="success" role="status">{message}</div>}

      <div className="stats" aria-label="Bot summary">
        <div className="stat">
          <span>Bot configurations</span>
          <strong>{loading ? "—" : bots.length}</strong>
          <small>Saved to your TradeBridge account</small>
        </div>
        <div className="stat">
          <span>Enabled configurations</span>
          <strong>{loading ? "—" : activeCount}</strong>
          <small>Not a count of running strategies</small>
        </div>
        <div className="stat">
          <span>Reported total P&amp;L</span>
          <strong className={pnlClass(totalPnl)}>{loading ? "—" : formatPnl(totalPnl)}</strong>
          <small>Summed from the bot records; account currency may vary</small>
        </div>
      </div>

      <div className="grid">
        <section className="panel" aria-labelledby="create-bot-title">
          <div className="heading">
            <div>
              <h2 id="create-bot-title">Create bot</h2>
              <p className="sub">New configurations are saved inactive by default.</p>
            </div>
          </div>

          <form onSubmit={(event) => void handleCreate(event)}>
            <div className="field">
              <label htmlFor="bot-name">Bot name</label>
              <input
                id="bot-name"
                value={form.bot_name}
                onChange={(event) => updateForm("bot_name", event.target.value)}
                minLength={2}
                maxLength={80}
                placeholder="e.g. EURUSD Momentum"
                autoComplete="off"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="bot-symbol">Deriv asset symbol</label>
              <input
                id="bot-symbol"
                value={form.symbol}
                onChange={(event) => updateForm("symbol", event.target.value)}
                minLength={2}
                maxLength={32}
                placeholder="frxEURUSD"
                autoComplete="off"
                spellCheck={false}
                required
              />
              <p className="hint">Use the exact symbol returned by Deriv market discovery. Symbol syntax is checked here; availability is not yet verified by a bot runner.</p>
            </div>

            <div className="field">
              <label htmlFor="bot-strategy">Strategy type</label>
              <select
                id="bot-strategy"
                value={form.strategy_type}
                onChange={(event) => updateForm("strategy_type", event.target.value as StrategyType)}
              >
                {STRATEGIES.map((strategy) => (
                  <option value={strategy.value} key={strategy.value}>{strategy.label}</option>
                ))}
              </select>
              <p className="hint">{STRATEGIES.find((item) => item.value === form.strategy_type)?.description}</p>
            </div>

            <div className="field">
              <label htmlFor="bot-stake">Stake amount</label>
              <input
                id="bot-stake"
                type="number"
                min="0.01"
                max="10000"
                step="0.01"
                value={form.stake_amount}
                onChange={(event) => updateForm("stake_amount", event.target.value)}
                required
              />
              <p className="hint">Positive amount, capped at 10,000 for this configuration. Actual order limits must also be checked on the server.</p>
            </div>

            <div className="formRow">
              <div className="field">
                <label htmlFor="bot-take-profit">Take profit (pips)</label>
                <input
                  id="bot-take-profit"
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.take_profit_pips}
                  onChange={(event) => updateForm("take_profit_pips", event.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="bot-stop-loss">Stop loss (pips)</label>
                <input
                  id="bot-stop-loss"
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.stop_loss_pips}
                  onChange={(event) => updateForm("stop_loss_pips", event.target.value)}
                  required
                />
              </div>
            </div>
            <p className="hint">A value of 0 means no threshold configured. Pip thresholds are stored as settings only and are not enforced by this UI.</p>

            <button className="primary" type="submit" disabled={saving || loading || !client || !userId}>
              {saving ? "Saving configuration…" : "＋ Create bot configuration"}
            </button>
          </form>
        </section>

        <section className="panel" aria-labelledby="your-bots-title">
          <div className="heading">
            <div>
              <h2 id="your-bots-title">Your bots</h2>
              <p className="sub">Status and P&amp;L update when Supabase broadcasts changes or you refresh.</p>
            </div>
          </div>

          {loading ? (
            <div className="empty" role="status"><div><strong>Loading bot configurations…</strong><p>Checking your signed-in account and Supabase access.</p></div></div>
          ) : bots.length === 0 ? (
            <div className="empty"><div><strong>No bot configurations yet</strong><p>Create your first bot configuration. It will be saved inactive.</p></div></div>
          ) : (
            <div className="botList">
              {bots.map((bot) => (
                <article className="botCard" key={bot.id}>
                  <div className="botTop">
                    <div>
                      <div className="botTitle">
                        <h3>{bot.bot_name}</h3>
                        <span className="symbol">{bot.symbol}</span>
                      </div>
                      <div className="meta">
                        <span className="badge">{strategyLabel(bot.strategy_type)}</span>
                        <span className="metaText">Stake {asNumber(bot.stake_amount).toFixed(2)}</span>
                        <span className="metaText">·</span>
                        <span className="metaText">{bot.total_trades} reported trades</span>
                      </div>
                    </div>
                    <span className={bot.is_active ? "status enabled" : "status"}>
                      {bot.is_active ? "Enabled · config" : "Inactive"}
                    </span>
                  </div>

                  <div className="metrics">
                    <div className="metric">
                      <span>REPORTED P&amp;L</span>
                      <strong className={pnlClass(bot.total_profit_loss)}>{formatPnl(bot.total_profit_loss)}</strong>
                    </div>
                    <div className="metric">
                      <span>TAKE PROFIT</span>
                      <strong>{asNumber(bot.take_profit_pips).toLocaleString("en-US")} pips</strong>
                    </div>
                    <div className="metric">
                      <span>STOP LOSS</span>
                      <strong>{asNumber(bot.stop_loss_pips).toLocaleString("en-US")} pips</strong>
                    </div>
                  </div>

                  <div className="botFooter">
                    <small>Updated {new Date(bot.updated_at).toLocaleString()}</small>
                    <button
                      type="button"
                      className={bot.is_active ? "toggle enabled" : "toggle"}
                      onClick={() => void toggleBot(bot)}
                      disabled={busyBotId === bot.id}
                      aria-label={bot.is_active ? "Disable " + bot.bot_name + " configuration" : "Enable " + bot.bot_name + " configuration"}
                    >
                      {busyBotId === bot.id ? "Saving…" : bot.is_active ? "Ⅱ Disable config" : "▶ Enable config"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="panel" aria-labelledby="bot-logs-title">
        <div className="sectionTitle">
          <div>
            <h2 id="bot-logs-title">Recent bot activity</h2>
            <p className="sub">Execution logs are expected to be written by a trusted server-side worker.</p>
          </div>
          <span className="metaText">{logs.length} recent {logs.length === 1 ? "event" : "events"}</span>
        </div>

        {loading ? (
          <p className="muted">Loading activity…</p>
        ) : logs.length === 0 ? (
          <p className="muted">No activity has been recorded yet. Creating or enabling a configuration does not create a trade log.</p>
        ) : (
          <div className="logs">
            {logs.map((log) => (
              <div className="log" key={log.id}>
                <div>
                  <strong>{log.action.replace(/_/g, " ")} · {botNames.get(log.bot_id) ?? "Bot"}</strong>
                  {log.details && <p>{logDetails(log.details)}</p>}
                  <small>{new Date(log.timestamp).toLocaleString()}</small>
                </div>
                {log.profit_loss !== null && log.profit_loss !== undefined && (
                  <strong className={pnlClass(log.profit_loss)}>{formatPnl(log.profit_loss)}</strong>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="muted">Automated trading involves risk. These settings are not a performance guarantee, and the reported P&amp;L depends on updates from a separate trusted execution service.</p>
    </section>
  );
}
