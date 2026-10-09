import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const connected = Boolean(request.cookies.get("tradebridge_deriv_access_token")?.value);
  return NextResponse.json(
    { connected },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Pragma": "no-cache",
      },
    },
  );
}
