-- Fix: mt5_lease_next_trade_order had duplicate `status` column assignment in
-- the cleanup UPDATE, which PostgreSQL rejects with a 400 error.
-- The two CASE expressions are merged into one here.
-- This is a forward-only replacement; do not edit after pushing.

create or replace function public.mt5_lease_next_trade_order(
  p_device_id    uuid,
  p_lease_seconds integer default 30
)
returns setof public.mt5_trade_orders
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  selected public.mt5_trade_orders%rowtype;
  now_ts   timestamptz := now();
begin
  if p_device_id is null or p_lease_seconds not between 5 and 120 then
    raise exception 'invalid_lease_request' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.mt5_devices d
     where d.id = p_device_id and d.status = 'paired'
  ) then
    raise exception 'device_not_paired' using errcode = '42501';
  end if;

  -- Expire stale orders and reclaim stale leases in one UPDATE.
  -- status is set once: expired orders become 'expired'; stale leases return to 'queued'.
  update public.mt5_trade_orders
     set status      = case
                         when expires_at <= now_ts                              then 'expired'
                         when status = 'leased' and lease_until <= now_ts       then 'queued'
                         else status
                       end,
         expired_at  = case
                         when expires_at <= now_ts and expired_at is null then now_ts
                         else expired_at
                       end,
         lease_until = case
                         when expires_at <= now_ts                        then null
                         when status = 'leased' and lease_until <= now_ts then null
                         else lease_until
                       end,
         lease_token = case
                         when expires_at <= now_ts                        then null
                         when status = 'leased' and lease_until <= now_ts then null
                         else lease_token
                       end,
         updated_at  = now_ts
   where device_id = p_device_id
     and status in ('queued', 'leased')
     and (expires_at <= now_ts
          or (status = 'leased' and lease_until <= now_ts));

  -- Pick the oldest eligible queued order.
  select * into selected
    from public.mt5_trade_orders o
   where o.device_id = p_device_id
     and o.status = 'queued'
     and o.expires_at > now_ts
   order by o.requested_at, o.id
   for update skip locked
   limit 1;

  if not found then
    return;
  end if;

  update public.mt5_trade_orders
     set status      = 'leased',
         lease_token = gen_random_uuid(),
         lease_until = now_ts + make_interval(secs => p_lease_seconds),
         leased_at   = now_ts,
         updated_at  = now_ts
   where id = selected.id
   returning * into selected;

  return next selected;
end;
$$;

revoke all on function public.mt5_lease_next_trade_order(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.mt5_lease_next_trade_order(uuid, integer) to service_role;
