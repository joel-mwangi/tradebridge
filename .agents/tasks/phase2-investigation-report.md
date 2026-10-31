# Phase 2 Investigation Report
## TradeBridge MT5 Integration — Pending Orders, Position Close, Position Modify, Order History

**Prepared for:** Planning agent (Phase 2 implementation)
**Status of Phase 1:** Fully working end-to-end (market buy/sell orders).
**Phase 2 scope:** Buy Limit, Sell Limit, Buy Stop, Sell Stop; close open position by MT5 ticket; modify open position SL/TP; order history panel.

---

## Executive Summary

Every layer needs additions but **none needs a breaking change to what already works**. The database is the most significant gap: the current `mt5_trade_orders` table has no `order_type` column, no `entry_price` column (required for pending orders), and its `status` CHECK constraint lacks `pending`-specific lifecycle values (`placed`, `cancelled_pending`). Two new tables are also needed (`mt5_position_commands` and a view/query for order history). The FastAPI backend, EA, Next.js proxy, and frontend all need additive changes only.

---

## Layer 1 — Supabase Migrations

### Files read
- `supabase/migrations/20261029100000_add_mt5_trade_orders.sql`
- `supabase/migrations/20261029110000_fix_mt5_lease_next_trade_order.sql`

### Current `mt5_trade_orders` columns

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| device_id | uuid | FK to mt5_devices |
| user_id | uuid | FK to auth.users |
| broker_symbol | text | regex validated |
| order_side | text | CHECK `in ('buy','sell')` |
| volume | numeric | > 0 |
| stop_loss | numeric | nullable |
| take_profit | numeric | nullable |
| deviation_points | integer | nullable |
| magic_number | integer | default 0 |
| account_type | text | CHECK `in ('demo','real')` |
| idempotency_key | text | unique per device |
| expires_at | timestamptz | |
| status | text | see below |
| lease_token | uuid | nullable |
| lease_until | timestamptz | nullable |
| leased_at | timestamptz | nullable |
| submitted_at | timestamptz | nullable |
| mt5_order_ticket | bigint | nullable |
| mt5_deal_ticket | bigint | nullable |
| fill_price | numeric | nullable |
| fill_volume | numeric | nullable |
| fill_time | timestamptz | nullable |
| mt5_retcode | integer | nullable |
| mt5_retcode_description | text | max 300 chars |
| reject_reason | text | max 300 chars |
| requested_at | timestamptz | default now() |
| accepted_at | timestamptz | nullable |
| filled_at | timestamptz | nullable |
| cancelled_at | timestamptz | nullable |
| reconciled_at | timestamptz | nullable |
| expired_at | timestamptz | nullable |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

### Current `status` CHECK constraint values

```
'queued','leased','submitted','accepted','rejected','filled','reconciled','expired','cancelled'
```

### What `mt5_ack_trade_order` accepts as `p_transition`

```
'submitted' | 'accepted' | 'rejected' | 'filled' | 'reconciled'
```

Allowed transition arcs:
- `leased → submitted`
- `submitted → accepted`
- `submitted → rejected`
- `accepted → filled`
- `accepted → reconciled`
- `leased → rejected`
- `submitted → reconciled` (via reconciled arc)

### What is MISSING for pending orders

1. **`order_type` column** — There is no way to distinguish `market`, `buy_limit`, `sell_limit`, `buy_stop`, `sell_stop`. The current table assumes every order is a market order.
2. **`entry_price` column** — Pending orders require an entry price (the limit/stop price at which MT5 should place the order). Without this column, the EA cannot receive the trigger price.
3. **Status values for pending lifecycle** — A pending order in MT5 does not fill immediately; it sits in the broker's order book. Two additional statuses are needed:
   - `placed` — EA sent `OrderSend` for a pending order and the broker accepted it (ticket assigned, no fill yet).
   - `cancelled_pending` — User or EA cancelled the pending order before it triggered.
