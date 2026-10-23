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

## Operational safeguards

- Stake is configurable in the panel (minimum 1, maximum 1000 account-currency units).
- The coordinator uses the authenticated backend Deriv WebSocket session through the existing trading hook.
- Stop is cooperative: it prevents subsequent buys after the current contract settles; it does not force-sell an active contract.
- Frequency and signal rules are observations, not a guarantee of profitability.

## Verification required

Run `npm test`, `npm run lint`, and `npm run build` before merging. Verify that qualification alone does not execute; only a completed entry signal starts a sequence; direction and barrier match the user's selection; settlement is sequential; two consecutive losses stop the sequence; three buys complete the sequence; and a new Run is required afterward.
