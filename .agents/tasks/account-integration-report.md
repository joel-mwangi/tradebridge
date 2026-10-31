# TradeBridge Demo / Real Account Integration Report

**Scope:** Full stack investigation — frontend (d:\tradebridge), backend (d:\ai-tradingbridge), EA (mt5/TradeBridgeMarketBridge.mq5).  
**Investigation date:** 2025-10  
**Status:** Read-only analysis. No code was changed.

---

## Executive Summary

Demo trading is fully wired end-to-end for both Deriv Options and Multipliers. Real-account Deriv Options and Multipliers trading is also fully gated with a multi-layer safety system (server env flag + per-account DB consent + server-side daily P/L check). MT5 market and pending orders, and position close/modify commands, are fully wired with EA-side account-type guards that match the `account_type` field in every order.

The principal gaps are:

1. **Backend `.env` does not set `TRADEBRIDGE_REAL_TRADING_ENABLED` or `TRADEBRIDGE_REAL_MAX_STAKE`** — real-account Deriv trading is permanently blocked until these are set on the deployed backend.
2. **No backend-side `TRADEBRIDGE_REAL_MAX_STAKE` equivalent for MT5 real orders** — `create_trade_order` and `create_position_command` accept real-account orders without volume/stake validation on the backend. The only check is the EA's `InpAccountType` guard (which is correct), and a hard `_MAX_VOLUME = 100.0` lot cap, but there is no per-user configurable backend maximum for real MT5 orders.
3. **Frontend `.env.example` is missing backend real-account env vars** — operators have no template for `TRADEBRIDGE_REAL_TRADING_ENABLED` or `TRADEBRIDGE_REAL_MAX_STAKE`.
4. **`REAL_EXECUTION_GATEWAY_AVAILABLE` is hardcoded `true` in TradingWorkspace** — this flag was the original safety lock for Deriv Options real trading when only browser-side WebSockets existed; it is now bypassed by the flag being hardcoded. The safety is now fully provided by the backend, but the code comment and variable no longer reflect that.
5. **MT5 ForexOrderPanel does not display a visible "real account extra confirmation" modal** — the panel shows a ⚠ REAL ACCOUNT badge but there is no additional "are you sure?" modal or checkbox before submitting real MT5 orders.

---

## Area 1 — Deriv Account Connection (TradingWorkspace.tsx)

### What works correctly

- `DerivAccount.account_type` is returned from the backend `/deriv/accounts` route (`routes.py`, lines normalizing `account_type` from the Deriv API response). The field is `"demo"` or `"real"`.
- `isDemoAccount()` / `isRealAccount()` compare `account.account_type.toLowerCase()` to `"demo"` / `"real"`.
- `activeAccountIsDemo` and `activeAccountIsReal` derive from the selected account. Both are used consistently throughout the component.
- `effectiveLiveTradingEnabled` is a **conjunction of four conditions**:
  ```ts
  REAL_EXECUTION_GATEWAY_AVAILABLE   // true (hardcoded)
  && activeAccountIsReal             // account_type === "real"
  && liveTradingEnabled              // loaded from /api/auth/deriv/live-consent
  && liveConsentLoadedAccountId === activeAccount?.account_id
  ```
  The last condition (`liveConsentLoadedAccountId`) ensures consent loaded for a different account does not unlock the current one.
- `effectiveLiveTradingEnabled` is correctly passed to `useTradingSession` and `useMultipliersTrading` as `realTradingEnabled`.
- `accountType` is passed to `ForexAnalyst` at line 624 as `activeAccountIsReal ? "real" : "demo"`, and `ForexAnalyst` passes it through to `ForexOrderPanel`.
- Switching from demo → real triggers `handleAccountChange` → `setPendingRealAccount` + `setShowRealSwitchConfirm(true)`, which opens a confirmation dialog that saves live consent before switching.
- Live consent is loaded per-account on `activeAccountIsReal` change; resetting both `liveTradingEnabled` and `liveConsentLoadedAccountId` before the fetch prevents a stale consent from briefly enabling real trading on the new account.

### Issues / Gaps

