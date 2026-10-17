export async function getOwnedDerivAccountIds(
  userId: string,
  accountIds: string[],
): Promise<{ accountIds: Set<string> | null; error: boolean }> {
  const uniqueIds = [...new Set(accountIds.filter((id) => typeof id === "string" && /^[A-Za-z0-9]{2,32}$/.test(id)))];
  if (uniqueIds.length === 0) {
    return accountIds.length === 0
      ? { accountIds: new Set(), error: false }
      : { accountIds: null, error: true };
  }

  const backendRaw = process.env.TRADEBRIDGE_BACKEND_URL?.trim();
  const backendUrl = backendRaw?.replace(/\/$/, "");
  const bridgeToken = process.env.TRADEBRIDGE_SESSION_BRIDGE_TOKEN?.trim();
  if (!backendUrl || !bridgeToken) return { accountIds: null, error: true };

  try {
    const response = await fetch(`${backendUrl}/deriv/internal/account-ownership`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tradebridge-Bridge-Token": bridgeToken,
      },
      body: JSON.stringify({ user_id: userId, account_ids: uniqueIds }),
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return { accountIds: null, error: true };

    const payload: unknown = await response.json();
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("owned_account_ids" in payload) ||
      !Array.isArray(payload.owned_account_ids) ||
      !payload.owned_account_ids.every((id): id is string => typeof id === "string" && uniqueIds.includes(id))
    ) {
      return { accountIds: null, error: true };
    }

    return { accountIds: new Set(payload.owned_account_ids), error: false };
  } catch {
    return { accountIds: null, error: true };
  }
}
