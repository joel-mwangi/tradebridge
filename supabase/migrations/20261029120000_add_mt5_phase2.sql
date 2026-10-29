-- Phase 2: Pending orders (limit/stop), position commands (close/modify).
-- All changes are additive; the two already-pushed migrations are not touched.
-- New migration: 20261029120000_add_mt5_phase2.sql

-- ---------------------------------------------------------------------------
-- 1. Add order_type column to mt5_trade_orders
-- ---------------------------------------------------------------------------
ALTER TABLE public.mt5_trade_orders
  ADD COLUMN order_type text NOT NULL DEFAULT 'market'
    CHECK (order_type IN ('market','buy_limit','sell_limit','buy_stop','sell_stop'));

-- ---------------------------------------------------------------------------
-- 2. Add entry_price column to mt5_trade_orders
-- ---------------------------------------------------------------------------
ALTER TABLE public.mt5_trade_orders
  ADD COLUMN entry_price numeric
    CHECK (entry_price IS NULL OR entry_price > 0);

-- ---------------------------------------------------------------------------
-- 3. Add placed_at column to mt5_trade_orders
-- ---------------------------------------------------------------------------
ALTER TABLE public.mt5_trade_orders
  ADD COLUMN placed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 4. Add cancelled_pending_at column to mt5_trade_orders
-- ---------------------------------------------------------------------------
ALTER TABLE public.mt5_trade_orders
  ADD COLUMN cancelled_pending_at timestamptz;

-- ---------------------------------------------------------------------------
-- 5. Expand the status CHECK constraint to include 'placed' and
--    'cancelled_pending'.  Drop the old constraint by its known name and
--    add a replacement covering all values (existing + new).
-- ---------------------------------------------------------------------------
ALTER TABLE public.mt5_trade_orders
  DROP CONSTRAINT mt5_trade_orders_status_check;

ALTER TABLE public.mt5_trade_orders
  ADD CONSTRAINT mt5_trade_orders_status_check
    CHECK (status IN (
      'queued','leased','submitted','accepted','rejected',
      'filled','reconciled','expired','cancelled',
      'placed','cancelled_pending'
    ));

-- ---------------------------------------------------------------------------
-- 6. Replace mt5_ack_trade_order
--    Signature is re-ordered to match the Phase 2 API contract:
--      p_mt5_order_ticket, p_mt5_deal_ticket, p_fill_price, p_fill_volume,
--      p_mt5_retcode, p_mt5_retcode_description, p_reject_reason
--    New transitions added:
--      accepted         → placed           (pending order placed in broker book)
--      placed           → cancelled_pending (pending order cancelled)
--      placed           → filled           (async fill of a pending order)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mt5_ack_trade_order(
  p_device_id               uuid,
  p_order_id                uuid,
  p_lease_token             uuid,
  p_transition              text,
  p_mt5_order_ticket        bigint   DEFAULT NULL,
  p_mt5_deal_ticket         bigint   DEFAULT NULL,
  p_fill_price              numeric  DEFAULT NULL,
  p_fill_volume             numeric  DEFAULT NULL,
  p_mt5_retcode             integer  DEFAULT NULL,
  p_mt5_retcode_description text     DEFAULT NULL,
  p_reject_reason           text     DEFAULT NULL
)
RETURNS public.mt5_trade_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  o            public.mt5_trade_orders%rowtype;
  final_o      public.mt5_trade_orders%rowtype;
  now_ts       timestamptz := now();
  allowed_from text[];