**Issue A (Low, cosmetic):** `REAL_EXECUTION_GATEWAY_AVAILABLE` is hardcoded `true` at line ~36. It was introduced as a safety flag; now it is always `true`, and `LiveTradingControls` has a dead `!executionGatewayAvailable` branch that reads "Real-money order entry is disabled for safety." This branch is unreachable, which is confusing for maintainers.

**Fix:** Either remove the constant and always pass `true`, or document clearly that it is intentionally permanent. No functional change needed; the backend provides the real gate.

---

## Area 2 — MT5 Order Panel (ForexOrderPanel.tsx)

### What works correctly

- `accountType` prop defaults to `"demo"` and is passed to the submit body as `account_type` in every order (market, pending, position command). Evidence: `handleSubmit` body at the `account_type: accountType` line; `handlePosSubmit` body similarly.
- The panel header renders `⚠ REAL ACCOUNT` in red when `accountType === "real"`, and `DEMO ACCOUNT` in green otherwise.
- No remaining hardcoded `"demo"` strings in order submission paths. All paths pass the prop.
- The `No EA paired` warning is shown and the submit button is disabled without `deviceId`.
- Quote-freshness gate (`quoteFresh`) blocks submission if the quote is stale.

### Issues / Gaps

**Issue B (Medium):** There is no extra confirmation step before submitting a real MT5 order. Unlike Deriv Options (which has a multi-step LiveTradingControls consent flow), a real MT5 order is submitted with the same single button click as a demo order. The ⚠ badge is a visual cue only; there is no checkbox or "Confirm this is a real-money order" prompt.

**Fix:** Before calling `handleSubmit` / `handlePosSubmit` when `accountType === "real"`, show a `window.confirm()` or an inline confirmation step. This is an app-level safety measure consistent with what the position close command already does (`window.confirm(...)` in `useMultipliersTrading.ts`).

---

## Area 3 — MT5 Bridge Backend (mt5_trade_orders.py, mt5_position_commands.py, mt5_bridge.py)

### What works correctly

- `create_trade_order` validates `account_type` is `"demo"` or `"real"` (raises HTTP 422 otherwise).
- Volume is capped at `_MAX_VOLUME = 100.0` lots — a hard absolute limit.
- `order_type` and `entry_price` consistency is validated (market orders must omit entry_price; pending orders require it).
- Idempotency is enforced: same key + same symbol/side returns the existing order; same key + different params raises 409.
- `create_position_command` validates `account_type` is `"demo"` or `"real"` (raises HTTP 422).
- Both routes verify the device belongs to the authenticated user and has `status == "paired"` before creating the row.
- The `account_type` value is stored in the database and returned to the EA in `lease_next_trade_order` and `lease_next_position_command` responses.

### Issues / Gaps

**Issue C (High — missing server-side MT5 real-order cap):** Neither `create_trade_order` nor `create_position_command` enforce any per-user configurable maximum volume for real-account orders. The only backend limit is the absolute `_MAX_VOLUME = 100.0` (100 lots — very large for a real account). There is no equivalent of `TRADEBRIDGE_REAL_MAX_STAKE` for MT5 real orders.

The EA does perform its own `InpAccountType` guard (see Area 7), but that is a client-side check: a malicious or misconfigured client could submit a real-account order of 100 lots and the backend would accept it.

**Fix:** Add a `TRADEBRIDGE_MT5_REAL_MAX_VOLUME` environment variable read in `create_trade_order`. When `body.account_type == "real"` and the variable is set, reject orders where `body.volume > configured_limit` with HTTP 422. Implement the same for `create_position_command` (partial close volume). The backend README example already documents a pattern to follow from `TRADEBRIDGE_REAL_MAX_STAKE`.

---

## Area 4 — Deriv Trading Session (useDemoTrading.ts / useMultipliersTrading.ts / LiveTradingControls.tsx)

### What works correctly

**Demo trading (options):**
- `useTradingSession` connects when `connected && account && accountType in ["demo","real"]`.
- For demo accounts, no extra gate is needed and the session opens directly.
- Balance, portfolio, statement, profit_table, and transaction subscriptions are all wired.
- Order resolution (localStorage key) prevents races across tabs.

