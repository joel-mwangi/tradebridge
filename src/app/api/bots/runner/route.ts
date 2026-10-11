import { NextRequest, NextResponse } from "next/server";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptDerivToken } from "@/lib/bots/credentials";
import {
  analyzeSignal,
  backtestStrategy,
  evaluateEntry,
  STRATEGY_ENGINE_VERSION,
} from "@/lib/bots/strategy-engine.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HEADERS = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };
const DERIV_API = "https://api.derivws.com";
const MAX_BOTS_PER_RUN = 4;
const HISTORY_COUNT = 5000;
const RPC_TIMEOUT_MS = 8000;
const TERMINAL_STATUSES = new Set(["won", "lost", "sold", "expired", "cancelled"]);

type JsonObject = Record<string, unknown>;
type BotRow = {
  id: string;
  user_id: string;
  bot_name: string;
  strategy_type: string;
  symbol: string;
  account_id: string | null;
  stake_amount: number | string;
  duration_seconds: number;
  daily_loss_limit: number | string;
  max_trades_per_day: number;
  max_consecutive_losses: number;
  min_expected_return: number | string;
  is_active: boolean;
};
type CredentialRow = {
  user_id: string;
  account_id: string;
  encrypted_access_token: string;
  currency: string;
  expires_at: string;
};
type LedgerRow = {
  id: string;
  bot_id: string;
  user_id: string;
  account_id: string;
  contract_id: string | null;
  status: string;
  created_at: string;
  settled_at: string | null;
  realized_pnl: number | string | null;
};
type BrokerMessage = {
  req_id?: number;
  msg_type?: string;
  error?: { message?: string; code?: string };
  history?: { prices?: Array<number | string>; times?: number[] };
  balance?: { balance?: number | string; currency?: string };
  portfolio?: { contracts?: Array<Record<string, unknown>> };
  proposal?: { id?: string; ask_price?: number | string; payout?: number | string };
  buy?: { contract_id?: number | string; buy_price?: number | string };
  proposal_open_contract?: Record<string, unknown>;
};

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: HEADERS });
}
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const valueAsNumber = Number(value);
  return Number.isFinite(valueAsNumber) ? valueAsNumber : null;
}
function startOfUtcDay() {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}
function constantTimeMatches(received: string, expected: string) {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
function deriveBrokerMessage(event: MessageEvent): BrokerMessage {
  const parsed: unknown = JSON.parse(String(event.data));
  if (!parsed || typeof parsed !== "object") throw new Error("invalid_broker_message");
  return parsed as BrokerMessage;
}
function websocketRequest(ws: WebSocket, payload: JsonObject): Promise<BrokerMessage> {
  const reqId = Math.floor(Math.random() * 1_000_000_000) + 1;
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error?: Error, message?: BrokerMessage) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      if (error) reject(error);
      else resolve(message as BrokerMessage);
    };
    const onMessage = (event: MessageEvent) => {
      let message: BrokerMessage;
      try { message = deriveBrokerMessage(event); }
      catch { return; }
      if (message.req_id !== reqId) return;
      if (message.error) finish(new Error("deriv_request_rejected"));
      else finish(undefined, message);
    };
    const timer = setTimeout(() => finish(new Error("deriv_request_timeout")), RPC_TIMEOUT_MS);
    ws.addEventListener("message", onMessage);
    try {
      ws.send(JSON.stringify({ ...payload, req_id: reqId }));
    } catch {
      finish(new Error("deriv_send_failed"));
    }
  });
}
function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let ws: WebSocket;
    try { ws = new WebSocket(url); }
    catch { reject(new Error("deriv_socket_unavailable")); return; }
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close();
      reject(new Error("deriv_socket_timeout"));
    }, RPC_TIMEOUT_MS);
    ws.addEventListener("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ws);
    }, { once: true });
    ws.addEventListener("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("deriv_socket_error"));
    }, { once: true });
  });
}

