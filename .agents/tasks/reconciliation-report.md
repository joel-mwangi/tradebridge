# Account Reconciliation Investigation Report

**Date:** 2025-10-29  
**Scope:** TradeBridge web app ↔ MT5 desktop terminal — position sync gap analysis

---

## Summary Answer

**There is zero account reconciliation between the TradeBridge web app and MT5.**

The EA is a pure command consumer. It polls for orders the backend queues and executes them. It never pushes any unsolicited state back to the backend: no position snapshot, no account balance, no equity, no list of open positions. The backend's only record of what is open in MT5 is the `mt5_trade_orders` table, which tracks only orders that were placed through TradeBridge. It is therefore blind to:

1. Positions opened directly in the MT5 terminal (not via TradeBridge).
2. Positions closed directly in the MT5 terminal — their `mt5_trade_orders` rows stay `filled` forever.
3. Current account balance, equity, margin, and free-margin — none of these are ever sent to the backend.

The "Close / Modify position" panel in `ForexOrderPanel.tsx` requires the user to manually type the MT5 ticket number because there is no live position list to show. The frontend has no idea what is currently open.

---

## Evidence

### 1. EA — no position snapshot, no heartbeat push

**File:** `d:\tradebridge\mt5\TradeBridgeMarketBridge.mq5`

The EA has three poll functions, called from `OnTimer()` on each `InpPollSeconds` tick:

```
PollForCommand()          // market-selection commands
PollForTradeOrder()       // trade orders (Phase 1 + 2)
PollForPositionCommand()  // position close/modify commands (Phase 2)
```

All three are **GET** requests to read a command from a queue. None of them POST any unsolicited data to the backend. There is no `PostAccountSnapshot()` function. There is no `PostOpenPositions()` function. There is no heartbeat endpoint.

`OnTradeTransaction` (Phase 2 addition) handles exactly one case: when a tracked pending order fills, it calls `AckFilled(...)`. It only fires for pending orders that TradeBridge itself placed and that were added to `g_placed_orders[]`. It does not report any other trade events — no external closes, no externally opened positions, no SL/TP hits on positions the user opened manually.

`AccountInfoInteger(ACCOUNT_TRADE_MODE)` is called in `ExecuteTradeOrder` and `ExecutePositionCommand`, but only locally to validate the demo/real guard. The result is never transmitted to the backend.

**Confirmed absence:** A grep for `snapshot`, `heartbeat`, `balance`, `equity`, `margin`, `AccountInfo` across the EA file returns zero matches, confirming no account-info transmission exists anywhere in the EA.

---

### 2. Backend — no snapshot receive endpoint, no open-positions list

**File:** `d:\ai-tradingbridge\app\mt5_position_commands.py`

This module adds Phase 2 position close/modify routing. Routes present:

- `POST /mt5/devices/{device_id}/position-commands` — user queues a close or modify command.
- `GET /mt5/devices/{device_id}/position-commands/{cmd_id}` — user polls a specific command's status.
- `POST /mt5/devices/{device_id}/position-commands/{cmd_id}/cancel` — user cancels a queued command.
- `GET /mt5/ea/position-commands/next` — EA polls for the next queued command.
- `POST /mt5/ea/position-commands/{cmd_id}/ack/{submitted|done|rejected}` — EA acks a command.

There is **no endpoint** for the EA to POST a snapshot of open positions. There is **no endpoint** for the frontend to GET a live list of open positions.

**File:** `d:\ai-tradingbridge\app\mt5_trade_orders.py`

This module handles Phase 1+2 trade order execution. Routes present:

- `POST /mt5/devices/{device_id}/trade-orders` — user creates a trade order.
- `GET /mt5/devices/{device_id}/trade-orders/{order_id}` — user polls a single order.
- `GET /mt5/devices/{device_id}/trade-orders` — returns paginated order *history* (all statuses).
- `POST .../cancel` — cancels a queued order.
- `GET /mt5/ea/trade-orders/next` — EA leases the next queued order.
- `POST /mt5/ea/trade-orders/{order_id}/ack/{submitted|accepted|rejected|filled|reconciled|placed|cancelled-pending}` — EA acks state transitions.