**Real trading (options):**
- After connection, `localSocket.onopen` sends `{ real_trading: { action: "confirm", confirmation: "ENABLE REAL TRADING" } }` when `isRealAccount && realTradingEnabled`.
- The backend `_handle_real_trading_control` handler in `client_handler.py` checks: `TRADEBRIDGE_REAL_TRADING_ENABLED == "true"`, `TRADEBRIDGE_REAL_MAX_STAKE` is set and positive, DB consent exists with `REAL_MONEY_RISK_ACKNOWLEDGEMENT_V1`, consent stake and daily-loss limits are finite and positive.
- Only after this confirmation does the backend send `real_trading_status: { enabled: true }` back to the client.
- In `useTradingSession` (`onmessage`), when `message.type === "real_trading_status"` and `enabled === true`, `sessionState` is set to `"Real trading connected"`.
- Every proposal and buy is re-checked through `_real_trading_gate_error` server-side before forwarding to Deriv.
- Server-side daily P/L is polled every 15 seconds by `real_risk_monitor`; it goes stale after 30 seconds, blocking trades.

**Real trading (multipliers):**
- `useMultipliersTrading` follows the identical flow: sends `real_trading` confirm, listens for `real_trading_status`, gates all proposals through `canTrade` (`realTradingEnabled && realSessionConfirmed`).

**LiveTradingControls:**
- Requires checkbox acknowledgement + valid stake/loss limits.
- Requires `TRADEBRIDGE_BACKEND_URL` to be set server-side before writing consent (live-consent POST route).
- Separate consent record per `(user_id, deriv_account_id)` in `deriv_live_trading_consents`.

### Issues / Gaps

**Issue D (Critical, deployment — already documented in backend README):** `TRADEBRIDGE_REAL_TRADING_ENABLED` and `TRADEBRIDGE_REAL_MAX_STAKE` are **not present in the deployed `.env`**. The backend `.env` only contains `BRIDGE_API_KEY`, `BRIDGE_ADMIN_API_KEY`, `BRIDGE_MIN_CONFIDENCE`, `BRIDGE_MAX_STAKE`, `BRIDGE_MAX_SIGNALS_PER_MINUTE`, `BRIDGE_ALLOWED_SYMBOLS`, `DERIV_APP_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. These are legacy bot-runner variables. The backend README does document these variables (commented out), but they are not configured.

**Effect:** Any attempt to enable real Deriv Options/Multipliers trading will be rejected by the backend with `REAL_TRADING_DISABLED`. This is a safe failure (fails closed), but real trading cannot be enabled until the operator sets these variables.

**Fix:** Add to the backend `.env` (server-side only, never frontend):
```
TRADEBRIDGE_REAL_TRADING_ENABLED=true
TRADEBRIDGE_REAL_MAX_STAKE=10
```
Choose a conservative initial `max_stake`. The per-account consent further limits it to `min(env_limit, consent_max_stake)`.

---

## Area 5 — Backend Real-Account Safety (deriv/routes.py, deriv/client_handler.py)

### What works correctly

- **`TRADEBRIDGE_REAL_TRADING_ENABLED`** (client_handler.py line 50): master switch; defaults to `"false"`. Real trading is off until explicitly enabled.
- **`TRADEBRIDGE_REAL_MAX_STAKE`** (client_handler.py `_configured_stake_limit`): absolute server-side stake ceiling; when set, it is combined with the per-account `consent.max_stake` as `min(env_limit, consent_max_stake)`. If not set for real, `_configured_stake_limit` returns `None`, which itself blocks trading.
- **Per-account consent** (`_load_live_trading_consent` → `deriv_live_trading_consents` table): checked on every proposal and buy, not just at connection time.
- **Server-trusted daily P/L** (`real_risk_monitor` in `trading_session.py`): polls Deriv every 15 s; proposal/buy blocked if P/L stale or daily-loss limit hit.
- **`live-consent` Next.js route** (`/api/auth/deriv/live-consent/route.ts`): requires `TRADEBRIDGE_BACKEND_URL` to be set before writing consent (prevents enabling consent when the gateway is misconfigured); account ownership is verified through `getOwnedDerivAccountIds` before any write.
- Consent is stored per `(user_id, deriv_account_id)` and validated on read with `acknowledgement_version === "REAL_MONEY_RISK_ACKNOWLEDGEMENT_V1"`.

### Issues / Gaps

**Issue E (Low, informational):** `real_risk_monitor` in `trading_session.py` references `datetime` and `timezone` but the import `from datetime import datetime, timezone` is missing from the module — it uses `import time` only. This will cause a `NameError` at runtime when a real-account WebSocket connects.

Evidence: `trading_session.py` imports at lines 1–16 include `import asyncio, json, logging, math, os, secrets, time` and `from typing import Any` but no `from datetime import datetime, timezone`. The `real_risk_monitor` method (line ~116) calls `datetime.now(timezone.utc)`.

**Fix:**
```python
# In trading_session.py, add:
from datetime import datetime, timezone
```

---

## Area 6 — Auth Flow (/api/auth/deriv/)

### What works correctly

- Demo and real accounts are differentiated by `account_type` returned from Deriv and stored in the frontend state only; no separate demo/real auth routes exist (accounts share one OAuth token).
- Live consent is stored **per `(user_id, deriv_account_id)`** in `deriv_live_trading_consents`, so demo and real accounts have independent consent records.
- Account ownership is verified at every consent GET/POST through `getOwnedDerivAccountIds`, which calls `POST /internal/account-ownership` on the FastAPI backend (uses `deriv_account_links` table).
- The frontend `liveConsentLoadedAccountId` guard ensures that switching accounts resets the consent state before the new account's consent is loaded.
- The live-consent POST refuses to write new consent if `TRADEBRIDGE_BACKEND_URL` is not set (prevents a misconfigured deployment from storing consent it cannot enforce).

### Issues / Gaps

None found. The auth-level demo/real differentiation is correctly implemented.

---

## Area 7 — EA (TradeBridgeMarketBridge.mq5)

### What works correctly

**Account type guard in `ExecuteTradeOrder`:**
```mql5
long account_mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
bool is_demo_account = (account_mode == 0) || (account_mode == 1); // DEMO or CONTEST
bool order_expects_demo = (account_type_str == "demo");

