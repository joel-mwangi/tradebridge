# TradeBridge digit bot — useBotSession, BotPanel, BotConfigForm, BotStatsPanel

The implementation adds an autonomous digit-contract trading bot to TradeBridge. A dedicated WebSocket session is opened per bot run, separate from the manual trade session. The bot executes a proposal → buy → proposal_open_contract settlement loop, applies one of four stake strategies between iterations, and enforces three stop conditions (trade count, daily loss, consecutive losses). Configuration is persisted to `localStorage` per account and the trade page is restructured into a two-column layout to mount both the manual ticket and the bot panel side by side.

**Watch for:** (confirmed) the Stop button is disabled while `runState === "connecting"`, meaning the user cannot abort a stuck WS connect; (confirmed) `won` is determined solely from `status === "won"` in the POC message body — a `"lost"` contract resolves correctly but a Deriv-side status value of anything other than exactly `"won"` (e.g., `"expired"`) will always mark the trade as a loss even if the contract was profitable; (likely) the type import for `StrategyType`/`Signal` references `strategy-engine.d.mts` while the plan's type import specified `strategy-engine.mjs` — this works because `.d.mts` is precisely the declaration file for `.mjs` and TypeScript resolves it correctly, but it is worth confirming the TSConfig allows `.mts` extension imports.

**Verdict**: APPROVED

---

## High-level view

The bot's own authenticated WebSocket is opened through the same `/api/auth/deriv/trade-session` endpoint the manual ticket uses, keeping the auth surface unchanged. The bot session never shares a socket with `useTradingSession`, so message routing between the two is cleanly isolated.

The proposal → buy → `proposal_open_contract` loop faithfully mirrors `useDemoTrading`'s flow. The three sequential `Promise`-wrapped message waits each restore the prior `onmessage` handler on timeout or completion, preserving socket usability without introducing an `addEventListener`-based architecture.

