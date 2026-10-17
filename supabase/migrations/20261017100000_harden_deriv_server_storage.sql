-- Canonical server-side Deriv storage hardening for TradeBridge.
-- The credential and account-link tables are created by earlier TradeBridge
-- migrations. Preserve their existing auth.users UUID relationships and metadata.
-- Apply through the TradeBridge Supabase migration workflow.

-- Credentials must only be accessed by FastAPI using the service-role key.
alter table public.deriv_backend_credentials enable row level security;
revoke all on table public.deriv_backend_credentials from public, anon, authenticated;
grant all on table public.deriv_backend_credentials to service_role;

-- Account links are now written by FastAPI after verified OAuth exchange.
-- Remove client-facing policies/grants so browser clients cannot write or inspect links.
alter table public.deriv_account_links enable row level security;
drop policy if exists "Users can read their own Deriv links" on public.deriv_account_links;
drop policy if exists "Users can create their own Deriv links" on public.deriv_account_links;
drop policy if exists "Users can remove their own Deriv links" on public.deriv_account_links;
revoke all on table public.deriv_account_links from public, anon, authenticated;
grant all on table public.deriv_account_links to service_role;

-- Support idempotent PostgREST upserts using on_conflict=user_id,deriv_account_id.
-- deriv_account_id remains the primary key, so one Deriv account cannot be linked
-- to multiple TradeBridge users.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.deriv_account_links'::regclass
      and conname = 'deriv_account_links_user_id_deriv_account_id_key'
  ) then
    alter table public.deriv_account_links
      add constraint deriv_account_links_user_id_deriv_account_id_key
      unique (user_id, deriv_account_id);
  end if;
end
$$;

comment on table public.deriv_backend_credentials is
  'Server-only encrypted Deriv OAuth credential custody for FastAPI; encryption key is stored outside the database.';
comment on table public.deriv_account_links is
  'Server-managed mapping from authenticated TradeBridge users to verified Deriv account IDs.';
