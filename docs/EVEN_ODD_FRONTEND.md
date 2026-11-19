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

- Service status and execution/model readiness.
- Market selection, bounded tick collection, and collection result.
- Persisted tick history and parity distribution summary.
- Structural data-quality audit.
- Candidate/validated model registry metadata and research-run history.

The UI intentionally does not create a trade, start a sequence, or display a
candidate model forecast as an actionable signal. The backend currently reports
no validated predictive model and order execution is disabled. Research runs
are initiated locally on the backend with
`python -m scripts.even_odd_research --symbol R_50 --walk-forward`.

## Backend request boundaries

Tick collection uses the backend's validated request fields:
`symbol`, `tick_count` (10–300), and `timeout_seconds` (5–80). The browser
cannot provide model probabilities, payout terms, calibration evidence, or
execution authorization. All API calls are no-store and pass through the
authenticated Next.js server route.
