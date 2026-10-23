# Demo strategy auto-execution

## Integrated flow

- `DigitStrategyPanel` exposes an explicit Demo-only arm control and a stake field.
- Arming waits for an exclusive qualified Under or Over signal from the existing strategy status stream. The selected barrier is used as the contract barrier.
- `TradingWorkspace` passes the verified Demo-account gate and `useTradingSession.executeDemoStrategyTrade` into the panel.
- The trading hook uses the existing authenticated backend Deriv WebSocket session to request a fresh proposal, submit the buy, subscribe to the resulting contract, and await a normalized settled status plus Deriv's reported profit.
- The coordinator runs contracts sequentially, counts only settled outcomes, stops after three settled buys, and stops earlier after two consecutive losses. A win or breakeven resets the consecutive-loss count.
- The Stop new buys control stops the sequence after the current contract settles; it does not attempt to force-sell an active contract.
- A timeout, disconnect, invalid contract ID, or missing settlement profit enters `reconciliation_required`. The hook persists the unresolved-order lock, blocks further orders, and does not retry automatically.
- The trading session rejects auto-execution unless the selected account type is exactly `demo`. Real-account execution remains disabled by the workspace gate.

## Important behavior

- The strategy uses a **1-tick** duration for this initial implementation. Stake is explicitly configurable in the panel (minimum 1, maximum 1000 account-currency units).
- The coordinator does not guarantee profitability. Digit frequencies and qualifications are observations, not reliable predictions of future ticks.
- The unresolved-order lock survives reloads, but the coordinator's in-memory sequence counters do not resume after reload. A reload during an active order is deliberately fail-closed and requires manual reconciliation in Deriv.
- Stop is cooperative: it prevents subsequent buys after the current contract settles. It does not cancel an already submitted buy or force-close an open contract.

## Verification required

Run `npm test`, `npm run lint`, and `npm run build` on this branch before merging. Verify in a Deriv Demo account that a qualification triggers a quote/buy, each contract settles before the next starts, two losses stop the sequence, three settled buys complete the sequence, and an interrupted order blocks further entries. Real-account execution must remain disabled.