import { NextRequest, NextResponse } from "next/server";

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
    response.cookies.delete("tradebridge_oauth_state");
    response.cookies.delete("tradebridge_pkce_verifier");
    return response;
  } catch {
    return fail("token_exchange");
  }
}
