-- Server-only idempotency ledger for position protection updates and full/partial closes.
-- The backend is the only writer; browser clients must never access action records directly.

create table if not exists public.ctrader_position_action_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 8 and 50),
  ctid_trader_account_id text not null,
  position_id bigint not null check (position_id > 0),
  action_type text not null check (action_type in ('protection', 'close')),
  request_hash text not null,
  status text not null check (status in ('submitting', 'completed', 'rejected', 'unknown')),
  provider_error_code text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (user_id, idempotency_key)
);

create index if not exists ctrader_position_action_requests_user_created_idx
  on public.ctrader_position_action_requests(user_id, created_at desc);

alter table public.ctrader_position_action_requests enable row level security;
revoke all on table public.ctrader_position_action_requests from public, anon, authenticated;
grant all on table public.ctrader_position_action_requests to service_role;

comment on table public.ctrader_position_action_requests is
  'Server-only idempotency ledger for cTrader stop-loss/take-profit changes and full/partial position closes. Unknown outcomes must not be retried blindly.';