4. **`placed_at` timestamp column** — Audit column parallel to `filled_at`.
5. **`cancelled_pending_at` timestamp column**.
6. **`mt5_ack_trade_order` transitions** — The function must accept `placed` and `cancelled_pending` transitions, with appropriate FROM states (`accepted → placed`, `placed → cancelled_pending`, `placed → filled`).
7. **`mt5_lease_next_trade_order` return payload** — The function already returns `SELECT *` so `entry_price` and `order_type` will be included once the columns exist. The FastAPI backend's EA lease response must forward those fields.

### What is MISSING for close / modify

**Position close** and **position modify** are fundamentally different commands: they operate on an already-open MT5 position (identified by MT5 ticket), not on a new order queue entry. Storing them in `mt5_trade_orders` would conflate two concerns.

The correct design is a **new table `mt5_position_commands`** with:
- `command_type` — `close` or `modify`
- `mt5_position_ticket` — bigint (the ticket of the open position)
- `volume` — for partial closes (null = full close)
- `new_stop_loss` / `new_take_profit` — for modify
- Its own `status` lifecycle: `queued → leased → submitted → done | rejected | expired`
- Its own lease function and ack functions (parallel to the trade order pattern)

**This is deliberately a separate table** (just as `mt5_commands` and `mt5_trade_orders` are separate) so the existing queue logic is not disturbed.

### What is MISSING for order history

The `mt5_trade_orders` table already stores all terminal statuses (`filled`, `rejected`, `reconciled`, `expired`, `cancelled`). What is missing is:
1. A **backend route** to query historical orders for a device with pagination.
2. A **frontend component** to display that history.

No new table is needed; the existing table's `user_idx` index (`user_id, created_at desc`) already supports efficient per-user history queries.

---

## Layer 2 — FastAPI Backend (`d:\ai-tradingbridge\app\mt5_trade_orders.py`)

### Existing Pydantic models

| Model | Fields |
|-------|--------|
| `CreateTradeOrderRequest` | `broker_symbol`, `order_side`, `volume`, `stop_loss`, `take_profit`, `deviation_points`, `magic_number`, `account_type`, `idempotency_key`, `expires_in_seconds` |
| `EaSubmittedAck` | `lease_token`, `mt5_order_ticket?`, `mt5_retcode?`, `mt5_retcode_description?` |
| `EaAcceptedAck` | `lease_token`, `mt5_order_ticket`, `mt5_retcode?`, `mt5_retcode_description?` |
| `EaRejectedAck` | `lease_token`, `mt5_order_ticket?`, `mt5_retcode?`, `mt5_retcode_description?`, `reject_reason` |
| `EaFilledAck` | `lease_token`, `mt5_order_ticket?`, `mt5_deal_ticket?`, `fill_price`, `fill_volume`, `mt5_retcode?`, `mt5_retcode_description?` |
| `EaReconciledAck` | `lease_token`, `mt5_order_ticket?`, `mt5_deal_ticket?`, `fill_price?`, `fill_volume?`, `reject_reason?`, `mt5_retcode?`, `mt5_retcode_description?` |

### Existing EA-facing routes

| Route | Purpose |
|-------|---------|
| `GET /mt5/ea/trade-orders/next` | Lease next queued trade order |
| `POST /mt5/ea/trade-orders/{id}/ack/submitted` | leased → submitted |
| `POST /mt5/ea/trade-orders/{id}/ack/accepted` | submitted → accepted |
| `POST /mt5/ea/trade-orders/{id}/ack/rejected` | leased|submitted → rejected |
| `POST /mt5/ea/trade-orders/{id}/ack/filled` | accepted → filled |
| `POST /mt5/ea/trade-orders/{id}/ack/reconciled` | accepted|submitted → reconciled |

### Existing user-facing routes

| Route | Purpose |
|-------|---------|
| `POST /mt5/devices/{device_id}/trade-orders` | Create market order |
| `GET /mt5/devices/{device_id}/trade-orders/{order_id}` | Poll order status |
| `POST /mt5/devices/{device_id}/trade-orders/{order_id}/cancel` | Cancel queued order |

### EA lease response (what the EA receives)

