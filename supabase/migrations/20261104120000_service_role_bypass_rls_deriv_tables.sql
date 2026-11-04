-- The new Supabase sb_secret_... keys map to the service_role Postgres role,
-- the same as the legacy service_role JWT. However, service_role does NOT
-- automatically bypass RLS unless the table has BYPASSRLS or explicit policies.
--
-- The harden migration enabled RLS and granted service_role full table access,
-- but did not add permissive RLS policies for service_role. PostgREST applies
-- RLS even to service_role unless explicitly bypassed.
--
-- This migration adds permissive policies so service_role (used by FastAPI
-- with both legacy JWT and new sb_secret_ keys) can read and write these
-- server-only tables without RLS blocking.

-- deriv_backend_credentials: FastAPI needs full CRUD for credential custody.
create policy "service_role_all_deriv_backend_credentials"
  on public.deriv_backend_credentials
  to service_role
  using (true)
  with check (true);

-- deriv_account_links: FastAPI needs full CRUD for account ownership links.
create policy "service_role_all_deriv_account_links"
  on public.deriv_account_links
  to service_role
  using (true)
  with check (true);
