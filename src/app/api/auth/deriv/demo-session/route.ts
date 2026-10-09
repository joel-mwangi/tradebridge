import { NextRequest, NextResponse } from "next/server";
import { fetchDerivAccounts } from "@/lib/deriv/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE = "https://api.derivws.com";

export async function POST(request: NextRequest) {
  const headers = {
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
  };
  const token = request.cookies.get("tradebridge_deriv_access_token")?.value;
  if (!token) {
    return NextResponse.json({ error: "not_connected" }, { status: 401, headers });
  }

  let accountId: unknown;
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null && "account_id" in body) {
      accountId = (body as { account_id?: unknown }).account_id;
    }
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers });
  }

  if (typeof accountId !== "string" || !/^[A-Za-z0-9]+$/.test(accountId)) {
    return NextResponse.json({ error: "invalid_account" }, { status: 400, headers });
  }

  const accountsResult = await fetchDerivAccounts(token);
  if (!accountsResult.ok) {
    const response = NextResponse.json(
      { error: accountsResult.error === "unauthorized" ? "token_expired" : "account_verification_failed" },
      { status: accountsResult.error === "unauthorized" ? 401 : accountsResult.error === "forbidden" ? 403 : 502, headers },
    );
    if (accountsResult.error === "unauthorized") response.cookies.delete("tradebridge_deriv_access_token");
    return response;
  }

  const account = accountsResult.accounts.find((item) => item.account_id === accountId);
  if (!account) {
    return NextResponse.json({ error: "account_not_found" }, { status: 404, headers });
  }
  if ((account.account_type ?? "").toLowerCase() !== "demo") {
    return NextResponse.json({ error: "demo_accounts_only" }, { status: 403, headers });
  }

  try {
    const response = await fetch(
      `${API_BASE}/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      },
    );

    if (response.status === 401) {
      const failed = NextResponse.json({ error: "token_expired" }, { status: 401, headers });
      failed.cookies.delete("tradebridge_deriv_access_token");
      return failed;
    }
    if (!response.ok) {
      return NextResponse.json({ error: "demo_session_unavailable" }, { status: 502, headers });
    }

    const payload: unknown = await response.json();
    const root = typeof payload === "object" && payload !== null
      ? payload as { data?: unknown }
      : {};
    const data = typeof root.data === "object" && root.data !== null
      ? root.data as { url?: unknown }
      : {};
    if (typeof data.url !== "string" || !data.url.startsWith("wss://api.derivws.com/")) {
      return NextResponse.json({ error: "invalid_demo_session" }, { status: 502, headers });
    }

    return NextResponse.json({ url: data.url }, { headers });
  } catch {
    return NextResponse.json({ error: "demo_session_unavailable" }, { status: 502, headers });
  }
}
