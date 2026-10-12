import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptDerivToken } from "@/lib/bots/credentials";
import { validateDigitStrategy, extractLastDigit, backtestDigitContract } from "@/lib/bots/digit-strategy-engine.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const HEADERS = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };
const API = "https://api.derivws.com";
const TIMEOUT = 8000;
type Obj = Record<string, unknown>;
type Reply = {
  req_id?: number; error?: { message?: string; code?: string };
  balance?: { balance?: number | string; currency?: string };
  portfolio?: { contracts?: Array<Record<string, unknown>> };
  history?: { prices?: Array<string | number>; times?: number[]; pip_size?: number };
  pip_size?: number;
  proposal?: { id?: string; ask_price?: number | string; payout?: number | string };
  buy?: { contract_id?: string | number; buy_price?: number | string };
  proposal_open_contract?: Record<string, unknown>;
};
function response(error: string, status: number) { return NextResponse.json({ error }, { status, headers: HEADERS }); }
function matches(received: string, expected: string) {
  const a = Buffer.from(received), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function num(v: unknown): number | null { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function rpc(ws: WebSocket, payload: Obj): Promise<Reply> {
  const id = Math.floor(Math.random() * 1e9) + 1;
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error?: Error, value?: Reply) => { if (done) return; done = true; clearTimeout(timer); ws.removeEventListener("message", listener); error ? reject(error) : resolve(value as Reply); };
    const listener = (event: MessageEvent) => {
      let value: Reply; try { value = JSON.parse(String(event.data)) as Reply; } catch { return; }
      if (value.req_id !== id) return;
      value.error ? finish(new Error("deriv_request_rejected")) : finish(undefined, value);
    };
    const timer = setTimeout(() => finish(new Error("deriv_request_timeout")), TIMEOUT);
    ws.addEventListener("message", listener);
    try { ws.send(JSON.stringify({ ...payload, req_id: id })); } catch { finish(new Error("deriv_send_failed")); }
  });
}
function socket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket; try { ws = new WebSocket(url); } catch { reject(new Error("deriv_socket_unavailable")); return; }
    const timer = setTimeout(() => { ws.close(); reject(new Error("deriv_socket_timeout")); }, TIMEOUT);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(ws); }, { once: true });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("deriv_socket_error")); }, { once: true });
  });
}
async function demoSocket(token: string, accountId: string) {
  const response = await fetch(API + "/trading/v1/options/accounts/" + encodeURIComponent(accountId) + "/otp", {
    method: "POST", headers: { Authorization: "Bearer " + token, Accept: "application/json" },
    cache: "no-store", signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(response.status === 401 ? "deriv_reconnect_required" : "deriv_otp_unavailable");
  const raw = await response.json() as { data?: { url?: unknown } };
  if (typeof raw.data?.url !== "string") throw new Error("invalid_demo_session");
  const url = new URL(raw.data.url);
  if (url.protocol !== "wss:" || url.hostname !== "api.derivws.com" || url.pathname !== "/trading/v1/options/ws/demo" || !url.searchParams.has("otp")) throw new Error("non_demo_session_rejected");
  return socket(url.toString());
}
function digitSeries(prices: Array<string | number>, pipSize?: number) { return prices.map((p) => extractLastDigit(p, pipSize)).filter((x): x is number => x !== null); }
async function log(admin: ReturnType<typeof createAdminClient>, strategyId: string, userId: string, action: string, details: Obj) {
  await admin.from("digit_strategy_trades").update({ details }).eq("id", "00000000-0000-0000-0000-000000000000");
  await admin.from("bot_strategy_definitions").update({ last_error: action === "runner_error" ? String(details.reason ?? "runner_error") : null })
    .eq("id", strategyId).eq("user_id", userId);
}
async function execute(admin: ReturnType<typeof createAdminClient>, strategy: Record<string, any>) {
  const id = String(strategy.id), userId = String(strategy.user_id), accountId = String(strategy.account_id ?? "");
  const validated = validateDigitStrategy(strategy.strategy_definition);
  if (!validated.valid || !validated.strategy || validated.strategy.entry_rule !== "last_digit_frequency") {
    await admin.from("bot_strategy_definitions").update({ status: "error", last_error: "strategy_validation_failed" }).eq("id", id);
    return { strategy_id: id, result: "invalid_strategy" };
  }
  const definition = validated.strategy;
  const { data: credentials, error: credentialError } = await admin.from("bot_runner_credentials")
    .select("encrypted_access_token,currency,expires_at").eq("user_id", userId).eq("account_id", accountId).maybeSingle();
  if (credentialError || !credentials || Date.parse(credentials.expires_at) <= Date.now()) {
    await admin.from("bot_strategy_definitions").update({ status: "paused", last_error: "demo_authorization_expired" }).eq("id", id);
    return { strategy_id: id, result: "authorization_expired" };
  }
  let ws: WebSocket | null = null;
  try {
    const token = decryptDerivToken(credentials.encrypted_access_token);
    ws = await demoSocket(token, accountId);
    const [balanceReply, portfolioReply, historyReply] = await Promise.all([
      rpc(ws, { balance: 1 }),
      rpc(ws, { portfolio: 1 }),
      rpc(ws, { ticks_history: definition.market, count: Math.min(5000, Math.max(1200, definition.frequency_window * 3)), end: "latest", style: "ticks" }),
    ]);
    const balance = num(balanceReply.balance?.balance);
    if (balance === null || balance <= 0 || balanceReply.balance?.currency !== credentials.currency) throw new Error("demo_balance_validation_failed");
    const openContracts = portfolioReply.portfolio?.contracts ?? [];
    const { data: unresolved, error: unresolvedError } = await admin.from("digit_strategy_trades")
      .select("*").eq("user_id", userId).eq("account_id", accountId).in("status", ["pending", "open", "unknown"]).order("created_at", { ascending: false }).limit(1);
    if (unresolvedError) throw new Error("trade_ledger_unavailable");
    if (unresolved?.length) {
      const trade = unresolved[0] as Record<string, any>;
      if (trade.status === "unknown" || trade.status === "pending") {
        await admin.from("bot_strategy_definitions").update({ status: "paused", last_error: "unresolved_order_requires_reconciliation" }).eq("id", id);
        return { strategy_id: id, result: "paused_unresolved_order" };
      }
      const contractId = String(trade.contract_id ?? "");
      let contract: Record<string, unknown> = {};
      try {
        const current = await rpc(ws, { proposal_open_contract: 1, contract_id: Number(contractId), subscribe: 0 });
        contract = current.proposal_open_contract ?? {};
      } catch {
        await admin.from("bot_strategy_definitions").update({ status: "paused", last_error: "settlement_check_failed" }).eq("id", id);
        return { strategy_id: id, result: "paused_settlement_check_failed" };
      }
      const terminal = contract.is_sold === 1 || contract.is_expired === 1 || contract.status === "won" || contract.status === "lost" || contract.status === "sold";
      if (terminal) {
        const profit = num(contract.profit);
        if (profit === null) throw new Error("settlement_profit_unavailable");
        const status = String(contract.status ?? (profit > 0 ? "won" : "lost"));
        const settled = await admin.from("digit_strategy_trades").update({
          status: ["won","lost","sold"].includes(status) ? status : (profit > 0 ? "won" : "lost"),
          realized_pnl: profit, settled_at: new Date().toISOString(), details: { settlement_verified: true, broker_status: status },
        }).eq("id", trade.id).eq("status", "open").select("id");
        if (settled.error) throw new Error("settlement_persist_failed");
        if (settled.data?.length) {
          const pnl = Number(strategy.session_pnl ?? 0) + profit;
          const lossLimit = Number(definition.max_session_loss);
          const target = Number(definition.session_profit_target);
          const hitLoss = lossLimit > 0 && pnl <= -lossLimit;
          const hitTarget = target > 0 && pnl >= target;
          await admin.from("bot_strategy_definitions").update({
            session_pnl: pnl, session_trade_count: Number(strategy.session_trade_count ?? 0) + 1,
            ...(hitLoss || hitTarget ? { status: "paused", last_error: hitLoss ? "session_loss_limit_reached" : "session_profit_target_reached" } : { last_error: null }),
          }).eq("id", id);
        }
        return { strategy_id: id, result: "contract_settled", profit };
      }
      if (openContracts.some((x) => String(x.contract_id ?? x.contractId ?? "") === contractId)) {
        return { strategy_id: id, result: "contract_still_open" };
      }
      await admin.from("bot_strategy_definitions").update({ status: "paused", last_error: "contract_missing_from_portfolio_requires_reconciliation" }).eq("id", id);
      await admin.from("digit_strategy_trades").update({ status: "unknown", details: { reason: "contract_missing_from_portfolio_and_not_terminal" } }).eq("id", trade.id).eq("status", "open");
      return { strategy_id: id, result: "paused_contract_requires_reconciliation" };
    }
    if (openContracts.length > 0) {
      await admin.from("bot_strategy_definitions").update({ status: "paused", last_error: "untracked_open_contract_on_account" }).eq("id", id);
      return { strategy_id: id, result: "untracked_open_contract" };
    }
    if (strategy.status !== "running") return { strategy_id: id, result: "paused_no_new_entries" };
    const sessionPnl = Number(strategy.session_pnl ?? 0);
    if ((definition.max_session_loss > 0 && sessionPnl <= -definition.max_session_loss)
      || (definition.session_profit_target > 0 && sessionPnl >= definition.session_profit_target)) {
      const reason = definition.max_session_loss > 0 && sessionPnl <= -definition.max_session_loss
        ? "session_loss_limit_reached" : "session_profit_target_reached";
      await admin.from("bot_strategy_definitions").update({ status: "paused", last_error: reason }).eq("id", id);
      return { strategy_id: id, result: "session_risk_limit", reason };
    }
    if (definition.stake > balance) return { strategy_id: id, result: "stake_exceeds_demo_balance" };
    if (definition.stake > balance * 0.01) return { strategy_id: id, result: "stake_exceeds_one_percent_balance_cap" };
    if (definition.max_session_loss === 0 && definition.session_profit_target === 0) {
      await admin.from("bot_strategy_definitions").update({ status: "paused", last_error: "session_risk_limits_required" }).eq("id", id);
      return { strategy_id: id, result: "paused_missing_session_risk_limits" };
    }
    const rawPrices = historyReply.history?.prices ?? [];
    const rawTimes = historyReply.history?.times ?? [];
    const rawPipSize = historyReply.pip_size ?? historyReply.history?.pip_size;
    const pipSize = Number.isInteger(rawPipSize) && (rawPipSize as number) >= 0 ? (rawPipSize as number) : undefined;
    const digits = digitSeries(rawPrices, pipSize);
    const epochs = rawTimes.map(Number);
    if (digits.length < definition.frequency_window + 100) return { strategy_id: id, result: "insufficient_tick_history" };
    const latestEpoch = epochs.length ? epochs[epochs.length - 1] : null;
    if (latestEpoch !== null && Number(strategy.last_tick_epoch ?? 0) >= latestEpoch) return { strategy_id: id, result: "waiting_for_new_tick" };

    const proposalRequest: Obj = {
      proposal: 1, amount: definition.stake, basis: "stake", contract_type: definition.contract_type,
      currency: credentials.currency, duration: definition.duration_ticks, duration_unit: "t",
      underlying_symbol: definition.market,
    };
    if (["DIGITOVER", "DIGITUNDER", "DIGITMATCH", "DIGITDIFF"].includes(definition.contract_type)) proposalRequest.barrier = String(definition.barrier);
    const proposalReply = await rpc(ws, proposalRequest);
    const proposal = proposalReply.proposal;
    const ask = num(proposal?.ask_price), payout = num(proposal?.payout), proposalId = String(proposal?.id ?? "");
    if (!proposalId || ask === null || payout === null || ask <= 0 || payout <= ask) return { strategy_id: id, result: "invalid_proposal" };
    const test = backtestDigitContract(digits, definition, payout / ask, 100);
    await admin.from("bot_strategy_definitions").update({
      last_evaluated_at: new Date().toISOString(), last_tick_epoch: latestEpoch,
      last_error: test.reason === "edge_not_proven" ? "edge_not_proven" : null,
    }).eq("id", id).eq("status", "running");
    if (!test.valid || test.expectedReturnLowerBound <= 0) return { strategy_id: id, result: "edge_not_proven", backtest: { trades: test.trades, winRate: test.winRate, lower95: test.wilsonLower95, expectedReturnLowerBound: test.expectedReturnLowerBound } };

    const recent = digits.slice(-definition.frequency_window);
    const counts = Array(10).fill(0);
    for (const digit of recent) counts[digit] += 1;
    const maxCount = Math.max(...counts);
    const modes = counts.map((count, digit) => ({ count, digit })).filter((x) => x.count === maxCount);
    if (modes.length !== 1 || maxCount / recent.length < 0.15) return { strategy_id: id, result: "no_clear_signal" };
    const mode = modes[0].digit;
    if (definition.contract_type === "DIGITMATCH" && definition.barrier !== mode) return { strategy_id: id, result: "no_matching_signal" };

    // Persist intent before buy. If the response is lost, mark unknown and pause; never blindly retry.
    const { data: ledger, error: ledgerInsertError } = await admin.from("digit_strategy_trades").insert({
      strategy_id: id, user_id: userId, account_id: accountId, symbol: definition.market,
      contract_type: definition.contract_type, barrier: definition.barrier, stake: definition.stake,
      ask_price: ask, potential_payout: payout, tick_epoch: latestEpoch, status: "pending",
      details: { proposal_id: proposalId, backtest_trades: test.trades, win_rate_lower_95: test.wilsonLower95, expected_return_lower_bound: test.expectedReturnLowerBound },
    }).select("id").single();
    if (ledgerInsertError || !ledger) throw new Error("trade_intent_persist_failed");
    try {
      const buy = await rpc(ws, { buy: proposalId, price: ask });
      const contractId = String(buy.buy?.contract_id ?? "");
      if (!/^\d{1,24}$/.test(contractId)) throw new Error("buy_response_missing_contract_id");
      await admin.from("digit_strategy_trades").update({ status: "open", contract_id: contractId, ask_price: num(buy.buy?.buy_price) ?? ask }).eq("id", ledger.id).eq("status", "pending");
      await admin.from("bot_strategy_definitions").update({ last_error: null, last_evaluated_at: new Date().toISOString(), last_tick_epoch: latestEpoch }).eq("id", id);
      return { strategy_id: id, result: "demo_trade_opened", contract_id: contractId, backtest: { trades: test.trades, wins: test.wins, winRate: test.winRate, lower95: test.wilsonLower95, expectedReturnLowerBound: test.expectedReturnLowerBound } };
    } catch {
      await admin.from("digit_strategy_trades").update({ status: "unknown", details: { reason: "buy_response_unconfirmed", proposal_id: proposalId } }).eq("id", ledger.id);
      await admin.from("bot_strategy_definitions").update({ status: "paused", last_error: "buy_response_unconfirmed" }).eq("id", id);
      return { strategy_id: id, result: "paused_ambiguous_order" };
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "digit_runner_error";
    await admin.from("bot_strategy_definitions").update({ last_error: reason }).eq("id", id);
    return { strategy_id: id, result: "runner_error", error: reason };
  } finally { try { ws?.close(); } catch {} }
}
export async function GET(request: NextRequest) {
  const allowed = [process.env.BOT_RUNNER_SECRET, process.env.CRON_SECRET].filter((x): x is string => Boolean(x?.trim()));
  if (!allowed.length) return response("bot_runner_secret_not_configured", 503);
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!received || !allowed.some((secret) => matches(received, secret))) return response("unauthorized", 401);
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch { return response("bot_database_not_configured", 503); }
  const [{ data: running, error }, { data: openRows, error: openError }] = await Promise.all([
    admin.from("bot_strategy_definitions").select("*").eq("status", "running").not("account_id", "is", null)
      .order("last_evaluated_at", { ascending: true, nullsFirst: true }).limit(5),
    admin.from("digit_strategy_trades").select("strategy_id").eq("status", "open").limit(50),
  ]);
  if (error || openError) return response("digit_strategy_database_unavailable", 503);
  const candidates = new Map<string, Record<string, any>>();
  for (const item of running ?? []) candidates.set(String(item.id), item as Record<string, any>);
  const openIds = [...new Set((openRows ?? []).map((x) => String(x.strategy_id)))].filter((id) => !candidates.has(id));
  if (openIds.length) {
    const { data: pausedWithOpen, error: pausedError } = await admin.from("bot_strategy_definitions")
      .select("*").in("id", openIds).eq("status", "paused").not("account_id", "is", null).limit(5);
    if (pausedError) return response("digit_strategy_database_unavailable", 503);
    for (const item of pausedWithOpen ?? []) candidates.set(String(item.id), item as Record<string, any>);
  }
  const results = [];
  for (const strategy of candidates.values()) {
    // Claim one evaluation slot for 45 seconds using a conditional update. This reduces
    // duplicate work from overlapping cron invocations; unresolved order checks remain authoritative.
    const staleBefore = new Date(Date.now() - 45_000).toISOString();
    const claimedAt = new Date().toISOString();
    // A claim is not an evaluation. Keep the lease separate from last_evaluated_at
    // so the UI only reports completed runner work as an evaluation heartbeat.
    const claim = await admin.from("bot_strategy_definitions").update({ runner_claimed_at: claimedAt })
      .eq("id", strategy.id).eq("status", strategy.status)
      .or("runner_claimed_at.is.null,runner_claimed_at.lt." + staleBefore).select("id");
    if (claim.error || !claim.data?.length) continue;
    const result = await execute(admin, { ...strategy, runner_claimed_at: claimedAt });
    await admin.from("bot_strategy_definitions").update({
      last_evaluated_at: new Date().toISOString(),
      runner_last_result: String(result.result ?? "unknown"),
    }).eq("id", strategy.id);
    results.push(result);
  }
  return NextResponse.json({ processed: results.length, results }, { headers: HEADERS });
}
