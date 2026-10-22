-- Server-only cTrader Open API token custody, account ownership, and order idempotency.
-- The backend encrypts both OAuth tokens using TRADEBRIDGE_CREDENTIAL_ENCRYPTION_KEY.
-- Browser clients must never read or mutate these tables.

create table if not exists public.ctrader_backend_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_access_token text not null,
  encrypted_refresh_token text not null,
  expires_at timestamptz not null,
  permission_scope smallint not null check (permission_scope in (0, 1)),
  updated_at timestamptz not null default pg_catalog.now()
);

alter table public.ctrader_backend_credentials enable row level security;
revoke all on table public.ctrader_backend_credentials from public, anon, authenticated;
grant all on table public.ctrader_backend_credentials to service_role;

create table if not exists public.ctrader_account_links (
  ctid_trader_account_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_live boolean not null default false,
  trader_login bigint,
  broker_title_short text,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint ctrader_account_links_user_id_account_id_key unique (user_id, ctid_trader_account_id)
);

create index if not exists ctrader_account_links_user_id_idx
  on public.ctrader_account_links(user_id);

alter table public.ctrader_account_links enable row level security;
revoke all on table public.ctrader_account_links from public, anon, authenticated;
grant all on table public.ctrader_account_links to service_role;

create table if not exists public.ctrader_order_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 8 and 50),
  ctid_trader_account_id text not null,
  symbol_id bigint not null check (symbol_id > 0),
  side text not null check (side in ('BUY', 'SELL')),
  volume_cents bigint not null check (volume_cents > 0),
  request_hash text not null,
  status text not null check (status in ('submitting', 'accepted', 'rejected', 'unknown')),
  provider_order_id text,
  provider_position_id text,
  provider_error_code text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (user_id, idempotency_key)
);

create index if not exists ctrader_order_requests_user_created_idx
  on public.ctrader_order_requests(user_id, created_at desc);

alter table public.ctrader_order_requests enable row level security;
revoke all on table public.ctrader_order_requests from public, anon, authenticated;
grant all on table public.ctrader_order_requests to service_role;

comment on table public.ctrader_backend_credentials is
  'Server-only encrypted cTrader OAuth credentials. The encryption key is kept outside Supabase.';
comment on table public.ctrader_account_links is
  'Verified mapping of cTrader account identifiers to a TradeBridge user. Clients have no direct access.';
comment on table public.ctrader_order_requests is
  'Persistent cTrader order idempotency ledger. Submitting/unknown outcomes must never be retried blindly.';
