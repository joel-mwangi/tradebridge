-- DESTRUCTIVE: removes the durable Demo bot execution ledger and worker heartbeat tables.
-- This does NOT delete bot configuration stored elsewhere.
-- Back up any run/trade history you need before applying.
-- No CASCADE is used: PostgreSQL will stop if dependent objects prevent the drop.
--
-- After applying this migration, the current FastAPI bot-control/worker flow that
-- reads or writes these tables will not work until that code is changed.

begin;

drop table if exists public.bot_trades;
drop table if exists public.bot_runs;
drop table if exists public.bot_worker_heartbeats;

commit;
