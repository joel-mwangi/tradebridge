import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ runId: string }> };
function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(_request: Request, { params }: Context) {
  const supabase = await createClient().catch(() => null);
  if (!supabase) return error("Authentication service unavailable", 503);
  const [{ data: { user }, error: userError }, { data: { session } }] = await Promise.all([
    supabase.auth.getUser(), supabase.auth.getSession(),
  ]);
  if (userError || !user || !session?.access_token) return error("Authentication required", 401);
  const { runId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return error("Run not found", 404);
  const base = process.env.TRADEBRIDGE_AI_URL?.replace(/\/+$/, "");
  if (!base) return error("Bot execution service is not configured", 503);
  try {
    const upstream = await fetch(new URL(`/bots/runs/${encodeURIComponent(runId)}/stop`, base), {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, Accept: "application/json" },
      cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    const body = await upstream.json().catch(() => null);
    if (!upstream.ok) return error(typeof body?.detail === "string" ? body.detail : "Could not stop bot run", upstream.status);
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch { return error("Bot execution service could not be reached; refresh status before retrying", 502); }
}
