import { NextRequest, NextResponse } from "next/server";
import { fetchDerivAccounts } from "@/lib/deriv/accounts";
import { getAuthenticatedDerivContext } from "@/lib/deriv/authenticated";
import { getOwnedDerivAccountIds } from "@/lib/deriv/ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE = "https://api.derivws.com";
const headers = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

function clearDerivCookies(response: NextResponse) {
  response.cookies.delete("tradebridge_deriv_access_token");
  response.cookies.delete("tradebridge_deriv_owner");
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403, headers });
  }

  const context = await getAuthenticatedDerivContext(request);
  if (!context.ok) {
    const response = NextResponse.json({ error: context.error }, { status: context.error === "configuration" ? 503 : 401, headers });
    if (context.error !== "not_connected") clearDerivCookies(response);
    return response;
  }

  let accountId: unknown;
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null && "account_id" in body) {
      accountId = (body as { account_id?: unknown }).account_id;
    }
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers });
  }

  if (typeof accountId !== "string" || !/^[A-Za-z0-9]+$/.test(accountId)) {
    return NextResponse.json({ error: "invalid_account" }, { status: 400, headers });
  }

  const accountsResult = await fetchDerivAccounts(context.token);
  if (!accountsResult.ok) {
    const response = NextResponse.json(
      { error: accountsResult.error === "unauthorized" ? "token_expired" : "account_verification_failed" },
      { status: accountsResult.error === "unauthorized" ? 401 : accountsResult.error === "forbidden" ? 403 : 502, headers },
    );
    if (accountsResult.error === "unauthorized") clearDerivCookies(response);
    return response;
  }

  const ownership = await getOwnedDerivAccountIds(context.supabase, context.userId, [accountId]);
  if (ownership.error || !ownership.accountIds) {
    return NextResponse.json({ error: "account_linking_unavailable" }, { status: 503, headers });
  }
  if (!ownership.accountIds.has(accountId)) {
    return NextResponse.json({ error: "account_not_linked" }, { status: 403, headers });
  }

  const account = accountsResult.accounts.find((item) => item.account_id === accountId);
  if (!account) return NextResponse.json({ error: "account_not_found" }, { status: 404, headers });

  const accountType = (account.account_type ?? "").toLowerCase();
  if (accountType !== "demo" && accountType !== "real") {
    return NextResponse.json({ error: "unsupported_account_type" }, { status: 403, headers });
  }

  // A browser-held authenticated Deriv Options WebSocket can submit orders
  // outside TradeBridge's stake/loss checks. Do not issue a trading-capable
  // Real-account OTP URL until every order can pass through a server-side
  // execution gateway with enforceable limits and revocation. Real account
  // summary/details remain available from the OAuth-backed accounts endpoint.
  if (accountType === "real") {
    return NextResponse.json({
      error: "real_execution_gateway_unavailable",
      message: "Real-account order sessions are disabled until server-side order controls can enforce risk limits for every order.",
    }, { status: 503, headers });
  }

  try {
    const response = await fetch(
      `${API_BASE}/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${context.token}`, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      },
    );

    if (response.status === 401) {
      const failed = NextResponse.json({ error: "token_expired" }, { status: 401, headers });
      clearDerivCookies(failed);
      return failed;
    }
    if (!response.ok) {
      return NextResponse.json({ error: "trading_session_unavailable" }, { status: 502, headers });
    }

    const payload: unknown = await response.json();
    const root = typeof payload === "object" && payload !== null ? payload as { data?: unknown } : {};
    const data = typeof root.data === "object" && root.data !== null ? root.data as { url?: unknown } : {};
    if (typeof data.url !== "string") {
      return NextResponse.json({ error: "invalid_trading_session" }, { status: 502, headers });
    }

    let socketUrl: URL;
    try {
      socketUrl = new URL(data.url);
    } catch {
      return NextResponse.json({ error: "invalid_trading_session" }, { status: 502, headers });
    }

    if (
      socketUrl.protocol !== "wss:" ||
      socketUrl.hostname !== "api.derivws.com" ||
      socketUrl.pathname !== "/trading/v1/options/ws/demo" ||
      !socketUrl.searchParams.has("otp")
    ) {
      return NextResponse.json({ error: "trading_session_account_type_mismatch" }, { status: 502, headers });
    }

    return NextResponse.json({
      url: socketUrl.toString(),
      account_type: "demo",
      account_id: accountId,
    }, { headers });
  } catch {
    return NextResponse.json({ error: "trading_session_unavailable" }, { status: 502, headers });
  }
}
