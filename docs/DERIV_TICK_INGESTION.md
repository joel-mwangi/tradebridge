# Deriv tick ingestion

TradeBridge stores durable Deriv tick history in its existing Supabase/Postgres database. The Cloudflare collector must send batches to `POST /api/internal/market-ticks`; it must not expose database credentials in the browser.

## Required server environment variables

- `NEXT_PUBLIC_SUPABASE_URL`: the TradeBridge Supabase project URL (already used by the app).
- `SUPABASE_SERVICE_ROLE_KEY`: existing server-only key used by `src/lib/supabase/admin.ts`.
- `DERIV_TICK_INGEST_TOKEN`: a new high-entropy shared secret, configured on the TradeBridge server and the Cloudflare Worker as a secret. Never commit it or place it in a `NEXT_PUBLIC_*` variable.

## Endpoint contract

Send an authenticated JSON request:

```http
POST /api/internal/market-ticks
Authorization: Bearer <DERIV_TICK_INGEST_TOKEN>
Content-Type: application/json
```

```json
{
  "ticks": [
    { "symbol": "1HZ100V", "quote": 1407.35, "epoch": 1792149592, "pip_size": 2 }
  ]
}
```

Send batches of at most 500 ticks. The endpoint validates each tick, calculates the final digit server-side, and uses the unique key `(symbol, epoch, quote)` to make retried batches idempotent. It returns HTTP 202 with received/inserted/duplicate counts.

## Migration and rollout

1. Apply `supabase/migrations/20261016100000_market_ticks.sql` to the actual TradeBridge Supabase project.
2. Configure `DERIV_TICK_INGEST_TOKEN` on the deployed TradeBridge server and Cloudflare Worker.
3. Update the collector to batch POST ticks to `/api/internal/market-ticks` and retry failed batches with bounded backoff.
4. Verify inserts and restart recovery before relying on the history for research.

The route is server-to-server only. The migration revokes table access from browser roles and grants it only to `service_role`. This endpoint is for market-data research, not automated order execution or a claim of predictive edge.
