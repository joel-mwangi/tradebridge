import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";


export async function GET(request: NextRequest) {
  const appUrl = (process.env.APP_URL || new URL(request.url).origin).replace(/\/$/, "");
  const redirectUri = `${appUrl}/api/auth/deriv/callback`;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const expectedState = request.cookies.get("tradebridge_oauth_state")?.value;
  const verifier = request.cookies.get("tradebridge_pkce_verifier")?.value;

  const fail = (reason: string) => {
    const response = NextResponse.redirect(new URL(`/?auth_error=${reason}`, appUrl));
    response.cookies.delete("tradebridge_oauth_state");
    response.cookies.delete("tradebridge_pkce_verifier");
    return response;
  };

  if (url.searchParams.has("error")) return fail("cancelled");
  if (!code || !returnedState || !expectedState || returnedState !== expectedState || !verifier) {
    return fail("invalid_callback");
  }

  let supabase;
  let user;
  try {
    supabase = await createClient();
    const result = await supabase.auth.getUser();
    user = result.data.user;
    if (result.error || !user) {
      return NextResponse.redirect(new URL("/login?error=deriv_auth_required", appUrl));
    }
    if (!user.email || !user.email_confirmed_at) return fail("platform_email_unverified");
  } catch {
    return fail("account_linking_unavailable");
  }

  try {
    const backendUrlRaw = process.env.TRADEBRIDGE_BACKEND_URL?.trim();
    const backendUrl = backendUrlRaw?.endsWith("/") ? backendUrlRaw.slice(0, -1) : backendUrlRaw;
    const bridgeToken = process.env.TRADEBRIDGE_SESSION_BRIDGE_TOKEN?.trim();
    if (!backendUrl || !bridgeToken) return fail("backend_session_unavailable");

    let accounts: Array<{ account_id: string; account_type: string | null; currency: string | null }> = [];
    try {
      const exchangeResponse = await fetch(`${backendUrl}/deriv/internal/oauth/exchange`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tradebridge-Bridge-Token": bridgeToken,
        },
        body: JSON.stringify({
          user_id: user.id,
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(18_000),
      });
      if (!exchangeResponse.ok) return fail("token_exchange");
      const exchangePayload = await exchangeResponse.json() as {
        accounts?: Array<{ account_id?: unknown; account_type?: unknown; currency?: unknown }>;
      };
      accounts = (exchangePayload.accounts ?? []).flatMap((account) => {
        if (typeof account.account_id !== "string" || !account.account_id) return [];
        return [{
          account_id: account.account_id,
          account_type: typeof account.account_type === "string" ? account.account_type : null,
          currency: typeof account.currency === "string" ? account.currency : null,
        }];
      });
    } catch {
      return fail("token_exchange");
    }
    if (accounts.length === 0) return fail("account_verification_failed");

    // FastAPI verifies the Deriv accounts and persists their ownership links.
    // A successful exchange response is returned only after both credential and
    // account-link writes succeed. The frontend must never write this table.
    const response = NextResponse.redirect(new URL("/?connection=connected", appUrl));
    response.cookies.delete("tradebridge_deriv_access_token");
    response.cookies.delete("tradebridge_deriv_owner");
    response.cookies.delete("tradebridge_oauth_state");
    response.cookies.delete("tradebridge_pkce_verifier");
    return response;
  } catch {
    return fail("token_exchange");
  }
}
