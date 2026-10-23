import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function redirectToAnalyst(appUrl: string, query: string) {
  return NextResponse.redirect(new URL(`/forex-analyst?${query}`, appUrl));
}

export async function GET(request: NextRequest) {
  const appUrl = (process.env.APP_URL || new URL(request.url).origin).replace(/\/$/, "");
  const redirectUri = `${appUrl}/api/auth/ctrader/callback`;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const expectedState = request.cookies.get("tradebridge_ctrader_oauth_state")?.value;

  const finish = (query: string) => {
    const response = redirectToAnalyst(appUrl, query);
    response.cookies.delete("tradebridge_ctrader_oauth_state");
    return response;
  };
  const fail = (reason: string) => finish(`ctrader_error=${encodeURIComponent(reason)}`);

  if (url.searchParams.has("error")) return fail("cancelled");
  if (!code || !returnedState || !expectedState || returnedState !== expectedState) {
    return fail("invalid_callback");
  }

  let user;
  try {
    const supabase = await createClient();
    const result = await supabase.auth.getUser();
    user = result.data.user;
    if (result.error || !user) {
      return NextResponse.redirect(new URL("/login?error=ctrader_auth_required", appUrl));
    }
    if (!user.email || !user.email_confirmed_at) return fail("email_unverified");
  } catch {
    return fail("account_linking_unavailable");
  }

  try {
    const backendUrlRaw = process.env.TRADEBRIDGE_BACKEND_URL?.trim();
    const backendUrl = backendUrlRaw?.endsWith("/") ? backendUrlRaw.slice(0, -1) : backendUrlRaw;
    const bridgeToken = process.env.TRADEBRIDGE_SESSION_BRIDGE_TOKEN?.trim();
    if (!backendUrl || !bridgeToken) return fail("backend_session_unavailable");

    const response = await fetch(`${backendUrl}/ctrader/internal/oauth/exchange`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tradebridge-Bridge-Token": bridgeToken,
      },
      body: JSON.stringify({ user_id: user.id, code, redirect_uri: redirectUri }),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      if (response.status === 409) return fail("account_conflict");
      if (response.status === 400) return fail("callback_configuration");
      return fail("token_exchange");
    }
    const payload: unknown = await response.json();
    const root = typeof payload === "object" && payload !== null
      ? payload as { connected?: unknown; accounts?: unknown }
      : {};
    if (root.connected !== true || !Array.isArray(root.accounts) || root.accounts.length === 0) {
      return fail("account_verification_failed");
    }
    return finish("ctrader=connected");
  } catch {
    return fail("token_exchange");
  }
}
