import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { encryptDerivToken } from "@/lib/bots/credentials";
import { fetchDerivAccounts } from "@/lib/deriv/accounts";
import { getAuthenticatedDerivContext } from "@/lib/deriv/authenticated";
import { getOwnedDerivAccountIds } from "@/lib/deriv/ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };
const API_BASE = "https://api.derivws.com";
const RPC_TIMEOUT_MS = 8000;
type Json = Record<string, unknown>;
type Ledger = {
  id: string;
  bot_id: string;
  user_id: string;
  account_id: string;
  symbol: string;
  direction: string;
  stake_amount: number | string;
  ask_price: number | string | null;
  status: string;
  created_at: string;
};
type Reply = {
  req_id?: number;
  msg_type?: string;
  error?: { message?: string; code?: string };
  portfolio?: { contracts?: Array<Record<string, unknown>> };
  statement?: { count?: number; transactions?: Array<Record<string, unknown>> };
  profit_table?: { count?: number; transactions?: Array<Record<string, unknown>> };
  proposal_open_contract?: Record<string, unknown>;
};

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: HEADERS });
}
function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
function sameNumber(a: number, b: number, relativeTolerance = 0.05) {
  return Number.isFinite(a) && Number.isFinite(b)
    && Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * relativeTolerance);
}
function parseMessage(event: MessageEvent): Reply | null {
  try {
    const value: unknown = JSON.parse(String(event.data));
    return value && typeof value === "object" ? value as Reply : null;
  } catch {
    return null;
  }
}
function request(ws: WebSocket, payload: Json): Promise<Reply> {
  const reqId = Math.floor(Math.random() * 1_000_000_000) + 1;
  return new Promise((resolve, reject) => {
    let complete = false;
    const finish = (error?: Error, message?: Reply) => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      if (error) reject(error);
      else resolve(message as Reply);
    };
    const onMessage = (event: MessageEvent) => {
      const message = parseMessage(event);
      if (!message || message.req_id !== reqId) return;
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
function connectSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    let finished = false;
    try { ws = new WebSocket(url); }
    catch { reject(new Error("deriv_socket_unavailable")); return; }
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      ws.close();
      reject(new Error("deriv_socket_timeout"));
    }, RPC_TIMEOUT_MS);
    ws.addEventListener("open", () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(ws);
    }, { once: true });
    ws.addEventListener("error", () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(new Error("deriv_socket_error"));
    }, { once: true });
  });
}
async function openDemoSocket(token: string, accountId: string) {
  const response = await fetch(API_BASE + "/trading/v1/options/accounts/" + encodeURIComponent(accountId) + "/otp", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(response.status === 401 ? "deriv_reconnect_required" : "deriv_otp_unavailable");
  const raw: unknown = await response.json();
  const root = raw && typeof raw === "object" ? raw as { data?: unknown } : {};
  const data = root.data && typeof root.data === "object" ? root.data as { url?: unknown } : {};
  if (typeof data.url !== "string") throw new Error("invalid_demo_session");
  const url = new URL(data.url);
  if (url.protocol !== "wss:" || url.hostname !== "api.derivws.com"
    || url.pathname !== "/trading/v1/options/ws/demo" || !url.searchParams.has("otp")) {
    throw new Error("non_demo_session_rejected");
  }
  return connectSocket(url.toString());
}

function getContractType(raw: Record<string, unknown>) {
  return String(raw.contract_type ?? raw.contractType ?? "").toUpperCase();
}
function getContractSymbol(raw: Record<string, unknown>) {
  return String(raw.underlying_symbol ?? raw.symbol ?? "");
}
function getContractStartMs(raw: Record<string, unknown>) {
  const epoch = num(raw.date_start ?? raw.purchase_time ?? raw.purchase_time_epoch);
  return epoch === null ? null : epoch * 1000;
}
function getContractBuyPrice(raw: Record<string, unknown>) {
  return num(raw.buy_price ?? raw.buyPrice);
}
function normalizedTerminalStatus(raw: Record<string, unknown>, profit: number) {
  const status = String(raw.status ?? "").toLowerCase();
  if (status === "sold" || raw.is_sold === 1 || raw.is_sold === true) return "sold";
  if (status === "won") return "won";
  if (status === "lost") return "lost";
  // Unknown terminal statuses with zero P/L must not be counted as wins.
  return profit > 0 ? "won" : "lost";
}

async function logReconciliation(admin: ReturnType<typeof createAdminClient>, ledger: Ledger, action: string, details: Json) {
  await admin.from("bot_logs").insert({
    bot_id: ledger.bot_id,
    action,
    details: { reconciliation: true, account_id: ledger.account_id, ledger_id: ledger.id, ...details },
  });
}

export async function POST(requestObject: NextRequest) {
  if (requestObject.headers.get("origin") && requestObject.headers.get("origin") !== requestObject.nextUrl.origin) {
    return errorResponse("origin_not_allowed", 403);
  }
  let body: { ledger_id?: unknown; resolution?: unknown; contract_id?: unknown };
  try { body = await requestObject.json() as typeof body; }
  catch { return errorResponse("invalid_request", 400); }

  const ledgerId = typeof body.ledger_id === "string" ? body.ledger_id : "";
  const resolution = body.resolution;
  const contractId = typeof body.contract_id === "string" ? body.contract_id.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ledgerId)
    || !["contract_found", "no_order"].includes(String(resolution))) {
    return errorResponse("invalid_reconciliation_request", 400);
  }
  if (resolution === "contract_found" && !/^\d{1,24}$/.test(contractId)) {
    return errorResponse("valid_contract_id_required", 400);
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user || !user.email || !user.email_confirmed_at) {
    return errorResponse("authentication_required", 401);
  }
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); }
  catch { return errorResponse("bot_server_not_configured", 503); }

  const { data: rawLedger, error: ledgerError } = await admin.from("bot_trade_ledger")
    .select("*").eq("id", ledgerId).eq("user_id", user.id).maybeSingle();
  if (ledgerError) return errorResponse("bot_ledger_unavailable", 503);
  if (!rawLedger) return errorResponse("bot_trade_not_found", 404);
  const ledger = rawLedger as Ledger;
  if (ledger.status !== "unknown") return errorResponse("trade_does_not_need_reconciliation", 409);

  const context = await getAuthenticatedDerivContext(requestObject);
  if (!context.ok) return errorResponse("deriv_reconnect_required", context.error === "configuration" ? 503 : 401);
  const accountOwnership = await getOwnedDerivAccountIds(context.supabase, user.id, [ledger.account_id]);
  if (accountOwnership.error || !accountOwnership.accountIds) return errorResponse("account_ownership_unavailable", 503);
  if (!accountOwnership.accountIds.has(ledger.account_id)) return errorResponse("demo_account_not_linked", 403);
  const accounts = await fetchDerivAccounts(context.token);
  if (!accounts.ok) return errorResponse("deriv_account_verification_failed", 502);
  const account = accounts.accounts.find((item) => item.account_id === ledger.account_id);
  if (!account) return errorResponse("demo_account_not_found", 404);
  if ((account.account_type ?? "").toLowerCase() !== "demo") return errorResponse("demo_only_reconciliation", 403);
  if (!account.currency) return errorResponse("account_currency_unavailable", 502);

  let ws: WebSocket;
  try { ws = await openDemoSocket(context.token, ledger.account_id); }
  catch (socketError) {
    const message = socketError instanceof Error ? socketError.message : "deriv_session_unavailable";
    const status = message === "deriv_reconnect_required" ? 401 : 502;
    return errorResponse(message, status);
  }

  try {
    if (resolution === "contract_found") {
      const response = await request(ws, { proposal_open_contract: 1, contract_id: Number(contractId) });
      const contract = response.proposal_open_contract;
      if (!contract || String(contract.contract_id ?? "") !== contractId) {
        return errorResponse("contract_not_found_in_demo_account", 404);
      }
      const expectedAsk = num(ledger.ask_price);
      const actualBuy = getContractBuyPrice(contract);
      const expectedStart = Date.parse(ledger.created_at);
      const actualStart = getContractStartMs(contract);
      const direction = getContractType(contract);
      if (getContractSymbol(contract) !== ledger.symbol
        || direction !== ledger.direction
        || expectedAsk === null || actualBuy === null || !sameNumber(actualBuy, expectedAsk)
        || actualStart === null || Math.abs(actualStart - expectedStart) > 3 * 60 * 1000) {
        return errorResponse("contract_does_not_match_unknown_order", 409);
      }

      const rawStatus = String(contract.status ?? "").toLowerCase();
      const isTerminal = ["won", "lost", "sold", "expired", "cancelled"].includes(rawStatus)
        || contract.is_sold === 1 || contract.is_sold === true
        || contract.is_expired === 1 || contract.is_expired === true;
      const profit = num(contract.profit);
      if (isTerminal && profit === null) return errorResponse("contract_settlement_pnl_unavailable", 502);
      const now = new Date().toISOString();
      const nextStatus = isTerminal ? normalizedTerminalStatus(contract, profit as number) : "open";
      const update = await admin.from("bot_trade_ledger").update({
        contract_id: contractId,
        status: nextStatus,
        ...(isTerminal ? { realized_pnl: profit, settled_at: now } : {}),
        details: {
          reconciliation: "broker_verified_contract",
          broker_status: rawStatus,
          underlying_symbol: ledger.symbol,
          contract_type: ledger.direction,
        },
      }).eq("id", ledger.id).eq("status", "unknown").select("id").maybeSingle();
      if (update.error) return errorResponse("bot_ledger_update_failed", 503);
      if (!update.data) return errorResponse("trade_changed_during_reconciliation", 409);

      if (isTerminal) {
        const { data: bot } = await admin.from("trading_bots")
          .select("total_trades,total_profit_loss").eq("id", ledger.bot_id).eq("user_id", user.id).maybeSingle();
        if (bot) {
          await admin.from("trading_bots").update({
            total_trades: Number(bot.total_trades ?? 0) + 1,
            total_profit_loss: (num(bot.total_profit_loss) ?? 0) + (profit as number),
          }).eq("id", ledger.bot_id).eq("user_id", user.id);
        }
        await logReconciliation(admin, ledger, "trade_reconciled_settled", { contract_id: contractId, status: nextStatus, profit_loss: profit });
      } else {
        // Retain only short-lived encrypted Demo credentials so the scheduled worker
        // can follow this verified open contract. The bot stays paused.
        let encryptedToken: string;
        try { encryptedToken = encryptDerivToken(context.token); }
        catch { return errorResponse("bot_token_encryption_not_configured", 503); }
        const credential = await admin.from("bot_runner_credentials").upsert({
          user_id: user.id,
          account_id: ledger.account_id,
          encrypted_access_token: encryptedToken,
          currency: account.currency,
          expires_at: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
          updated_at: now,
        }, { onConflict: "user_id,account_id" });
        if (credential.error) return errorResponse("bot_credentials_unavailable", 503);
        await logReconciliation(admin, ledger, "trade_reconciled_open", { contract_id: contractId, broker_status: rawStatus });
      }
      return NextResponse.json({
        success: true,
        resolution: nextStatus,
        message: isTerminal
          ? "Deriv verified the contract and settlement. The bot remains paused; review its activity before re-arming."
          : "Deriv verified the open contract. Its settlement will be monitored, but the bot remains paused and cannot enter a new trade.",
      }, { headers: HEADERS });
    }

    // Mark an ambiguous order as not placed only when Deriv returns a complete
    // empty portfolio and no matching buy transaction in the relevant time window.
    const createdAt = Date.parse(ledger.created_at);
    if (!Number.isFinite(createdAt) || Date.now() - createdAt < 2 * 60 * 1000) {
      return errorResponse("wait_before_confirming_no_order", 409);
    }
    const startEpoch = Math.max(0, Math.floor((createdAt - 60_000) / 1000));
    const endEpoch = Math.floor(Date.now() / 1000);
    const [portfolioResponse, statementResponse, profitResponse] = await Promise.all([
      request(ws, { portfolio: 1 }),
      request(ws, { statement: 1, action_type: "buy", date_from: startEpoch, date_to: endEpoch, limit: 999, offset: 0 }),
      request(ws, { profit_table: 1, date_from: startEpoch, date_to: endEpoch, limit: 500, offset: 0 }),
    ]);
    const contracts = portfolioResponse.portfolio?.contracts;
    const statement = statementResponse.statement;
    const statementRows = statement?.transactions;
    const statementCount = num(statement?.count);
    const profits = profitResponse.profit_table;
    const profitRows = profits?.transactions;
    const profitCount = num(profits?.count);
    if (!Array.isArray(contracts) || contracts.length > 0
      || !Array.isArray(statementRows) || statementCount === null || statementCount > statementRows.length || statementRows.length >= 999
      || !Array.isArray(profitRows) || profitCount === null || profitCount > profitRows.length || profitRows.length >= 500) {
      return errorResponse("broker_history_incomplete_or_open_exposure", 409);
    }

    const lowerMs = createdAt - 60_000;
    const upperMs = Date.now();
    const expectedAmount = num(ledger.ask_price) ?? num(ledger.stake_amount);
    const incompleteStatement = statementRows.some((row) =>
      num(row.transaction_time ?? row.time ?? row.transaction_timestamp) === null
      || num(row.amount) === null,
    );
    const incompleteProfitTable = profitRows.some((row) =>
      num(row.purchase_time ?? row.transaction_time) === null
      || num(row.buy_price ?? row.amount) === null,
    );
    if (incompleteStatement || incompleteProfitTable) {
      return errorResponse("broker_history_incomplete_or_open_exposure", 409);
    }
    const potentiallyMatchingBuy = statementRows.some((row) => {
      const time = num(row.transaction_time ?? row.time ?? row.transaction_timestamp);
      const amount = num(row.amount);
      if (time === null || amount === null) return false;
      const timeMs = time * 1000;
      if (timeMs < lowerMs || timeMs > upperMs || expectedAmount === null
        || !sameNumber(Math.abs(amount), expectedAmount, 0.08)) return false;
      const rowSymbol = String(row.underlying_symbol ?? row.symbol ?? "");
      // Missing symbol metadata is ambiguous, not proof that the bot order did not exist.
      return !rowSymbol || rowSymbol === ledger.symbol;
    });
    const potentiallyMatchingProfit = profitRows.some((row) => {
      const time = num(row.purchase_time ?? row.transaction_time);
      const amount = num(row.buy_price ?? row.amount);
      if (time === null || amount === null) return false;
      const timeMs = time * 1000;
      if (timeMs < lowerMs || timeMs > upperMs || expectedAmount === null
        || !sameNumber(Math.abs(amount), expectedAmount, 0.08)) return false;
      const rowSymbol = String(row.underlying_symbol ?? row.symbol ?? "");
      return !rowSymbol || rowSymbol === ledger.symbol;
    });
    if (potentiallyMatchingBuy || potentiallyMatchingProfit) {
      return errorResponse("possible_purchase_found", 409);
    }

    const updated = await admin.from("bot_trade_ledger").update({
      status: "rejected",
      details: { reconciliation: "broker_checked_no_matching_purchase", checked_at: new Date().toISOString() },
    }).eq("id", ledger.id).eq("status", "unknown").select("id").maybeSingle();
    if (updated.error) return errorResponse("bot_ledger_update_failed", 503);
    if (!updated.data) return errorResponse("trade_changed_during_reconciliation", 409);
    await logReconciliation(admin, ledger, "trade_reconciled_not_placed", {
      checked_statement_transactions: statementRows.length,
      checked_profit_transactions: profitRows.length,
    });
    return NextResponse.json({
      success: true,
      resolution: "not_placed",
      message: "Deriv showed no open contract or matching buy in the checked statement and profit history. The ambiguous ledger entry was closed as not placed; the bot remains paused until you re-arm it.",
    }, { headers: HEADERS });
  } catch {
    return errorResponse("broker_reconciliation_failed", 502);
  } finally {
    try { ws.close(); } catch { /* already closed */ }
  }
}
