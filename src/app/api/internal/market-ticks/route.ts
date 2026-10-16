import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live tick persistence is intentionally disabled during the FastAPI migration.
 * The live market stream is forwarded ephemerally and must not write ticks to
 * Supabase. Keep this endpoint as a 410 tombstone so any old Cloudflare Worker
 * fails visibly instead of silently continuing to collect market history.
 */
export async function POST() {
  return NextResponse.json(
    { error: "tick_persistence_disabled", message: "Live market ticks are not persisted by TradeBridge." },
    {
      status: 410,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Deprecation": "true",
      },
    },
  );
}
