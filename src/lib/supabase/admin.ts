import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client for trusted mutations that must not be exposed
 * through the browser's authenticated PostgREST role.
 *
 * Never import this module from a Client Component and never prefix the key
 * with NEXT_PUBLIC_. Callers must still authenticate the user and validate
 * ownership before using this client.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase admin access is not configured. Set SUPABASE_SERVICE_ROLE_KEY on the server.");
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
