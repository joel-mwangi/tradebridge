import { NextRequest, NextResponse } from "next/server";
import { fetchDerivAccounts } from "@/lib/deriv/accounts";
import { getAuthenticatedDerivContext } from "@/lib/deriv/authenticated";
import { getOwnedDerivAccountIds } from "@/lib/deriv/ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

function clearDerivCookies(response: NextResponse) {
  response.cookies.delete("tradebridge_deriv_access_token");
  response.cookies.delete("tradebridge_deriv_owner");
}

export async function GET(request: NextRequest) {
  const context = await getAuthenticatedDerivContext(request);
  if (!context.ok) {
    const status = context.error === "unauthorized" ? 401 : context.error === "configuration" ? 503 : 401;
    const response = NextResponse.json(
      { connected: false, accounts: [], error: context.error },
      { status, headers },
    );
    if (context.error === "owner_mismatch" || context.error === "unauthorized" || context.error === "unverified") {
      clearDerivCookies(response);
    }
    return response;
  }

  const result = await fetchDerivAccounts(context.token);
  if (!result.ok) {
    const response = NextResponse.json(
      { connected: false, accounts: [], error: result.error === "unauthorized" ? "token_expired" : result.error === "forbidden" ? "insufficient_scope" : "deriv_unavailable" },
      { status: result.error === "unauthorized" ? 401 : result.error === "forbidden" ? 403 : 502, headers },
    );
    if (result.error === "unauthorized") clearDerivCookies(response);
    return response;
  }

  const ownership = await getOwnedDerivAccountIds(
    context.supabase,
    context.userId,
    result.accounts.map((account) => account.account_id),
  );
  if (ownership.error || !ownership.accountIds) {
    return NextResponse.json(
      { connected: false, accounts: [], error: "account_linking_unavailable" },
      { status: 503, headers },
    );
  }

  const ownedAccounts = result.accounts.filter((account) => ownership.accountIds?.has(account.account_id));
  if (ownedAccounts.length === 0) {
    const response = NextResponse.json(
      { connected: false, accounts: [], error: "account_mismatch" },
      { status: 409, headers },
    );
    clearDerivCookies(response);
    return response;
  }

  return NextResponse.json({ connected: true, accounts: ownedAccounts }, { headers });
}
