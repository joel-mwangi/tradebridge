-- Migration: add mt5_positions table for real-time EA position sync
create table if not exists mt5_positions (
  id              uuid primary key default gen_random_uuid(),
  device_id       uuid not null references mt5_devices(id) on delete cascade,
  user_id         text not null,
  mt5_ticket      bigint not null,
  symbol          text not null,
  order_side      text not null check (order_side in ('buy', 'sell')),
  volume          numeric not null,
  open_price      numeric not null,
  current_price   numeric not null,
  floating_pl     numeric not null,
  stop_loss       numeric,
  take_profit     numeric,
  account_type    text not null check (account_type in ('demo', 'real')),
  is_open         boolean not null default true,
  opened_at       timestamptz not null,
  closed_at       timestamptz,
  last_synced_at  timestamptz not null default now()
);

create unique index if not exists mt5_positions_device_ticket_uidx
  on mt5_positions (device_id, mt5_ticket);

create index if not exists mt5_positions_device_open_idx
  on mt5_positions (device_id, is_open);

-- RLS: each user can only read/write their own device positions
alter table mt5_positions enable row level security;

create policy "owner can read positions" on mt5_positions
  for select using (user_id = auth.uid()::text);

create policy "service role full access" on mt5_positions
  for all using (auth.role() = 'service_role');
