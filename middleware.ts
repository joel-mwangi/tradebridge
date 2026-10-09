import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = new Set(["/login", "/register", "/forgot-password", "/reset-password", "/auth/callback"]);

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.has(path);

  if (!url || !key) {
    if (isPublic) return response;
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "auth_not_configured" }, { status: 503 });
    }
    return NextResponse.redirect(new URL("/login?error=configuration", request.url));
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user }, error } = await supabase.auth.getUser();
  const authenticated = Boolean(user && !error);

  if (isPublic && authenticated) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (!isPublic && !authenticated) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    const loginUrl = new URL("/login", request.url);
    if (path !== "/") loginUrl.searchParams.set("next", path);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