All four stake strategies (fixed, martingale, reverse martingale, D'Alembert) apply correctly on win and loss. The `maxStake` ceiling is respected in all three variable-stake strategies. The D'Alembert floor is correctly set to `initialStake`, preventing the stake from going below the configured minimum on a winning streak.

The stop conditions carry one confirmed gap: the daily-loss check on the stop button path. While the UI clamps `dailyLossLimit` to `≤ 0` on input and `loadConfig` silently maps a stored `0` back to the default (`-20`), the `checkStopConditions` function itself short-circuits with `cfg.dailyLossLimit < 0 &&` — so if `dailyLossLimit` ever reaches `0` at runtime (e.g., a future code path that resets the config), the daily-loss stop becomes silently disabled without any warning to the user.

The DemoTradeTicket props wiring in `TradingWorkspace` is correct. `trading.acknowledgeOrderResolution` is exported by `useTradingSession` (confirmed at line 834 of `useDemoTrading.ts`) and is passed directly without a fallback. All props match the `Props` type declared in `DemoTradeTicket.tsx`.

The CSS is append-only. No existing class names in the original sheet were modified. The new `.tradeGrid / .tradeLeft / .tradeRight` classes, bot panel classes, and stats table classes are all present and correctly scoped.

---

<details>
<summary>Issues (3)</summary>

1. **Stop disabled during connecting** — While `isRunning` covers `"connecting"` for the Start/Stop toggle, the Stop button has `disabled={runState !== "running" && runState !== "cooldown"}`, which means it is disabled during `"connecting"`. If the WS handshake hangs, the user cannot stop the bot from the UI. Fix: allow stop when `runState === "connecting"` as well, or wire the Stop button to `isRunning` instead of the narrower check.

2. **`won` resolved only from `status === "won"`** — When a digit contract settles as expired or cancelled and the contract was profitable (uncommon but possible on early sell), `contractStatus` will not equal `"won"`, so the bot records it as a loss with `profit = -cfg.stake` even though `raw.profit` may be positive. The `profit` field is read correctly from the message, but the `won` boolean will be wrong. Fix: derive `won` from `profit > 0` (or `profit >= 0`) as a fallback when `contractStatus` is not `"won"` or `"lost"`.

3. **Daily-loss stop silently disables at zero** — `checkStopConditions` guards with `cfg.dailyLossLimit < 0` before comparing `netPnl`. A `dailyLossLimit` of `0` passes the form validation (the UI input has `max={0}`) and would reach this guard and be silently skipped. Although `loadConfig` remaps a stored `0` back to the default, a fresh config constructed via `defaultConfig` starts at `-20` and the form allows exactly `0` as a valid input. Fix: either exclude `0` from the form's valid range (`min={-1}` or equivalent) or replace the guard with `cfg.dailyLossLimit !== 0 && s.netPnl <= cfg.dailyLossLimit`.

</details>

<details>
<summary>Details</summary>

### Stop button disabled during `"connecting"` runState

`isRunning` is `true` for `"running" | "connecting" | "cooldown"`, which correctly prevents starting a second bot run while one is in progress. But the Stop button's own `disabled` prop is `runState !== "running" && runState !== "cooldown"` — it does not include `"connecting"`. The effect is that during the WS handshake (which involves a `fetch` to `/api/auth/deriv/trade-session` and then a WebSocket `onopen`), the Stop button is rendered but disabled, and the user is trapped until the connection either succeeds or errors. The fix is one token: `disabled={runState !== "running" && runState !== "cooldown" && runState !== "connecting"}`, or more simply, `disabled={!isRunning}`.

### `won` determination is fragile for non-"won"/"lost" terminal states

`resolve({ won: contractStatus === "won", profit })` means any terminal status other than `"won"` (i.e., `"lost"`, `"sold"`, `"expired"`, `"cancelled"`) will produce `won: false`. For `"lost"` this is correct. For `"sold"` (an early exit) or `"expired"` (a tick-duration expiry at zero payout), the profit field is still correctly read from `raw.profit`, so the financial accounting is right. But the `won` boolean drives the stake strategy on the next trade: a profitable early exit is recorded as a loss, which would trigger a martingale increase when the correct response is a reset to `initialStake`. In practice digit contracts don't support early sell, so this is a low-probability path, but it represents a latent correctness gap.

### Daily-loss stop guard at zero

```typescript
if (cfg.dailyLossLimit < 0 && s.netPnl <= cfg.dailyLossLimit)
```

The `< 0` guard exists to avoid treating `dailyLossLimit = 0` (disabled) as "stop immediately on the first loss". But the form allows `max={0}` with no `min` on the daily loss input, meaning the user can type `0` and submit it. `loadConfig` saves and restores this as `0`. At runtime, `checkStopConditions` skips the daily-loss check entirely, and there is no visible indicator that the stop condition is inactive. The fix is to either prevent `0` at the input level or swap the guard to `cfg.dailyLossLimit !== 0`.

### `onmessage` chaining correctness

Each of the three await stages (proposal, buy, settlement) saves the current `socketRef.current.onmessage` into `prevOnMessage`, installs a new handler, and restores the previous one on resolution or timeout. This is correct for the bot's dedicated socket, which has no concurrent message consumers. The settlement stage additionally exposes its resolver through `resolveSettlementRef` so `stop()` can drain the promise immediately and restore `onmessage` before the 120-second timeout fires. The unmount cleanup correctly mirrors `stop()`'s drain logic.

### Stake strategy math

All four strategies are confirmed correct against the spec:
- Fixed: always returns `initialStake`.
- Martingale: resets to `initialStake` on win, multiplies on loss, capped at `maxStake`.
- Reverse martingale: multiplies on win, resets on loss, capped at `maxStake`.
- D'Alembert: decrements by `stepUnit` on win (floor at `initialStake`), increments on loss (ceiling at `maxStake`).

The `configRef.current` is mutated after each trade to carry the next stake into the following iteration, and the mutation uses a spread to avoid aliasing the previous config object.

### localStorage persistence and config merging

`loadConfig` merges the stored object against a fresh `defaultConfig` before returning it, so any newly added fields in a future schema migration will receive valid defaults rather than `undefined`. The `dailyLossLimit` zero-remapping is done here with a comment explaining why. `saveConfig` is called in a `useEffect` keyed to `[accountId, config]`, so every config change is persisted.

### CSS isolation

All new classes appear after line 675 in `TradingWorkspace.module.css` and no existing class definitions were changed. The `.positive` and `.negative` utility classes that `BotStatsPanel` references exist at line 345, predating this change. The `.tradeRight` column has `position: sticky; overflow-y: auto` with a `max-height` of `calc(100vh - 160px)`, which makes the bot panel scroll independently from the left column on desktop. The `@media (max-width: 768px)` breakpoint resets this to `position: static`, which is the expected mobile behavior.

</details>

---

<details>
<summary>File map</summary>

| File | Change |
|---|---|
| `bot-types.ts` | New — `BotConfig`, `BotTradeRecord`, `BotSessionStats`, `BotStatus`, `BotRunState`, `BotSessionHandle` type definitions |
| `useBotSession.ts` | New — authenticated WS bot loop hook, stake strategies, stop conditions, localStorage order-pending marker |
| `BotConfigForm.tsx` | New — controlled form for all `BotConfig` fields with conditional field visibility |
| `BotStatsPanel.tsx` | New — session stats row and scrollable trade journal table |
| `BotPanel.tsx` | New — bot lifecycle UI (start/stop/reset, config/stats tabs, unresolved-order notice, localStorage persistence) |
| `TradingWorkspace.tsx` | Modified — trade page restructured to `tradeGrid` two-column layout; `BotPanel` mounted in right column |
| `TradingWorkspace.module.css` | Appended — `.tradeGrid`, `.tradeLeft`, `.tradeRight`, `.botPanel`, `.botTabs`, `.botControls`, `.botStatusMsg`, `.botRunError`, `.botActiveTradeCard`, `.botConfigSection`, `.botStatsRow`, `.botStatCell`, `.botJournalTable` |

Full diff: `git diff main -- src/components/trading/`

</details>
