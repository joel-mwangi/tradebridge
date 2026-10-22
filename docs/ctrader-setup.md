# Deriv cTrader account linking and demo execution

TradeBridge's Forex Analyst can link a Deriv cTrader account using cTrader Open API. This is separate from the existing Deriv Options connection and does not place orders in MT5. The chart remains an analysis feed; the trade ticket uses cTrader's account-specific Forex symbol catalogue and fetches a bid/ask snapshot from the linked account.

## Required cTrader setup

1. Register a cTrader Open API application with Spotware and wait for approval.
2. Register this exact redirect URI in the cTrader application:
   `https://swigtrade.vercel.app/api/auth/ctrader/callback`
   Register a different exact URI for local development if needed.
3. Configure OAuth authorization scope as `trading` when users connect. The cTrader authorization page remains responsible for user consent.
4. Apply `supabase/migrations/20261022120000_add_ctrader_gateway.sql` and `supabase/migrations/20261022150000_add_ctrader_position_actions.sql` to the TradeBridge Supabase project.

## Environment variables

### FastAPI backend

Set these on the deployed FastAPI service:

- `CTRADER_OPENAPI_CLIENT_ID`: approved cTrader app client ID.
- `CTRADER_OPENAPI_CLIENT_SECRET`: cTrader app secret. Keep it only on the backend.
- `CTRADER_OAUTH_REDIRECT_URI`: exact public callback URL shown above.
- `APP_URL`: frontend origin, e.g. `https://swigtrade.vercel.app`.
- `TRADEBRIDGE_SESSION_BRIDGE_TOKEN`: the existing shared secret used by the Next.js callback.
- `TRADEBRIDGE_ALLOWED_ORIGINS`: include `https://swigtrade.vercel.app` so the browser ticket can call FastAPI.
- `TRADEBRIDGE_CREDENTIAL_ENCRYPTION_KEY`: a Fernet key used to encrypt cTrader access and refresh tokens.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the Supabase auth URL/key configuration already required by the backend.
- `CTRADER_DEMO_ORDERS_ENABLED`: keep `false` while linking and validating the account.
- `CTRADER_DEMO_MAX_VOLUME_UNITS`: conservative server-side maximum; defaults to `1000` base-currency units.

### Next.js / Vercel

Set:

- `APP_URL=https://swigtrade.vercel.app`
- `CTRADER_OPENAPI_CLIENT_ID` (public client identifier only; never expose the secret)
- `TRADEBRIDGE_BACKEND_URL` (server-side base URL of the FastAPI service)
- `TRADEBRIDGE_SESSION_BRIDGE_TOKEN` (same shared value as FastAPI)
- `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_HTTP_URL` (the HTTPS base URL of FastAPI, needed by the authenticated account/ticket UI)

Do not add the cTrader client secret, service-role key, encryption key, or bridge token to any `NEXT_PUBLIC_*` variable.

## Activation checklist

1. Apply the Supabase migration in the right project.
2. Configure backend and frontend environment variables, then redeploy both services.
3. Connect a cTrader **Demo** account from the Forex Analyst and verify that account IDs and Forex symbols load.
4. Verify that open positions, pending orders, stop-loss/take-profit, and net unrealised P/L reconcile against the cTrader account.
5. Test protection edits, partial closes and full closes on Demo only; verify the position list after each action.
6. Keep all live-account position-changing actions blocked until provider-connected Demo acceptance tests pass and a separate live rollout review is completed.
7. Keep `CTRADER_DEMO_ORDERS_ENABLED=false` until demo authorization, account ownership, server limits and the provider's order acknowledgement have been tested.
8. Then the operator may set `CTRADER_DEMO_ORDERS_ENABLED=true` for demo orders only, starting with a very small allowed volume.
9. Confirm every test order in the cTrader account activity before relying on TradeBridge's acknowledgement.

## Execution safeguards in this implementation

- OAuth tokens are stored encrypted server-side, not in browser cookies.
- TradeBridge checks linked-account ownership and uses cTrader symbol IDs.
- The order endpoint accepts only explicitly confirmed **Demo** market orders and checks the server maximum plus cTrader's per-symbol minimum, maximum and step.
- A persistent one-time idempotency key blocks duplicate order submissions and position actions.
- If cTrader does not acknowledge an order/action, TradeBridge records the outcome as unknown and instructs the user to reconcile account state before trying again.
- Open positions, pending orders, stop-loss/take-profit and net unrealised P/L are read from cTrader; the UI refreshes them every 15 seconds.
- Stop-loss/take-profit changes and full/partial position closes require explicit confirmation and are demo-only in this implementation.
- Real-money order execution remains blocked in the backend, even when the user has a linked live account.

This is an integration foundation, not a claim that the hosted callback or a real order has been live-tested. Validate cTrader app approval, registered redirect URI, database migration and demo order round-trip before considering further rollout.
