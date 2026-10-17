import { NextResponse } from "next/server";
import { getDerivBackendSession } from "@/lib/deriv/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

export async function GET() {
  const session = await getDerivBackendSession();
  if (!session.ok) {
    return NextResponse.json(
      { connected: false, accounts: [], error: session.error },
      { status: session.status, headers },
    );
  }

  try {
    const upstream = await fetch(`${session.backendUrl}/deriv/accounts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessToken}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const payload: unknown = await upstream.json();
    if (!upstream.ok) {
      return NextResponse.json(
        { connected: false, accounts: [], error: upstream.status === 401 ? "token_expired" : "deriv_unavailable" },
        { status: upstream.status === 401 ? 401 : upstream.status === 403 ? 403 : 502, headers },
      );
    }
    const root = typeof payload === "object" && payload !== null
      ? payload as { connected?: unknown; accounts?: unknown }
      : {};
    const accounts = Array.isArray(root.accounts) ? root.accounts : [];
    return NextResponse.json({ connected: root.connected === true, accounts }, { headers });
  } catch {
    return NextResponse.json({ connected: false, accounts: [], error: "deriv_unavailable" }, { status: 502, headers });
  }
}
