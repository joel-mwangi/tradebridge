import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

// Retired: trading sessions must be issued as one-time tickets by FastAPI.
// Never request or return an upstream Deriv OTP/WebSocket URL from Next.js.
export async function POST() {
  return NextResponse.json(
    { error: "legacy_endpoint_retired", message: "Use the authenticated FastAPI Deriv WebSocket gateway." },
    { status: 410, headers },
  );
}