```python
"order": {
    "id", "broker_symbol", "order_side", "volume",
    "stop_loss", "take_profit", "deviation_points",
    "magic_number", "account_type", "expires_at", "lease_token"
}
```
**Missing for pending orders:** `order_type`, `entry_price` — these must be added to this response dictionary in `lease_next_trade_order` once the DB columns exist.

### What is MISSING for pending order creation

1. `CreateTradeOrderRequest` needs `order_type: StrictStr` (validated against `market|buy_limit|sell_limit|buy_stop|sell_stop`) and `entry_price: float | None` (required when order_type is not `market`, must be > 0).
2. The `create_trade_order` route must validate `order_type` and `entry_price` consistency (entry_price required for non-market orders, must be None for market).
3. The DB INSERT payload must include `order_type` and `entry_price`.
4. `EaAcceptedAck` is repurposed for market accepted but for pending it maps to `placed` — a new `EaPlacedAck` model is needed (same fields as `EaAcceptedAck` but semantically distinct).
5. A new ack route `POST /mt5/ea/trade-orders/{id}/ack/placed` for the `accepted → placed` transition.
6. A new ack route `POST /mt5/ea/trade-orders/{id}/ack/cancelled-pending` for the `placed → cancelled_pending` transition.

### What is MISSING for position close / modify

A new `mt5_position_commands.py` module (parallel to `mt5_trade_orders.py`) with:

**User-facing:**
- `POST /mt5/devices/{device_id}/position-commands` — Create a close or modify command (body: `command_type`, `mt5_position_ticket`, `volume?`, `new_stop_loss?`, `new_take_profit?`)
- `GET /mt5/devices/{device_id}/position-commands/{cmd_id}` — Poll command status
- `POST /mt5/devices/{device_id}/position-commands/{cmd_id}/cancel` — Cancel before EA pickup

**EA-facing:**
- `GET /mt5/ea/position-commands/next` — Lease next queued command
- `POST /mt5/ea/position-commands/{id}/ack/submitted`
- `POST /mt5/ea/position-commands/{id}/ack/done`
- `POST /mt5/ea/position-commands/{id}/ack/rejected`

### What is MISSING for order history

A new user-facing route:
- `GET /mt5/devices/{device_id}/trade-orders` — Return paginated list of orders for this device, filtered by terminal statuses, ordered by `requested_at desc`. Query params: `limit`, `before` (cursor by `requested_at`).

---

## Layer 3 — MT5 EA (`d:\tradebridge\mt5\TradeBridgeMarketBridge.mq5`)

### What `PollForTradeOrder` currently parses

From the JSON lease response:

```mq5
order_id      = JsonStringField(resp, "id")
broker_symbol = JsonStringField(resp, "broker_symbol")
order_side    = JsonStringField(resp, "order_side")      // "buy" | "sell"
lease_token   = JsonStringField(resp, "lease_token")
account_type  = JsonStringField(resp, "account_type")
volume        = JsonNumberField(resp, "volume")
stop_loss     = JsonNumberField(resp, "stop_loss")
take_profit   = JsonNumberField(resp, "take_profit")
deviation_d   = JsonNumberField(resp, "deviation_points")
magic_d       = JsonNumberField(resp, "magic_number")
```

**Not parsed:** `order_type`, `entry_price` — these don't exist in the response yet.

### What `ExecuteTradeOrder` currently handles

- Account type guard (demo vs real)
- Symbol validation (`SymbolExist`, `SymbolSelect`)
- Volume validation against broker limits; snapping to lot step
- `CTrade.Buy()` or `CTrade.Sell()` at market price (0)
- Four ack paths: submitted → rejected (OrderSend false), submitted → accepted → filled (retcode 10009/10010), submitted → accepted → reconcile (retcode 10008), or defensive reconcile for other retcodes
- `ReconcileSubmittedOrder` for uncertain outcomes

### What is MISSING for pending orders

1. **Parse `order_type` and `entry_price`** in `PollForTradeOrder`:
   ```mq5
   string order_type  = JsonStringField(resp, "order_type");   // "buy_limit" etc.
   double entry_price = JsonNumberField(resp, "entry_price");
   ```