Again, **no snapshot receive endpoint** exists. `list_trade_orders` returns everything in `mt5_trade_orders` for a device — including records in `filled` status — but this is not an open-positions list; it is an order log. A `filled` row means "this order was once opened", not "this position is still open."

**File:** `d:\ai-tradingbridge\app\mt5_bridge.py`

The device ack (`POST /mt5/ea/commands/{command_id}/ack`) stores `outcome`, `result_code`, and `result_message` — only market-selection outcomes. The `PATCH mt5_devices` call on every authorized request updates `last_seen_at` (last EA heartbeat). That is the only state the device record carries; it has no position fields.

A grep for `snapshot`, `heartbeat`, `balance`, `equity`, `margin`, `position.*list`, `open.*positions` across all `.py` files returns zero matches.

---

### 3. Database — no positions table, no account snapshots table

**Migration files in** `d:\tradebridge\supabase\migrations\`:

| Migration | Tables/functions created |
|---|---|
| `20261028130000_add_mt5_market_command_storage.sql` | `mt5_pairing_codes`, `mt5_devices`, `mt5_commands` |
| `20261028170000_reject_expired_mt5_command_leases.sql` | update to `mt5_commands` |
| `20261029100000_add_mt5_trade_orders.sql` | `mt5_trade_orders` |
| `20261029110000_fix_mt5_lease_next_trade_order.sql` | update to `mt5_lease_next_trade_order` |
| `20261029120000_add_mt5_phase2.sql` | adds columns to `mt5_trade_orders`; creates `mt5_position_commands` |

**No `mt5_positions` table exists.** No `mt5_account_snapshots` table exists. No `mt5_positions_snapshot` table exists.

The `mt5_trade_orders` table's `status` column tracks one-way lifecycle (`queued → leased → submitted → accepted → filled`). There is no `closed_at` column, no `close_price`, no `closed_by` field. Once a row reaches `filled`, it never transitions again. If the position is later closed manually in MT5, the `filled` row sits unchanged.

The `mt5_position_commands` table (`done` status) records that TradeBridge sent a close/modify command and that the EA acknowledged execution. It does not record the resulting MT5 position state, nor does it mark the corresponding `mt5_trade_orders` row as closed.

---

### 4. Frontend — ticket number is always manual entry

**File:** `d:\tradebridge\src\components\trading\ForexOrderPanel.tsx`

The "Close / Modify position" section (lines ~440–510 of the component) renders:

```tsx
<label className={styles.field}>
  <span>MT5 position ticket</span>
  <input inputMode="numeric" value={posTicket} onChange={(e) => setPosTicket(e.target.value)} placeholder="e.g. 5819158396" />
