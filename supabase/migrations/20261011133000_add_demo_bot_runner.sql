-- Demo-only automated bot runner. All order-writing privileges remain server-side.
alter table public.trading_bots
  add column if not exists account_id text,
  add column if not exists duration_seconds integer not null default 60,
  add column if not exists daily_loss_limit numeric(18, 8) not null default 5,
  add column if not exists max_trades_per_day integer not null default 10,
  add column if not exists max_consecutive_losses integer not null default 3,
  add column if not exists min_expected_return numeric(8, 5) not null default 0.02;

alter table public.trading_bots
  add constraint trading_bots_duration_seconds_range
    check (duration_seconds between 1 and 3600),
  add constraint trading_bots_daily_loss_limit_positive
    check (daily_loss_limit > 0),
  add constraint trading_bots_daily_trade_limit_range
    check (max_trades_per_day between 1 and 100),
  add constraint trading_bots_loss_streak_limit_range
    check (max_consecutive_losses between 1 and 10),
  add constraint trading_bots_min_return_range
    check (min_expected_return between 0 and 1);

-- Old rows were only browser-side configurations and are not safe to auto-run.
update public.trading_bots set is_active = false where is_active = true;

-- Users may create/edit strategy parameters but can never activate a bot directly
-- through PostgREST. Activation always passes through the authenticated server route.
revoke insert (is_active) on public.trading_bots from authenticated;
revoke update (is_active) on public.trading_bots from authenticated;
grant insert (account_id, duration_seconds, daily_loss_limit, max_trades_per_day,
              max_consecutive_losses, min_expected_return)
  on public.trading_bots to authenticated;
grant update (duration_seconds, daily_loss_limit, max_trades_per_day,
              max_consecutive_losses, min_expected_return)
  on public.trading_bots to authenticated;

create table if not exists public.bot_runner_credentials (
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id text not null,
  encrypted_access_token text not null,
  currency text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, account_id)
);
alter table public.bot_runner_credentials enable row level security;
revoke all on table public.bot_runner_credentials from public, anon, authenticated;
grant all on table public.bot_runner_credentials to service_role;

create table if not exists public.bot_runner_leases (
  bot_id uuid primary key references public.trading_bots (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  lease_token uuid not null,
  lease_until timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.bot_runner_leases enable row level security;
revoke all on table public.bot_runner_leases from public, anon, authenticated;
grant all on table public.bot_runner_leases to service_role;
create index if not exists bot_runner_leases_until_idx on public.bot_runner_leases (lease_until);

create table if not exists public.bot_trade_ledger (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  bot_id uuid not null references public.trading_bots (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id text not null,
  symbol text not null,
  direction text not null check (direction in ('CALL', 'PUT')),
  stake_amount numeric(18, 8) not null check (stake_amount > 0),
  ask_price numeric(18, 8),
  potential_payout numeric(18, 8),
  contract_id text,
  status text not null check (status in ('pending', 'open', 'unknown', 'won', 'lost', 'sold', 'rejected')),
  realized_pnl numeric(18, 8),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists bot_trade_ledger_bot_created_idx
  on public.bot_trade_ledger (bot_id, created_at desc);
create index if not exists bot_trade_ledger_account_status_idx
  on public.bot_trade_ledger (account_id, status, created_at desc);
create index if not exists bot_trade_ledger_settled_idx
  on public.bot_trade_ledger (bot_id, settled_at desc) where settled_at is not null;

alter table public.bot_trade_ledger enable row level security;
revoke all on table public.bot_trade_ledger from public, anon, authenticated;
grant select on table public.bot_trade_ledger to authenticated;
grant all on table public.bot_trade_ledger to service_role;
drop policy if exists "Users can read their own bot trade ledger" on public.bot_trade_ledger;
create policy "Users can read their own bot trade ledger"
  on public.bot_trade_ledger for select to authenticated
  using ((select auth.uid()) = user_id);

-- A user can pause bots in the UI, but bot enabling and ledger writes are server-only.
-- service_role is the only role allowed to write credentials, leases, or ledger rows.
