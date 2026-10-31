# TradeBridge Demo & Real Account Integration — Readiness Audit

**Audited:** All key files read directly from source.  
**Scope:** Demo and Real account trading features, end-to-end.

---

## Summary Verdicts

| # | Feature | Verdict |
|---|---------|---------|
| 1 | Deriv account connection | READY (needs env vars) |
| 2 | Demo → Real account switch | READY (needs env vars) |
| 3 | Real → Demo switch | READY |
| 4 | Deriv Options trading — demo | READY (needs env vars) |
| 5 | Deriv Options trading — real | READY (needs env vars) |
| 6 | Deriv Multipliers trading — demo | READY (needs env vars) |
| 7 | Deriv Multipliers trading — real | READY (needs env vars) |
| 8 | MT5 pairing | READY |
| 9 | MT5 market orders — demo | READY |
| 10 | MT5 market orders — real | READY (needs env vars) |
| 11 | MT5 pending orders — demo | READY |
| 12 | MT5 pending orders — real | READY (needs env vars) |
| 13 | MT5 position close — demo | READY |
| 14 | MT5 position close — real | READY (needs env vars) |
| 15 | MT5 position modify — demo | READY |
| 16 | MT5 position modify — real | READY (needs env vars) |
| 17 | Live trading consent | READY (needs env vars) |
| 18 | Daily P&L risk monitor | READY |
| 19 | EA account-type guard | READY |
| 20 | ForexOrderPanel accountType prop | READY |

**No items are BLOCKED.** All features are code-complete end-to-end. Several backend env vars must be set before real trading works.

---

## Required Backend Environment Variables (before real trading)

These must be set on the FastAPI backend (`d:\ai-tradingbridge`):

| Variable | Purpose | Notes |
|----------|---------|-------|
| `TRADEBRIDGE_REAL_TRADING_ENABLED` | Master switch for all Deriv real trading | Set to `true` |
| `TRADEBRIDGE_REAL_MAX_STAKE` | Maximum stake per Deriv real order | e.g. `10` (USD). Required — gate returns `REAL_STAKE_LIMIT_NOT_CONFIGURED` if unset |
| `TRADEBRIDGE_MT5_REAL_MAX_VOLUME` | Max lots per real MT5 order or partial close | e.g. `1.0`. Optional — only the hard 100-lot cap applies if unset |
| `TRADEBRIDGE_BACKEND_URL` | Used by the Next.js live-consent route to confirm the execution gateway is available | Required to enable live consent via `/api/auth/deriv/live-consent` POST |

