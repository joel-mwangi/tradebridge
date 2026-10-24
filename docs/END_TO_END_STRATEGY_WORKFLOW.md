# End-to-end strategy workflow contract

This is the integration checklist for the frontend strategy panel and the FastAPI strategy feed. It does not claim a live Deriv end-to-end test has passed.

## Run configuration
- A run is bound to symbol, direction, barrier, and windowSize.
- Changing any of these invalidates the current observation and disarms pending automatic execution.
- The frontend must reject a signal unless backend status matches all four settings, requested_direction and selected_group agree, and signal_generated is exactly true. This is enforced by strategy-signal-contract.mjs.
- Over barriers are valid only for 0–8; Under barriers only for 1–9.

## Signal and execution
- One fresh Run arms at most one signal consumer.
- One accepted signal may initiate at most three sequential Demo buys.
- Each buy must resolve only after authoritative Deriv settlement; no next buy while a previous order is unsettled.
- Two consecutive settled losses stop the sequence; a win or breakeven resets the loss streak.
- Rejected, timed-out, duplicate, or unknown outcomes halt for reconciliation. Never retry automatically.
- Real-account automatic strategy execution remains disabled.

## Required release checks
1. Run npm test and npm run lint.
2. Confirm the frontend build succeeds against the deployed FastAPI WebSocket contract.
3. On a Deriv Demo account, verify a selected configuration from Run through one confirmed signal, buy, settlement, recorded result, and stop behavior.
4. Exercise two-loss stop, market/direction/barrier/window mismatch, disconnect, timeout, duplicate signal, and refresh/reconciliation paths.
5. Do not mark the workflow complete until the actual Demo-provider test and deployed integration checks have passed.
