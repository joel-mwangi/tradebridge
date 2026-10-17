import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

// Retired: FastAPI owns Demo session authorization and WebSocket connections.
// Next.js must never request or return a Deriv OTP URL.
export async function POST() {
  return NextResponse.json(
    { error: "legacy_endpoint_retired", message: "Use the authenticated FastAPI Deriv WebSocket gateway." },
    { status: 410, headers },
  );
}