</label>
```

The `posTicket` state is entirely user-typed. There is no `useEffect` or `fetch` call that populates it from a server-side positions list. The `loadOrders()` function (called on mount) fetches from `/api/mt5/devices/${deviceId}/trade-orders?limit=100` — this returns the trade order history. It sets `placedOrders` (pending-in-broker-book orders) and `history` (terminal orders). It does not set any open-position list, and none of those objects contain the ticket field shown in the close/modify form.

There is no component, hook, or API call anywhere in the frontend codebase that fetches a live snapshot of open MT5 positions.

The `placedOrders` list (pending TradeBridge orders at the broker) does exist and is shown, but this is limited to pending orders placed in the current browser session, not all open positions in MT5.

---

## Mismatch Map

| Scenario | mt5_trade_orders state | What the frontend shows | Reality in MT5 |
|---|---|---|---|
| Position opened via TradeBridge | Row with `status=filled` | Appears in order history as "Filled ✓" | Position may still be open or may have been closed manually |
| Position closed via TradeBridge close command | `mt5_trade_orders` row stays `filled`; `mt5_position_commands` row becomes `done` | No visual change to the filled order row | Position is closed |
| Position opened directly in MT5 desktop | No row at all | Invisible to web app | Open |
| Position closed via MT5 SL/TP hit | `mt5_trade_orders` row stays `filled` | Still shown as "Filled ✓" | Closed |
| Position closed manually in MT5 | `mt5_trade_orders` row stays `filled` | Still shown as "Filled ✓" | Closed |
| Account balance / equity | Never stored | Never shown | Unknown to backend |

---

## What a Full Reconciliation System Would Need

### EA additions

1. **Periodic position snapshot POST.** On every N-th timer tick (e.g., every 30 seconds or every 5 ticks), the EA calls a new backend endpoint:

   ```
   POST /mt5/ea/snapshot
   {
     "account_balance": AccountInfoDouble(ACCOUNT_BALANCE),
     "account_equity": AccountInfoDouble(ACCOUNT_EQUITY),
     "account_margin": AccountInfoDouble(ACCOUNT_MARGIN),
     "account_free_margin": AccountInfoDouble(ACCOUNT_FREE_MARGIN),
     "account_currency": AccountInfoString(ACCOUNT_CURRENCY),
     "positions": [
       {
         "ticket":       PositionGetInteger(POSITION_TICKET),
         "symbol":       PositionGetString(POSITION_SYMBOL),
         "type":         PositionGetInteger(POSITION_TYPE),  // 0=buy, 1=sell
         "volume":       PositionGetDouble(POSITION_VOLUME),
         "open_price":   PositionGetDouble(POSITION_PRICE_OPEN),
         "current_price":PositionGetDouble(POSITION_PRICE_CURRENT),
         "sl":           PositionGetDouble(POSITION_SL),
         "tp":           PositionGetDouble(POSITION_TP),
         "profit":       PositionGetDouble(POSITION_PROFIT),
         "open_time":    PositionGetInteger(POSITION_TIME),
         "magic":        PositionGetInteger(POSITION_MAGIC),
         "comment":      PositionGetString(POSITION_COMMENT)
       }
       // ... for i in range(PositionsTotal())
     ]
   }
   ```

   This snapshot replaces any previous snapshot for the device; it is not appended. The EA iterates `PositionsTotal()` and calls `PositionGetTicket(i)` / `PositionSelectByIndex(i)` to build the list.

### Backend additions

2. **`mt5_account_snapshots` table.** Stores one row per device (upsert on device_id). Columns: `device_id`, `account_balance`, `account_equity`, `account_margin`, `account_free_margin`, `account_currency`, `positions` (JSONB array), `captured_at`.

3. **`POST /mt5/ea/snapshot` endpoint** (EA-facing, device-auth). Upserts the `mt5_account_snapshots` row for this device. No lease, no queue — just an idempotent write.

4. **`GET /mt5/devices/{device_id}/snapshot` endpoint** (user-facing, JWT-auth). Returns the latest snapshot for the device including positions array and account info. Verifies device belongs to the requesting user.

5. **Reconciliation logic** (can be a backend-side function or a frontend-side comparison):
   - For each position in the snapshot: look for a `mt5_trade_orders` row with matching `mt5_order_ticket` (or `mt5_deal_ticket`) and `status=filled`. If found → "opened via TradeBridge". If not found → "opened externally".
   - For each `mt5_trade_orders` row with `status=filled`: check whether the snapshot contains a position with a matching ticket. If not → "closed externally" (flag the row or expose via API).

### Frontend additions

6. **Open positions panel.** A new section in `ForexOrderPanel.tsx` (or a sibling component) that:
   - Calls `GET /api/mt5/devices/{deviceId}/snapshot` on mount and on a 30-second interval.
   - Renders each position from the snapshot's `positions` array: symbol, side, volume, open price, current price, unrealized P&L, SL, TP.
   - Marks positions "via TradeBridge" vs "external" (the reconciliation comparison).
   - Flags `filled` orders whose ticket is absent from the snapshot as "closed externally".
   - Replaces the manual ticket entry in the close/modify form with a dropdown populated from the snapshot positions.

7. **Account info bar.** Show balance, equity, margin, and free-margin from the snapshot, refreshed on the same poll interval.

---

## Priority Order for Implementation

1. **EA: add snapshot POST** — prerequisite for everything else. No schema changes needed until the backend endpoint exists.
2. **Backend: `mt5_account_snapshots` table + migration** — enable the EA to write state.
3. **Backend: `POST /mt5/ea/snapshot` endpoint** — receives the EA's push.
4. **Backend: `GET /mt5/devices/{device_id}/snapshot` endpoint** — exposes it to the frontend.
5. **Frontend: open positions panel + account info bar** — consumes the snapshot.
6. **Frontend: replace manual ticket entry with position dropdown** — UX improvement, depends on (5).
7. **Backend: reconciliation comparison** — flag externally-opened and externally-closed positions.