2. **Route to `ExecutePendingOrder`** when `order_type != "market"`. A separate function (not modifying `ExecuteTradeOrder`) handles pending placement:
   - Maps `buy_limit` → `ORDER_TYPE_BUY_LIMIT`, `sell_limit` → `ORDER_TYPE_SELL_LIMIT`, `buy_stop` → `ORDER_TYPE_BUY_STOP`, `sell_stop` → `ORDER_TYPE_SELL_STOP`
   - Calls `CTrade.OrderOpen(broker_symbol, order_type_enum, volume, 0, entry_price, sl, tp, ..., "TradeBridge " + order_id)`
   - On retcode 10008 or 10009 → `AckSubmitted` then `AckPlaced` (new ack function calling `/ack/placed`)
   - Ack for fill: pending orders fill asynchronously; a separate poll of open pending orders by MT5 ticket on each `OnTimer` cycle is needed (or the EA can track `placed` orders in a global array and check `HistoryOrderSelect` each tick)

3. **`AckPlaced`** function — mirrors `AckAccepted` but calls `/ack/placed`. New ack HTTP helper.

4. **`AckCancelledPending`** — mirrors `AckRejected` but calls `/ack/cancelled-pending`.

5. **Pending order fill polling** — After a pending order is placed, the EA needs to detect when it fills. The simplest approach: maintain a global array of `{order_id, lease_token, mt5_ticket, broker_symbol}` for all `placed` orders. Each `OnTimer` call iterates this array, calls `HistoryOrderSelect(ticket)`, and if `ORDER_STATE_FILLED` calls `AckFilled`.

### What close/modify commands would look like

A second poll endpoint `/mt5/ea/position-commands/next` returns JSON with:
```json
{
  "id": "...",
  "command_type": "close",          // "close" | "modify"
  "mt5_position_ticket": 12345678,
  "volume": null,                   // null = full close
  "new_stop_loss": null,
  "new_take_profit": null,
  "lease_token": "..."
}
```

The EA function `ExecutePositionCommand`:
- For `close`: `CTrade.PositionClose(mt5_position_ticket)` or `CTrade.PositionClosePartial(ticket, volume)` for partial
- For `modify`: `CTrade.PositionModify(ticket, new_sl, new_tp)`
- Acks: `submitted` → `done` or `rejected`

A new `PollForPositionCommand()` function called from `OnTimer` (parallel to `PollForTradeOrder`), with its own in-progress guard.

---

## Layer 4 — Next.js Proxy (`d:\tradebridge\src\app\api\mt5\[...path]\route.ts`)

### Current allow-list

```typescript
// Pairing / device management
GET    devices
POST   pairing-codes
POST   pair
DELETE devices/{UUID}

// Trade order lifecycle (Phase 1)
POST   devices/{UUID}/trade-orders
GET    devices/{UUID}/trade-orders/{UUID}
POST   devices/{UUID}/trade-orders/{UUID}/cancel
```

### Paths MISSING for Phase 2

```typescript
// Pending orders (same route, different body — no new proxy rule needed for creation)
// ↑ POST devices/{UUID}/trade-orders already covers pending order creation

// Order history
GET    devices/{UUID}/trade-orders

// Position commands
POST   devices/{UUID}/position-commands
GET    devices/{UUID}/position-commands/{UUID}
POST   devices/{UUID}/position-commands/{UUID}/cancel
```

**Observation:** The proxy uses a `method === "GET" && regex.test(routePath)` pattern. A `GET devices/{UUID}/trade-orders` (list) would currently match nothing because the only GET for trade-orders requires a second UUID. A new allow rule is needed:
```typescript
(method === "GET" && new RegExp(`^devices/${UUID}/trade-orders$`, "i").test(routePath))
```

The proxy also only exposes `GET`, `POST`, `DELETE` methods. Position commands only need `GET` and `POST`; no new HTTP methods are required.

---

## Layer 5 — Frontend (`d:\tradebridge\src\components\trading\ForexOrderPanel.tsx`)

### Current order types shown

