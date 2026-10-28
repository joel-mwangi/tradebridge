-- Bind every MT5 command lease to a unique token.
-- A timestamp check alone cannot distinguish an old worker after a command is re-leased.
-- This is a forward-only migration; do not edit already-applied migrations.

alter table public.mt5_commands
  add column if not exists lease_token uuid;

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
     set status = 'expired', lease_until = null, lease_token = null
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
     set status = 'leased',
         lease_until = now() + make_interval(secs => p_lease_seconds),
         lease_token = gen_random_uuid()
   where id = selected.id
   returning * into selected;

  return next selected;
end;
$$;

-- Remove the old RPC signature so callers cannot bypass lease-token validation.
drop function public.mt5_ack_command(uuid, uuid, text, text, text);

create function public.mt5_ack_command(
  p_device_id uuid,
  p_command_id uuid,
  p_lease_token uuid,
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
  if p_device_id is null or p_command_id is null or p_lease_token is null
     or p_outcome is null or p_outcome not in ('acknowledged', 'rejected')
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

  -- Idempotent retries are allowed only for the same lease and same final outcome.
  if current_command.status in ('acknowledged', 'rejected') then
    if current_command.status <> p_outcome
       or current_command.lease_token is distinct from p_lease_token then
      raise exception 'conflicting_duplicate_acknowledgement' using errcode = '22023';
    end if;
    return current_command;
  end if;

  if current_command.status <> 'leased'
     or current_command.lease_token is distinct from p_lease_token
     or current_command.expires_at <= now()
     or current_command.lease_until is null
     or current_command.lease_until <= now() then
    raise exception 'command_not_leased_or_expired' using errcode = '22023';
  end if;

  update public.mt5_commands
     set status = p_outcome,
         acknowledged_at = now(),
         lease_until = null,
         result_code = p_result_code,
         result_message = p_result_message
   where id = p_command_id
   returning * into final_command;

  return final_command;
end;
$$;

revoke all on function public.mt5_lease_next_command(uuid, integer) from public, anon, authenticated;
grant execute on function public.mt5_lease_next_command(uuid, integer) to service_role;
revoke all on function public.mt5_ack_command(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.mt5_ack_command(uuid, uuid, uuid, text, text, text) to service_role;
