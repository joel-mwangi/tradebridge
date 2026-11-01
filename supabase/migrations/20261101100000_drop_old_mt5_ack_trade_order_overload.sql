-- Drop the Phase 1 overload of mt5_ack_trade_order that was superseded by the
-- Phase 2 migration (20261029120000_add_mt5_phase2.sql).
--
-- The Phase 2 migration used CREATE OR REPLACE with a reordered parameter list,
-- which in PostgreSQL creates a NEW overload rather than replacing the original.
-- PostgREST resolves RPC calls by name; two overloads with the same name and
-- overlapping named parameters cause an HTTP 300 ambiguous-function response,
-- which the FastAPI _rpc() helper surfaces as HTTP 503 to the EA.
--
-- The old signature is:
--   mt5_ack_trade_order(uuid, uuid, uuid, text,
--                       bigint,  -- p_mt5_order_ticket
--                       integer, -- p_mt5_retcode
--                       text,    -- p_mt5_retcode_description
--                       text,    -- p_reject_reason
--                       bigint,  -- p_mt5_deal_ticket
--                       numeric, -- p_fill_price
--                       numeric) -- p_fill_volume
--
-- The Phase 2 (current) signature is:
--   mt5_ack_trade_order(uuid, uuid, uuid, text,
--                       bigint,  -- p_mt5_order_ticket
--                       bigint,  -- p_mt5_deal_ticket
--                       numeric, -- p_fill_price
--                       numeric, -- p_fill_volume
--                       integer, -- p_mt5_retcode
--                       text,    -- p_mt5_retcode_description
--                       text)    -- p_reject_reason

DROP FUNCTION IF EXISTS public.mt5_ack_trade_order(
  uuid, uuid, uuid, text,
  bigint,  -- p_mt5_order_ticket
  integer, -- p_mt5_retcode
  text,    -- p_mt5_retcode_description
  text,    -- p_reject_reason
  bigint,  -- p_mt5_deal_ticket
  numeric, -- p_fill_price
  numeric  -- p_fill_volume
);
