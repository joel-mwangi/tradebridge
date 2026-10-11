-- Automated trading bot configuration and server-produced activity logs.
-- IMPORTANT: is_active is a desired configuration flag only. A trusted server-side
-- execution worker must validate risk, ownership and broker state before placing orders.

create table if not exists public.trading_bots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  bot_name text not null check (char_length(trim(bot_name)) between 1 and 80),
  strategy_type text not null check (
    strategy_type in ('trend_following', 'mean_reversion', 'breakout', 'momentum')
  ),
  symbol text not null check (symbol ~ '^[A-Za-z0-9_]{2,32}$'),
  stake_amount numeric(18, 8) not null check (stake_amount > 0 and stake_amount <= 10000),
  take_profit_pips numeric(18, 8) not null default 0 check (take_profit_pips >= 0),
  stop_loss_pips numeric(18, 8) not null default 0 check (stop_loss_pips >= 0),
  is_active boolean not null default false,
  total_trades integer not null default 0 check (total_trades >= 0),
  total_profit_loss numeric(18, 8) not null default 0,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create index if not exists trading_bots_user_created_idx
  on public.trading_bots (user_id, created_at desc);

create table if not exists public.bot_logs (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.trading_bots (id) on delete cascade,
  action text not null check (char_length(trim(action)) between 1 and 80),
  details jsonb not null default '{}'::jsonb,
  profit_loss numeric(18, 8),
  "timestamp" timestamptz not null default pg_catalog.now()
);

create index if not exists bot_logs_bot_timestamp_idx
  on public.bot_logs (bot_id, "timestamp" desc);

alter table public.trading_bots enable row level security;
alter table public.bot_logs enable row level security;

-- Start from no access for anonymous/public clients and grant only the operations
-- intended below. RLS remains the ownership boundary for every authenticated query.
revoke all on table public.trading_bots from public, anon, authenticated;
grant select, insert, update, delete on table public.trading_bots to authenticated;
grant all on table public.trading_bots to service_role;

drop policy if exists "Users can read their own trading bots" on public.trading_bots;
drop policy if exists "Users can create their own trading bots" on public.trading_bots;
drop policy if exists "Users can update their own trading bots" on public.trading_bots;
drop policy if exists "Users can delete their own trading bots" on public.trading_bots;

create policy "Users can read their own trading bots"
  on public.trading_bots for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own trading bots"
  on public.trading_bots for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own trading bots"
  on public.trading_bots for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own trading bots"
  on public.trading_bots for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Bot logs are written by the trusted execution service, not by browser clients.
-- Authenticated users receive SELECT only; the policy verifies ownership via the
-- parent bot row and prevents access to another user's log records.
revoke all on table public.bot_logs from public, anon, authenticated;
grant select on table public.bot_logs to authenticated;
grant all on table public.bot_logs to service_role;

drop policy if exists "Users can read logs for their own bots" on public.bot_logs;
create policy "Users can read logs for their own bots"
  on public.bot_logs for select to authenticated
  using (
    exists (
      select 1
      from public.trading_bots as owner_bot
      where owner_bot.id = bot_logs.bot_id
        and owner_bot.user_id = (select auth.uid())
    )
  );

create or replace function public.set_trading_bots_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.set_trading_bots_updated_at() from public, anon, authenticated;

drop trigger if exists trading_bots_updated_at on public.trading_bots;
create trigger trading_bots_updated_at
  before update on public.trading_bots
  for each row execute function public.set_trading_bots_updated_at();

-- Enable database-change broadcasts where the standard Supabase Realtime
-- publication exists. The checks make this safe to re-run on existing projects.
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'trading_bots'
    ) then
      alter publication supabase_realtime add table public.trading_bots;
    end if;

    if not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'bot_logs'
    ) then
      alter publication supabase_realtime add table public.bot_logs;
    end if;
  end if;
end;
$$;
