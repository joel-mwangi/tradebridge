import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

async function authContext() {
  const supabase = await createClient();
  const [{ data: { user }, error: userError }, { data: { session } }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getSession(),
  ]);
  if (userError || !user || !session?.access_token) return null;
  return session.access_token;
}

async function backendUrl(path: string) {
  const base = process.env.TRADEBRIDGE_AI_URL?.replace(/\/+$/, "");
  if (!base) throw new Error("Bot execution service is not configured.");
  return new URL(path, base);
}

export async function GET(request: Request) {
  let token: string | null;
  try { token = await authContext(); } catch { return error("Authentication service unavailable", 503); }
  if (!token) return error("Authentication required", 401);

  try {
    const url = await backendUrl("/bots/runs");
    const limit = new URL(request.url).searchParams.get("limit") ?? "50";
    url.searchParams.set("limit", /^(?:[1-9]|[1-9]\d|100)$/.test(limit) ? limit : "50");
    const upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const body = await upstream.json().catch(() => null);
    if (!upstream.ok) return error(typeof body?.detail === "string" ? body.detail : "Could not load server bot runs", upstream.status);
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" } });
  } catch {
    return error("Bot execution service could not be reached", 502);
  }
}

export async function POST(request: Request) {
  let token: string | null;
  try { token = await authContext(); } catch { return error("Authentication service unavailable", 503); }
  if (!token) return error("Authentication required", 401);

  let body: unknown;
  try { body = await request.json(); } catch { return error("Invalid JSON request", 400); }
  try {
    const upstream = await fetch(await backendUrl("/bots/runs"), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      const status = [400, 401, 403, 409, 422].includes(upstream.status) ? upstream.status : upstream.status >= 500 ? 502 : 400;
      return error(typeof payload?.detail === "string" ? payload.detail : "Could not queue bot run", status);
    }
    return NextResponse.json(payload, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return error("Bot execution service could not be reached; no run status was confirmed", 502);
  }
}
