-- Durable storage and atomic operations for the MT5 market-selection bridge.
-- Canonical Supabase migrations live in this TradeBridge repository.
-- Backend calls the functions with the service-role key; no browser access is granted.

create table if not exists public.mt5_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_name text not null check (char_length(btrim(device_name)) between 1 and 100),
  credential_hash text not null check (char_length(credential_hash) between 20 and 512),
  status text not null default 'paired' check (status in ('paired', 'revoked')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index if not exists mt5_devices_user_status_idx
  on public.mt5_devices (user_id, status, created_at desc);

create table if not exists public.mt5_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique check (char_length(code_hash) between 20 and 512),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists mt5_pairing_codes_user_expiry_idx
  on public.mt5_pairing_codes (user_id, expires_at desc);

create table if not exists public.mt5_commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  command_type text not null default 'select_market' check (command_type = 'select_market'),
  provider_symbol text not null check (provider_symbol ~ '^[A-Za-z0-9_]{2,32}$'),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  status text not null default 'pending' check (status in ('pending', 'leased', 'acknowledged', 'rejected', 'expired')),
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  lease_until timestamptz,
  acknowledged_at timestamptz,
  result_code text check (result_code is null or char_length(result_code) <= 80),
  result_message text check (result_message is null or char_length(result_message) <= 500),
  created_at timestamptz not null default now(),
  constraint mt5_commands_device_owner_fk
    foreign key (device_id, user_id) references public.mt5_devices(id, user_id) on delete cascade,
  constraint mt5_commands_idempotency_unique unique (device_id, idempotency_key),
  constraint mt5_commands_expiry_check check (expires_at > requested_at)
);

create index if not exists mt5_commands_device_queue_idx
  on public.mt5_commands (device_id, status, requested_at);

alter table public.mt5_devices enable row level security;
alter table public.mt5_pairing_codes enable row level security;
alter table public.mt5_commands enable row level security;
revoke all on table public.mt5_devices from public, anon, authenticated;
revoke all on table public.mt5_pairing_codes from public, anon, authenticated;
revoke all on table public.mt5_commands from public, anon, authenticated;
grant all on table public.mt5_devices to service_role;
grant all on table public.mt5_pairing_codes to service_role;
grant all on table public.mt5_commands to service_role;

-- Consume a one-time pairing code and create its device atomically.
-- p_code_hash and p_credential_hash must be derived server-side; raw secrets never enter SQL.
create or replace function public.mt5_pair_device(
  p_code_hash text,
  p_device_name text,
  p_credential_hash text
)
returns table (device_id uuid, owner_user_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  pairing public.mt5_pairing_codes%rowtype;
  created_device public.mt5_devices%rowtype;
begin
  if p_code_hash is null or char_length(p_code_hash) not between 20 and 512
     or p_credential_hash is null or char_length(p_credential_hash) not between 20 and 512
     or p_device_name is null or char_length(btrim(p_device_name)) not between 1 and 100 then
    raise exception 'invalid_pairing_input' using errcode = '22023';
  end if;

  select * into pairing
    from public.mt5_pairing_codes
   where code_hash = p_code_hash
     and consumed_at is null
     and expires_at > now()
   for update;
  if not found then
    raise exception 'invalid_or_expired_pairing_code' using errcode = '22023';
  end if;

  update public.mt5_pairing_codes
     set consumed_at = now()
   where id = pairing.id;

  insert into public.mt5_devices (user_id, device_name, credential_hash, status)
  values (pairing.user_id, btrim(p_device_name), p_credential_hash, 'paired')
  returning * into created_device;

  return query select created_device.id, created_device.user_id;
end;
$$;

-- Atomically lease one command. Reclaim expired leases but never return expired commands.
create or replace function public.mt5_lease_next_command(
  p_device_id uuid,
  p_lease_seconds integer default 20
)
returns setof public.mt5_commands
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  selected public.mt5_commands%rowtype;
begin
  if p_device_id is null or p_lease_seconds not between 5 and 60 then
    raise exception 'invalid_lease_request' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.mt5_devices d
     where d.id = p_device_id and d.status = 'paired'
  ) then
    raise exception 'device_not_paired' using errcode = '42501';
  end if;

  update public.mt5_commands
     set status = 'expired', lease_until = null
   where device_id = p_device_id
     and status in ('pending', 'leased')
     and expires_at <= now();

  select * into selected
    from public.mt5_commands c
   where c.device_id = p_device_id
     and c.expires_at > now()
     and (c.status = 'pending' or (c.status = 'leased' and c.lease_until <= now()))
   order by c.requested_at, c.id
   for update skip locked
   limit 1;

  if not found then
    return;
  end if;

  update public.mt5_commands
     set status = 'leased', lease_until = now() + make_interval(secs => p_lease_seconds)
   where id = selected.id
   returning * into selected;

  return next selected;
end;
$$;

-- Acknowledge only a command belonging to the authenticated device; duplicates are idempotent.
create or replace function public.mt5_ack_command(
  p_device_id uuid,
  p_command_id uuid,
  p_outcome text,
  p_result_code text default null,
  p_result_message text default null
)
returns public.mt5_commands
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_command public.mt5_commands%rowtype;
  final_command public.mt5_commands%rowtype;
begin
  if p_device_id is null or p_command_id is null or p_outcome not in ('acknowledged', 'rejected')
     or (p_result_code is not null and char_length(p_result_code) > 80)
     or (p_result_message is not null and char_length(p_result_message) > 500) then
    raise exception 'invalid_acknowledgement' using errcode = '22023';
  end if;

  select * into current_command
    from public.mt5_commands
   where id = p_command_id and device_id = p_device_id
   for update;
  if not found then
    raise exception 'command_not_found_for_device' using errcode = '42501';
  end if;

  if current_command.status in ('acknowledged', 'rejected') then
    if current_command.status <> p_outcome then
      raise exception 'conflicting_duplicate_acknowledgement' using errcode = '22023';
    end if;
    return current_command;
  end if;

  if current_command.status <> 'leased' or current_command.expires_at <= now() then
    raise exception 'command_not_leased_or_expired' using errcode = '22023';
  end if;

  update public.mt5_commands
     set status = p_outcome, acknowledged_at = now(), lease_until = null,
         result_code = p_result_code, result_message = p_result_message
   where id = p_command_id
   returning * into final_command;
  return final_command;
end;
$$;

revoke all on function public.mt5_pair_device(text, text, text) from public, anon, authenticated;
revoke all on function public.mt5_lease_next_command(uuid, integer) from public, anon, authenticated;
revoke all on function public.mt5_ack_command(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.mt5_pair_device(text, text, text) to service_role;
grant execute on function public.mt5_lease_next_command(uuid, integer) to service_role;
grant execute on function public.mt5_ack_command(uuid, uuid, text, text, text) to service_role;

comment on table public.mt5_devices is 'Server-only paired MT5 Expert Advisor devices; credential hashes only.';
comment on table public.mt5_pairing_codes is 'Server-only hashed, expiring, single-use MT5 pairing codes.';
comment on table public.mt5_commands is 'Durable MT5 market-selection command queue; commands never authorize order execution.';