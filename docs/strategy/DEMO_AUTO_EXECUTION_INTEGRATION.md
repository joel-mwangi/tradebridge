# Demo strategy auto-execution

The user's latest explicit strategy discussion is authoritative. See [STRATEGY_SOURCE_OF_TRUTH.md](../STRATEGY_SOURCE_OF_TRUTH.md). This document must not override it.

## Required behavior

- The user selects Over or Under and a barrier, then clicks Run. Run starts a fresh strategy session and arms demo execution when a verified Demo account and the execution callback are available.
- A market qualification is not an entry signal. The coordinator may buy only when the backend reports `signal_generated: true` for the user's selected direction, market, and barrier after all filters and the post-trigger digit sequence have passed.
- One confirmed signal starts one sequence of up to three sequential 1-tick demo buys. Wait for each contract's authoritative settlement and reconciliation before the next buy.
- Stop immediately after two consecutive settled losses. Never submit the third buy after two consecutive losses. A win or breakeven resets the consecutive-loss count.
- After three buys or the two-loss stop, stop the strategy session. Do not automatically restart; require the user to click Run again.
- An unknown/unreconciled outcome blocks further buys and requires reconciliation. Never automatically retry an order with an unknown outcome.
- Real-account auto-execution remains disabled.

## EVEN/ODD automatic execution

The strategy panel supports `DIGITEVEN` and `DIGITODD` in addition to Over/Under.
Even/Odd start and proposal messages omit `barrier`; the frontend must never send a
placeholder barrier such as `0`.

EVEN/ODD uses an independent Maziwa/Dollar Printer state machine, not the OVER/UNDER
qualification pipeline. It uses a rolling 1,000-tick window and waits for the full
window before evaluating. Before a trigger is armed, the selected parity must have at
least 52% power and be rising versus ten ticks earlier; rank 1 Green must be at least
11.0%, rank 2 Blue at least 10.7%, both on the selected parity, and ranks 9 Yellow and
10 Red on the opposing parity with Red at most 9.1%. Equal ranks use most-recent
occurrence as the tie-break. It then requires at least three consecutive opposing ticks
followed immediately by the first selected-parity confirmation tick. Red Reverse is excluded.

The confirmed setup uses the existing one-sequence execution coordinator: fixed stake,
up to three 1-tick buys, stop after two consecutive losses, 180-tick cooldown after
completion or two losses, and no automatic restart during cooldown. Reconnect replay
preserves the contract type and continues to omit the barrier for EVEN/ODD.

## Operational safeguards

- Stake is configurable in the panel (minimum 1, maximum 1000 account-currency units).
- The coordinator uses the authenticated backend Deriv WebSocket session through the existing trading hook.
- Stop is cooperative: it prevents subsequent buys after the current contract settles; it does not force-sell an active contract.
- Frequency and signal rules are observations, not a guarantee of profitability.

## Verification required

Run `npm test`, `npm run lint`, and `npm run build` before merging. Verify that qualification alone does not execute; only a completed entry signal starts a sequence; direction and barrier match the user's selection; settlement is sequential; two consecutive losses stop the sequence; three buys complete the sequence; and a new Run is required afterward.
