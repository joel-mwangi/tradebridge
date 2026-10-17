import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ runId: string }> };
function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

async function context() {
  const supabase = await createClient();
  const [{ data: { user }, error: userError }, { data: { session } }] = await Promise.all([
    supabase.auth.getUser(), supabase.auth.getSession(),
  ]);
  return userError || !user || !session?.access_token ? null : session.access_token;
}

export async function GET(_request: Request, { params }: Context) {
  const token = await context().catch(() => null);
  if (!token) return error("Authentication required", 401);
  const { runId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return error("Run not found", 404);
  const base = process.env.TRADEBRIDGE_AI_URL?.replace(/\/+$/, "");
  if (!base) return error("Bot execution service is not configured", 503);
  try {
    const upstream = await fetch(new URL(`/bots/runs/${encodeURIComponent(runId)}`, base), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    const body = await upstream.json().catch(() => null);
    if (!upstream.ok) return error(typeof body?.detail === "string" ? body.detail : "Could not load bot run", upstream.status);
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" } });
  } catch { return error("Bot execution service could not be reached", 502); }
}
