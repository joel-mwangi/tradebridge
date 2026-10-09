import { NextRequest, NextResponse } from "next/server";
import { fetchDerivAccounts } from "@/lib/deriv/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = request.cookies.get("tradebridge_deriv_access_token")?.value;
  const headers = {
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
  };

  if (!token) {
    return NextResponse.json({ connected: false }, { headers });
  }

  const result = await fetchDerivAccounts(token);
  if (!result.ok) {
    const response = NextResponse.json(
      {
        connected: false,
        error: result.error === "unauthorized"
          ? "token_expired"
          : result.error === "forbidden"
            ? "insufficient_scope"
            : "deriv_unavailable",
      },
      { headers },
    );
    if (result.error === "unauthorized") {
      response.cookies.delete("tradebridge_deriv_access_token");
    }
    return response;
  }

  return NextResponse.json({ connected: true, accountCount: result.accounts.length }, { headers });
}