async function writeLog(admin: ReturnType<typeof createAdminClient>, bot: BotRow, action: string, details: JsonObject, profitLoss?: number | null) {
  await admin.from("bot_logs").insert({
    bot_id: bot.id,
    action,
    details: { engine: STRATEGY_ENGINE_VERSION, ...details },
    ...(profitLoss === undefined ? {} : { profit_loss: profitLoss }),
  });
}
async function pauseAccountBots(admin: ReturnType<typeof createAdminClient>, bot: BotRow, action: string, details: JsonObject) {
  await admin.from("trading_bots").update({ is_active: false })
    .eq("user_id", bot.user_id).eq("account_id", bot.account_id).eq("is_active", true);
  await admin.from("bot_runner_credentials").delete()
    .eq("user_id", bot.user_id).eq("account_id", bot.account_id);
  await writeLog(admin, bot, action, details);
}
async function getAccountOpenLedger(admin: ReturnType<typeof createAdminClient>, bot: BotRow) {
  const result = await admin.from("bot_trade_ledger").select("*")
    .eq("user_id", bot.user_id).eq("account_id", bot.account_id)
    .in("status", ["pending", "open", "unknown"])
    .order("created_at", { ascending: false }).limit(10);
  if (result.error) throw new Error("bot_ledger_unavailable");
  return (result.data ?? []) as LedgerRow[];
}

async function getDailyRiskState(admin: ReturnType<typeof createAdminClient>, bot: BotRow) {
  const today = startOfUtcDay();
  const [created, settled, recent, lastTrade] = await Promise.all([
    admin.from("bot_trade_ledger").select("id,status,created_at")
      .eq("user_id", bot.user_id).eq("account_id", bot.account_id)
      .gte("created_at", today).neq("status", "rejected").limit(1000),
    admin.from("bot_trade_ledger").select("realized_pnl,settled_at,status")
      .eq("user_id", bot.user_id).eq("account_id", bot.account_id)
      .gte("settled_at", today).not("realized_pnl", "is", null).order("settled_at", { ascending: false }).limit(1000),
    admin.from("bot_trade_ledger").select("realized_pnl,status,settled_at")
      .eq("user_id", bot.user_id).eq("account_id", bot.account_id)
      .not("settled_at", "is", null).not("realized_pnl", "is", null)
      .order("settled_at", { ascending: false }).limit(10),
    admin.from("bot_trade_ledger").select("created_at")
      .eq("user_id", bot.user_id).eq("account_id", bot.account_id)
      .neq("status", "rejected").order("created_at", { ascending: false }).limit(1),
  ]);
  if (created.error || settled.error || recent.error || lastTrade.error) throw new Error("bot_risk_state_unavailable");
  const dailyPnl = (settled.data ?? []).reduce((sum, row) => sum + (toNumber(row.realized_pnl) ?? 0), 0);
  let consecutiveLosses = 0;
  for (const row of recent.data ?? []) {
    const pnl = toNumber(row.realized_pnl);
    if (pnl === null || pnl >= 0) break;
    consecutiveLosses += 1;
  }
  const lastAt = lastTrade.data?.[0]?.created_at ? Date.parse(lastTrade.data[0].created_at) : null;
  return {
    dailyPnl,
    tradesToday: (created.data ?? []).length,
    consecutiveLosses,
    lastTradeAt: Number.isFinite(lastAt) ? lastAt : null,
  };
}

