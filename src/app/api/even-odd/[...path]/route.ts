import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_PATHS = [
  /^status$/, /^collect$/, /^live-status$/, /^analyze$/, /^history$/, /^quality$/,
  /^payouts$/, /^models$/, /^research-runs$/, /^forecast$/, /^entry-check$/,
  /^sessions$/, /^sessions\/[0-9a-f-]{36}$/i, /^sequence-plan$/, /^sequences$/,
  /^sequences\/[0-9a-f-]{36}$/i, /^settlements$/,
];

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const endpoint = path.join("/");
  if (!ALLOWED_PATHS.some((pattern) => pattern.test(endpoint))) {
    return NextResponse.json({ detail: "Even/Odd endpoint is not allowed." }, { status: 404 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ detail: "Sign in to access Even/Odd Lab." }, { status: 401 });
  }

  const backendUrl = process.env.TRADEBRIDGE_BACKEND_URL?.trim().replace(/\/$/, "");
  const apiToken = process.env.TRADEBRIDGE_API_TOKEN?.trim();
  if (!backendUrl || !apiToken) {
    return NextResponse.json({ detail: "Even/Odd backend proxy is not configured." }, { status: 503 });
  }

  const target = new URL(backendUrl + "/even-odd/" + endpoint);
  request.nextUrl.searchParams.forEach((value, key) => target.searchParams.append(key, value));
  const headers = new Headers({
    Authorization: "Bearer " + apiToken,
    Accept: "application/json",
    // Identity is derived from getUser() above; browser-supplied headers are never forwarded.
    "X-TradeBridge-User-ID": data.user.id,
  });
  let body: string | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    headers.set("Content-Type", "application/json");
    body = await request.text();
  }

  try {
    const upstream = await fetch(target, {
      method: request.method, headers, body, cache: "no-store", signal: AbortSignal.timeout(85000),
    });
    const responseBody = await upstream.text();
    return new NextResponse(responseBody, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ detail: "Could not reach the Even/Odd backend." }, { status: 502 });
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxy(request, context);
}
export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxy(request, context);
}
