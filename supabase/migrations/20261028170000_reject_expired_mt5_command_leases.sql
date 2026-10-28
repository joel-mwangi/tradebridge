-- Reject MT5 command acknowledgements from expired leases.
-- Keep this as a forward-only migration; do not edit the already-applied migration.

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
  if p_device_id is null or p_command_id is null or p_outcome is null
     or p_outcome not in ('acknowledged', 'rejected')
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

  -- A repeated acknowledgement of the same terminal outcome remains idempotent.
  if current_command.status in ('acknowledged', 'rejected') then
    if current_command.status <> p_outcome then
      raise exception 'conflicting_duplicate_acknowledgement' using errcode = '22023';
    end if;
    return current_command;
  end if;

  -- Only the current, unexpired lease holder may finalize this command.
  -- A command may be re-leased after lease_until; an old EA must not win a race.
  if current_command.status <> 'leased'
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

revoke all on function public.mt5_ack_command(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.mt5_ack_command(uuid, uuid, text, text, text) to service_role;
