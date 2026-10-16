-- Persist Deriv market ticks in TradeBridge's existing Supabase/Postgres database.
-- Ingestion is server-to-server only; browser roles must not read or write this table.

create table if not exists public.market_ticks (
  id bigint generated always as identity primary key,
  symbol text not null check (symbol ~ '^[A-Za-z0-9_]{2,32}$'),
  quote numeric(20, 10) not null check (quote > 0),
  epoch bigint not null check (epoch > 0),
  pip_size smallint not null check (pip_size between 0 and 10),
  last_digit smallint not null check (last_digit between 0 and 9),
  received_at timestamptz not null default pg_catalog.now(),
  constraint market_ticks_symbol_epoch_quote_key unique (symbol, epoch, quote)
);

create index if not exists market_ticks_symbol_epoch_idx
  on public.market_ticks (symbol, epoch desc);

create index if not exists market_ticks_symbol_digit_epoch_idx
  on public.market_ticks (symbol, last_digit, epoch desc);

alter table public.market_ticks enable row level security;

revoke all on table public.market_ticks from public, anon, authenticated;
grant all on table public.market_ticks to service_role;

comment on table public.market_ticks is
  'Server-ingested Deriv market tick history for research and model evaluation; not a trading signal.';
