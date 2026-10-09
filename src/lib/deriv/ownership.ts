import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export async function getOwnedDerivAccountIds(
  supabase: SupabaseServerClient,
  userId: string,
  accountIds: string[],
): Promise<{ accountIds: Set<string> | null; error: boolean }> {
  const uniqueIds = [...new Set(accountIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (uniqueIds.length === 0) return { accountIds: new Set(), error: false };

  const { data, error } = await supabase
    .from("deriv_account_links")
    .select("deriv_account_id")
    .eq("user_id", userId)
    .in("deriv_account_id", uniqueIds);

  if (error || !data) return { accountIds: null, error: true };
  return {
    accountIds: new Set(data.map((row) => row.deriv_account_id)),
    error: false,
  };
}
