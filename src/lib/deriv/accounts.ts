export type DerivAccount = {
  account_id: string;
  balance: number | null;
  currency: string | null;
  account_type: string | null;
  status: string | null;
};

type FetchAccountsResult =
  | { ok: true; accounts: DerivAccount[] }
  | { ok: false; status: number; error: "unauthorized" | "forbidden" | "upstream" };

const ACCOUNTS_ENDPOINT = "https://api.derivws.com/trading/v1/options/accounts";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function toAccount(value: unknown): DerivAccount | null {
  const item = record(value);
  if (!item) return null;

  const accountId = item.account_id ?? item.accountId ?? item.id;
  if (typeof accountId !== "string" || !accountId.trim()) return null;

  const rawBalance = item.balance;
  const balance = typeof rawBalance === "number" && Number.isFinite(rawBalance)
    ? rawBalance
    : typeof rawBalance === "string" && rawBalance.trim() !== "" && Number.isFinite(Number(rawBalance))
      ? Number(rawBalance)
      : null;

  return {
    account_id: accountId,
    balance,
    currency: typeof item.currency === "string" ? item.currency : null,
    account_type: typeof item.account_type === "string"
      ? item.account_type
      : typeof item.accountType === "string"
        ? item.accountType
        : null,
    status: typeof item.status === "string" ? item.status : null,
  };
}

function extractAccounts(payload: unknown): DerivAccount[] {
  const root = record(payload);
  const data = root?.data;
  const dataRecord = record(data);

  const candidates = Array.isArray(data)
    ? data
    : Array.isArray(dataRecord?.accounts)
      ? dataRecord.accounts
      : dataRecord
        ? [dataRecord]
        : Array.isArray(root?.accounts)
          ? root.accounts
          : [];

  return candidates.map(toAccount).filter((account): account is DerivAccount => account !== null);
}

export async function fetchDerivAccounts(accessToken: string): Promise<FetchAccountsResult> {
  try {
    const response = await fetch(ACCOUNTS_ENDPOINT, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });

    if (response.status === 401) return { ok: false, status: 401, error: "unauthorized" };
    if (response.status === 403) return { ok: false, status: 403, error: "forbidden" };
    if (!response.ok) return { ok: false, status: response.status, error: "upstream" };

    const payload: unknown = await response.json();
    return { ok: true, accounts: extractAccounts(payload) };
  } catch {
    return { ok: false, status: 502, error: "upstream" };
  }
}
