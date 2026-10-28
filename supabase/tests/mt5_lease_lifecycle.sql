-- Manual integration test for MT5 lease-token lifecycle.
-- SAFETY: run this entire file as ONE execution in a non-production Supabase project.
-- It inserts fixture rows inside one transaction and explicitly rolls the transaction back.
-- Do not select/run only part of this script. It requires at least one existing auth.users row.
-- It does not place trades or modify existing device/command rows.

BEGIN;

DO $test$
DECLARE
  v_user_id uuid;
  v_device_valid uuid;
  v_device_expired uuid;
  v_device_released uuid;
  v_command_id uuid;
  v_first record;
  v_second record;
  v_ack record;
  v_expected_rejection boolean;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at DESC LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'MT5 lease lifecycle test requires at least one auth.users row';
  END IF;

  -- Scenario 1: a valid acknowledgement succeeds and the same acknowledgement is idempotent.
  INSERT INTO public.mt5_devices (user_id, device_name, credential_hash, status)
  VALUES (v_user_id, 'lease-test-valid-' || gen_random_uuid()::text, encode(gen_random_bytes(32), 'hex'), 'paired')
  RETURNING id INTO v_device_valid;

  INSERT INTO public.mt5_commands (device_id, user_id, provider_symbol, idempotency_key, expires_at)
  VALUES (v_device_valid, v_user_id, 'EURUSD', 'valid-' || gen_random_uuid()::text, now() + interval '1 hour')
  RETURNING id INTO v_command_id;

  SELECT * INTO v_first FROM public.mt5_lease_next_command(v_device_valid, 20);
  IF v_first.id IS DISTINCT FROM v_command_id OR v_first.lease_token IS NULL THEN
    RAISE EXCEPTION 'FAIL: valid scenario did not lease the expected command with a token';
  END IF;

  SELECT * INTO v_ack FROM public.mt5_ack_command(
    v_device_valid, v_command_id, v_first.lease_token, 'acknowledged', 'TEST_OK', 'valid acknowledgement'
  );
  IF v_ack.status <> 'acknowledged' THEN
    RAISE EXCEPTION 'FAIL: valid acknowledgement returned status %', v_ack.status;
  END IF;

  SELECT * INTO v_ack FROM public.mt5_ack_command(
    v_device_valid, v_command_id, v_first.lease_token, 'acknowledged', 'TEST_OK', 'valid acknowledgement'
  );
  IF v_ack.status <> 'acknowledged' THEN
    RAISE EXCEPTION 'FAIL: duplicate acknowledgement was not idempotent';
  END IF;

  -- Scenario 2: an expired lease cannot be acknowledged.
  INSERT INTO public.mt5_devices (user_id, device_name, credential_hash, status)
  VALUES (v_user_id, 'lease-test-expired-' || gen_random_uuid()::text, encode(gen_random_bytes(32), 'hex'), 'paired')
  RETURNING id INTO v_device_expired;

  INSERT INTO public.mt5_commands (device_id, user_id, provider_symbol, idempotency_key, expires_at)
  VALUES (v_device_expired, v_user_id, 'GBPUSD', 'expired-' || gen_random_uuid()::text, now() + interval '1 hour')
  RETURNING id INTO v_command_id;

  SELECT * INTO v_first FROM public.mt5_lease_next_command(v_device_expired, 20);
  UPDATE public.mt5_commands
     SET lease_until = now() - interval '1 second'
   WHERE id = v_command_id;

  v_expected_rejection := false;
  BEGIN
    PERFORM public.mt5_ack_command(
      v_device_expired, v_command_id, v_first.lease_token, 'acknowledged', 'SHOULD_FAIL', 'expired lease'
    );
  EXCEPTION
    WHEN SQLSTATE '22023' THEN v_expected_rejection := true;
  END;
  IF NOT v_expected_rejection THEN
    RAISE EXCEPTION 'FAIL: acknowledgement with an expired lease was accepted';
  END IF;

  -- Scenario 3: re-leasing rotates the token; old token fails, new token succeeds.
  INSERT INTO public.mt5_devices (user_id, device_name, credential_hash, status)
  VALUES (v_user_id, 'lease-test-released-' || gen_random_uuid()::text, encode(gen_random_bytes(32), 'hex'), 'paired')
  RETURNING id INTO v_device_released;

  INSERT INTO public.mt5_commands (device_id, user_id, provider_symbol, idempotency_key, expires_at)
  VALUES (v_device_released, v_user_id, 'USDJPY', 'releas-' || gen_random_uuid()::text, now() + interval '1 hour')
  RETURNING id INTO v_command_id;

  SELECT * INTO v_first FROM public.mt5_lease_next_command(v_device_released, 20);
  UPDATE public.mt5_commands
     SET lease_until = now() - interval '1 second'
   WHERE id = v_command_id;

  SELECT * INTO v_second FROM public.mt5_lease_next_command(v_device_released, 20);
  IF v_second.id IS DISTINCT FROM v_command_id
     OR v_second.lease_token IS NULL
     OR v_second.lease_token = v_first.lease_token THEN
    RAISE EXCEPTION 'FAIL: re-lease did not issue a fresh token';
  END IF;

  v_expected_rejection := false;
  BEGIN
    PERFORM public.mt5_ack_command(
      v_device_released, v_command_id, v_first.lease_token, 'acknowledged', 'STALE_TOKEN', 'must be rejected'
    );
  EXCEPTION
    WHEN SQLSTATE '22023' THEN v_expected_rejection := true;
  END;
  IF NOT v_expected_rejection THEN
    RAISE EXCEPTION 'FAIL: stale token was accepted after re-leasing';
  END IF;

  SELECT * INTO v_ack FROM public.mt5_ack_command(
    v_device_released, v_command_id, v_second.lease_token, 'acknowledged', 'TEST_OK', 'fresh lease token'
  );
  IF v_ack.status <> 'acknowledged' THEN
    RAISE EXCEPTION 'FAIL: acknowledgement with the fresh token did not succeed';
  END IF;

  RAISE NOTICE 'PASS: valid acknowledgement';
  RAISE NOTICE 'PASS: idempotent duplicate acknowledgement';
  RAISE NOTICE 'PASS: expired lease rejected';
  RAISE NOTICE 'PASS: re-lease rotates token';
  RAISE NOTICE 'PASS: stale token rejected';
  RAISE NOTICE 'PASS: fresh token accepted';
END;
$test$;

-- Intentionally discard all fixture rows created by this test.
ROLLBACK;
