import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";

async function handleSignOut(request: NextRequest) {
  const appUrl = (process.env.APP_URL || new URL(request.url).origin).replace(/\/$/, "");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  const response = NextResponse.redirect(new URL("/login", appUrl), { status: 303 });

  if (url && key) {
    // Use the SSR client so signOut clears the server-side session cookies
    // that the middleware reads. Browser-only signOut does not clear these.
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    });
    try {
      await supabase.auth.signOut();
    } catch {
      // Always redirect even if signout fails.
    }
  }

  return response;
}

export async function POST(request: NextRequest) {
  return handleSignOut(request);
}

export async function GET(request: NextRequest) {
  return handleSignOut(request);
}
