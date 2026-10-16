# Live market data: ephemeral only

TradeBridge's active market feed uses the FastAPI WebSocket proxy and keeps live tick/history messages in memory only. Do not run a separate tick collector or write live ticks to the database.

The legacy `POST /api/internal/market-ticks` endpoint returns HTTP 410 (`tick_persistence_disabled`) and does not write to Supabase. The existing `public.market_ticks` table and historical rows remain unchanged.

## Live feed

- The browser connects to the configured backend WebSocket URL for `/deriv/live/market`.
- FastAPI opens the public Deriv WebSocket upstream and forwards requests/responses.
- Market history and tick updates are ephemeral; the frontend retains only a bounded in-memory view for display.
- This proxy is not an archive and cannot recover a continuous history after disconnect. Deriv history requests can refill the chart/analysis window on reconnect.

## Rollout

1. Deploy the frontend on Vercel as planned.
2. Deploy/configure the FastAPI service for the Deriv WebSocket endpoints and set exact allowed frontend origins.
3. Configure `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_MARKET_WS_ENABLED=true` and `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_MARKET_WS_URL` only after the endpoint is deployed and smoke-tested.
4. Do not configure a separate worker/collector for tick persistence.

No worker/collector source is tracked in this repository. Any separately deployed external worker would have to be removed from its own hosting control plane; it cannot be deleted through this repository change.