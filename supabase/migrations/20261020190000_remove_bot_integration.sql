-- Retire automated bot database objects after removing the bot UI and execution API.
-- WARNING: This permanently deletes bot configurations, strategy drafts, bot logs,
-- and bot trade ledgers. This migration must be reviewed before being applied to
-- any database where those records need to be retained.

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    if exists (select 1 from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trading_bots') then
      alter publication supabase_realtime drop table public.trading_bots;
    end if;
    if exists (select 1 from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bot_logs') then
      alter publication supabase_realtime drop table public.bot_logs;
    end if;
  end if;
end;
$$;

drop table if exists public.digit_strategy_trades;
drop table if exists public.bot_trade_ledger;
drop table if exists public.bot_runner_leases;
drop table if exists public.bot_runner_credentials;
drop table if exists public.bot_logs;
drop table if exists public.bot_strategy_definitions;
drop table if exists public.trading_bots;

drop function if exists public.set_bot_strategy_definitions_updated_at();
drop function if exists public.set_trading_bots_updated_at();
