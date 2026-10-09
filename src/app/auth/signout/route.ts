import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.redirect(new URL("/login?error=configuration", request.url));

  let response = NextResponse.redirect(new URL("/login?signed_out=1", request.url), { status: 303 });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  await supabase.auth.signOut();
  // Clear this browser’s Deriv authorization when the platform identity signs out.
  response.cookies.delete("tradebridge_deriv_access_token");
  response.cookies.delete("tradebridge_deriv_owner");
  response.cookies.delete("tradebridge_oauth_state");
  response.cookies.delete("tradebridge_pkce_verifier");
  return response;
}
