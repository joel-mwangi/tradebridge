-- Store Deriv OAuth credentials encrypted at rest for FastAPI session ownership.
-- Live ticks are intentionally not stored by this migration.
create table if not exists public.deriv_backend_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_access_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default pg_catalog.now()
);

alter table public.deriv_backend_credentials enable row level security;

revoke all on table public.deriv_backend_credentials from public, anon, authenticated;
grant all on table public.deriv_backend_credentials to service_role;

comment on table public.deriv_backend_credentials is
  'Server-only encrypted Deriv OAuth credential custody for FastAPI; encryption key is stored outside the database.';
