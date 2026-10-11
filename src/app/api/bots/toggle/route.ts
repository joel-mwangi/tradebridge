import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchDerivAccounts } from "@/lib/deriv/accounts";
import { getAuthenticatedDerivContext } from "@/lib/deriv/authenticated";
import { getOwnedDerivAccountIds } from "@/lib/deriv/ownership";
import { encryptDerivToken } from "@/lib/bots/credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

async function logAction(admin: ReturnType<typeof createAdminClient>, bot: Record<string, unknown>, action: string, details: Record<string, unknown>) {
  await admin.from("bot_logs").insert({
    bot_id: bot.id,
    action,
    details,
  });
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403, headers });
  }

  let body: { bot_id?: unknown; enabled?: unknown; stop_all?: unknown };
  try {
    body = await request.json() as { bot_id?: unknown; enabled?: unknown; stop_all?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers });
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user || !user.email || !user.email_confirmed_at) {
    return NextResponse.json({ error: "authentication_required" }, { status: 401, headers });
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "bot_server_not_configured" }, { status: 503, headers });
  }

  if (body.stop_all === true) {
    const { data: activeBots, error: listError } = await admin
      .from("trading_bots")
      .select("id,account_id,bot_name")
      .eq("user_id", user.id)
      .eq("is_active", true);
    if (listError) {
      return NextResponse.json({ error: "bot_database_unavailable" }, { status: 503, headers });
    }

    const { error: stopError } = await admin
      .from("trading_bots")
      .update({ is_active: false })
      .eq("user_id", user.id)
      .eq("is_active", true);
    if (stopError) return NextResponse.json({ error: "bot_pause_failed" }, { status: 503, headers });

    const { data: unresolvedTrades, error: tradeError } = await admin
      .from("bot_trade_ledger")
      .select("account_id,status")
      .eq("user_id", user.id)
      .in("status", ["pending", "open"])
      .limit(200);
    if (tradeError) return NextResponse.json({ error: "bot_ledger_unavailable" }, { status: 503, headers });
    const accountsWithOpenTrades = new Set((unresolvedTrades ?? []).map((row) => String(row.account_id)));
    const { data: savedCredentials, error: savedCredentialsError } = await admin
      .from("bot_runner_credentials")
      .select("account_id")
      .eq("user_id", user.id);
    if (savedCredentialsError) return NextResponse.json({ error: "bot_credentials_unavailable" }, { status: 503, headers });

    // Keep a short-lived credential only while a known order needs settlement.
    // Paused bots will not open new positions.
    for (const credential of savedCredentials ?? []) {
      if (accountsWithOpenTrades.has(String(credential.account_id))) continue;
      const { error: deleteError } = await admin.from("bot_runner_credentials")
        .delete().eq("user_id", user.id).eq("account_id", credential.account_id);
      if (deleteError) return NextResponse.json({ error: "bots_paused_credentials_cleanup_failed" }, { status: 503, headers });
    }

    for (const bot of activeBots ?? []) {
      await logAction(admin, bot as unknown as Record<string, unknown>, "bot_paused", { reason: "user_stop_all" });
    }
    return NextResponse.json({ success: true, stopped: (activeBots ?? []).length }, { headers });
  }

  const botId = typeof body.bot_id === "string" ? body.bot_id : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(botId)
    || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "invalid_bot_request" }, { status: 400, headers });
  }

  const { data: bot, error: botError } = await admin
    .from("trading_bots")
    .select("*")
    .eq("id", botId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (botError) return NextResponse.json({ error: "bot_database_unavailable" }, { status: 503, headers });
  if (!bot) return NextResponse.json({ error: "bot_not_found" }, { status: 404, headers });

  if (body.enabled === false) {
    const { error: pauseError } = await admin
      .from("trading_bots")
      .update({ is_active: false })
      .eq("id", bot.id)
      .eq("user_id", user.id);
    if (pauseError) return NextResponse.json({ error: "bot_pause_failed" }, { status: 503, headers });

    if (bot.account_id) {
      const [{ data: otherActive, error: activeError }, { data: unsettled, error: unsettledError }] = await Promise.all([
        admin.from("trading_bots").select("id")
          .eq("user_id", user.id).eq("account_id", bot.account_id)
          .eq("is_active", true).limit(1),
        admin.from("bot_trade_ledger").select("id")
          .eq("user_id", user.id).eq("account_id", bot.account_id)
          .in("status", ["pending", "open"]).limit(1),
      ]);
      // On a state-check failure, keep the credential and fail closed. The bot is
      // already paused, and cleanup can be retried without disrupting settlement.
      if (!activeError && !unsettledError && (!otherActive || otherActive.length === 0)
        && (!unsettled || unsettled.length === 0)) {
        await admin.from("bot_runner_credentials").delete()
          .eq("user_id", user.id).eq("account_id", bot.account_id);
      }
    }

    await logAction(admin, bot as unknown as Record<string, unknown>, "bot_paused", { reason: "user_disabled" });
    return NextResponse.json({ success: true, enabled: false }, { headers });
  }

  if (typeof bot.account_id !== "string" || !bot.account_id) {
    return NextResponse.json({ error: "demo_account_required" }, { status: 400, headers });
  }

  const [{ data: otherActive, error: activeBotError }, { data: unsettledTrades, error: unsettledError }] = await Promise.all([
    admin.from("trading_bots").select("id")
      .eq("user_id", user.id).eq("account_id", bot.account_id).eq("is_active", true)
      .neq("id", bot.id).limit(1),
    admin.from("bot_trade_ledger").select("id,status")
      .eq("user_id", user.id).eq("account_id", bot.account_id)
      .in("status", ["pending", "open", "unknown"]).limit(1),
  ]);
  if (activeBotError || unsettledError) {
    return NextResponse.json({ error: "bot_account_state_unavailable" }, { status: 503, headers });
  }
  if (otherActive && otherActive.length > 0) {
    return NextResponse.json({ error: "another_bot_armed_on_account" }, { status: 409, headers });
  }
  if (unsettledTrades && unsettledTrades.length > 0) {
    return NextResponse.json({
      error: unsettledTrades[0].status === "unknown" ? "unknown_bot_trade_requires_reconciliation" : "open_bot_trade_must_settle",
    }, { status: 409, headers });
  }

  let context = await getAuthenticatedDerivContext(request);
  if (!context.ok) {
    return NextResponse.json({
      error: context.error === "not_connected" ? "deriv_reconnect_required" : "deriv_authorization_invalid",
    }, { status: context.error === "configuration" ? 503 : 401, headers });
  }

  const accountsResult = await fetchDerivAccounts(context.token);
  if (!accountsResult.ok) {
    return NextResponse.json({
      error: accountsResult.error === "unauthorized" ? "deriv_reconnect_required" : "deriv_account_verification_failed",
    }, { status: accountsResult.error === "unauthorized" ? 401 : 502, headers });
  }

  const ownership = await getOwnedDerivAccountIds(context.supabase, user.id, [bot.account_id]);
  if (ownership.error || !ownership.accountIds) {
    return NextResponse.json({ error: "account_ownership_unavailable" }, { status: 503, headers });
  }
  if (!ownership.accountIds.has(bot.account_id)) {
    return NextResponse.json({ error: "demo_account_not_linked" }, { status: 403, headers });
  }

  const account = accountsResult.accounts.find((item) => item.account_id === bot.account_id);
  if (!account) return NextResponse.json({ error: "demo_account_not_found" }, { status: 404, headers });
  if ((account.account_type ?? "").toLowerCase() !== "demo") {
    return NextResponse.json({ error: "demo_only_runner" }, { status: 403, headers });
  }
  if (!account.currency) return NextResponse.json({ error: "account_currency_unavailable" }, { status: 502, headers });

  let encryptedToken: string;
  try {
    encryptedToken = encryptDerivToken(context.token);
  } catch {
    return NextResponse.json({ error: "bot_token_encryption_not_configured" }, { status: 503, headers });
  }

  // The OAuth access token is short-lived. A 45-minute safety TTL avoids treating
  // a token as indefinitely valid; Deriv remains authoritative on every run.
  const expiresAt = new Date(Date.now() + 45 * 60 * 1000).toISOString();
  const { error: credentialError } = await admin.from("bot_runner_credentials").upsert({
    user_id: user.id,
    account_id: bot.account_id,
    encrypted_access_token: encryptedToken,
    currency: account.currency,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,account_id" });
  if (credentialError) return NextResponse.json({ error: "bot_credentials_unavailable" }, { status: 503, headers });

  const { error: activateError } = await admin.from("trading_bots")
    .update({ is_active: true })
    .eq("id", bot.id)
    .eq("user_id", user.id);
  if (activateError) {
    // Credentials are account-scoped and may belong to a bot that won a concurrent
    // activation. Never remove them without proving no bot or trade still needs them.
    const { data: activeAfterFailure } = await admin.from("trading_bots").select("id")
      .eq("user_id", user.id).eq("account_id", bot.account_id).eq("is_active", true).limit(1);
    if (!activeAfterFailure || activeAfterFailure.length === 0) {
      const { data: outstanding } = await admin.from("bot_trade_ledger").select("id")
        .eq("user_id", user.id).eq("account_id", bot.account_id)
        .in("status", ["pending", "open"]).limit(1);
      if (!outstanding || outstanding.length === 0) {
        await admin.from("bot_runner_credentials").delete().eq("user_id", user.id).eq("account_id", bot.account_id);
      }
    }
    return NextResponse.json({
      error: activeAfterFailure && activeAfterFailure.length > 0
        ? "another_bot_armed_on_account"
        : "bot_activation_failed",
    }, { status: activeAfterFailure && activeAfterFailure.length > 0 ? 409 : 503, headers });
  }

  await logAction(admin, bot as unknown as Record<string, unknown>, "bot_armed", {
    mode: "demo_only",
    account_id: bot.account_id,
    credential_expires_at: expiresAt,
    engine: "tb-signal-v1",
  });
  return NextResponse.json({
    success: true,
    enabled: true,
    mode: "demo_only",
    credential_expires_at: expiresAt,
    message: "Demo bot armed. It will trade only if its out-of-sample edge and every risk gate pass.",
  }, { headers });
}