These must be set on the Next.js frontend (`d:\tradebridge`):

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_HTTP_URL` | Backend HTTP base URL for account loading |
| `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_MARKET_WS_URL` | Backend WebSocket URL for ForexAnalyst market feed |

---

## Detailed Evidence

### 1. Deriv Account Connection

**READY (needs env vars)**

- `TradingWorkspace.tsx` lines for `accountsRequest`: calls `${backendUrl}/deriv/accounts` (POST) with Supabase JWT.
- Backend `routes.py` → `list_accounts()`: fetches Deriv REST, filters by `_linked_account_ids()`, returns `{connected, accounts}` with `account_type`, `balance`, `currency`.
- Frontend: `demoAccounts`/`realAccounts` split by `isDemoAccount`/`isRealAccount`. Account selector dropdown renders all accounts. Balance displayed from `liveBalance` (live WebSocket balance if session connected, else account balance from REST).
- `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_HTTP_URL` must be set; throws a clear error if not.

### 2. Demo → Real Account Switch

**READY (needs env vars)**

- `TradingWorkspace.tsx` → `handleAccountChange()`: detects `currentIsDemo && targetIsReal` and sets `showRealSwitchConfirm = true`, storing `pendingRealAccount`.
- A full modal dialog renders (`showRealSwitchConfirm && pendingRealAccount`): shows account ID, currency, and a warning that real funds will be used. Cancel and Confirm buttons present.
- `handleConfirmRealSwitch()`: POSTs to `/api/auth/deriv/live-consent` with `{account_id, enabled: true, max_stake, max_daily_loss}`, then calls `applyAccountChange()`, sets `liveTradingEnabled = true`, updates `liveConsentLoadedAccountId`.
- Frontend route `live-consent/route.ts` → POST: validates ownership, checks `TRADEBRIDGE_BACKEND_URL` env var (returns 503 if absent), upserts to `deriv_live_trading_consents` with `acknowledgement_version = "REAL_MONEY_RISK_ACKNOWLEDGEMENT_V1"`.
- Error path: if the POST returns `!response.ok || data.enabled !== true`, `liveConsentMessage` is set with the error and the account change is **not** applied.

### 3. Real → Demo Switch

**READY**

- `handleAccountChange()`: if target is not real (i.e., demo), falls through directly to `applyAccountChange()` — no confirmation modal, immediate switch.
- Verified: the condition `currentIsDemo && targetIsReal` is the only branch that opens the modal; all other direction switches are immediate.

### 4. Deriv Options trading — demo

**READY (needs env vars)**

- `useTradingSession` hook drives demo options trading via the backend WebSocket proxy.
- `effectiveLiveTradingEnabled` is passed to `DemoTradeTicket` as `realTradingEnabled`.
- Backend `client_handler.py` → `_real_trading_gate_error()`: returns `None` (no error) when `session.account_type != "real"`, so demo orders are always allowed.
- Stake limit: `_configured_stake_limit()` reads `TRADEBRIDGE_DEMO_MAX_STAKE` (defaults to 1000 if unset).
- Full lifecycle: proposal → `valid_proposals` tracked → buy validation → forwarded upstream to Deriv.
- `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_MARKET_WS_URL` / trading WS URL needed to connect.

### 5. Deriv Options trading — real

**READY (needs env vars)**

- `_real_trading_gate_error()` in `client_handler.py` checks (in order):
  1. `TRADEBRIDGE_REAL_TRADING_ENABLED` env var must be `"true"`.
  2. `TRADEBRIDGE_REAL_MAX_STAKE` must be set and positive.
  3. `user_id` and `account_id` present in session.
  4. Live consent loaded from DB: `enabled=True`, `acknowledgement_version == "REAL_MONEY_RISK_ACKNOWLEDGEMENT_V1"`.
  5. `consent_max_stake` and `consent_max_daily_loss` both > 0.
  6. `daily_realized_profit` fresh (≤30s stale); daily loss limit not exceeded.
  7. `real_trading_confirmed` on this WebSocket connection.
- `real_trading_confirm` flow: client sends `{"real_trading": {"action": "confirm", "confirmation": "ENABLE REAL TRADING"}}` → `_handle_real_trading_control()` sets `session.real_trading_confirmed = True`.
- All gates confirmed present and active.

### 6. Deriv Multipliers trading — demo

**READY (needs env vars)**

- `useMultipliersTrading` hook, activated when `page === "trade" && tradeProduct === "multipliers"`.
- Backend validates via `_validate_multiplier_proposal()` in `client_handler.py`: checks product_api is `"multipliers"`, validates MULTUP/MULTDOWN, basis, currency, multiplier range, limit_order, cancellation.
- Demo path: same gate bypass as options — no real trading gate applies.

### 7. Deriv Multipliers trading — real

**READY (needs env vars)**

- Same `_real_trading_gate_error()` applies to multiplier proposals and buys.
- `_validate_multiplier_proposal()` confirms the multiplier-specific fields.
- `MultipliersTradeTicket` receives `realTradingEnabled={effectiveLiveTradingEnabled}` and `realSessionConfirmed={multipliers.realSessionConfirmed}`.

### 8. MT5 Pairing

**READY**

- `Mt5PairingPanel` component on the `/mt5` page.
- Backend generates a one-time credential; the EA's `InpDeviceCredential` input accepts it.
- EA `OnInit()` validates `StringLen(InpDeviceCredential) >= 32` before starting.
- Device list and credential-shown-once behavior handled by the pairing panel / DB.

### 9. MT5 Market Orders — Demo

**READY**

- `ForexOrderPanel.tsx`: `handleSubmit()` POSTs to `/api/mt5/devices/${deviceId}/trade-orders` with `account_type: accountType`.
- Backend `create_trade_order()` in `mt5_trade_orders.py`: validates symbol, side, volume, creates row in `mt5_trade_orders` with `status: "queued"`.
- EA `PollForTradeOrder()` → `ExecuteTradeOrder()`: account-type guard validates `account_type_str == "demo"` against `ACCOUNT_TRADE_MODE`; routes to `g_trade.Buy()` / `g_trade.Sell()`.
- Full ack lifecycle: submitted → accepted → filled (or reconciled on timeout).
- Frontend polls every 2s via `pollOrder()`; terminal status stops polling and reloads order list.

### 10. MT5 Market Orders — Real

**READY (needs env vars)**

- Backend: `TRADEBRIDGE_MT5_REAL_MAX_VOLUME` check: if set and `body.volume > cap`, returns HTTP 422.
- Frontend: `handleSubmit()` shows `window.confirm()` with "⚠ REAL ACCOUNT" warning before submitting.
- Body includes `account_type: "real"`.
- EA: `ExecuteTradeOrder()` → account-type guard compares `account_type_str == "real"` vs `ACCOUNT_TRADE_MODE == 2`; mismatch → `AckRejected` with `ACCOUNT_TYPE_MISMATCH`.
- `InpAccountType` EA input default is `"demo"` — operator must change it to `"real"` in the EA settings when attaching to a real account.

### 11. MT5 Pending Orders (limit/stop) — Demo

**READY**

- `ForexOrderPanel.tsx`: `orderCat` selector offers "market", "limit", "stop". `deriveOrderType()` maps to `buy_limit`, `sell_limit`, `buy_stop`, `sell_stop`.
- Backend `create_trade_order()`: Phase 2 validation — `order_type` must be valid, `entry_price` required for non-market.
- EA `ExecutePendingOrder()`: maps to `ORDER_TYPE_BUY_LIMIT` etc., calls `g_trade.OrderOpen()`, acks `placed`, tracks in `g_placed_orders[]`.
- Async fill detection: `OnTradeTransaction()` fires on `TRADE_TRANSACTION_DEAL_ADD`, looks up `g_placed_orders`, calls `AckFilled()`.
- Placed orders listed in `ForexOrderPanel` under "Pending orders" section with Cancel button.

### 12. MT5 Pending Orders — Real

**READY (needs env vars)**

- Same `TRADEBRIDGE_MT5_REAL_MAX_VOLUME` volume cap applies.
- Same `window.confirm()` confirmation in UI.
- EA account-type guard runs in `ExecutePendingOrder()` as well (same guard as market orders).

### 13. MT5 Position Close — Demo

**READY**

- `ForexOrderPanel.tsx` position section: `handlePosSubmit()` POSTs to `/api/mt5/devices/${deviceId}/position-commands` with `command_type: "close"`, `mt5_position_ticket`, optional `volume`.
- Backend `create_position_command()` in `mt5_position_commands.py`: validates command_type, account_type, device ownership.
- EA `PollForPositionCommand()` → `ExecutePositionCommand()`: calls `g_trade.PositionClose()` or `PositionClosePartial()`.
- Ack lifecycle: submitted → done (or rejected).

### 14. MT5 Position Close — Real

**READY (needs env vars)**

- `TRADEBRIDGE_MT5_REAL_MAX_VOLUME` cap applies to partial close volume.
- Frontend shows `window.confirm()` for real account.
- EA account-type guard in `ExecutePositionCommand()`.

### 15. MT5 Position Modify — Demo

**READY**

- `posCommandType = "modify"` path in `handlePosSubmit()`: sends `new_stop_loss`, `new_take_profit`.
- Backend passes to `mt5_position_commands`.
- EA: `g_trade.PositionModify(position_ticket, new_sl, new_tp)`.

### 16. MT5 Position Modify — Real

**READY (needs env vars)**

- Frontend: `window.confirm()` with "⚠ REAL ACCOUNT" for modify as well.
- EA account-type guard runs.

### 17. Live Trading Consent

**READY (needs env vars)**

- `live-consent/route.ts` (GET): reads `deriv_live_trading_consents` row per `(user_id, deriv_account_id)`. Returns `enabled`, `max_stake`, `max_daily_loss`, `acknowledgement_version`.
- `live-consent/route.ts` (POST): validates ownership, checks `TRADEBRIDGE_BACKEND_URL` is set (returns 503 if not), upserts with `acknowledgement_version = "REAL_MONEY_RISK_ACKNOWLEDGEMENT_V1"`, `max_stake` clamped to [1, 10000], `max_daily_loss` clamped to [1, 100000].
- Backend `client_handler.py` → `_real_trading_gate_error()`: loads consent via `_load_live_trading_consent()`, checks `enabled=True` and `acknowledgement_version == "REAL_CONSENT_ACKNOWLEDGEMENT"` (= `"REAL_MONEY_RISK_ACKNOWLEDGEMENT_V1"`). The strings match between frontend and backend.
- `TradingWorkspace.tsx`: on `activeAccountIsReal` change, auto-fetches consent and populates `liveTradingEnabled`, `maxRealStake`, `maxDailyLoss`.

### 18. Daily P&L Risk Monitor

**READY**

- `trading_session.py` → `real_risk_monitor()`: imports `from datetime import datetime, timezone` — **datetime import is correct and present** (line 12 of the file). No missing import.
- Loop: every 15s, sends `profit_table` request to Deriv with `date_from = day_start.timestamp()`, `date_to = now.timestamp()`. Req_id stored in `self.daily_profit_request_id`.
- `record_daily_profit_table()`: validates response, sums profits into `self.daily_realized_profit`, stores `daily_profit_checked_at`.
- `_real_trading_gate_error()`: checks `daily_realized_profit is not None`, `daily_profit_checked_at is not None`, staleness ≤30s, and `daily_realized_profit > -consent_max_daily_loss`.

### 19. EA Account-Type Guard

**READY**

- EA `InpAccountType` input: default `"demo"`, must be set to `"real"` for real accounts.
- `OnInit()` validates `InpAccountType in ("demo", "real")`.
- `ExecuteTradeOrder()`, `ExecutePendingOrder()`, `ExecutePositionCommand()` all perform a **runtime check** comparing `account_type_str` (from the queued order) against `AccountInfoInteger(ACCOUNT_TRADE_MODE)`:
  - `ACCOUNT_TRADE_MODE == 0` or `1` → demo/contest → `is_demo_account = true`.
  - `ACCOUNT_TRADE_MODE == 2` → real → `is_demo_account = false`.
- If `order_expects_demo != is_demo_account` → logs "SAFETY BLOCK" and calls `AckRejected` with `ACCOUNT_TYPE_MISMATCH`. This is a **live runtime guard**, not just the `InpAccountType` input.

### 20. ForexOrderPanel accountType Prop

**READY**

- `TradingWorkspace.tsx` (page `"forex-analyst"`):  
  `<ForexAnalyst accountType={activeAccountIsReal ? "real" : "demo"} />`
- `ForexAnalyst.tsx`: receives `accountType` prop and passes it to:  
  `<ForexOrderPanel ... accountType={accountType} />`  
  (via `useMt5Device()` for deviceId, and all live quote props)
- `ForexOrderPanel.tsx`: prop `accountType = "demo"` default; used in:
  - `handleSubmit()`: `if (accountType === "real") window.confirm(...)` before order
  - `handlePosSubmit()`: same real-account confirm for position commands
  - Badge display: "⚠ REAL ACCOUNT" vs "DEMO ACCOUNT" header badge
  - Order body: `account_type: accountType` sent to backend
  - Status card: shows "Real" or "Demo" account in fill confirmation

---

## Conclusions

**All 20 items are code-complete.** The implementation covers the full end-to-end lifecycle for every feature on both demo and real accounts.

### What works without configuration
- Demo options, multipliers, MT5 market/pending/close/modify on demo all work as long as the backend and frontend URLs are set.
- Real → Demo switch is immediate with no config.
- EA account-type guard is purely runtime — no additional config needed there.

### What requires backend env vars before real trading
1. `TRADEBRIDGE_REAL_TRADING_ENABLED=true` — master gate; without it every real Deriv trade returns `REAL_TRADING_DISABLED`.
2. `TRADEBRIDGE_REAL_MAX_STAKE=<amount>` — required; without it every real Deriv proposal/buy/strategy returns `REAL_STAKE_LIMIT_NOT_CONFIGURED`.
3. `TRADEBRIDGE_BACKEND_URL=<http-backend-url>` — required on the Next.js server; without it enabling live consent returns 503 `real_execution_gateway_unavailable`, which blocks the Demo→Real switch entirely.
4. `TRADEBRIDGE_MT5_REAL_MAX_VOLUME=<lots>` — optional but recommended; without it only the hard 100-lot absolute cap protects real MT5 orders.

### EA operator checklist for real MT5 trading
- Change `InpAccountType` to `"real"` in EA settings when attaching to a real account.
- The EA performs a runtime `ACCOUNT_TRADE_MODE` check regardless of `InpAccountType`, so mismatched orders are always rejected at the EA level.

### No regressions found
- The `datetime` import in `trading_session.py` is correct (`from datetime import datetime, timezone`) — this was previously flagged as a concern and is confirmed fixed.
- The `REAL_MONEY_RISK_ACKNOWLEDGEMENT_V1` string matches exactly between `live-consent/route.ts` and `client_handler.py`.
- `effectiveLiveTradingEnabled` in `TradingWorkspace.tsx` requires all four conditions: `REAL_EXECUTION_GATEWAY_AVAILABLE && activeAccountIsReal && liveTradingEnabled && liveConsentLoadedAccountId === activeAccount?.account_id` — per-account consent is enforced.
