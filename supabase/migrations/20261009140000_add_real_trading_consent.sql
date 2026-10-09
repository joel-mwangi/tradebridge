-- Persist per-user, per-real-account opt-in for live-money trading.
-- Clients may read their own setting, but only trusted server-side routes may mutate it.
create table if not exists public.deriv_live_trading_consents (
  user_id uuid not null references auth.users (id) on delete cascade,
  deriv_account_id text not null references public.deriv_account_links (deriv_account_id) on delete cascade,
  enabled boolean not null default false,
  acknowledgement_version text,
  acknowledged_at timestamptz,
  max_stake numeric(18, 8) not null default 10,
  max_daily_loss numeric(18, 8) not null default 25,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, deriv_account_id),
  constraint deriv_live_consent_ack_check check (
    not enabled or (
      acknowledgement_version = 'REAL_MONEY_RISK_ACKNOWLEDGEMENT_V1'
      and acknowledged_at is not null
    )
  ),
  constraint deriv_live_consent_max_stake_check check (max_stake > 0 and max_stake <= 10000),
  constraint deriv_live_consent_daily_loss_check check (max_daily_loss > 0 and max_daily_loss <= 100000)
);

create index if not exists deriv_live_trading_consents_account_idx
  on public.deriv_live_trading_consents (deriv_account_id);

alter table public.deriv_live_trading_consents enable row level security;

-- Do not grant client INSERT or UPDATE. A client could otherwise forge the
-- acknowledgement through PostgREST without visiting the consent UI/API route.
revoke all on table public.deriv_live_trading_consents from public, anon, authenticated;
grant select on table public.deriv_live_trading_consents to authenticated;
grant all on table public.deriv_live_trading_consents to service_role;

drop policy if exists "Users can create their own live trading consent" on public.deriv_live_trading_consents;
drop policy if exists "Users can update their own live trading consent" on public.deriv_live_trading_consents;
drop policy if exists "Users can read their own live trading consent" on public.deriv_live_trading_consents;
create policy "Users can read their own live trading consent"
  on public.deriv_live_trading_consents for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.set_deriv_live_consent_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_deriv_live_consent_updated_at() from public, anon, authenticated;
drop trigger if exists deriv_live_trading_consent_updated_at on public.deriv_live_trading_consents;
create trigger deriv_live_trading_consent_updated_at
  before update on public.deriv_live_trading_consents
  for each row execute function public.set_deriv_live_consent_updated_at();
