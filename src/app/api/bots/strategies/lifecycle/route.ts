import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedDerivContext } from "@/lib/deriv/authenticated";
import { fetchDerivAccounts } from "@/lib/deriv/accounts";
import { getOwnedDerivAccountIds } from "@/lib/deriv/ownership";
import { encryptDerivToken } from "@/lib/bots/credentials";
import { validateDigitStrategy } from "@/lib/bots/digit-strategy-engine.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403, headers });
  }
  let body: { strategy_id?: unknown; action?: unknown; account_id?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return NextResponse.json({ error: "invalid_request" }, { status: 400, headers }); }

  const strategyId = typeof body.strategy_id === "string" ? body.strategy_id : "";
  const action = body.action;
  const accountId = typeof body.account_id === "string" ? body.account_id : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(strategyId)
    || !["start", "pause"].includes(String(action))) {
    return NextResponse.json({ error: "invalid_lifecycle_request" }, { status: 400, headers });
  }
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user || !user.email || !user.email_confirmed_at) {
    return NextResponse.json({ error: "authentication_required" }, { status: 401, headers });
  }
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); }
  catch { return NextResponse.json({ error: "bot_server_not_configured" }, { status: 503, headers }); }

  const { data: strategy, error: strategyError } = await admin.from("bot_strategy_definitions")
    .select("id,user_id,name,strategy_definition,source_format,status,account_id,session_started_at")
    .eq("id", strategyId).eq("user_id", user.id).maybeSingle();
  if (strategyError) return NextResponse.json({ error: "strategy_database_unavailable" }, { status: 503, headers });
  if (!strategy) return NextResponse.json({ error: "strategy_not_found" }, { status: 404, headers });

  if (action === "pause") {
    const { error } = await admin.from("bot_strategy_definitions").update({
      status: "paused", last_error: null,
    }).eq("id", strategyId).eq("user_id", user.id);
    if (error) return NextResponse.json({ error: "strategy_pause_failed" }, { status: 503, headers });
    return NextResponse.json({ success: true, status: "paused" }, { headers });
  }

  if (strategy.source_format === "xml") {
    return NextResponse.json({ error: "blockly_xml_is_not_executable" }, { status: 422, headers });
  }
  const validated = validateDigitStrategy(strategy.strategy_definition);
  if (!validated.valid || validated.strategy?.entry_rule !== "last_digit_frequency") {
    return NextResponse.json({ error: "strategy_not_executable", details: validated.errors.length ? validated.errors : ["manual_review_requires_manual_execution"] }, { status: 422, headers });
  }
  if (!accountId || !/^[A-Za-z0-9_-]{2,64}$/.test(accountId)) {
    return NextResponse.json({ error: "demo_account_required" }, { status: 400, headers });
  }

  const context = await getAuthenticatedDerivContext(request);
  if (!context.ok) return NextResponse.json({ error: context.error === "configuration" ? "deriv_configuration_error" : "deriv_reconnect_required" }, { status: context.error === "configuration" ? 503 : 401, headers });
  const accounts = await fetchDerivAccounts(context.token);
  if (!accounts.ok) return NextResponse.json({ error: "deriv_account_verification_failed" }, { status: 502, headers });
  const ownership = await getOwnedDerivAccountIds(context.supabase, user.id, [accountId]);
  if (ownership.error || !ownership.accountIds) return NextResponse.json({ error: "account_ownership_unavailable" }, { status: 503, headers });
  if (!ownership.accountIds.has(accountId)) return NextResponse.json({ error: "demo_account_not_linked" }, { status: 403, headers });
  const account = accounts.accounts.find((item) => item.account_id === accountId);
  if (!account || (account.account_type ?? "").toLowerCase() !== "demo") {
    return NextResponse.json({ error: "demo_only_runner" }, { status: 403, headers });
  }
  if (!account.currency) return NextResponse.json({ error: "account_currency_unavailable" }, { status: 502, headers });

  const { data: otherRunning, error: runningError } = await admin.from("bot_strategy_definitions")
    .select("id").eq("user_id", user.id).eq("account_id", accountId).eq("status", "running").neq("id", strategyId).limit(1);
  if (runningError) return NextResponse.json({ error: "strategy_state_unavailable" }, { status: 503, headers });
  if (otherRunning?.length) return NextResponse.json({ error: "another_digit_strategy_running_on_account" }, { status: 409, headers });
  const { data: openTrades, error: openError } = await admin.from("digit_strategy_trades")
    .select("id,status").eq("account_id", accountId).in("status", ["pending", "open", "unknown"]).limit(1);
  if (openError) return NextResponse.json({ error: "strategy_trade_state_unavailable" }, { status: 503, headers });
  if (openTrades?.length) return NextResponse.json({ error: "unresolved_contract_requires_reconciliation" }, { status: 409, headers });

  let encryptedToken: string;
  try { encryptedToken = encryptDerivToken(context.token); }
  catch { return NextResponse.json({ error: "bot_token_encryption_not_configured" }, { status: 503, headers }); }
  const expiresAt = new Date(Date.now() + 45 * 60 * 1000).toISOString();
  const { error: credentialError } = await admin.from("bot_runner_credentials").upsert({
    user_id: user.id, account_id: accountId, encrypted_access_token: encryptedToken,
    currency: account.currency, expires_at: expiresAt, updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,account_id" });
  if (credentialError) return NextResponse.json({ error: "bot_credentials_unavailable" }, { status: 503, headers });

  const now = new Date().toISOString();
  const { error: updateError } = await admin.from("bot_strategy_definitions").update({
    status: "running", account_id: accountId, session_started_at: strategy.session_started_at ?? now,
    last_evaluated_at: null, last_tick_epoch: null, last_error: null,
  }).eq("id", strategyId).eq("user_id", user.id);
  if (updateError) return NextResponse.json({ error: "strategy_start_failed" }, { status: 503, headers });
  return NextResponse.json({ success: true, status: "running", mode: "demo_only", account_id: accountId, message: "Strategy armed on the verified Demo account. Server runner evaluates it on scheduled invocations; no profit is guaranteed." }, { headers });
}
