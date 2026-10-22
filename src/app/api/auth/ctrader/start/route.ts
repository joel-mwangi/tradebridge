import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const AUTHORIZATION_ENDPOINT = "https://id.ctrader.com/my/settings/openapi/grantingaccess/";
const STATE_TTL_SECONDS = 10 * 60;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.redirect(new URL("/login?error=ctrader_auth_required", request.url));
    }
    if (!user.email || !user.email_confirmed_at) {
      return NextResponse.redirect(new URL("/forex-analyst?ctrader_error=email_unverified", request.url));
    }

    const clientId = requiredEnv("CTRADER_OPENAPI_CLIENT_ID");
    const appUrl = requiredEnv("APP_URL").replace(/\/$/, "");
    const redirectUri = `${appUrl}/api/auth/ctrader/callback`;
    const state = randomBytes(32).toString("hex");

    const authorizationUrl = new URL(AUTHORIZATION_ENDPOINT);
    authorizationUrl.searchParams.set("client_id", clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("scope", "trading");
    authorizationUrl.searchParams.set("product", "web");
    authorizationUrl.searchParams.set("state", state);

    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set("tradebridge_ctrader_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: STATE_TTL_SECONDS,
    });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/forex-analyst?ctrader_error=configuration", request.url));
  }
}
