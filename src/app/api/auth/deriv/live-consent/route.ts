import { NextRequest, NextResponse } from "next/server";
import { getDerivBackendSession } from "@/lib/deriv/backend";
import { getOwnedDerivAccountIds } from "@/lib/deriv/ownership";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACKNOWLEDGEMENT_VERSION = "REAL_MONEY_RISK_ACKNOWLEDGEMENT_V1";
const headers = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

function accountIdFrom(request: NextRequest, body?: Record<string, unknown>) {
  const value = body?.account_id ?? request.nextUrl.searchParams.get("account_id");
  return typeof value === "string" && /^[A-Za-z0-9]+$/.test(value) ? value : null;
}

async function sessionOrResponse() {
  const session = await getDerivBackendSession();
  if (!session.ok) {
    return { session: null, response: NextResponse.json({ error: session.error }, { status: session.status, headers }) };
  }
  return { session, response: null };
}

export async function GET(request: NextRequest) {
  const { session, response } = await sessionOrResponse();
  if (response || !session) return response;

  const accountId = accountIdFrom(request);
  if (!accountId) return NextResponse.json({ error: "invalid_account" }, { status: 400, headers });

  const ownership = await getOwnedDerivAccountIds(session.userId, [accountId]);
  if (ownership.error || !ownership.accountIds) {
    return NextResponse.json({ error: "account_linking_unavailable" }, { status: 503, headers });
  }
  if (!ownership.accountIds.has(accountId)) {
    return NextResponse.json({ error: "account_not_linked" }, { status: 403, headers });
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("deriv_live_trading_consents")
      .select("enabled, acknowledgement_version, acknowledged_at, max_stake, max_daily_loss")
      .eq("user_id", session.userId)
      .eq("deriv_account_id", accountId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: "live_consent_schema_missing" }, { status: 503, headers });
    }

    return NextResponse.json({
      enabled: Boolean(data?.enabled && data.acknowledgement_version === ACKNOWLEDGEMENT_VERSION),
      acknowledgement_version: data?.acknowledgement_version ?? null,
      acknowledged_at: data?.acknowledged_at ?? null,
      max_stake: data?.max_stake ?? 10,
      max_daily_loss: data?.max_daily_loss ?? 25,
    }, { headers });
  } catch {
    return NextResponse.json({ error: "live_consent_schema_missing" }, { status: 503, headers });
  }
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403, headers });
  }

  const { session, response } = await sessionOrResponse();
  if (response || !session) return response;

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400, headers });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers });
  }

  const accountId = accountIdFrom(request, body);
  if (!accountId || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers });
  }

  const ownership = await getOwnedDerivAccountIds(session.userId, [accountId]);
  if (ownership.error || !ownership.accountIds) {
    return NextResponse.json({ error: "account_linking_unavailable" }, { status: 503, headers });
  }
  if (!ownership.accountIds.has(accountId)) {
    return NextResponse.json({ error: "account_not_linked" }, { status: 403, headers });
  }

  if (body.enabled) {
    const backendUrl = process.env.TRADEBRIDGE_BACKEND_URL?.trim();
    if (!backendUrl) {
      return NextResponse.json({
        error: "real_execution_gateway_unavailable",
        message: "Real-money consent cannot be enabled until a server-side execution gateway enforces risk limits.",
      }, { status: 503, headers });
    }

    const maxStakeRaw = Number(body.max_stake);
    const maxDailyLossRaw = Number(body.max_daily_loss);
    const maxStake = Number.isFinite(maxStakeRaw) && maxStakeRaw >= 1 && maxStakeRaw <= 10000 ? maxStakeRaw : 10;
    const maxDailyLoss = Number.isFinite(maxDailyLossRaw) && maxDailyLossRaw >= 1 && maxDailyLossRaw <= 100000 ? maxDailyLossRaw : 25;

    try {
      const admin = createAdminClient();
      const { error } = await admin
        .from("deriv_live_trading_consents")
        .upsert({
          user_id: session.userId,
          deriv_account_id: accountId,
          enabled: true,
          acknowledgement_version: ACKNOWLEDGEMENT_VERSION,
          acknowledged_at: new Date().toISOString(),
          max_stake: maxStake,
          max_daily_loss: maxDailyLoss,
        }, { onConflict: "user_id,deriv_account_id" });

      if (error) return NextResponse.json({ error: "live_consent_write_failed" }, { status: 503, headers });
      return NextResponse.json({
        enabled: true,
        acknowledgement_version: ACKNOWLEDGEMENT_VERSION,
        acknowledged_at: new Date().toISOString(),
        max_stake: maxStake,
        max_daily_loss: maxDailyLoss,
      }, { headers });
    } catch {
      return NextResponse.json({ error: "live_consent_write_unavailable" }, { status: 503, headers });
    }
  }

  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("deriv_live_trading_consents")
      .update({ enabled: false })
      .eq("user_id", session.userId)
      .eq("deriv_account_id", accountId);

    if (error) return NextResponse.json({ error: "live_consent_write_failed" }, { status: 503, headers });
    return NextResponse.json({ enabled: false }, { headers });
  } catch {
    return NextResponse.json({ error: "live_consent_write_unavailable" }, { status: 503, headers });
  }
}
