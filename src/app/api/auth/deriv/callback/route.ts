import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchDerivAccounts } from "@/lib/deriv/accounts";

export const runtime = "nodejs";

const TOKEN_ENDPOINT = "https://auth.deriv.com/oauth2/token";

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

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
    const clientId = getRequiredEnv("DERIV_OAUTH_CLIENT_ID");
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    });

    const tokenResponse = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });

    if (!tokenResponse.ok) return fail("token_exchange");
    const tokenData: unknown = await tokenResponse.json();
    if (
      typeof tokenData !== "object" ||
      tokenData === null ||
      !("access_token" in tokenData) ||
      typeof tokenData.access_token !== "string" ||
      !tokenData.access_token
    ) {
      return fail("token_exchange");
    }

    const data = tokenData as { access_token: string; expires_in?: number; token_type?: string };
    const accountsResult = await fetchDerivAccounts(data.access_token);
    if (!accountsResult.ok || accountsResult.accounts.length === 0) {
      return fail("account_verification_failed");
    }

    const links = accountsResult.accounts.map((account) => ({
      deriv_account_id: account.account_id,
      user_id: user.id,
      account_type: account.account_type,
      currency: account.currency,
    }));
    const { data: inserted, error: linkError } = await supabase
      .from("deriv_account_links")
      .upsert(links, { onConflict: "deriv_account_id", ignoreDuplicates: true })
      .select("deriv_account_id");

    if (linkError) return fail("account_linking_unavailable");

    const { data: ownedLinks, error: verifyError } = await supabase
      .from("deriv_account_links")
      .select("deriv_account_id")
      .eq("user_id", user.id)
      .in("deriv_account_id", accountsResult.accounts.map((account) => account.account_id));

    const ownedIds = new Set((ownedLinks ?? []).map((link) => link.deriv_account_id));
    const allOwned = !verifyError && accountsResult.accounts.every((account) => ownedIds.has(account.account_id));
    if (!allOwned) {
      const insertedIds = (inserted ?? []).map((link) => link.deriv_account_id);
      if (insertedIds.length > 0) {
        await supabase.from("deriv_account_links").delete().eq("user_id", user.id).in("deriv_account_id", insertedIds);
      }
      return fail(verifyError ? "account_linking_unavailable" : "account_conflict");
    }

    const expiresIn = Number.isFinite(data.expires_in) && (data.expires_in ?? 0) > 0
      ? Math.min(Math.floor(data.expires_in as number), 24 * 60 * 60)
      : 3600;
    const response = NextResponse.redirect(new URL("/?connection=connected", appUrl));
    const secure = process.env.NODE_ENV === "production";

    response.cookies.set("tradebridge_deriv_access_token", data.access_token, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: expiresIn,
    });
    response.cookies.set("tradebridge_deriv_owner", user.id, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: expiresIn,
    });
    response.cookies.delete("tradebridge_oauth_state");
    response.cookies.delete("tradebridge_pkce_verifier");
    return response;
  } catch {
    return fail("token_exchange");
  }
}