if (order_expects_demo != is_demo_account) {
    AckRejected(..., "ACCOUNT_TYPE_MISMATCH", reason);
    return;
}
```
This guard is present and correct in all three execution paths:
- `ExecuteTradeOrder` (market orders)
- `ExecutePendingOrder` (limit/stop orders — same guard at top of function)
- `ExecutePositionCommand` (close/modify — same guard, acks submitted then rejected)

**OnInit guard:**
```mql5
if (InpAccountType != "demo" && InpAccountType != "real") {
    Print("InpAccountType must be 'demo' or 'real'.");
    return INIT_PARAMETERS_INCORRECT;
}
```
EA refuses to start if `InpAccountType` is invalid.

**Volume validation:** `min_lot / max_lot` range checked before execution; volume is snapped to `lot_step`.

**`InpAccountType` vs runtime account:** The guard compares the *runtime* MT5 account mode (`AccountInfoInteger(ACCOUNT_TRADE_MODE)`) against the *order's* `account_type` field, not `InpAccountType`. This means if a user has `InpAccountType = "demo"` but is connected to a real MT5 account, a real-account order (`account_type = "real"`) will be correctly blocked, and a demo order on a real account will also be blocked. This is the strongest possible guard.

### Issues / Gaps

**Issue F (Low):** There is no max-volume guard for real-account orders in the EA. A real order for 100 lots (the backend cap) would pass the EA guard and be sent to the broker. If the broker has a lower limit, it will be rejected with retcode; if not, it will execute. The backend should enforce this limit (see Issue C).

**Issue G (Minor):** The `InpAccountType` input is a string with no dropdown in the EA input panel. An operator could typo it. The `OnInit` guard catches this and returns `INIT_PARAMETERS_INCORRECT`, so it's safe but could be user-unfriendly. Not a functional gap.

---

## Area 8 — Environment Variables

### Frontend (d:\tradebridge\.env.example)

```dotenv
NODE_ENV=development
APP_URL=
DERIV_OAUTH_CLIENT_ID=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
TRADEBRIDGE_BACKEND_URL=
TRADEBRIDGE_SESSION_BRIDGE_TOKEN=
NEXT_PUBLIC_TRADEBRIDGE_BACKEND_HTTP_URL=
NEXT_PUBLIC_TRADEBRIDGE_BACKEND_WS_URL=
NEXT_PUBLIC_TRADEBRIDGE_BACKEND_MARKET_WS_URL=
```

**Missing from `.env.example`:** No `TRADEBRIDGE_REAL_MAX_STAKE`, `TRADEBRIDGE_REAL_TRADING_ENABLED` (these are backend-only, so correct to exclude from frontend). However, the example also lacks a comment explaining what the operator must set on the backend before real trading works.

### Backend (d:\ai-tradingbridge) — `.env.example` does not exist

The backend has no `.env.example`. The actual `.env` contains only legacy bot-runner keys (`BRIDGE_API_KEY`, etc.) and the required Supabase/Deriv keys, but is missing:

| Variable | Required for real trading | Currently in .env |
|---|---|---|
| `TRADEBRIDGE_REAL_TRADING_ENABLED` | Yes (Deriv Options/Multipliers real orders) | ❌ Missing |
| `TRADEBRIDGE_REAL_MAX_STAKE` | Yes (Deriv Options/Multipliers real orders) | ❌ Missing |
| `TRADEBRIDGE_DEMO_MAX_STAKE` | No (defaults to 1000) | ❌ Missing (uses default) |
| `TRADEBRIDGE_SESSION_BRIDGE_TOKEN` | Yes (Next.js→backend token) | Unknown |
| `TRADEBRIDGE_CREDENTIAL_ENCRYPTION_KEY` | Yes (encrypts Deriv OAuth tokens) | Unknown |
| `TRADEBRIDGE_ALLOWED_ORIGINS` | Yes (CORS) | Unknown |

The backend README documents all of these correctly. The gap is operational (the variables are not set), not a code defect.

**Fix:**
1. Create `d:\ai-tradingbridge\.env.example` mirroring the README's template.
2. Add to the production backend environment:
   ```
   TRADEBRIDGE_REAL_TRADING_ENABLED=true
   TRADEBRIDGE_REAL_MAX_STAKE=10
   TRADEBRIDGE_DEMO_MAX_STAKE=1000
   ```

---

## Consolidated Findings

| # | Severity | Area | Finding | Fix |
|---|---|---|---|---|
| A | Low | TradingWorkspace | `REAL_EXECUTION_GATEWAY_AVAILABLE = true` is dead code; the "safety lock" branch is unreachable | Remove or document the constant |
| B | Medium | ForexOrderPanel | No confirmation prompt before submitting real MT5 orders | Add `window.confirm()` or inline confirmation when `accountType === "real"` |
| C | High | Backend MT5 | No server-side maximum volume check for real MT5 orders; only absolute 100-lot hard cap | Add `TRADEBRIDGE_MT5_REAL_MAX_VOLUME` env var check in `create_trade_order` and `create_position_command` |
| D | Critical | Backend .env | `TRADEBRIDGE_REAL_TRADING_ENABLED` and `TRADEBRIDGE_REAL_MAX_STAKE` not set in production | Set these in backend environment; real Deriv trading is currently blocked |
| E | High | trading_session.py | `real_risk_monitor` uses `datetime.now(timezone.utc)` but `datetime`/`timezone` not imported | Add `from datetime import datetime, timezone` to `trading_session.py` |
| F | Low | EA | No max-volume guard for real orders in EA (relies on backend or broker rejection) | Implement Issue C at backend level |
| G | Low | EA | `InpAccountType` is a free-text string input | Cosmetic; `OnInit` guard catches typos |

---

## Summary of Integration Status

| Feature | Demo | Real |
|---|---|---|
| Deriv account detection | ✅ Full | ✅ Full |
| Deriv Options trading | ✅ Full | ✅ Full (blocked by missing env vars — Issue D) |
| Deriv Multipliers trading | ✅ Full | ✅ Full (blocked by missing env vars — Issue D) |
| MT5 market orders | ✅ Full | ✅ Full (no backend volume cap — Issue C) |
| MT5 pending orders | ✅ Full | ✅ Full (no backend volume cap — Issue C) |
| MT5 position close/modify | ✅ Full | ✅ Full (no backend volume cap — Issue C) |
| EA account-type guard | ✅ Solid | ✅ Solid |
| Server-side stake/loss limits | ✅ (Demo) | ✅ Code present, ❌ env vars missing |
| Live consent gate | N/A | ✅ Correct |
| Auth differentiation | ✅ | ✅ |
