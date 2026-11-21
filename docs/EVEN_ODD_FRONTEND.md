# Even/Odd Lab frontend

The Even/Odd Lab workspace is available at `/even-odd-lab`. It is an independent
research interface and does not share state with TradeBridge's existing trade
ticket, digit strategy, or market-analysis modules.

## Server environment

Configure these variables in the TradeBridge frontend deployment and local
`.env.local`:

- `TRADEBRIDGE_BACKEND_URL`: base URL of the FastAPI backend, without a trailing slash.
- `TRADEBRIDGE_API_TOKEN`: the same server-to-server token configured as
  `TRADEBRIDGE_API_TOKEN` on the backend.

Both values are server-only. Never add a `NEXT_PUBLIC_` prefix and never put
the token in browser code. The Next.js catch-all route at
`/api/even-odd/[...path]` authenticates the signed-in Supabase user and proxies
only allowlisted Even/Odd endpoints using the server token.

## Current frontend scope

The terminal is organized into seven workspaces:

- **Overview:** service readiness, bounded tick collection, parity and digit
  distributions, recent sequences, parity streaks, rolling-frequency momentum,
  transition counts, payout quotes and structural data-quality audit.
- **Pattern Intelligence:** multi-window parity percentages and momentum, per-digit frequency movement, parity suffix patterns, digit-to-digit transition matrix, research probability inspection and manual training-run history. Descriptive rates are not actionable signals.\n- **ML Predictions:** candidate/validated model registry, partition sizes,
  research-only next-parity forecast and uncertainty display.
- **Entry Intelligence:** backend-gated entry evaluation, explicit WAIT states,
  payout-aware qualification and risk-bounded sequence planning. The browser
  cannot supply probabilities, validation flags or policy overrides.
- **Backtesting:** persisted chronological experiment history, train /
  validation / calibration / test partition summaries, expanding walk-forward
  folds and comparisons against constant and rolling-frequency baselines.
- **Performance:** out-of-sample accuracy, balanced accuracy, precision derived
  from the confusion matrix, Brier score, log loss, calibration error and
  baseline comparisons.
- **Sessions & risk:** persistent owner-scoped sessions, sequence ledger,
  settlement records, fixed stake, session loss cap and configured trade caps.

The frontend does not submit or close Deriv contracts. A candidate model forecast
is never displayed as an actionable signal. The backend currently reports no
validated predictive model and order execution remains disabled.

Research runs execute outside the Vercel request lifecycle through the manually
dispatched GitHub Actions workflow documented in
`docs/even-odd/ML_RESEARCH_PIPELINE.md`. The current research evaluator tests
probability forecasts and walk-forward baselines; it does **not** yet perform a
full historical payout replay or calculate realized-return drawdown. The UI
must not invent those metrics or describe predictive classification evaluation
as a completed profitability backtest.

## Backend request boundaries

Manual tick collection is browser-managed. The signed-in browser opens the public
Deriv WebSocket and submits batches of at most 100 live observations through the
authenticated Next.js proxy to FastAPI. FastAPI verifies job ownership, validates
market and basic tick fields, persists each batch to Database 2, and advances
progress only after persistence succeeds. The browser must remain open and the
computer awake; tab closure, browser suspension, network loss, or a Deriv socket
disconnect can interrupt the collection. A partial sample is stopped, not marked
completed. No historical backfill is used.

The browser never connects directly to Database 2 and never receives its secret
key. The existing worker deployment is no longer required for this collection
flow. Browser-originated observations must be treated as client-originated data:
they are not cryptographically attested by Deriv and must not be treated as
tamper-proof evidence for shared model training without additional provenance
controls.


## Session and sequence ownership

The proxy calls `supabase.auth.getUser()` and derives the authenticated UUID
from that verified user object. It constructs a fresh upstream request header
set and injects `X-TradeBridge-User-ID`; it does not forward a browser-supplied
identity header. FastAPI requires this context together with the private
server-to-server API token.

The backend stores ownership in the dedicated Even/Odd Supabase project
(Database 2). Session reads are owner-filtered; sequence reads verify ownership
through the parent session; sequence-start and settlement database functions
check the owner inside their atomic transactions. Legacy rows with no owner
remain inaccessible through user-facing session APIs and are not automatically
assigned to an account.

The frontend must never connect directly to Database 2 or expose its secret
key. No cross-project foreign key to the primary TradeBridge Auth database is
used.
