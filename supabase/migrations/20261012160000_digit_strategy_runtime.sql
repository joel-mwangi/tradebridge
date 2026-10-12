alter table public.bot_strategy_definitions add column if not exists account_id text;
alter table public.bot_strategy_definitions add column if not exists session_started_at timestamptz;
alter table public.bot_strategy_definitions add column if not exists session_pnl numeric(18,8) not null default 0;
alter table public.bot_strategy_definitions add column if not exists session_trade_count integer not null default 0;
alter table public.bot_strategy_definitions add column if not exists last_evaluated_at timestamptz;
alter table public.bot_strategy_definitions add column if not exists last_tick_epoch bigint;
alter table public.bot_strategy_definitions add column if not exists last_error text;
create table if not exists public.digit_strategy_trades (
 id uuid primary key default gen_random_uuid(),
 strategy_id uuid not null references public.bot_strategy_definitions(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 account_id text not null,
 contract_id text,
 symbol text not null,
 contract_type text not null check (contract_type in ('DIGITOVER','DIGITUNDER','DIGITEVEN','DIGITODD','DIGITMATCH','DIGITDIFF')),
 barrier integer check (barrier between 0 and 9),
 stake numeric(18,8) not null check (stake > 0),
 ask_price numeric(18,8),
 potential_payout numeric(18,8),
 status text not null default 'pending' check (status in ('pending','open','won','lost','sold','unknown','rejected')),
 realized_pnl numeric(18,8),
 tick_epoch bigint,
 details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 settled_at timestamptz
);
create index if not exists digit_strategy_trades_open_idx on public.digit_strategy_trades(account_id,status,created_at desc);
create index if not exists digit_strategy_trades_strategy_idx on public.digit_strategy_trades(strategy_id,created_at desc);
alter table public.digit_strategy_trades enable row level security;
revoke all on public.digit_strategy_trades from public, anon, authenticated;
grant select on public.digit_strategy_trades to authenticated;
grant all on public.digit_strategy_trades to service_role;
create policy "Users read own digit strategy trades" on public.digit_strategy_trades for select to authenticated using ((select auth.uid()) = user_id);