BEGIN
  -- Basic input validation
  IF p_device_id IS NULL OR p_order_id IS NULL OR p_lease_token IS NULL
     OR p_transition IS NULL
     OR p_transition NOT IN (
       'submitted','accepted','rejected','filled','reconciled',
       'placed','cancelled_pending'
     )
     OR (p_mt5_retcode_description IS NOT NULL
         AND char_length(p_mt5_retcode_description) > 300)
     OR (p_reject_reason IS NOT NULL
         AND char_length(p_reject_reason) > 300) THEN
    RAISE EXCEPTION 'invalid_ack_input' USING errcode = '22023';
  END IF;

  SELECT * INTO o
    FROM public.mt5_trade_orders
   WHERE id = p_order_id AND device_id = p_device_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'trade_order_not_found_for_device' USING errcode = '42501';
  END IF;

  -- Token must match
  IF o.lease_token IS DISTINCT FROM p_lease_token THEN
    RAISE EXCEPTION 'invalid_lease_token' USING errcode = '42501';
  END IF;

  -- Idempotent: if already in the target status, return as-is.
  IF o.status = p_transition THEN
    RETURN o;
  END IF;

  -- Validate transition arcs
  CASE p_transition
    WHEN 'submitted'         THEN allowed_from := ARRAY['leased'];
    WHEN 'accepted'          THEN allowed_from := ARRAY['submitted'];
    WHEN 'rejected'          THEN allowed_from := ARRAY['leased','submitted'];
    WHEN 'filled'            THEN allowed_from := ARRAY['accepted','placed'];
    WHEN 'reconciled'        THEN allowed_from := ARRAY['accepted','submitted'];
    WHEN 'placed'            THEN allowed_from := ARRAY['accepted'];
    WHEN 'cancelled_pending' THEN allowed_from := ARRAY['placed'];
  END CASE;

  IF NOT (o.status = ANY(allowed_from)) THEN
    RAISE EXCEPTION 'invalid_status_transition: % -> %', o.status, p_transition
      USING errcode = '22023';
  END IF;

  -- Per-transition field requirements
  IF p_transition = 'filled'
     AND (p_fill_price IS NULL OR p_fill_volume IS NULL) THEN
    RAISE EXCEPTION 'fill_price_and_fill_volume_required_for_filled'
      USING errcode = '22023';
  END IF;
  IF p_transition = 'rejected' AND p_reject_reason IS NULL THEN
    RAISE EXCEPTION 'reject_reason_required_for_rejected'
      USING errcode = '22023';
  END IF;

  UPDATE public.mt5_trade_orders
     SET status                  = p_transition,
         mt5_order_ticket        = COALESCE(p_mt5_order_ticket, mt5_order_ticket),
         mt5_retcode             = COALESCE(p_mt5_retcode, mt5_retcode),
         mt5_retcode_description = COALESCE(p_mt5_retcode_description, mt5_retcode_description),
         reject_reason           = COALESCE(p_reject_reason, reject_reason),
         -- fill fields: set on 'filled' from either 'accepted' or 'placed'
         mt5_deal_ticket         = CASE
                                     WHEN p_transition = 'filled'
                                     THEN COALESCE(p_mt5_deal_ticket, mt5_deal_ticket)
                                     ELSE mt5_deal_ticket
                                   END,
         fill_price              = CASE
                                     WHEN p_transition = 'filled'
                                     THEN COALESCE(p_fill_price, fill_price)
                                     ELSE fill_price
                                   END,
         fill_volume             = CASE
                                     WHEN p_transition = 'filled'
                                     THEN COALESCE(p_fill_volume, fill_volume)
                                     ELSE fill_volume
                                   END,
         fill_time               = CASE
                                     WHEN p_transition = 'filled' THEN now_ts
                                     ELSE fill_time
                                   END,
         -- timestamps
         submitted_at            = CASE
                                     WHEN p_transition = 'submitted' AND submitted_at IS NULL
                                     THEN now_ts ELSE submitted_at
                                   END,
         accepted_at             = CASE
                                     WHEN p_transition = 'accepted' AND accepted_at IS NULL
                                     THEN now_ts ELSE accepted_at
                                   END,
         placed_at               = CASE
                                     WHEN p_transition = 'placed' AND placed_at IS NULL
                                     THEN now_ts ELSE placed_at
                                   END,
         filled_at               = CASE
                                     WHEN p_transition = 'filled' AND filled_at IS NULL
                                     THEN now_ts ELSE filled_at
                                   END,
         reconciled_at           = CASE
                                     WHEN p_transition = 'reconciled'
                                     THEN now_ts ELSE reconciled_at
                                   END,
         cancelled_pending_at    = CASE
                                     WHEN p_transition = 'cancelled_pending'
                                     THEN now_ts ELSE cancelled_pending_at
                                   END,
         -- Keep lease_token alive through non-terminal transitions so the EA
         -- can continue using the same token across multiple ack calls.
         -- Clear on terminal transitions only.
         lease_token             = CASE
                                     WHEN p_transition IN (
                                       'rejected','filled','reconciled','cancelled_pending'
                                     ) THEN NULL
                                     ELSE lease_token
                                   END,
         lease_until             = CASE
                                     WHEN p_transition IN (
                                       'rejected','filled','reconciled','cancelled_pending'
                                     ) THEN NULL
                                     ELSE lease_until
                                   END,
         updated_at              = now_ts
   WHERE id = p_order_id
   RETURNING * INTO final_o;

  RETURN final_o;
