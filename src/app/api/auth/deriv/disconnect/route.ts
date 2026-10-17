import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403 });
  }

  let persistentRevocationFailed = false;
  // Server-side revocation is attempted before clearing local cookies. If it
  // fails, still clear browser state but make the failure visible to the user.
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) {
      persistentRevocationFailed = true;
    } else if (user) {
      const backendUrlRaw = process.env.TRADEBRIDGE_BACKEND_URL?.trim();
      const backendUrl = backendUrlRaw?.endsWith("/") ? backendUrlRaw.slice(0, -1) : backendUrlRaw;
      const bridgeToken = process.env.TRADEBRIDGE_SESSION_BRIDGE_TOKEN?.trim();
      if (!backendUrl || !bridgeToken) {
        persistentRevocationFailed = true;
      } else {
        try {
          const backendResponse = await fetch(`${backendUrl}/deriv/internal/credentials/${encodeURIComponent(user.id)}`, {
            method: "DELETE",
            headers: { "X-Tradebridge-Bridge-Token": bridgeToken },
            cache: "no-store",
            signal: AbortSignal.timeout(5_000),
          });
          if (!backendResponse.ok) persistentRevocationFailed = true;
        } catch {
          persistentRevocationFailed = true;
        }
      }

      try {
        const admin = createAdminClient();
        const { error } = await admin
          .from("deriv_live_trading_consents")
          .update({ enabled: false })
          .eq("user_id", user.id)
          .eq("enabled", true);
        if (error) persistentRevocationFailed = true;
      } catch {
        persistentRevocationFailed = true;
      }
    }
  } catch {
    persistentRevocationFailed = true;
  }

  const response = NextResponse.redirect(
    new URL(persistentRevocationFailed ? "/?disconnect_error=server_revoke_failed" : "/", request.url),
    { status: 303 },
  );
  response.cookies.delete("tradebridge_deriv_access_token");
  response.cookies.delete("tradebridge_deriv_owner");
  response.cookies.delete("tradebridge_oauth_state");
  response.cookies.delete("tradebridge_pkce_verifier");
  return response;
}
