import { NextResponse, type NextRequest } from "next/server";
import { getDerivBackendSession } from "@/lib/deriv/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, context: RouteContext, method: "GET" | "POST" | "DELETE") {
  const session = await getDerivBackendSession();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status, headers });
  }

  const { path } = await context.params;
  const routePath = path.join("/");
  const UUID = "[0-9a-f-]{36}";
  const allowed =
    // ── Pairing / device management ─────────────────────────────────────────
    (method === "GET"    && routePath === "devices") ||
    (method === "POST"   && (routePath === "pairing-codes" || routePath === "pair")) ||
    (method === "DELETE" && new RegExp(`^devices/${UUID}$`, "i").test(routePath)) ||
    // ── Trade order lifecycle (Phase 1 market orders) ────────────────────────
    // Create a trade order for a device
    (method === "POST"   && new RegExp(`^devices/${UUID}/trade-orders$`, "i").test(routePath)) ||
    // Poll a specific order's status
    (method === "GET"    && new RegExp(`^devices/${UUID}/trade-orders/${UUID}$`, "i").test(routePath)) ||
    // Cancel a queued order
    (method === "POST"   && new RegExp(`^devices/${UUID}/trade-orders/${UUID}/cancel$`, "i").test(routePath));
  if (!allowed) return NextResponse.json({ error: "not_found" }, { status: 404, headers });

  let body: string | undefined;
  if (method === "POST") {
    try {
      const payload: unknown = await request.json();
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        return NextResponse.json({ error: "invalid_request" }, { status: 400, headers });
      }
      body = JSON.stringify(payload);
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400, headers });
    }
  }

  try {
    const upstream = await fetch(`${session.backendUrl}/mt5/${routePath}`, {
      method,
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (upstream.status === 204) return new NextResponse(null, { status: 204, headers });
    const payload: unknown = await upstream.json().catch(() => ({ error: "invalid_backend_response" }));
    return NextResponse.json(payload, { status: upstream.status, headers });
  } catch {
    return NextResponse.json({ error: "mt5_backend_unavailable" }, { status: 502, headers });
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "GET");
}
export async function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "POST");
}
export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "DELETE");
}
