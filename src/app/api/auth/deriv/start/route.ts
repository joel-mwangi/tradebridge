import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const AUTHORIZATION_ENDPOINT = "https://auth.deriv.com/oauth2/auth";
const COOKIE_TTL_SECONDS = 10 * 60;

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export async function GET(request: NextRequest) {
  try {
    const clientId = getRequiredEnv("DERIV_OAUTH_CLIENT_ID");
    const appUrl = getRequiredEnv("APP_URL").replace(/\/$/, "");
    const redirectUri = `${appUrl}/api/auth/deriv/callback`;
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(32).toString("hex");
    const mode = request.nextUrl.searchParams.get("mode");
    const prompt = mode === "signup" ? "registration" : undefined;

    const authorizationUrl = new URL(AUTHORIZATION_ENDPOINT);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("scope", "trade");
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", challenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    if (prompt) authorizationUrl.searchParams.set("prompt", prompt);

    const response = NextResponse.redirect(authorizationUrl);
    const secure = process.env.NODE_ENV === "production";
    response.cookies.set("tradebridge_oauth_state", state, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_TTL_SECONDS,
    });
    response.cookies.set("tradebridge_pkce_verifier", verifier, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_TTL_SECONDS,
    });

    return response;
  } catch {
    return NextResponse.redirect(new URL("/?auth_error=configuration", request.url));
  }
}
