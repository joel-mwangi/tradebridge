# Live market data: ephemeral only

TradeBridge's active market feed now uses the FastAPI WebSocket proxy and keeps live tick/history messages in memory only. **Do not configure or run a Cloudflare tick collector for database persistence.** The legacy `POST /api/internal/market-ticks` endpoint returns HTTP 410 (`tick_persistence_disabled`) and does not write to Supabase.

The existing `public.market_ticks` table and research endpoints are not deleted by this migration, so any historical rows already stored remain until an explicit data-retention decision is made. No new live tick rows should be written through TradeBridge.

## Live feed

- Browser connects to the configured FastAPI WebSocket URL (typically `/deriv/live/market`).
- FastAPI opens the public Deriv WebSocket upstream and forwards requests/responses.
- Market history and tick updates are ephemeral; the frontend retains only its bounded in-memory view for display.
- This proxy is not an archive and cannot recover a continuous history after disconnect. Deriv history requests can refill the chart/analysis window on reconnect.

## Rollout

1. Deploy `ai-tradingbridge` to an always-on ASGI host.
2. Configure `TRADEBRIDGE_ALLOWED_ORIGINS` with exact frontend origins.
3. Set `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_MARKET_WS_ENABLED=true` and `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_MARKET_WS_URL=wss://<backend-host>/deriv/live/market` only after the backend endpoint has been smoke-tested.
4. Disable any external Cloudflare Worker or scheduled collector that writes ticks to `/api/internal/market-ticks`.

Do not delete the existing table or migration as part of this change; historical data removal requires a separate explicit decision.
