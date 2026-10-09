import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403 });
  }

  // Revoke the app's persisted live-trading opt-in on disconnect. If the consent
  // migration has not been applied, logout still succeeds and all local tokens clear.
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from("deriv_live_trading_consents")
        .update({ enabled: false })
        .eq("user_id", user.id)
        .eq("enabled", true);
    }
  } catch {
    // Disconnect must still clear local session cookies even if Supabase is unavailable.
  }

  const response = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  response.cookies.delete("tradebridge_deriv_access_token");
  response.cookies.delete("tradebridge_deriv_owner");
  response.cookies.delete("tradebridge_oauth_state");
  response.cookies.delete("tradebridge_pkce_verifier");
  return response;
}
