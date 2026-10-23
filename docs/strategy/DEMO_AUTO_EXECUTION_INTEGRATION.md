# Demo automatic execution integration contract

This document describes the coordinator added for the Deriv Demo strategy execution workflow. It is not a claim that the UI and authenticated Deriv session have already been wired together.

## Safety contract

- The coordinator accepts Demo accounts only. It refuses real accounts before execution.
- It requires a qualified signal tied to the configured market.
- Trades are executed one at a time and each callback must resolve only after Deriv confirms settlement.
- The session allows at most three confirmed, settled trades.
- Two consecutive losses stop further submissions; any win or breakeven resets the consecutive-loss counter.
- An unknown purchase or settlement result transitions to `reconciliation_required`. The coordinator never retries it automatically.
- Existing contract monitoring must continue even if the strategy session stops.
- The caller must supply a unique session ID and an execution callback that uses the existing authenticated backend trading session. Never pass account tokens to this module or call Deriv directly from this coordinator.

## Integration requirements before enabling from Run

1. In the strategy monitor, emit a signal only after official percentage qualification and the documented live tick pattern `TRIGGER → S → S → O` are both satisfied.
2. Connect the signal to `createDemoExecutionSession` only when the selected account is confirmed Demo and the authenticated trading session is ready.
3. Implement `executeAndReconcile` using the existing quote/buy flow, with the UI confirmation step bypassed only for this explicit Demo automation path. Preserve the existing manual path.
4. Resolve each callback only after the accepted contract's authoritative settlement update is received. If the buy acknowledgement or settlement is uncertain, return an unknown result and pause.
5. Persist enough session/contract identifiers to recover outstanding contracts after refresh or disconnect. Never restart a purchase sequence after a reload without reconciling prior requests.
6. Add an explicit strategy stake setting and validate it against the selected Demo account currency and provider limits.
7. Keep real-account execution disabled.

The coordinator and its unit tests are isolated from network access; passing them validates the sequential stop logic, not the Deriv integration or profitability.
