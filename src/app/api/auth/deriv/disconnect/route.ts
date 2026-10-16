import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403 });
  }

  // Best-effort revocation uses a server-only privileged client because direct
  // authenticated UPDATE access is intentionally forbidden by RLS. Clearing
  // cookies must still work if Supabase is unavailable or is not configured.
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const backendUrlRaw = process.env.TRADEBRIDGE_BACKEND_URL?.trim();
      const backendUrl = backendUrlRaw?.endsWith("/") ? backendUrlRaw.slice(0, -1) : backendUrlRaw;
      const bridgeToken = process.env.TRADEBRIDGE_SESSION_BRIDGE_TOKEN?.trim();
      if (backendUrl && bridgeToken) {
        await fetch(`${backendUrl}/deriv/internal/credentials/${encodeURIComponent(user.id)}`, {
          method: "DELETE",
          headers: { "X-Tradebridge-Bridge-Token": bridgeToken },
          cache: "no-store",
          signal: AbortSignal.timeout(5_000),
        }).catch(() => undefined);
      }
      const admin = createAdminClient();
      await admin
        .from("deriv_live_trading_consents")
        .update({ enabled: false })
        .eq("user_id", user.id)
        .eq("enabled", true);
    }
  } catch {
    // Disconnect still clears local authorization cookies, but persistent
    // revocation cannot be confirmed when server-side Supabase is unavailable.
  }

  const response = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  response.cookies.delete("tradebridge_deriv_access_token");
  response.cookies.delete("tradebridge_deriv_owner");
  response.cookies.delete("tradebridge_oauth_state");
  response.cookies.delete("tradebridge_pkce_verifier");
  return response;
}