END;
$$;

REVOKE ALL ON FUNCTION public.mt5_ack_trade_order(
  uuid, uuid, uuid, text,
  bigint, bigint, numeric, numeric,
  integer, text, text)
  FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mt5_ack_trade_order(
  uuid, uuid, uuid, text,
  bigint, bigint, numeric, numeric,
  integer, text, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Table: mt5_position_commands
-- ---------------------------------------------------------------------------
CREATE TABLE public.mt5_position_commands (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id               uuid        NOT NULL,
  user_id                 uuid        NOT NULL REFERENCES auth.users(id),
  command_type            text        NOT NULL CHECK (command_type IN ('close','modify')),
  mt5_position_ticket     bigint      NOT NULL,
  volume                  numeric     CHECK (volume IS NULL OR volume > 0),
  new_stop_loss           numeric     CHECK (new_stop_loss IS NULL OR new_stop_loss > 0),
  new_take_profit         numeric     CHECK (new_take_profit IS NULL OR new_take_profit > 0),
  account_type            text        NOT NULL CHECK (account_type IN ('demo','real')),
  idempotency_key         text,
  expires_at              timestamptz,
  status                  text        NOT NULL DEFAULT 'queued'
                            CHECK (status IN (
                              'queued','leased','submitted','done',
                              'rejected','expired','cancelled'
                            )),
  lease_token             uuid,
  lease_until             timestamptz,
  leased_at               timestamptz,
  submitted_at            timestamptz,
  done_at                 timestamptz,
  cancelled_at            timestamptz,
  expired_at              timestamptz,
  mt5_retcode             integer,
  mt5_retcode_description text        CHECK (mt5_retcode_description IS NULL
                                        OR length(mt5_retcode_description) <= 300),
  reject_reason           text        CHECK (reject_reason IS NULL
                                        OR length(reject_reason) <= 300),
  requested_at            timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (device_id, user_id)
    REFERENCES public.mt5_devices(id, user_id),
  UNIQUE (device_id, idempotency_key)
);

ALTER TABLE public.mt5_position_commands ENABLE ROW LEVEL SECURITY;

CREATE INDEX mt5_position_commands_device_idx
  ON public.mt5_position_commands (device_id, requested_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.mt5_position_commands TO service_role;

-- ---------------------------------------------------------------------------
-- 8. Function: mt5_lease_next_position_command
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mt5_lease_next_position_command(
  p_device_id     uuid,
  p_lease_seconds integer DEFAULT 30
)
RETURNS SETOF public.mt5_position_commands
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now timestamptz := now();
  v_cmd public.mt5_position_commands;
BEGIN
  SELECT * INTO v_cmd
  FROM public.mt5_position_commands
  WHERE device_id = p_device_id
    AND status = 'queued'
    AND (expires_at IS NULL OR expires_at > v_now)
  ORDER BY requested_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.mt5_position_commands SET
    status      = 'leased',
    lease_token = gen_random_uuid(),
    lease_until = v_now + (p_lease_seconds || ' seconds')::interval,
    leased_at   = v_now,
    updated_at  = v_now
  WHERE id = v_cmd.id
  RETURNING * INTO v_cmd;

  RETURN NEXT v_cmd;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mt5_lease_next_position_command(uuid, integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 9. Function: mt5_ack_position_command
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mt5_ack_position_command(
  p_device_id               uuid,
  p_cmd_id                  uuid,
  p_lease_token             uuid,
  p_transition              text,
  p_mt5_retcode             integer DEFAULT NULL,
  p_mt5_retcode_description text    DEFAULT NULL,
  p_reject_reason           text    DEFAULT NULL
)
RETURNS SETOF public.mt5_position_commands
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cmd  public.mt5_position_commands;
  v_now  timestamptz := now();
BEGIN
  SELECT * INTO v_cmd
  FROM public.mt5_position_commands
  WHERE id = p_cmd_id
    AND device_id = p_device_id
    AND lease_token = p_lease_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'position command not found or lease_token mismatch';
  END IF;

  IF p_transition = 'submitted' THEN
    IF v_cmd.status NOT IN ('leased') THEN
      RAISE EXCEPTION 'invalid transition submitted from %', v_cmd.status;
    END IF;
    UPDATE public.mt5_position_commands
       SET status                  = 'submitted',
           submitted_at            = v_now,
           updated_at              = v_now,
           mt5_retcode             = COALESCE(p_mt5_retcode, mt5_retcode),
           mt5_retcode_description = COALESCE(p_mt5_retcode_description, mt5_retcode_description)
     WHERE id = p_cmd_id
     RETURNING * INTO v_cmd;

  ELSIF p_transition = 'done' THEN
    IF v_cmd.status NOT IN ('submitted') THEN
      RAISE EXCEPTION 'invalid transition done from %', v_cmd.status;
    END IF;
    UPDATE public.mt5_position_commands
       SET status                  = 'done',
           done_at                 = v_now,
           updated_at              = v_now,
           mt5_retcode             = COALESCE(p_mt5_retcode, mt5_retcode),
           mt5_retcode_description = COALESCE(p_mt5_retcode_description, mt5_retcode_description)
     WHERE id = p_cmd_id
     RETURNING * INTO v_cmd;

  ELSIF p_transition = 'rejected' THEN
    IF v_cmd.status NOT IN ('leased','submitted') THEN
      RAISE EXCEPTION 'invalid transition rejected from %', v_cmd.status;
    END IF;
    UPDATE public.mt5_position_commands
       SET status                  = 'rejected',
           updated_at              = v_now,
           mt5_retcode             = COALESCE(p_mt5_retcode, mt5_retcode),
           mt5_retcode_description = COALESCE(p_mt5_retcode_description, mt5_retcode_description),
           reject_reason           = COALESCE(p_reject_reason, reject_reason)
     WHERE id = p_cmd_id
     RETURNING * INTO v_cmd;

  ELSE
    RAISE EXCEPTION 'unknown transition %', p_transition;
  END IF;

  RETURN NEXT v_cmd;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mt5_ack_position_command(uuid, uuid, uuid, text, integer, text, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 10. Function: mt5_cancel_position_command
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mt5_cancel_position_command(
  p_user_id uuid,
  p_cmd_id  uuid
)
RETURNS SETOF public.mt5_position_commands
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cmd public.mt5_position_commands;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_cmd
  FROM public.mt5_position_commands
  WHERE id = p_cmd_id
    AND user_id = p_user_id
    AND status = 'queued'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'position command not found or not cancellable';
  END IF;

  UPDATE public.mt5_position_commands
     SET status       = 'cancelled',
         cancelled_at = v_now,
         updated_at   = v_now
   WHERE id = p_cmd_id
   RETURNING * INTO v_cmd;

  RETURN NEXT v_cmd;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mt5_cancel_position_command(uuid, uuid)
  TO service_role;
