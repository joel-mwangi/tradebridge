import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export type AuthenticatedDerivContext =
  | { ok: true; supabase: ServerClient; userId: string; token: string }
  | { ok: false; error: "unauthorized" | "not_connected" | "owner_mismatch" | "unverified" | "configuration" };

export async function getAuthenticatedDerivContext(
  request: NextRequest,
): Promise<AuthenticatedDerivContext> {
  const token = request.cookies.get("tradebridge_deriv_access_token")?.value;
  const ownerId = request.cookies.get("tradebridge_deriv_owner")?.value;
  if (!token) return { ok: false, error: "not_connected" };

  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return { ok: false, error: "unauthorized" };
    if (!user.email || !user.email_confirmed_at) return { ok: false, error: "unverified" };
    if (!ownerId || ownerId !== user.id) return { ok: false, error: "owner_mismatch" };
    return { ok: true, supabase, userId: user.id, token };
  } catch {
    return { ok: false, error: "configuration" };
  }
}
