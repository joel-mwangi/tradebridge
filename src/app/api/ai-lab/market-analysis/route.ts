import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYMBOL_PATTERN = /^[A-Za-z0-9_]{2,32}$/;
const ALLOWED_LIMITS = new Set([100, 500, 1000, 2500, 5000, 10000]);

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Authenticated browser-to-server proxy. The AI API token is never exposed to
 * the client; the Python service performs the privileged market_ticks query.
 */
export async function GET(request: Request) {
  let supabase;
  try {
    supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return jsonError("Authentication required", 401);
  } catch {
    return jsonError("Authentication service unavailable", 503);
  }

  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol") ?? "1HZ100V";
  const rawLimit = url.searchParams.get("limit") ?? "1000";
  const limit = Number(rawLimit);

  if (!SYMBOL_PATTERN.test(symbol)) return jsonError("Invalid market symbol", 400);
  if (!Number.isInteger(limit) || !ALLOWED_LIMITS.has(limit)) {
    return jsonError("limit must be one of 100, 500, 1000, 2500, 5000, or 10000", 400);
  }

  const aiBaseUrl = process.env.TRADEBRIDGE_AI_URL?.replace(/\/+$/, "");
  const apiToken = process.env.TRADEBRIDGE_API_TOKEN;
  if (!aiBaseUrl || !apiToken) {
    return jsonError("AI research service is not configured on the server", 503);
  }

  let upstream: Response;
  try {
    const upstreamUrl = new URL("/analysis/digits/latest", aiBaseUrl);
    upstreamUrl.searchParams.set("symbol", symbol);
    upstreamUrl.searchParams.set("limit", String(limit));
    upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return jsonError("AI research service could not be reached", 502);
  }

  const body = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    const status = upstream.status === 404 ? 404 : upstream.status === 422 ? 400 : upstream.status === 503 ? 503 : 502;
    const message = upstream.status === 404
      ? "No stored tick history for this symbol yet"
      : upstream.status === 503
        ? "AI research service or its Supabase connection is not configured"
        : "AI research service returned an error";
    return jsonError(message, status);
  }

  if (
    !body ||
    body.symbol !== symbol ||
    body.source !== "supabase.market_ticks" ||
    !Number.isInteger(body.returned_ticks) ||
    body.returned_ticks < 1 ||
    !body.analysis ||
    !Number.isInteger(body.analysis.sample_size) ||
    !body.analysis.counts ||
    !body.analysis.frequencies
  ) {
    return jsonError("AI research service returned an invalid analysis response", 502);
  }

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" },
  });
}
