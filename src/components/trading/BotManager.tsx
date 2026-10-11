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
  account_id: string | null;
  stake_amount: number | string;
  duration_seconds: number;
  daily_loss_limit: number | string;
  max_trades_per_day: number;
  max_consecutive_losses: number;
  min_expected_return: number | string;
  is_active: boolean;
  total_trades: number;
  total_profit_loss: number | string;
  created_at: string;
  updated_at: string;
}

interface DemoAccountOption {
  account_id: string;
  account_type: string | null;
  currency: string | null;
  balance?: number | null;
}

interface AccountsResponse {
  connected?: boolean;
  accounts?: DemoAccountOption[];
  error?: string;
}

interface BotLog {
  id: string;
  bot_id: string;
  action: string;
  details: Record<string, unknown> | string | null;
  profit_loss: number | string | null;
  timestamp: string;
}

interface UnknownBotTrade {
  id: string;
  bot_id: string;
  account_id: string;
  symbol: string;
  direction: "CALL" | "PUT";
  stake_amount: number | string;
  ask_price: number | string | null;
  created_at: string;
}

type BrowserSupabaseClient = ReturnType<typeof createClient>;

interface BotFormState {
  bot_name: string;
  strategy_type: StrategyType;
  symbol: string;
  account_id: string;
  stake_amount: string;
  duration_seconds: string;
  daily_loss_limit: string;
  max_trades_per_day: string;
}

const INITIAL_FORM: BotFormState = {
  bot_name: "",
  strategy_type: "trend_following",
  symbol: "frxEURUSD",
  account_id: "",
  stake_amount: "1",
  duration_seconds: "60",
  daily_loss_limit: "5",
  max_trades_per_day: "10",
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
  const code = message.toLowerCase();
  if (code.includes("bot_token_encryption_not_configured")) return "Bot token encryption is not configured on the server. Set BOT_TOKEN_ENCRYPTION_KEY to a base64-encoded 32-byte key.";
  if (code.includes("demo_account_required")) return "Select a verified Deriv Demo account in the bot configuration first.";
  if (code.includes("another_bot_armed_on_account")) return "Only one bot can be armed on this Demo account at a time. Pause the other bot first.";
  if (code.includes("open_bot_trade_must_settle")) return "An earlier bot contract is still open. The runner must reconcile it before a new bot can be armed.";
  if (code.includes("open_trade_for_other_bot")) return "Another bot has an outstanding contract on this account. Open that bot and refresh settlement access first.";
  if (code.includes("unknown_bot_trade_requires_reconciliation")) return "An earlier order has an unknown outcome. Use the broker-verification tools below before attempting any new trade.";
  if (code.includes("possible_purchase_found")) return "Deriv returned a potentially matching purchase. Enter its contract ID and verify it; TradeBridge will not mark it as absent.";
  if (code.includes("broker_history_incomplete_or_open_exposure")) return "Deriv could not prove the account had no matching order or open exposure. Verify the transaction directly and enter the contract ID.";
  if (code.includes("wait_before_confirming_no_order")) return "Wait at least two minutes after the ambiguous order before checking whether it was placed.";
  if (code.includes("contract_does_not_match_unknown_order")) return "That contract does not match the original symbol, direction, stake or time. Check the contract ID.";
  if (code.includes("contract_not_found_in_demo_account")) return "Deriv did not return that contract for this Demo account. Recheck the contract ID.";
  if (code.includes("broker_reconciliation_failed")) return "Deriv verification failed or timed out. The safety lock remains in place; refresh and retry later.";
  if (code.includes("bot_account_state_unavailable")) return "TradeBridge could not safely verify account exposure. Retry after the bot database is available.";
  if (code.includes("deriv_reconnect_required") || code.includes("deriv_authorization_invalid")) return "Reconnect Deriv, select your Demo account, then enable the bot again.";
  if (code.includes("demo_only_runner")) return "Automated bots can only use a verified Demo account.";
  if (code.includes("bot_server_not_configured") || code.includes("bot_runner_not_configured")) return "The server-side bot runner is not configured yet. Review docs/bot-runner-setup.md.";
  if (code.includes("bot_credentials_unavailable") || code.includes("bot_database_unavailable")) return "The bot runner database is unavailable. Apply all TradeBridge migrations and verify server credentials.";
  if (code.includes("trading_bots") || code.includes("bot_logs") || code.includes("bot_trade_ledger")) {
    return "Bot tables are not available yet. Apply all TradeBridge Supabase migrations, then reload.";
  }
  if (code.includes("row-level security")) {
    return "Supabase rejected this operation. Confirm that you are signed in to the correct TradeBridge account.";
  }
  return message;
}