The form shows only **Buy** / **Sell** side-switch buttons (market orders). There is no `order_type` selector for limit/stop orders. The `pendingSection` at the bottom explicitly says: _"Pending (limit/stop) orders are Phase 2."_

### `pendingSection` rendering (current)

```tsx
<div className={styles.pendingSection}>
  <div className={styles.pendingHeading}>
    <strong>Pending orders</strong>
    <span>0</span>
  </div>
  <p>
    Pending (limit/stop) orders are Phase 2. Only market orders are
    supported in this build.
  </p>
</div>
```
This is entirely a placeholder — no list, no form, no state.

### Terminal statuses the frontend knows about

```typescript
const TERMINAL_STATUSES = new Set([
  "filled", "rejected", "reconciled", "expired", "cancelled",
]);
```

Missing for pending orders: `placed` is not terminal (order lives in broker book), `cancelled_pending` is terminal. `statusLabel()` also has no entries for `placed` or `cancelled_pending`.

### Entry price field

**Does not exist.** There is no entry price input anywhere in `ForexOrderPanel.tsx`. The `handleSubmit` body does not include `order_type` or `entry_price`. Adding a pending order requires:
1. An `orderType` state variable defaulting to `"market"`.
2. A selector (tabs or dropdown) for `market | buy_limit | sell_limit | buy_stop | sell_stop`.
3. An `entryPrice` input field that appears only when `orderType !== "market"`.
4. Validation: `entryPrice` required and > 0 when order type is non-market.
5. `canSubmit` updated to include entry price validity.
6. The POST body must include `order_type` and `entry_price` for non-market orders.

### The `accountType` prop is hardcoded

In `ForexAnalyst.tsx` line ~1031: `accountType="demo"` is a hardcoded literal. For Phase 2, this should be wired to the user's actual selected account type (passed down from the workspace).

---

## Layer 6 — `ForexOrderPanel.module.css`

### Existing CSS classes relevant to Phase 2

| Class | Current use |
|-------|------------|
| `.pendingSection` | Container for the pending orders area (grid, gap 8px, border-top) |
| `.pendingHeading` | Heading row (flex, space-between) |
| `.pendingHeading strong` | "Pending orders" label (font-size 11px) |
| `.pendingHeading span` | Badge showing order count (20px circle, muted) |
| `.pendingSection p` | Placeholder text (muted, 9px) |
| `.field` | Reusable label+input row (grid, gap 6px) — can be reused for entry price |
| `.reviewCard` | Order status card — can be reused for pending order status display |
| `.dismissButton` | Cancel/dismiss button |
| `.validation` | Error message (red, 9px) |
| `.sideSwitch` | Buy/Sell toggle — layout reusable for order type selector |
| `.reviewBuy` / `.reviewSell` | Submit button styles |

**Missing CSS classes for Phase 2:**
- `.orderTypeSelector` — tab row for market/limit/stop selection (or reuse `.sideSwitch` pattern with more options)
- `.pendingOrderRow` — individual pending order row in the pending section list
- `.pendingOrderSymbol` — icon/badge in each pending row
- `.pendingOrderActions` — cancel button row per pending order
- `.historySection` / `.historyList` / `.historyRow` — for the order history panel (if added to this component vs. a separate `Mt5OrderHistory` component)

The CSS variables `--fx-panel`, `--fx-ink`, `--fx-muted`, `--fx-line`, `--fx-border`, `--fx-surface` are already defined and available for new elements.

---

## Layer 7 — `TradingWorkspace.tsx` / `TradingActivity.tsx`

### How `ForexAnalyst` is rendered (lines 622–625, workspace)

```tsx
{page === "forex-analyst" && (
  <section className={styles.workspaceSection} aria-label="Forex AI chart analyst">
    <ForexAnalyst />
  </section>
)}
```

`ForexAnalyst` is rendered **without any props from TradingWorkspace**. The `mt5Device` is fetched inside `ForexAnalyst` via the `useMt5Device()` hook. The `accountType` is hardcoded to `"demo"` inside `ForexAnalyst` (line ~1031 in ForexAnalyst.tsx).

