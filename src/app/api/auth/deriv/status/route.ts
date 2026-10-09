import { NextRequest, NextResponse } from "next/server";
import { fetchDerivAccounts } from "@/lib/deriv/accounts";
import { getAuthenticatedDerivContext } from "@/lib/deriv/authenticated";
import { getOwnedDerivAccountIds } from "@/lib/deriv/ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

export async function GET(request: NextRequest) {
  const context = await getAuthenticatedDerivContext(request);
  if (!context.ok) {
    const response = NextResponse.json(
      { connected: false, error: context.error },
      { status: context.error === "configuration" ? 503 : 401, headers },
    );
    if (context.error !== "not_connected") {
      response.cookies.delete("tradebridge_deriv_access_token");
      response.cookies.delete("tradebridge_deriv_owner");
    }
    return response;
  }

  const result = await fetchDerivAccounts(context.token);
  if (!result.ok) {
    const response = NextResponse.json(
      { connected: false, error: result.error === "unauthorized" ? "token_expired" : result.error === "forbidden" ? "insufficient_scope" : "deriv_unavailable" },
      { status: result.error === "unauthorized" ? 401 : result.error === "forbidden" ? 403 : 502, headers },
    );
    if (result.error === "unauthorized") {
      response.cookies.delete("tradebridge_deriv_access_token");
      response.cookies.delete("tradebridge_deriv_owner");
    }
    return response;
  }

  const ownership = await getOwnedDerivAccountIds(
    context.supabase,
    context.userId,
    result.accounts.map((account) => account.account_id),
  );
  if (ownership.error || !ownership.accountIds) {
    return NextResponse.json({ connected: false, error: "account_linking_unavailable" }, { status: 503, headers });
  }

  const ownedCount = result.accounts.filter((account) => ownership.accountIds?.has(account.account_id)).length;
  if (ownedCount === 0) {
    const response = NextResponse.json({ connected: false, error: "account_mismatch" }, { status: 409, headers });
    response.cookies.delete("tradebridge_deriv_access_token");
    response.cookies.delete("tradebridge_deriv_owner");
    return response;
  }

  return NextResponse.json({ connected: true, accountCount: ownedCount }, { headers });
}
