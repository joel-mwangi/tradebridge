-- Harden already-deployed versions of the real-trading consent table.
-- Authenticated users can read only their own row. All mutations must pass
-- through server routes using the server-only Supabase service-role client.
alter table public.deriv_live_trading_consents enable row level security;

revoke all on table public.deriv_live_trading_consents from public, anon, authenticated;
grant select on table public.deriv_live_trading_consents to authenticated;
grant all on table public.deriv_live_trading_consents to service_role;

drop policy if exists "Users can create their own live trading consent" on public.deriv_live_trading_consents;
drop policy if exists "Users can update their own live trading consent" on public.deriv_live_trading_consents;
drop policy if exists "Users can read their own live trading consent" on public.deriv_live_trading_consents;

create policy "Users can read their own live trading consent"
  on public.deriv_live_trading_consents for select to authenticated
  using ((select auth.uid()) = user_id);