export default function BotManager({ theme }: { theme: "dark" | "light" }) {
  const [client, setClient] = useState<BrowserSupabaseClient | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [demoAccounts, setDemoAccounts] = useState<DemoAccountOption[]>([]);
  const [stoppingAll, setStoppingAll] = useState(false);
  const [reconcilingLedgerId, setReconcilingLedgerId] = useState<string | null>(null);
  const [reconcileContractIds, setReconcileContractIds] = useState<Record<string, string>>({});
  const [unknownTrades, setUnknownTrades] = useState<UnknownBotTrade[]>([]);
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

    const { data: unknownRows, error: unknownError } = await supabase
      .from("bot_trade_ledger")
      .select("id,bot_id,account_id,symbol,direction,stake_amount,ask_price,created_at")
      .eq("user_id", currentUserId)
      .eq("status", "unknown")
      .order("created_at", { ascending: false })
      .limit(20);
    if (unknownError) throw new Error(unknownError.message);
    setUnknownTrades((unknownRows ?? []) as unknown as UnknownBotTrade[]);

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

        const accountsResponse = await fetch("/api/auth/deriv/accounts", { cache: "no-store" });
        if (accountsResponse.ok) {
          const accountData = await accountsResponse.json() as AccountsResponse;
          const demoOnly = (accountData.accounts ?? []).filter(
            (account) => (account.account_type ?? "").toLowerCase() === "demo" && Boolean(account.account_id),
          );
          setDemoAccounts(demoOnly);
          if (demoOnly.length > 0) {
            setForm((current) => ({ ...current, account_id: current.account_id || demoOnly[0].account_id }));
          }
        }

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
    const durationSeconds = Number(form.duration_seconds);
    const dailyLossLimit = Number(form.daily_loss_limit);
    const maxTradesPerDay = Number(form.max_trades_per_day);
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
    if (!demoAccounts.some((account) => account.account_id === form.account_id)) {
      setError("Select a verified Demo account. Real accounts cannot be used for automated bots.");
      return;
    }
    if (!Number.isFinite(stake) || stake <= 0 || stake > 100) {
      setError("Stake must be greater than 0 and no more than 100 in the account currency.");
      return;
    }
    if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 1800) {
      setError("Contract duration must be an integer between 1 and 1,800 seconds.");
      return;
    }
    if (!Number.isFinite(dailyLossLimit) || dailyLossLimit <= 0 || dailyLossLimit > 10000) {
      setError("Daily loss limit must be greater than 0 and no more than 10,000.");
      return;
    }
    if (!Number.isInteger(maxTradesPerDay) || maxTradesPerDay < 1 || maxTradesPerDay > 100) {
      setError("Maximum trades per day must be an integer between 1 and 100.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { error: insertError } = await client.from("trading_bots").insert({
        user_id: userId,
        account_id: form.account_id,
        bot_name: trimmedName,
        strategy_type: form.strategy_type,
        symbol: trimmedSymbol,
        stake_amount: stake,
        duration_seconds: durationSeconds,
        daily_loss_limit: dailyLossLimit,
        max_trades_per_day: maxTradesPerDay,
        max_consecutive_losses: 3,
        min_expected_return: 0.02,
      });

      if (insertError) throw new Error(insertError.message);
      setForm({ ...INITIAL_FORM, account_id: form.account_id });
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
      const response = await fetch("/api/bots/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot_id: bot.id, enabled: !bot.is_active }),
        cache: "no-store",
      });
      const result = await response.json() as {
        success?: boolean;
        error?: string;
        settlement_only?: boolean;
        credential_expires_at?: string;
      };
      if (!response.ok || !result.success) throw new Error(result.error ?? "Could not update bot state.");

      await loadData(client, userId);
      setMessage(
        result.settlement_only
          ? "Demo authorization refreshed for settlement only. The bot remains paused and cannot open another order until the outstanding contract settles."
          : !bot.is_active
            ? "Demo bot armed. It will place an order only when the out-of-sample edge and risk gates pass. Its short-lived Deriv authorization must be renewed when it expires."
            : "Bot paused. No new entries will be opened; any known outstanding contract remains eligible for settlement monitoring.",
      );
    } catch (toggleError: unknown) {
      setError(friendlyError(toggleError instanceof Error ? toggleError.message : "Could not update this bot."));
    } finally {
      setBusyBotId(null);
    }
  }

  async function stopAllBots() {
    setStoppingAll(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/bots/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stop_all: true }),
        cache: "no-store",
      });
      const result = await response.json() as { success?: boolean; stopped?: number; error?: string };
      if (!response.ok || !result.success) throw new Error(result.error ?? "Could not stop all bots.");
      if (client && userId) await loadData(client, userId);
      setMessage("All bots are paused. Credentials are removed unless a known open contract still needs the runner to reconcile its settlement. No new bot entries will be opened.");
    } catch (stopError: unknown) {
      setError(friendlyError(stopError instanceof Error ? stopError.message : "Could not stop all bots."));
    } finally {
      setStoppingAll(false);
    }
  }

  async function reconcileUnknownTrade(
    trade: UnknownBotTrade,
    resolution: "contract_found" | "no_order",
  ) {
    setReconcilingLedgerId(trade.id);
    setError(null);
    setMessage(null);
    try {
      const contractId = reconcileContractIds[trade.id]?.trim() ?? "";
      if (resolution === "contract_found" && !/^\\d{1,24}$/.test(contractId)) {
        throw new Error("valid_contract_id_required");
      }
      const response = await fetch("/api/bots/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ledger_id: trade.id,
          resolution,
          ...(resolution === "contract_found" ? { contract_id: contractId } : {}),
        }),
        cache: "no-store",
      });
      const result = await response.json() as { success?: boolean; error?: string; message?: string };
      if (!response.ok || !result.success) throw new Error(result.error ?? "broker_reconciliation_failed");
      if (client && userId) await loadData(client, userId);
      setMessage(result.message ?? "Trade outcome reconciled. The bot remains paused until you review and re-arm it.");
      setReconcileContractIds((current) => {
        const next = { ...current };
        delete next[trade.id];
        return next;
      });
    } catch (reconcileError: unknown) {
      setError(friendlyError(reconcileError instanceof Error ? reconcileError.message : "broker_reconciliation_failed"));
    } finally {
      setReconcilingLedgerId(null);
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
        .eyebrow { margin:0 0 7px; color:var(--bot-teal-ink); font-size:10px; font-weight:800; letter-spacing:1.4px; text-transform:uppercase; }
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
        .reconcilePanel { display:grid; gap:8px; margin-top:12px; padding:12px; border:1px solid rgba(245,158,11,.4); border-radius:9px; background:rgba(245,158,11,.08); }
        .reconcilePanel > strong { color:var(--bot-amber, #f59e0b); font-size:11px; }
        .reconcilePanel p, .reconcilePanel small { margin:0; color:var(--bot-muted); font-size:10px; line-height:1.5; }
        .reconcileControls { display:grid; grid-template-columns:minmax(0,1fr) auto auto; align-items:end; gap:8px; }
        .reconcileControls .field { min-width:0; }
        @media (max-width:640px) { .reconcileControls { grid-template-columns:minmax(0,1fr); } .reconcileControls .secondary { width:100%; } }
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
              <label htmlFor="bot-account">Verified Deriv Demo account</label>
              <select
                id="bot-account"
                value={form.account_id}
                onChange={(event) => updateForm("account_id", event.target.value)}
                required
                disabled={demoAccounts.length === 0}
              >
                {demoAccounts.length === 0
                  ? <option value="">Connect Deriv and select a Demo account</option>
                  : demoAccounts.map((account) => (
                    <option value={account.account_id} key={account.account_id}>
                      {account.account_id} · {account.currency ?? "Currency"} · Demo
                    </option>
                  ))}
              </select>
              <p className="hint">Bots are hard-limited to verified Demo accounts. Real-money automation is not supported.</p>
            </div>

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
              <p className="hint">The runner also caps each stake at 1% of the verified Demo balance. A larger configured stake is skipped rather than forced.</p>
            </div>

            <div className="formRow">
              <div className="field">
                <label htmlFor="bot-duration">Contract duration (seconds)</label>
                <input
                  id="bot-duration"
                  type="number"
                  min="1"
                  max="1800"
                  step="1"
                  value={form.duration_seconds}
                  onChange={(event) => updateForm("duration_seconds", event.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="bot-daily-loss">Daily loss limit</label>
                <input
                  id="bot-daily-loss"
                  type="number"
                  min="0.01"
                  max="10000"
                  step="0.01"
                  value={form.daily_loss_limit}
                  onChange={(event) => updateForm("daily_loss_limit", event.target.value)}
                  required
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="bot-max-trades">Maximum trades per day (account-wide)</label>
              <input
                id="bot-max-trades"
                type="number"
                min="1"
                max="100"
                step="1"
                value={form.max_trades_per_day}
                onChange={(event) => updateForm("max_trades_per_day", event.target.value)}
                required
              />
              <p className="hint">The runner also pauses after 3 consecutive losses, blocks overlapping contracts, and requires a positive out-of-sample edge before every entry.</p>
            </div>

            <button className="primary" type="submit" disabled={saving || loading || !client || !userId || demoAccounts.length === 0}>
              {saving ? "Saving configuration…" : "＋ Create bot configuration"}
            </button>
          </form>
        </section>

        <section className="panel" aria-labelledby="your-bots-title">
          <div className="heading">
            <div>
              <h2 id="your-bots-title">Your bots</h2>
              <p className="sub">Only the scheduled server runner can submit Demo orders; enabled status does not guarantee a signal or profit.</p>
            </div>
            <button className="secondary" type="button" onClick={() => void stopAllBots()} disabled={stoppingAll || activeCount === 0}>
              {stoppingAll ? "Stopping…" : "■ Stop all"}
            </button>
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
                        <span className="metaText">{bot.account_id ?? "No Demo account"}</span>
                        <span className="metaText">·</span>
                        <span className="metaText">Stake {asNumber(bot.stake_amount).toFixed(2)}</span>
                        <span className="metaText">·</span>
                        <span className="metaText">{bot.total_trades} settled trades</span>
                      </div>
                    </div>
                    <span className={bot.is_active ? "status enabled" : "status"}>
                      {bot.is_active ? "Armed · Demo" : "Inactive"}
                    </span>
                  </div>

                  {unknownTrades.filter((trade) => trade.bot_id === bot.id).map((trade) => (
                    <div className="reconcilePanel" key={trade.id} role="alert">
                      <strong>Unknown order outcome — new entries are blocked</strong>
                      <p>
                        TradeBridge did not receive a definitive buy response. Verify the Demo account through Deriv before clearing this safety lock.
                        Expected {trade.direction === "CALL" ? "Higher" : "Lower"} · {trade.symbol} · {asNumber(trade.ask_price ?? trade.stake_amount).toFixed(2)}.
                      </p>
                      <div className="reconcileControls">
                        <div className="field">
                          <label htmlFor={"reconcile-contract-" + trade.id}>Deriv contract ID</label>
                          <input
                            id={"reconcile-contract-" + trade.id}
                            inputMode="numeric"
                            placeholder="Enter contract ID from Deriv"
                            value={reconcileContractIds[trade.id] ?? ""}
                            onChange={(event) => setReconcileContractIds((current) => ({ ...current, [trade.id]: event.target.value }))}
                            disabled={reconcilingLedgerId === trade.id}
                          />
                        </div>
                        <button
                          className="secondary"
                          type="button"
                          onClick={() => void reconcileUnknownTrade(trade, "contract_found")}
                          disabled={reconcilingLedgerId === trade.id || !/^\\d{1,24}$/.test(reconcileContractIds[trade.id]?.trim() ?? "")}
                        >
                          {reconcilingLedgerId === trade.id ? "Checking…" : "Verify contract"}
                        </button>
                        <button
                          className="secondary"
                          type="button"
                          onClick={() => void reconcileUnknownTrade(trade, "no_order")}
                          disabled={reconcilingLedgerId === trade.id}
                        >
                          Verify no order
                        </button>
                      </div>
                      <small>“Verify no order” checks the live Demo portfolio and broker statement/profit history. If the evidence is incomplete or a possible purchase is found, TradeBridge keeps the lock.</small>
                    </div>
                  ))}

                  <div className="metrics">
                    <div className="metric">
                      <span>REPORTED P&amp;L</span>
                      <strong className={pnlClass(bot.total_profit_loss)}>{formatPnl(bot.total_profit_loss)}</strong>
                    </div>
                    <div className="metric">
                      <span>DURATION</span>
                      <strong>{bot.duration_seconds}s</strong>
                    </div>
                    <div className="metric">
                      <span>DAILY LOSS STOP</span>
                      <strong>{asNumber(bot.daily_loss_limit).toLocaleString("en-US")}</strong>
                    </div>
                  </div>

                  <div className="botFooter">
                    <small>Updated {new Date(bot.updated_at).toLocaleString()}</small>
                    <button
                      type="button"
                      className={bot.is_active ? "toggle enabled" : "toggle"}
                      onClick={() => void toggleBot(bot)}
                      disabled={busyBotId === bot.id}
                      aria-label={bot.is_active ? "Pause " + bot.bot_name : "Arm " + bot.bot_name}
                    >
                      {busyBotId === bot.id ? "Saving…" : bot.is_active ? "Ⅱ Pause bot" : "▶ Arm Demo bot"}
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

      <p className="muted">No strategy guarantees profit. The runner uses an out-of-sample holdout, a 95% Wilson lower-bound profitability gate, a 1% per-trade balance cap, a daily loss stop, trade-count and loss-streak limits, one open account contract at a time, and an ambiguity pause. The Deriv OAuth token is encrypted server-side and expires from bot use after a short safety TTL; reconnect and re-arm to renew it. Make sure a scheduler is configured as described in docs/bot-runner-setup.md.</p>
    </section>
  );
}