async function obtainDemoSocket(token: string, accountId: string): Promise<WebSocket> {
  const otpResponse = await fetch(
    DERIV_API + "/trading/v1/options/accounts/" + encodeURIComponent(accountId) + "/otp",
    {
      method: "POST",
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!otpResponse.ok) throw new Error(otpResponse.status === 401 ? "deriv_token_expired" : "deriv_otp_unavailable");
  const payload: unknown = await otpResponse.json();
  const root = payload && typeof payload === "object" ? payload as { data?: unknown } : {};
  const data = root.data && typeof root.data === "object" ? root.data as { url?: unknown } : {};
  if (typeof data.url !== "string") throw new Error("invalid_demo_session");
  const url = new URL(data.url);
  if (url.protocol !== "wss:" || url.hostname !== "api.derivws.com"
    || url.pathname !== "/trading/v1/options/ws/demo" || !url.searchParams.has("otp")) {
    throw new Error("non_demo_session_rejected");
  }
  return openSocket(url.toString());
}

async function settleExistingTrade(
  admin: ReturnType<typeof createAdminClient>,
  bot: BotRow,
  ws: WebSocket,
  ledger: LedgerRow,
) {
  if (ledger.status === "unknown") {
    await pauseAccountBots(admin, bot, "bot_paused_unknown_order", {
      reason: "previous_order_outcome_unknown",
      ledger_id: ledger.id,
      note: "Reconcile Deriv open contracts and statement activity before re-arming.",
    });
    return "unknown_order_paused";
  }
  if (ledger.status === "pending") {
    const ageMs = Date.now() - Date.parse(ledger.created_at);
    if (ageMs > 60_000) {
      await admin.from("bot_trade_ledger").update({
        status: "unknown",
        details: { reason: "worker_restarted_while_order_pending" },
      }).eq("id", ledger.id).eq("status", "pending");
      await pauseAccountBots(admin, bot, "bot_paused_unknown_order", {
        reason: "stale_pending_order",
        ledger_id: ledger.id,
        note: "Do not retry until the account activity has been reconciled.",
      });
      return "stale_pending_paused";
    }
    return "order_pending";
  }
  if (!ledger.contract_id) {
    await admin.from("bot_trade_ledger").update({ status: "unknown" }).eq("id", ledger.id);
    await pauseAccountBots(admin, bot, "bot_paused_unknown_order", {
      reason: "open_contract_id_missing", ledger_id: ledger.id,
    });
    return "contract_id_missing_paused";
  }

  const response = await websocketRequest(ws, {
    proposal_open_contract: 1,
    contract_id: Number(ledger.contract_id),
  });
  const raw = response.proposal_open_contract;
  if (!raw || typeof raw !== "object") return "contract_status_unavailable";
  const status = String(raw.status ?? "").toLowerCase();
  const terminal = TERMINAL_STATUSES.has(status) || raw.is_sold === 1 || raw.is_expired === 1;
  if (!terminal) return "open_contract_pending";

  const profit = toNumber(raw.profit);
  if (profit === null) {
    await pauseAccountBots(admin, bot, "bot_paused_unknown_settlement", {
      reason: "terminal_contract_without_realized_pnl", ledger_id: ledger.id,
    });
    return "settlement_missing_pnl_paused";
  }
  const nextStatus = status === "sold" || raw.is_sold === 1 ? "sold" : profit >= 0 ? "won" : "lost";
  const { data: updated, error } = await admin.from("bot_trade_ledger").update({
    status: nextStatus,
    realized_pnl: profit,
    settled_at: new Date().toISOString(),
    details: { broker_status: status },
  }).eq("id", ledger.id).eq("status", "open").select("id").maybeSingle();
  if (error) throw new Error("bot_settlement_write_failed");
  if (updated) {
    const { data: freshBot } = await admin.from("trading_bots").select("total_trades,total_profit_loss").eq("id", bot.id).maybeSingle();
    if (freshBot) {
      await admin.from("trading_bots").update({
        total_trades: Number(freshBot.total_trades ?? 0) + 1,
        total_profit_loss: (toNumber(freshBot.total_profit_loss) ?? 0) + profit,
      }).eq("id", bot.id);
    }
    await writeLog(admin, bot, "trade_settled", {
      contract_id: ledger.contract_id,
      status: nextStatus,
      strategy: bot.strategy_type,
    }, profit);
  }
  return "trade_settled";
}

async function processBot(admin: ReturnType<typeof createAdminClient>, bot: BotRow) {
  if (!bot.account_id) {
    await admin.from("trading_bots").update({ is_active: false }).eq("id", bot.id);
    await writeLog(admin, bot, "bot_paused_missing_account", { reason: "select_a_verified_demo_account" });
    return { bot_id: bot.id, result: "paused_missing_account" };
  }

  const { data: credential, error: credentialError } = await admin.from("bot_runner_credentials")
    .select("*").eq("user_id", bot.user_id).eq("account_id", bot.account_id).maybeSingle();
  if (credentialError) throw new Error("bot_credentials_unavailable");
  if (!credential) {
    await admin.from("trading_bots").update({ is_active: false }).eq("id", bot.id);
    await writeLog(admin, bot, "bot_paused_missing_credentials", { reason: "reconnect_deriv_and_rearm" });
    return { bot_id: bot.id, result: "paused_missing_credentials" };
  }
  const credentials = credential as CredentialRow;
  if (Date.parse(credentials.expires_at) <= Date.now()) {
    await pauseAccountBots(admin, bot, "bot_paused_token_expired", { reason: "short_lived_deriv_token_expired" });
    return { bot_id: bot.id, result: "paused_token_expired" };
  }

  let token: string;
  try { token = decryptDerivToken(credentials.encrypted_access_token); }
  catch {
    await pauseAccountBots(admin, bot, "bot_paused_credential_decryption", { reason: "credential_key_changed_or_invalid" });
    return { bot_id: bot.id, result: "paused_invalid_credentials" };
  }

  let ws: WebSocket | null = null;
  try {
    ws = await obtainDemoSocket(token, bot.account_id);
    const unsettled = await getAccountOpenLedger(admin, bot);
    if (unsettled.length > 0) {
      const existing = unsettled[0];
      const result = await settleExistingTrade(admin, bot, ws, existing);
      return { bot_id: bot.id, result };
    }

    // Disabling a bot blocks new entries, but an existing known contract must still
    // be polled to settlement. If no trade remains, remove its account credentials
    // once no other bot on this account is armed.
    if (!bot.is_active) {
      const { data: otherActive, error: activeError } = await admin.from("trading_bots").select("id")
        .eq("user_id", bot.user_id).eq("account_id", bot.account_id).eq("is_active", true).limit(1);
      if (!activeError && (!otherActive || otherActive.length === 0)) {
        await admin.from("bot_runner_credentials").delete()
          .eq("user_id", bot.user_id).eq("account_id", bot.account_id);
      }
      return { bot_id: bot.id, result: "paused_no_new_entries" };
    }

    const [portfolioMessage, balanceMessage, historyMessage] = await Promise.all([
      websocketRequest(ws, { portfolio: 1 }),
      websocketRequest(ws, { balance: 1 }),
      websocketRequest(ws, {
        ticks_history: bot.symbol,
        count: HISTORY_COUNT,
        end: "latest",
        style: "ticks",
        adjust_start_time: 1,
      }),
    ]);

    const openContracts = portfolioMessage.portfolio?.contracts ?? [];
    if (openContracts.length > 0) {
      await writeLog(admin, bot, "trade_skipped_open_account_exposure", {
        reason: "an_open_contract_exists_on_this_demo_account",
        open_contracts: openContracts.length,
      });
      return { bot_id: bot.id, result: "open_account_exposure" };
    }

    const balance = toNumber(balanceMessage.balance?.balance);
    const currency = String(balanceMessage.balance?.currency ?? credentials.currency);
    const prices = historyMessage.history?.prices?.map((price) => Number(price)) ?? [];
    const times = historyMessage.history?.times?.map((time) => Number(time)) ?? [];
    if (!balanceMessage.balance || balance === null || balance <= 0 || currency !== credentials.currency) {
      await writeLog(admin, bot, "trade_skipped_balance_unavailable", { reason: "balance_or_currency_validation_failed" });
      return { bot_id: bot.id, result: "balance_unavailable" };
    }
    if (prices.length !== times.length || prices.length < 100 || !times.length) {
      await writeLog(admin, bot, "trade_skipped_history_unavailable", {
        reason: "not_enough_valid_market_history", points: prices.length,
      });
      return { bot_id: bot.id, result: "insufficient_history" };
    }
    const lastEpoch = times[times.length - 1];
    if (!Number.isFinite(lastEpoch) || Date.now() / 1000 - lastEpoch > 90 || lastEpoch > Date.now() / 1000 + 5) {
      await writeLog(admin, bot, "trade_skipped_stale_data", { reason: "latest_market_tick_is_stale" });
      return { bot_id: bot.id, result: "stale_market_data" };
    }

    const signal = analyzeSignal(prices, bot.strategy_type);
    if (!signal) {
      await writeLog(admin, bot, "no_signal", { strategy: bot.strategy_type, symbol: bot.symbol, points: prices.length });
      return { bot_id: bot.id, result: "no_signal" };
    }

    const proposalMessage = await websocketRequest(ws, {
      proposal: 1,
      amount: Number(bot.stake_amount),
      basis: "stake",
      contract_type: signal.direction,
      currency,
      duration: Number(bot.duration_seconds),
      duration_unit: "s",
      underlying_symbol: bot.symbol,
    });
    const proposal = proposalMessage.proposal;
    const askPrice = toNumber(proposal?.ask_price);
    const payout = toNumber(proposal?.payout);
    const proposalId = typeof proposal?.id === "string" ? proposal.id : "";
    if (!proposalId || askPrice === null || payout === null || askPrice <= 0 || payout <= askPrice) {
      await writeLog(admin, bot, "trade_skipped_invalid_proposal", { reason: "broker_quote_failed_validation" });
      return { bot_id: bot.id, result: "invalid_proposal" };
    }

    const backtest = backtestStrategy({
      prices,
      times,
      strategy: bot.strategy_type,
      durationSeconds: Number(bot.duration_seconds),
      payoutPerStake: payout / askPrice,
      holdoutFraction: 0.3,
    });

    const dayStart = startOfUtcDay();
    const [todayTrades, todaySettlements, recentSettlements, previousTrade, ledgerOpen] = await Promise.all([
      admin.from("bot_trade_ledger").select("id,status,created_at")
        .eq("user_id", bot.user_id).eq("account_id", bot.account_id)
        .gte("created_at", dayStart).neq("status", "rejected").limit(1000),
      admin.from("bot_trade_ledger").select("realized_pnl")
        .eq("user_id", bot.user_id).eq("account_id", bot.account_id)
        .gte("settled_at", dayStart).not("realized_pnl", "is", null).limit(1000),
      admin.from("bot_trade_ledger").select("realized_pnl")
        .eq("user_id", bot.user_id).eq("account_id", bot.account_id)
        .not("settled_at", "is", null).not("realized_pnl", "is", null)
        .order("settled_at", { ascending: false }).limit(10),
      admin.from("bot_trade_ledger").select("created_at")
        .eq("user_id", bot.user_id).eq("account_id", bot.account_id)
        .neq("status", "rejected").order("created_at", { ascending: false }).limit(1),
      admin.from("bot_trade_ledger").select("id")
        .eq("user_id", bot.user_id).eq("account_id", bot.account_id)
        .in("status", ["pending", "open", "unknown"]).limit(1),
    ]);
    if (todayTrades.error || todaySettlements.error || recentSettlements.error || previousTrade.error || ledgerOpen.error) {
      throw new Error("bot_risk_state_unavailable");
    }

    const dailyPnl = (todaySettlements.data ?? []).reduce((sum, item) => sum + (toNumber(item.realized_pnl) ?? 0), 0);
    let consecutiveLosses = 0;
    for (const item of recentSettlements.data ?? []) {
      const pnl = toNumber(item.realized_pnl);
      if (pnl === null || pnl >= 0) break;
      consecutiveLosses += 1;
    }
    const lastTradeTime = previousTrade.data?.[0]?.created_at ? Date.parse(previousTrade.data[0].created_at) : null;

    const decision = evaluateEntry({
      signal,
      backtest,
      askPrice,
      payout,
      configuredStake: Number(bot.stake_amount),
      balance,
      dailyPnl,
      dailyLossLimit: Number(bot.daily_loss_limit),
      tradesToday: (todayTrades.data ?? []).length,
      maxTradesPerDay: Number(bot.max_trades_per_day),
      consecutiveLosses,
      maxConsecutiveLosses: Number(bot.max_consecutive_losses),
      openPositionCount: (ledgerOpen.data ?? []).length,
      lastTradeAt: Number.isFinite(lastTradeTime) ? lastTradeTime : null,
      now: Date.now(),
      cooldownSeconds: 60,
      maxStakeFraction: 0.01,
      minExpectedReturn: Number(bot.min_expected_return),
    });

    if (!decision.allowed) {
      await writeLog(admin, bot, "trade_skipped_risk_gate", {
        reason: decision.reason,
        direction: signal.direction,
        signal_reason: signal.reason,
        backtest_trades: backtest.trades,
        backtest_wins: backtest.wins,
        backtest_win_rate: backtest.winRate,
        win_rate_lower_95: backtest.wilsonLower95,
        assumed_gross_payout_ratio: payout / askPrice,
        expected_return_at_lower_bound: decision.expectedReturnAtLowerBound,
      });
      if (["daily_loss_limit", "daily_trade_limit", "consecutive_loss_limit"].includes(decision.reason)) {
        await pauseAccountBots(admin, bot, "bot_paused_risk_limit", { reason: decision.reason });
      }
      return { bot_id: bot.id, result: decision.reason };
    }

    const idempotencyKey = randomUUID();
    const { data: ledger, error: ledgerError } = await admin.from("bot_trade_ledger").insert({
      idempotency_key: idempotencyKey,
      bot_id: bot.id,
      user_id: bot.user_id,
      account_id: bot.account_id,
      symbol: bot.symbol,
      direction: signal.direction,
      stake_amount: Number(bot.stake_amount),
      ask_price: askPrice,
      potential_payout: payout,
      status: "pending",
      details: {
        engine: STRATEGY_ENGINE_VERSION,
        strategy: bot.strategy_type,
        signal_reason: signal.reason,
        signal_score: signal.score,
        backtest_trades: backtest.trades,
        backtest_win_rate: backtest.winRate,
        win_rate_lower_95: backtest.wilsonLower95,
        expected_return_at_lower_bound: decision.expectedReturnAtLowerBound,
        payout_ratio_assumption: payout / askPrice,
      },
    }).select("id").single();
    if (ledgerError || !ledger) throw new Error("bot_order_intent_write_failed");

    let buyMessage: BrokerMessage;
    try {
      buyMessage = await websocketRequest(ws, { buy: proposalId, price: askPrice });
    } catch {
      await admin.from("bot_trade_ledger").update({
        status: "unknown",
        details: { reason: "buy_response_unconfirmed", idempotency_key: idempotencyKey },
      }).eq("id", ledger.id);
      await pauseAccountBots(admin, bot, "bot_paused_unknown_order", {
        reason: "buy_outcome_ambiguous",
        ledger_id: ledger.id,
        note: "Do not retry until Deriv contract and statement history are reconciled.",
      });
      return { bot_id: bot.id, result: "ambiguous_buy_paused" };
    }

    const contractId = buyMessage.buy?.contract_id === undefined ? "" : String(buyMessage.buy.contract_id);
    if (!contractId) {
      await admin.from("bot_trade_ledger").update({
        status: "unknown",
        details: { reason: "buy_response_missing_contract_id", idempotency_key: idempotencyKey },
      }).eq("id", ledger.id);
      await pauseAccountBots(admin, bot, "bot_paused_unknown_order", {
        reason: "buy_response_missing_contract_id",
        ledger_id: ledger.id,
      });
      return { bot_id: bot.id, result: "ambiguous_buy_paused" };
    }

    await admin.from("bot_trade_ledger").update({
      status: "open",
      contract_id: contractId,
      details: {
        engine: STRATEGY_ENGINE_VERSION,
        strategy: bot.strategy_type,
        direction: signal.direction,
        signal_reason: signal.reason,
        buy_price: toNumber(buyMessage.buy?.buy_price) ?? askPrice,
      },
    }).eq("id", ledger.id).eq("status", "pending");
    await writeLog(admin, bot, "trade_opened", {
      contract_id: contractId,
      symbol: bot.symbol,
      direction: signal.direction,
      duration_seconds: bot.duration_seconds,
      ask_price: askPrice,
      potential_payout: payout,
      backtest_trades: backtest.trades,
      win_rate_lower_95: backtest.wilsonLower95,
    });
    return { bot_id: bot.id, result: "demo_trade_opened", contract_id: contractId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "bot_run_failed";
    if (reason === "deriv_token_expired" || reason === "deriv_otp_unavailable") {
      await pauseAccountBots(admin, bot, "bot_paused_deriv_authorization", { reason: reason === "deriv_token_expired" ? "token_expired" : "session_unavailable" });
      return { bot_id: bot.id, result: "paused_deriv_authorization" };
    }
    await writeLog(admin, bot, "bot_run_error", { reason: reason.startsWith("bot_") ? reason : "provider_or_execution_error" });
    return { bot_id: bot.id, result: "runner_error" };
  } finally {
    try { ws?.close(); } catch { /* socket already closed */ }
  }
}

export async function GET(request: NextRequest) {
  const allowedSecrets = [process.env.BOT_RUNNER_SECRET, process.env.CRON_SECRET]
    .filter((secret): secret is string => Boolean(secret?.trim()));
  if (allowedSecrets.length === 0) return jsonError("bot_runner_secret_not_configured", 503);
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!received || !allowedSecrets.some((secret) => constantTimeMatches(received, secret))) {
    return jsonError("unauthorized", 401);
  }

  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); }
  catch { return jsonError("bot_database_not_configured", 503); }

  const [{ data: activeBots, error }, { data: unsettledRows, error: ledgerError }] = await Promise.all([
    admin.from("trading_bots").select("*").eq("is_active", true).order("last_runner_at", { ascending: true, nullsFirst: true }).limit(50),
    admin.from("bot_trade_ledger").select("bot_id,status")
      .in("status", ["open", "pending"]).limit(100),
  ]);
  if (error || ledgerError) return jsonError("bot_database_unavailable", 503);

  // Include paused bots only when they still have a known pending/open trade to
  // reconcile. They must never generate a new entry while disabled.
  const candidatesById = new Map<string, BotRow>((activeBots ?? []).map((row) => [String(row.id), row as BotRow]));
  for (const row of unsettledRows ?? []) {
    const botId = String(row.bot_id);
    if (candidatesById.has(botId)) continue;
    const { data: pausedBot, error: pausedBotError } = await admin.from("trading_bots").select("*")
      .eq("id", botId).eq("is_active", false).maybeSingle();
    if (pausedBotError) return jsonError("bot_database_unavailable", 503);
    if (pausedBot) candidatesById.set(botId, pausedBot as BotRow);
  }
  const candidates = [...candidatesById.values()].sort((a, b) => {
    // The database order favours the least recently considered active bots; paused
    // reconciliation candidates remain eligible but can never open new trades.
    return Date.parse(String(a.last_runner_at ?? "1970-01-01")) - Date.parse(String(b.last_runner_at ?? "1970-01-01"));
  });

  const results: Array<{ bot_id: string; result: string; contract_id?: string }> = [];
  for (const candidate of candidates.slice(0, MAX_BOTS_PER_RUN)) {
    const nowIso = new Date().toISOString();
    const leaseToken = randomUUID();
    if (candidate.account_id) {
      await admin.from("bot_runner_leases").delete().eq("account_id", candidate.account_id).lt("lease_until", nowIso);
    } else {
      await admin.from("bot_runner_leases").delete().eq("bot_id", candidate.id).lt("lease_until", nowIso);
    }
    const { error: leaseError } = await admin.from("bot_runner_leases").insert({
      bot_id: candidate.id,
      user_id: candidate.user_id,
      account_id: candidate.account_id,
      lease_token: leaseToken,
      lease_until: new Date(Date.now() + 55_000).toISOString(),
    });
    if (leaseError) {
      results.push({ bot_id: candidate.id, result: "skipped_runner_lease_held" });
      continue;
    }

    try {
      const { data: currentBot, error: reloadError } = await admin.from("trading_bots").select("*")
        .eq("id", candidate.id).maybeSingle();
      if (reloadError || !currentBot) {
        results.push({ bot_id: candidate.id, result: "skipped_bot_no_longer_exists" });
        continue;
      }
      results.push(await processBot(admin, currentBot as BotRow));
    } catch {
      results.push({ bot_id: candidate.id, result: "runner_error" });
    } finally {
      await admin.from("trading_bots").update({ last_runner_at: new Date().toISOString() }).eq("id", candidate.id);
      await admin.from("bot_runner_leases").delete().eq("bot_id", candidate.id).eq("lease_token", leaseToken);
    }
  }

  return NextResponse.json({
    success: true,
    processed: results.length,
    active_bots_seen: activeBots?.length ?? 0,
    reconciliation_candidates_seen: candidates.length,
    max_bots_per_run: MAX_BOTS_PER_RUN,
    engine: STRATEGY_ENGINE_VERSION,
    result_summary: results,
  }, { headers: HEADERS });
}
