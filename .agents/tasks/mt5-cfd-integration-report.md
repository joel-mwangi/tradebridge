# MT5 CFD Trade Execution Integration — Investigation Report

**Date:** 2025-07  
**Scope:** End-to-end CFD trade execution from the Next.js frontend (`d:\tradebridge`) through the FastAPI backend (`d:\ai-tradingbridge`) to the MT5 desktop Expert Advisor (`d:\tradebridge\mt5\TradeBridgeMarketBridge.mq5`).

---

## Summary Answer (TL;DR)

**No CFD order execution exists anywhere in this system.** Every layer — the EA, the FastAPI backend, and the Next.js frontend — is deliberately and explicitly limited to **market selection only**. The entire MT5 integration is a pairing + symbol-selection bridge: the frontend can tell the EA to highlight a symbol in Market Watch; nothing sends, creates, modifies, or closes a trade. The `ForexOrderPanel` component renders a fully functional order form but explicitly states `"Forex order routing is not connected in this build"` and submits nothing. To execute CFD trades end-to-end, the following must be built from scratch across all three layers.

---

## 1. MT5 Expert Advisor (`d:\tradebridge\mt5\TradeBridgeMarketBridge.mq5`)

### What it does
- Polls `GET /mt5/ea/commands/next?lease_seconds=20` every 3 s (configurable via `InpPollSeconds`).
- Authenticates using a per-device bearer token (`InpDeviceCredential`) set in EA inputs.
- Parses a `provider_symbol` from the response, resolves it to a broker symbol via `InpSymbolMappings` (e.g. `frxEURUSD=EURUSD`), and calls `SymbolSelect(broker_symbol, true)` — this only adds the symbol to Market Watch.
- Acknowledges the command with `POST /mt5/ea/commands/{command_id}/ack`, sending `lease_token`, `outcome` (`acknowledged`/`rejected`), `result_code`, and `result_message`.
- Backend base URL defaults to `https://ai-tradingbridge.vercel.app`.

### What it does NOT do
- **No order placement.** Zero calls to `OrderSend`, `CTrade`, or any MQL5 trade function. The file header and README explicitly state: *"Market selection only. This EA does not place or manage orders."*
- No support for `volume`, `order_type`, `stop_loss`, `take_profit`, or any trade parameters.
- No open/close/modify command types. The only `command_type` in the database schema is `select_market`.
- No trade confirmation payload — the ack only reports whether the symbol was selected.

### Authentication
Bearer token passed in every HTTP request header: `Authorization: Bearer <InpDeviceCredential>`. The credential is a `secrets.token_urlsafe(48)` value shown once at pairing and hashed in the database.

---

## 2. FastAPI Backend (`d:\ai-tradingbridge\app\mt5_bridge.py`)

### Routes under `/mt5`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/mt5/pairing-codes` | Supabase JWT | Generate a one-time 5-min pairing code |
| POST | `/mt5/pair` | None (code-gated) | Consume code → return device credential once |
| GET | `/mt5/devices` | Supabase JWT | List user's paired devices |
| DELETE | `/mt5/devices/{device_id}` | Supabase JWT | Revoke a device |
| POST | `/mt5/devices/{device_id}/commands` | Supabase JWT | Queue a `select_market` command for the device |
| GET | `/mt5/ea/commands/next` | Device bearer | EA polls for the next pending command |
| POST | `/mt5/ea/commands/{command_id}/ack` | Device bearer | EA acknowledges command execution |

