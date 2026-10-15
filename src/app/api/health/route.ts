import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startedAt = Date.now();

/**
 * Lightweight process health endpoint for deployment probes.
 * This intentionally does not expose environment variables, credentials,
 * database details, or claim that external dependencies are healthy.
 */
export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "tradebridge",
      uptimeSeconds: Math.floor(process.uptime()),
      startedAt: new Date(startedAt).toISOString(),
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        Pragma: "no-cache",
      },
    },
  );
}
