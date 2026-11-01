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
  const queryString = request.nextUrl.search; // e.g. "?lease_seconds=20" or ""
  const UUID = "[0-9a-f-]{36}";
  const ACK  = "submitted|accepted|placed|rejected|filled|reconciled|cancelled-pending";
  const allowed =
    // ── Pairing / device management ─────────────────────────────────────────
    (method === "GET"    && routePath === "devices") ||
    (method === "POST"   && (routePath === "pairing-codes" || routePath === "pair")) ||
    (method === "DELETE" && new RegExp(`^devices/${UUID}$`, "i").test(routePath)) ||
    // ── Trade order lifecycle (Phase 1 + Phase 2) ────────────────────────────
    // Create a market or pending order for a device
    (method === "POST"   && new RegExp(`^devices/${UUID}/trade-orders$`, "i").test(routePath)) ||
    // Order history list for a device
    (method === "GET"    && new RegExp(`^devices/${UUID}/trade-orders$`, "i").test(routePath)) ||
    // Poll a specific order's status
    (method === "GET"    && new RegExp(`^devices/${UUID}/trade-orders/${UUID}$`, "i").test(routePath)) ||
    // Cancel a queued order
    (method === "POST"   && new RegExp(`^devices/${UUID}/trade-orders/${UUID}/cancel$`, "i").test(routePath)) ||
    // ── Position commands (Phase 2: close / modify) ───────────────────────
    (method === "POST"   && new RegExp(`^devices/${UUID}/position-commands$`, "i").test(routePath)) ||
    (method === "GET"    && new RegExp(`^devices/${UUID}/position-commands/${UUID}$`, "i").test(routePath)) ||
    (method === "POST"   && new RegExp(`^devices/${UUID}/position-commands/${UUID}/cancel$`, "i").test(routePath)) ||
    // ── EA-side polling and ack endpoints ────────────────────────────────────
    // Market-selection commands
    (method === "GET"    && routePath === "ea/commands/next") ||
    (method === "POST"   && new RegExp(`^ea/commands/${UUID}/ack$`, "i").test(routePath)) ||
    // Trade order polling and ack
    (method === "GET"    && routePath === "ea/trade-orders/next") ||
    (method === "POST"   && new RegExp(`^ea/trade-orders/${UUID}/ack/(${ACK})$`, "i").test(routePath)) ||
    // Position command polling and ack
    (method === "GET"    && routePath === "ea/position-commands/next") ||
    (method === "POST"   && new RegExp(`^ea/position-commands/${UUID}/ack/(submitted|done|rejected)$`, "i").test(routePath)) ||
    // ── Phase 3: position sync (EA push + UI poll) ────────────────────
    (method === "POST"   && routePath === "ea/positions/sync") ||
    (method === "POST"   && new RegExp(`^ea/positions/\\d+/closed$`).test(routePath)) ||
    (method === "GET"    && new RegExp(`^devices/${UUID}/positions$`, "i").test(routePath));
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
    const upstream = await fetch(`${session.backendUrl}/mt5/${routePath}${queryString}`, {
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