### Data storage
Supabase tables (defined in `d:\tradebridge\supabase\migrations\`):
- `mt5_devices` — paired device registry (hashed credentials only)
- `mt5_pairing_codes` — one-time codes (hashed, expiring)
- `mt5_commands` — command queue with `command_type = 'select_market'` enforced by `CHECK` constraint

The `mt5_commands` table has a hard `CHECK (command_type = 'select_market')` constraint — no other command type can be stored. The `mt5_lease_next_command` and `mt5_ack_command` Supabase RPCs implement atomic lease/ack with a `lease_token` (UUID) to prevent stale workers from double-acknowledging.

### Pydantic models
- `CreateCommandRequest`: fields `provider_symbol`, `idempotency_key`, `expires_in_seconds`. **No volume, order type, SL, TP, or CFD fields.**
- `AckRequest`: fields `lease_token`, `outcome`, `result_code`, `result_message`. No trade result.

### What is missing / stubbed
- No route for creating trade orders (buy, sell, close, modify).
- No Pydantic model for a CFD order request.
- No trade signal queue, no `trade_orders` table, no position tracking.
- The backend README explicitly states: *"Deriv's published MT5 API documentation says MT5 trading is not supported through its APIs; this repo therefore does not promise MT5 CFD order execution."*

---

## 3. Next.js Frontend (`d:\tradebridge\src`)

### `ForexOrderPanel.tsx`
- Full order form UI: side (buy/sell), order type (market/limit/stop), volume (lots), entry price, stop loss, take profit.
- Validates fields and shows a "Review" card when form is complete.
- **Calls no backend endpoint.** The review card contains this explicit note: *"Forex order routing is not connected in this build. TradeBridge currently supports confirmed Deriv digit Options orders, not forex CFD/margin orders. No order will be sent."*
- The submit button only opens a review modal; there is no fetch/POST anywhere in the file.

### `Mt5PairingPanel.tsx`
- Fully implemented pairing flow: generate pairing code → register device → receive device credential.
- Calls `/api/mt5/pairing-codes` (POST), `/api/mt5/pair` (POST), `/api/mt5/devices` (GET), `/api/mt5/devices/{id}` (DELETE).
- This is the **only working end-to-end flow** — pairing and device management work.
- The panel UI description says explicitly: *"This bridge does not place or manage trades."*

### `LiveTradingControls.tsx`
- Controls the `executionGatewayAvailable` flag for live Deriv Options trading.
- Unrelated to MT5/CFD — this controls the Deriv WebSocket trading gateway, not MT5.
- When `executionGatewayAvailable` is false (current state), it shows: *"Real-money order entry is disabled for safety... Real-account trading will remain locked until a server-side execution gateway validates every order."*

### `/api/mt5/[...path]/route.ts`
- Proxies requests to `${TRADEBRIDGE_BACKEND_URL}/mt5/{path}`.
- **Whitelist is strictly limited**: only `GET devices`, `POST pairing-codes`, `POST pair`, and `DELETE devices/{uuid}` are allowed through.
- Any attempt to proxy a trade execution route (e.g. `POST /mt5/orders`) returns `404 not_found`.
- No trade execution path is in the allow-list.

### `ForexAnalyst.tsx`
- The "AI Analyst" tab. Connects via WebSocket to `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_MARKET_WS_URL` to stream live ticks and candle history from the Deriv market data proxy.
- Renders live charts, candle patterns, swing points, support/resistance zones.
- Includes `ForexOrderPanel` as a sidebar component — so the order form is visible in the Analyst tab, but as confirmed above, it submits nothing.
- No MT5 trade commands are issued from this component.

### Environment variables for MT5
From `.env.example`:
- `TRADEBRIDGE_BACKEND_URL` — server-side backend URL used by the proxy route
- `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_HTTP_URL` — client-side HTTP base
- `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_WS_URL` — client-side WS
- `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_MARKET_WS_URL` — market data WS (used by `ForexAnalyst`)
- No MT5-specific variables exist beyond what is used for the pairing proxy.

---

## 4. Docker / Deployment

The `docker-compose.yml` builds only the Next.js frontend — **there is no FastAPI service in the compose file**. The FastAPI backend is deployed separately (Vercel or another host). The EA connects directly to the backend at `https://ai-tradingbridge.vercel.app`. There is no compose networking between frontend and backend; they communicate over the public internet (or via `TRADEBRIDGE_BACKEND_URL`).

Key deployment constraint from the backend README: the FastAPI server requires an **always-on ASGI host** (not serverless) for WebSocket connections. The EA talks directly to the deployed FastAPI URL, not through the Next.js proxy.

---

## 5. End-to-End Gap Analysis

### The intended flow (currently unimplemented)

```
[User fills ForexOrderPanel]
    │  ← form submit (NOT IMPLEMENTED)
    ▼
[Next.js API route: /api/mt5/execute or similar]
    │  ← route not in allow-list
    ▼
[FastAPI: POST /mt5/devices/{device_id}/trade-orders]
    │  ← route does not exist
    ▼
[Supabase: mt5_trade_orders table]
    │  ← table does not exist; only select_market commands are stored
    ▼
[EA polls GET /mt5/ea/commands/next]
    │  ← EA only handles select_market commands; no OrderSend code
    ▼
[MT5 executes trade via OrderSend()]
    │  ← not implemented
    ▼
[EA acknowledges with ticket number, fill price, volume]
    │  ← ack payload only reports select/reject outcome
    ▼
[FastAPI updates order status]
    │  ← no order status tracking
    ▼
[Frontend shows fill confirmation]
    ← not implemented
```

### Gap inventory (every broken link)

| # | Layer | Gap | Severity |
|---|-------|-----|----------|
| 1 | EA (MQL5) | No `OrderSend`/`CTrade` code. No buy, sell, close, or modify functions. | **Critical** |
| 2 | EA (MQL5) | Only handles `select_market` command type. No `place_order`, `close_order`, `modify_order` dispatch. | **Critical** |
| 3 | EA (MQL5) | No trade-result payload in ack. Ticket number, fill price, actual volume not returned. | **Critical** |
| 4 | Backend (Python) | No `/mt5/devices/{id}/trade-orders` route or equivalent. | **Critical** |
| 5 | Backend (Python) | `mt5_commands` table enforces `command_type = 'select_market'` via a database CHECK constraint. Adding new command types requires a Supabase migration. | **Critical** |
| 6 | Backend (Python) | No Pydantic model for CFD order params (symbol, volume, order_type, sl, tp, magic_number). | **Critical** |
| 7 | Backend (Python) | No trade order state machine (pending → leased → filled/rejected/cancelled). | **Critical** |
| 8 | Next.js proxy | `route.ts` allow-list blocks any path other than `devices`, `pairing-codes`, and `pair`. Adding a trade route requires modifying the allow-list regex. | **High** |
| 9 | Next.js UI | `ForexOrderPanel` does not call any backend on submit. The submit button only opens a review modal. | **High** |
| 10 | Next.js UI | No order status polling or fill-confirmation UI. | **Medium** |
| 11 | Env/config | No MT5 CFD-specific env vars. `TRADEBRIDGE_BACKEND_URL` is used but not always set in practice. | **Medium** |
| 12 | Docker | FastAPI is not in `docker-compose.yml`; no local multi-service development setup exists. | **Low** |

### Field-name mismatches (future integration)

The `ForexOrderPanel` collects:
- `side`: `"buy"` | `"sell"`
- `orderType`: `"market"` | `"limit"` | `"stop"`
- `volume` (string, lots)
- `entryPrice` (string)
- `stopLoss` (string)
- `takeProfit` (string)

MT5 `OrderSend` / `CTrade` needs:
- `action`: `ORDER_TYPE_BUY`, `ORDER_TYPE_SELL`, `ORDER_TYPE_BUY_LIMIT`, etc.
- `volume`: double (lots)
- `price`: double (0.0 for market orders)
- `sl`: double
- `tp`: double
- `symbol`: string (broker symbol, not provider symbol)

The panel uses camelCase string enums; MT5 uses `ORDER_TYPE_*` integer constants. A translation layer is required in either the EA or the FastAPI backend command model.

---

## 6. Conclusions and Recommended Fixes

### What already works
- MT5 pairing flow is complete end-to-end: frontend → Next.js proxy → FastAPI → Supabase → EA.
- Market selection (`SymbolSelect`) is working if deployed correctly.
- The Deriv Options trading gateway (WebSocket, demo and real) is a complete parallel execution path.

### What must be built to enable CFD trade execution

#### Step 1 — Supabase migration: extend command types
Add a new migration that either relaxes the `command_type` CHECK constraint or adds a separate `mt5_trade_orders` table with columns: `device_id`, `user_id`, `symbol` (broker symbol), `order_type` (`buy`/`sell`/`buy_limit`/`sell_limit`), `volume`, `price` (0 for market), `sl`, `tp`, `magic_number`, `status` (`pending`/`leased`/`filled`/`rejected`/`cancelled`), `fill_price`, `fill_time`, `ticket` (MT5 ticket number), `lease_token`, `expires_at`, `idempotency_key`.

#### Step 2 — FastAPI backend: trade order routes
- `POST /mt5/devices/{device_id}/trade-orders` — create a trade order (authenticated by Supabase JWT).
- `GET /mt5/ea/trade-orders/next?lease_seconds=30` — EA polls; returns the next pending order.
- `POST /mt5/ea/trade-orders/{order_id}/ack` — EA reports fill: ticket, fill_price, fill_volume, or rejection with error code.
- `GET /mt5/devices/{device_id}/trade-orders/{order_id}` — frontend polls for fill status.
- Add `TradeOrderRequest` Pydantic model: `broker_symbol`, `order_type`, `volume`, `price`, `sl`, `tp`, `magic_number`, `idempotency_key`, `expires_in_seconds`.

#### Step 3 — EA (MQL5): order execution
Add a new command handler branch in `PollForCommand()`:
- For `command_type = "place_order"`: call `CTrade::Buy()` / `CTrade::BuyLimit()` / `CTrade::Sell()` etc.
- Capture the ticket number and fill price from `CTrade::ResultOrder()` and `CTrade::ResultPrice()`.
- Return fill details in the ack payload.
- Validate volume and price against `SymbolInfoDouble()` (min lot, lot step, tick size).
- For `command_type = "close_order"`: call `CTrade::PositionClose(ticket)` or `CTrade::PositionClosePartial()`.

#### Step 4 — Next.js proxy route
Add `"trade-orders"` paths to the allow-list in `route.ts`:
- `POST devices/{uuid}/trade-orders` — submit a new order
- `GET devices/{uuid}/trade-orders/{uuid}` — poll order status

#### Step 5 — `ForexOrderPanel.tsx`
Replace the review modal dismiss with an actual `fetch("/api/mt5/devices/{deviceId}/trade-orders", { method: "POST", body: ... })` call. Add a `deviceId` prop (from the pairing panel) or retrieve it from a shared context. Show polling state and fill result.

#### Step 6 — Risk controls
Before any of this is live, add server-side stake validation equivalent to the Deriv gateway's `TRADEBRIDGE_REAL_MAX_STAKE` gate. The EA runs on the user's real broker account; there is no sandbox.

---

## File Citation Index

| File | Key finding |
|------|-------------|
| `d:\tradebridge\mt5\TradeBridgeMarketBridge.mq5` | Market selection only; no OrderSend; polls `/mt5/ea/commands/next` |
| `d:\tradebridge\mt5\README.md` | Confirms: "No order execution, lot sizing, stop loss, take profit, or trading permissions are implemented" |
| `d:\ai-tradingbridge\app\mt5_bridge.py` | All 7 routes; `CreateCommandRequest` has no trade fields; only `select_market` command type |
| `d:\tradebridge\supabase\migrations\20261028130000_add_mt5_market_command_storage.sql` | `CHECK (command_type = 'select_market')` database constraint |
| `d:\tradebridge\supabase\migrations\20261028170000_reject_expired_mt5_command_leases.sql` | `lease_token` UUID added; `mt5_ack_command` signature updated |
| `d:\tradebridge\src\components\trading\ForexOrderPanel.tsx` | Form submits nothing; review card says "No order will be sent" |
| `d:\tradebridge\src\components\trading\Mt5PairingPanel.tsx` | Pairing flow fully implemented; "does not place or manage trades" |
| `d:\tradebridge\src\components\trading\LiveTradingControls.tsx` | Deriv Options gateway only; unrelated to MT5 |
| `d:\tradebridge\src\app\api\mt5\[...path]\route.ts` | Allow-list: `devices`, `pairing-codes`, `pair` only; trade routes → 404 |
| `d:\tradebridge\.env.example` | No MT5 trade-specific env vars; `TRADEBRIDGE_BACKEND_URL` is the only backend pointer |
| `d:\tradebridge\next.config.ts` | No rewrites or proxy config; backend calls are via API routes |
| `d:\tradebridge\docker-compose.yml` | Next.js only; FastAPI not containerised here |
| `d:\ai-tradingbridge\README.md` | Confirms: "Deriv's published MT5 API documentation says MT5 trading is not supported through its APIs; this repo therefore does not promise MT5 CFD order execution" |
| `d:\ai-tradingbridge\app\main.py` | `mt5_router` is registered; no other MT5 files exist |
| `d:\tradebridge\src\components\trading\ForexAnalyst.tsx` | AI Analyst tab; ForexOrderPanel is rendered but inactive; market data via WS only |
