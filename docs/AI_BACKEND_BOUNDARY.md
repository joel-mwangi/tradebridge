# TradeBridge frontend / AI backend boundary

## Decision

TradeBridge is the presentation and manual-trading application. The `joel-mwangi/ai-tradingbridge` FastAPI service is the single owner of AI and statistical research logic. Do not build a second model, feature-engineering pipeline, or statistical implementation in this frontend repository.

## Preserve existing trading responsibilities

The frontend continues to own the trader's interactions:
- market and contract selection;
- stake and contract parameters;
- explicit manual trade submission through the existing Deriv trading connection;
- open-contract updates, settlement and order reconciliation.

The AI/research service must never send trade proposals to Deriv or execute a contract. Its availability must not be a prerequisite for manual trading.

## Research UI responsibilities

- Request or subscribe to backend-produced research results.
- Render values, timestamps, sample window, model/version, confidence/calibration where available, and freshness/error status.
- Do not recalculate statistics or infer a trading signal from backend output.
- Keep the API token and database service-role key server-side.
- A Next.js route may authenticate the user and proxy requests/streams, but must not duplicate research calculations.
- Keep the historical analysis endpoint for on-demand history/backtesting; use a separate supported streaming path for continuous updates.

## Live-data constraints

The current AI Lab market panel fetches `/api/ai-lab/market-analysis` on activation, selection changes, and manual refresh. This is request-based historical analysis, not a continuous live stream.

The existing server-side `/api/internal/market-ticks` endpoint persists batches to Supabase. The documented collector is outside this repository, and its deployment/configuration must be verified before claiming end-to-end live ingestion.

Do not add another frontend Deriv research collector merely to make the AI Lab look live. Keep the current Deriv trading socket and manual execution behavior intact. The live research collector, transport and runtime must be chosen centrally and documented in `ai-tradingbridge`.

## Refactor acceptance criteria

- Frontend research code is transport, state, and presentation only.
- No duplicate research/statistical algorithms remain in frontend code.
- AI Lab displays server timestamps and explicit stale/disconnected/error states.
- Manual trade execution and contract reconciliation pass regression tests with the research service offline.
- The deployed app is not described as streaming until a real end-to-end test proves it.
