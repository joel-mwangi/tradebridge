import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const appUrl = (process.env.APP_URL || new URL(request.url).origin).replace(/\/$/, "");
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Always redirect to login even if signout fails.
  }
  const response = NextResponse.redirect(new URL("/login", appUrl), { status: 303 });
  response.cookies.delete("sb-access-token");
  response.cookies.delete("sb-refresh-token");
  return response;
}

// Support GET so that direct navigation to /api/auth/signout also works.
export async function GET(request: NextRequest) {
  return POST(request);
}
