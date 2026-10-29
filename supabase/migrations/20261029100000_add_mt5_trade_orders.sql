-- MT5 Phase 1: Market-order execution with full audit trail.
-- Deliberately separate from mt5_commands (market selection) so the two
-- concerns never share a table, a function, or a database constraint.
-- All columns use snake_case to match the existing mt5_commands convention.
-- service_role only; no browser access is granted.

-- ---------------------------------------------------------------------------
-- Table: mt5_trade_orders
-- ---------------------------------------------------------------------------
create table if not exists public.mt5_trade_orders (
  id                 uuid        primary key default gen_random_uuid(),
  device_id          uuid        not null,
  user_id            uuid        not null references auth.users(id) on delete cascade,

  -- Order parameters (set at creation, never mutated)
  broker_symbol      text        not null check (broker_symbol ~ '^[A-Za-z0-9_\\.]{2,40}$'),
  order_side         text        not null check (order_side in ('buy', 'sell')),
  volume             numeric     not null check (volume > 0),
  stop_loss          numeric     check (stop_loss is null or stop_loss > 0),
  take_profit        numeric     check (take_profit is null or take_profit > 0),
  -- Maximum acceptable deviation/slippage in points; null = broker default
  deviation_points   integer     check (deviation_points is null or deviation_points >= 0),
  -- Optional caller-assigned magic number for EA filtering
  magic_number       integer     not null default 0 check (magic_number >= 0),
  -- Demo or real account designation. The EA must honour this.
  account_type       text        not null check (account_type in ('demo', 'real')),
  idempotency_key    text        not null check (char_length(idempotency_key) between 8 and 128),
  expires_at         timestamptz not null,

  -- Lifecycle status
  -- queued     → order created; not yet picked up by the EA
  -- leased     → EA has taken the order and is processing it
  -- submitted  → EA called OrderSend; awaiting broker response
  -- accepted   → broker accepted the order (ticket assigned); may not yet be filled
  -- rejected   → broker or EA rejected; no position opened
  -- filled     → position opened and confirmed by the EA
  -- reconciled → status resolved after a timeout + MT5 position query
  -- expired    → lease or order TTL elapsed without completion
  -- cancelled  → cancelled by the user before EA pickup
  status             text        not null default 'queued'
                     check (status in ('queued','leased','submitted','accepted',
                                       'rejected','filled','reconciled','expired','cancelled')),

  -- Lease management (same token-based approach as mt5_commands)
  lease_token        uuid,
  lease_until        timestamptz,
  leased_at          timestamptz,

  -- EA progress fields (set during ack)
  submitted_at       timestamptz,
  -- Broker-assigned order ticket (set when accepted/submitted)
  mt5_order_ticket   bigint,
  -- Broker-assigned deal ticket (set when filled)
  mt5_deal_ticket    bigint,
  fill_price         numeric,
  fill_volume        numeric,
  fill_time          timestamptz,
  -- Raw MT5 return code from OrderSend (always stored, even on success)
  mt5_retcode        integer,
  -- Human-readable broker return message
  mt5_retcode_description text    check (mt5_retcode_description is null
                                   or char_length(mt5_retcode_description) <= 300),

  -- Rejection / reconciliation detail
  reject_reason      text        check (reject_reason is null
                                   or char_length(reject_reason) <= 300),

  -- Timestamps
  requested_at       timestamptz not null default now(),
  accepted_at        timestamptz,
  filled_at          timestamptz,
  cancelled_at       timestamptz,
  reconciled_at      timestamptz,
  expired_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- Referential integrity: device must belong to the same user
  constraint mt5_trade_orders_device_owner_fk
    foreign key (device_id, user_id)
    references public.mt5_devices(id, user_id) on delete cascade,

  -- Hard uniqueness: same device, same idempotency key → same row
  constraint mt5_trade_orders_idempotency_unique
    unique (device_id, idempotency_key),

  constraint mt5_trade_orders_expiry_check
    check (expires_at > requested_at)
);

create index if not exists mt5_trade_orders_device_queue_idx
  on public.mt5_trade_orders (device_id, status, requested_at);

