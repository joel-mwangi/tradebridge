import { createClient } from "@/lib/supabase/server";

export type DerivBackendSession =
  | { ok: true; backendUrl: string; accessToken: string; userId: string }
  | { ok: false; status: number; error: string };

export async function getDerivBackendSession(): Promise<DerivBackendSession> {
  const backendRaw = process.env.TRADEBRIDGE_BACKEND_URL?.trim();
  const backendUrl = backendRaw?.replace(/\/$/, "");
  if (!backendUrl) return { ok: false, status: 503, error: "backend_unavailable" };

  try {
    const supabase = await createClient();
    const [{ data: userData, error: userError }, { data: sessionData, error: sessionError }] =
      await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
    const user = userData.user;
    const accessToken = sessionData.session?.access_token;
    if (userError || sessionError || !user || !accessToken) {
      return { ok: false, status: 401, error: "unauthorized" };
    }
    if (!user.email || !user.email_confirmed_at) {
      return { ok: false, status: 403, error: "unverified" };
    }
    return { ok: true, backendUrl, accessToken, userId: user.id };
  } catch {
    return { ok: false, status: 503, error: "backend_unavailable" };
  }
}