### `TradingActivity.tsx` — order history pattern

`TradingActivity` handles Deriv open positions and account statement. It is **Deriv-only** and has no concept of MT5 orders. The MT5 order history panel must be a new component (e.g., `Mt5OrderHistory.tsx`) placed inside `ForexOrderPanel` (below the pending section) or as a separate `ForexAnalyst` side panel.

---

## Conclusions and Recommendations

### Decision 1: Database schema additions (one new migration file)

Add to `mt5_trade_orders`:
- `order_type text NOT NULL DEFAULT 'market' CHECK (order_type IN ('market','buy_limit','sell_limit','buy_stop','sell_stop'))`
- `entry_price numeric CHECK (entry_price IS NULL OR entry_price > 0)`
- Status values: expand CHECK to add `'placed','cancelled_pending'`
- Timestamp columns: `placed_at timestamptz`, `cancelled_pending_at timestamptz`
- Update `mt5_ack_trade_order` to accept `placed` (`accepted → placed`) and `cancelled_pending` (`placed → cancelled_pending`) transitions.

Create new table `mt5_position_commands` with its own lease and ack functions.

**Do NOT edit the two already-pushed migration files.** Write all changes as a new migration, e.g. `20261029120000_add_mt5_phase2.sql`.

### Decision 2: New FastAPI module `mt5_position_commands.py`

Keeps concerns separated. Mount via the same `router` pattern as `mt5_trade_orders.py`. `mt5_trade_orders.py` gets minor additions: `order_type`, `entry_price` on `CreateTradeOrderRequest`; a `EaPlacedAck` model; two new ack routes (`/ack/placed`, `/ack/cancelled-pending`); a `GET /devices/{device_id}/trade-orders` history route.

### Decision 3: EA changes are additive only

`PollForTradeOrder` dispatches to either `ExecuteTradeOrder` (unchanged, market) or `ExecutePendingOrder` (new) based on `order_type`. A `PollForPositionCommand()` is added to `OnTimer`. A global array tracks placed pending orders for fill detection.

### Decision 4: Proxy allow-list additions

Three new lines in the `allowed` block of `route.ts`. No structural change.

### Decision 5: Frontend — extend `ForexOrderPanel` for pending order form

Add `orderType` state and selector above the side-switch. Show `entryPrice` field conditionally. Refactor `pendingSection` from a placeholder into a live list showing the device's currently placed pending orders (fetched from the history route, filtered by `status = 'placed'`). Add a separate `Mt5OrderHistory` component rendered below the pending section showing terminal-status orders.

### Decision 6: Wire `accountType` dynamically

`ForexAnalyst.tsx` should accept `accountType` as a prop from `TradingWorkspace` instead of hardcoding `"demo"`. This is a Phase 2 prerequisite for real-account pending orders.

---

## Gap / Risk Notes

1. **Pending order fill detection is async** — MT5 pending orders can sit unfilled indefinitely. The EA needs a polling loop or `OnTradeTransaction` handler to detect when a placed order fills. `OnTradeTransaction` is cleaner than polling an array but requires restructuring the EA's event model. Recommend using `OnTradeTransaction` and having it call `AckFilled` when it receives a fill for a known TradeBridge ticket.

2. **Partial close** — MT5 allows partial position close. The `mt5_position_commands` table must accommodate `volume` (null = full close) and the EA must use `CTrade.PositionClosePartial`.

3. **Hardcoded `accountType="demo"`** in `ForexAnalyst.tsx` — must be fixed before Phase 2 can be used with real accounts. Low-risk change but required.

4. **Order history pagination** — The `mt5_trade_orders` table's `user_idx` index supports `user_id, created_at desc`. Backend route should support cursor-based pagination (`before` timestamp) rather than offset to avoid skipping rows on inserts.

5. **`TERMINAL_STATUSES` in `ForexOrderPanel`** — must add `cancelled_pending`; `placed` is NOT terminal.

6. **The proxy only exposes GET, POST, DELETE** — position commands only need GET and POST, so no new HTTP methods are needed in `route.ts`.