create index if not exists mt5_trade_orders_user_idx
  on public.mt5_trade_orders (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS: table is service_role only
-- ---------------------------------------------------------------------------
alter table public.mt5_trade_orders enable row level security;
revoke all on table public.mt5_trade_orders from public, anon, authenticated;
grant all on table public.mt5_trade_orders to service_role;

-- ---------------------------------------------------------------------------
-- Function: mt5_lease_next_trade_order
-- Atomically lease one queued trade order for the authenticated EA device.
-- Re-leases an order whose previous lease expired without an ack.
-- Never returns an expired order.
-- ---------------------------------------------------------------------------
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

  -- Expire stale orders and reclaim stale leases atomically.
  update public.mt5_trade_orders
     set status      = case
                         when expires_at <= now_ts then 'expired'
                         else status
                       end,
         expired_at  = case
                         when expires_at <= now_ts and expired_at is null then now_ts
                         else expired_at
                       end,
         lease_until = case
                         when expires_at <= now_ts then null
                         when status = 'leased' and lease_until <= now_ts then null
                         else lease_until
                       end,
         lease_token = case
                         when expires_at <= now_ts then null
                         when status = 'leased' and lease_until <= now_ts then null
                         else lease_token
                       end,
         status      = case
                         when status = 'leased' and lease_until <= now_ts
                              and expires_at > now_ts then 'queued'
                         else status
                       end,
         updated_at  = now_ts
   where device_id = p_device_id
     and status in ('queued', 'leased')
     and (expires_at <= now_ts
          or (status = 'leased' and lease_until <= now_ts));

  -- Pick the oldest eligible order.
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

-- ---------------------------------------------------------------------------
-- Function: mt5_ack_trade_order
-- EA uses this to advance the order through its lifecycle.
-- Allowed transitions (enforced here):
--   leased     → submitted  (OrderSend called; ticket assigned or not yet)
--   submitted  → accepted   (broker accepted; ticket known)
--   submitted  → rejected   (broker rejected; retcode + reason required)
--   accepted   → filled     (deal confirmed; fill_price + fill_volume required)
--   accepted   → reconciled (position query resolved an uncertain accepted order)
--   leased     → rejected   (EA-side rejection before OrderSend)
-- Any other transition raises an exception.
-- ---------------------------------------------------------------------------
create or replace function public.mt5_ack_trade_order(
  p_device_id              uuid,
  p_order_id               uuid,
  p_lease_token            uuid,
  p_transition             text,    -- 'submitted'|'accepted'|'rejected'|'filled'|'reconciled'
  -- submitted / accepted
  p_mt5_order_ticket       bigint   default null,
  p_mt5_retcode            integer  default null,
  p_mt5_retcode_description text    default null,
  -- rejected
  p_reject_reason          text     default null,
  -- filled / reconciled
  p_mt5_deal_ticket        bigint   default null,
  p_fill_price             numeric  default null,
  p_fill_volume            numeric  default null
)
returns public.mt5_trade_orders
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  o           public.mt5_trade_orders%rowtype;
  final_o     public.mt5_trade_orders%rowtype;
  now_ts      timestamptz := now();
  allowed_from text[];
begin
  -- Basic input validation
  if p_device_id is null or p_order_id is null or p_lease_token is null
     or p_transition is null
     or p_transition not in ('submitted','accepted','rejected','filled','reconciled')
     or (p_mt5_retcode_description is not null
         and char_length(p_mt5_retcode_description) > 300)
     or (p_reject_reason is not null
         and char_length(p_reject_reason) > 300) then
    raise exception 'invalid_ack_input' using errcode = '22023';
  end if;

  select * into o
    from public.mt5_trade_orders
   where id = p_order_id and device_id = p_device_id
   for update;
  if not found then
    raise exception 'trade_order_not_found_for_device' using errcode = '42501';
  end if;

  -- Token must match
  if o.lease_token is distinct from p_lease_token then
    raise exception 'invalid_lease_token' using errcode = '42501';
  end if;

  -- Idempotent: if already in the target status with the same token, return as-is.
  if o.status = p_transition then
    return o;
  end if;

  -- Validate transition
  case p_transition
    when 'submitted'   then allowed_from := array['leased'];
    when 'accepted'    then allowed_from := array['submitted'];
    when 'rejected'    then allowed_from := array['leased','submitted'];
    when 'filled'      then allowed_from := array['accepted'];
    when 'reconciled'  then allowed_from := array['accepted','submitted'];
  end case;

  if not (o.status = any(allowed_from)) then
    raise exception 'invalid_status_transition: % -> %', o.status, p_transition
      using errcode = '22023';
  end if;

  -- Per-transition field requirements
  if p_transition = 'filled' and (p_fill_price is null or p_fill_volume is null) then
    raise exception 'fill_price_and_fill_volume_required_for_filled' using errcode = '22023';
  end if;
  if p_transition = 'rejected' and p_reject_reason is null then
    raise exception 'reject_reason_required_for_rejected' using errcode = '22023';
  end if;

  update public.mt5_trade_orders
     set status                   = p_transition,
         mt5_order_ticket         = coalesce(p_mt5_order_ticket, mt5_order_ticket),
         mt5_retcode              = coalesce(p_mt5_retcode, mt5_retcode),
         mt5_retcode_description  = coalesce(p_mt5_retcode_description, mt5_retcode_description),
         reject_reason            = coalesce(p_reject_reason, reject_reason),
         mt5_deal_ticket          = coalesce(p_mt5_deal_ticket, mt5_deal_ticket),
         fill_price               = coalesce(p_fill_price, fill_price),
         fill_volume              = coalesce(p_fill_volume, fill_volume),
         fill_time                = case when p_transition = 'filled' then now_ts else fill_time end,
         submitted_at             = case when p_transition = 'submitted' and submitted_at is null
                                         then now_ts else submitted_at end,
         accepted_at              = case when p_transition = 'accepted' and accepted_at is null
                                         then now_ts else accepted_at end,
         filled_at                = case when p_transition = 'filled' and filled_at is null
                                         then now_ts else filled_at end,
         reconciled_at            = case when p_transition = 'reconciled'
                                         then now_ts else reconciled_at end,
         -- Keep lease_token alive through submitted→accepted so the EA can
         -- continue to use the same token across multiple ack calls for one order.
         -- Clear it only on terminal transitions.
         lease_token              = case when p_transition in ('rejected','filled','reconciled')
                                         then null else lease_token end,
         lease_until              = case when p_transition in ('rejected','filled','reconciled')
                                         then null else lease_until end,
         updated_at               = now_ts
   where id = p_order_id
   returning * into final_o;

  return final_o;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function: mt5_cancel_trade_order
-- User-initiated cancellation; only valid while status = 'queued'.
-- ---------------------------------------------------------------------------
create or replace function public.mt5_cancel_trade_order(
  p_user_id  uuid,
  p_order_id uuid
)
returns public.mt5_trade_orders
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  o       public.mt5_trade_orders%rowtype;
  final_o public.mt5_trade_orders%rowtype;
begin
  if p_user_id is null or p_order_id is null then
    raise exception 'invalid_cancel_input' using errcode = '22023';
  end if;

  select * into o
    from public.mt5_trade_orders
   where id = p_order_id and user_id = p_user_id
   for update;
  if not found then
    raise exception 'trade_order_not_found_for_user' using errcode = '42501';
  end if;

  if o.status <> 'queued' then
    raise exception 'trade_order_not_cancellable: status is %', o.status
      using errcode = '22023';
  end if;

  update public.mt5_trade_orders
     set status       = 'cancelled',
         cancelled_at = now(),
         updated_at   = now()
   where id = p_order_id
   returning * into final_o;

  return final_o;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
revoke all on function public.mt5_lease_next_trade_order(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.mt5_ack_trade_order(
  uuid, uuid, uuid, text, bigint, integer, text, text, bigint, numeric, numeric)
  from public, anon, authenticated;
revoke all on function public.mt5_cancel_trade_order(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.mt5_lease_next_trade_order(uuid, integer) to service_role;
grant execute on function public.mt5_ack_trade_order(
  uuid, uuid, uuid, text, bigint, integer, text, text, bigint, numeric, numeric) to service_role;
grant execute on function public.mt5_cancel_trade_order(uuid, uuid) to service_role;

comment on table public.mt5_trade_orders is
  'Phase 1 MT5 market-order execution queue with full audit trail. Separate from mt5_commands (market selection).';
