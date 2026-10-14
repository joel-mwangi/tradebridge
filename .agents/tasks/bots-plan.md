# Implementation Plan — /bots Page

> Task: Add a fully-functional `/bots` page to TradeBridge that mirrors the structure of Deriv Bot,
> with two inner tabs (Dashboard | Bot Builder), a full Blockly drag-and-drop workspace, and a
> shared Run/Stop panel (Summary / Transactions / Journal).

---

- [ ] 1. **Install Blockly**
      Run `npm install blockly@10.4.3 --save --legacy-peer-deps` from `d:\tradebridge`.
      This installs Blockly and its TypeScript types as a direct dependency without conflicting
      with React 19 peer requirements.
      Files: `package.json` (updated by npm)
      Verify: `npx tsc --noEmit` — no missing-module errors for `blockly`.

- [ ] 2. **Create bot-types.ts — all shared TypeScript types**
      Define every type the bots subsystem uses so all other files can import from one place.
      Types to include:
      - `BotStatus`: `"idle" | "connecting" | "running" | "cooldown" | "stopping" | "stopped" | "error"`
      - `StakeStrategy`: `{ type: "fixed"; amount: number } | { type: "martingale"; base: number; multiplier: number; maxStake: number } | { type: "dalembert"; unit: number; maxStake: number }`
      - `StopCondition`: `{ type: "profit"; target: number } | { type: "loss"; limit: number } | { type: "tradeCount"; max: number } | { type: "time"; seconds: number }`
      - `BotConfig`: full bot config (id, name, symbol, contractType, barrier, duration, durationUnit, stakeStrategy, stopConditions, cooldownSeconds, maxTradesPerDay, maxConsecutiveLosses, createdAt, updatedAt)
      - `BotRun`: a single bot run summary record (botId, startedAt, endedAt, status, tradeCount, wins, losses, netPnl, currency)
      - `BotTransaction`: single transaction from a bot run (id, contractId, contractType, symbol, stake, payout, profit, currency, startedAt, settledAt, status)
      - `JournalEntry`: log line (timestamp, level: "info"|"warn"|"error", message)
      - `BotRunState`: live state consumed by RunPanel (status, currentStake, tradeCount, wins, losses, netPnl, currency, transactions, journal, startedAt, lastError)
      Files: `src/components/bots/bot-types.ts`
      Verify: `npx tsc --noEmit` — no errors in the new file.

- [ ] 3. **Create bot-storage.ts — localStorage persistence**
      Thin wrapper over localStorage that reads/writes bot configs and recent run history.
      Key schema:
      - `tradebridge:bots:configs` → JSON array of `BotConfig[]`
      - `tradebridge:bots:runs` → JSON array of `BotRun[]` (latest 50 runs, trimmed on write)
      Exports: `loadBotConfigs()`, `saveBotConfigs(configs)`, `loadBotRuns()`, `saveNewRun(run)`,
      `deleteBotConfig(id)`, `upsertBotConfig(config)`.
      All functions handle missing/corrupt JSON gracefully (catch → return empty).
      Files: `src/components/bots/bot-storage.ts`
      Verify: `npx tsc --noEmit` — no errors.

- [ ] 4. **Create useBotRunner.ts — bot execution hook**
      Mirror the WebSocket pattern from `useDemoTrading.ts`. Key design decisions:
      - Takes `(connected: boolean, account: DerivAccount | null, config: BotConfig | null)` as params.
      - Opens a trade-session WebSocket via `/api/auth/deriv/trade-session` (same endpoint as live trading).
      - State machine: `idle → connecting → running → cooldown → stopping → stopped → error`.
        - `cooldown` state waits `config.cooldownSeconds` between trades using a `setTimeout`.
        - `stopping` drains in-flight proposals before emitting `stopped`.
      - Stake strategies: `fixed` (constant), `martingale` (multiply on loss, reset on win, cap at maxStake), `d'Alembert` (add unit on loss, subtract on win, floor at base, cap at maxStake).
      - Stop conditions checked after every settled contract: profit target, loss limit, trade count, elapsed time.
      - Pending marker key: `tradebridge:bot-order-pending:${account.account_id}:${config.id}` written to localStorage before sending `buy`, cleared on confirmed settlement (mirrors the order-resolution pattern in `useDemoTrading.ts`).
      - Emits `BotRunState` (live state) and exposes `start()`, `stop()` functions.
      - On `stop()`: sets status to `stopping`, waits for any in-flight contract to settle, then closes the socket.
      - Journal entries appended for every state transition, error, and settled trade.
      Files: `src/components/bots/useBotRunner.ts`
      Verify: `npx tsc --noEmit` — no errors.

- [ ] 5. **Create RunPanel.tsx — run/stop panel with three inner tabs**
      Props: `runState: BotRunState; onStop: () => void; onStart: () => void; config: BotConfig | null`.
      Three inner tabs rendered as a horizontal pill-tab row:
      - **Summary**: stats grid (Status, Trades, Wins/Losses, Win Rate, Net P&L, Current Stake) — each in a `statCard`-styled box; a large Run/Stop button at the bottom that calls `onStart` / `onStop`.
      - **Transactions**: scrollable table — columns: Time, Symbol, Type, Stake, Payout, Profit, Status. Empty-state row when no transactions yet.
      - **Journal**: scrollable pre-formatted log list, newest entry at the top, color-coded by level (info=muted, warn=amber, error=red).
      Uses only CSS module classes — no external UI library.
      CSS module file is `RunPanel.module.css` (new file).
      Files: `src/components/bots/RunPanel.tsx`, `src/components/bots/RunPanel.module.css`
      Verify: `npx tsc --noEmit` — no errors.

- [ ] 6. **Create BotDashboard.tsx — bot management dashboard**
      Props: `configs: BotConfig[]; runs: BotRun[]; runState: BotRunState; activeConfigId: string | null; onSelectConfig: (id: string) => void; onNewConfig: (config: BotConfig) => void; onDeleteConfig: (id: string) => void; onImportConfig: (config: BotConfig) => void; onStart: () => void; onStop: () => void`.
      Layout (top-to-bottom):
      1. Four action-card row: "New Bot" (opens quick-strategy modal), "Import Bot" (file input for JSON), "Quick Strategy" (same modal), "View History" (scrolls to runs table).
      2. Bot list table: columns — Name, Symbol, Strategy summary, Last run status, Actions (Select / Delete). Clicking "Select" sets `activeConfigId` and enables the Run button in RunPanel.
      3. Quick-strategy modal: inline, shown/hidden with state. Presents a form with symbol select, contract type, stake, stop conditions (profit / loss / trade count). On confirm, creates a `BotConfig` with `upsertBotConfig` and calls `onNewConfig`. Uses the existing `inputShell` / `fieldLabel` CSS patterns from `TradingWorkspace.module.css`.
      4. File import: hidden `<input type="file" accept=".json">` triggered by the Import card. Parses JSON, validates shape (must have `id`, `name`, `symbol`), calls `onImportConfig`. Shows an inline error string if invalid.
      5. Recent runs table: columns — Bot Name, Started, Ended, Trades, Win%, Net P&L, Status.
      CSS module: `BotDashboard.module.css`.
      Files: `src/components/bots/BotDashboard.tsx`, `src/components/bots/BotDashboard.module.css`
      Verify: `npx tsc --noEmit` — no errors.

- [ ] 7. **Create BotBuilder.tsx — Blockly visual bot builder**
      This is the largest single component. Key decisions:
      - Use `dynamic(() => import('./BotBuilderInner'), { ssr: false })` to lazy-load the entire
        Blockly workspace so it never runs during SSR (Next.js 15 requires this for browser-only APIs).
      - The outer `BotBuilder.tsx` simply renders the dynamic import with a "Loading bot builder…"
        fallback; all logic lives in `BotBuilderInner.tsx`.

      **BotBuilderInner.tsx** — full Blockly workspace:
      - `useEffect` mounts `Blockly.inject('#blockly-container', { toolbox, theme: darkTheme, ... })`.
        Injects into a `div` with `ref`. Disposes workspace on unmount.
      - Custom dark theme: `Blockly.Theme.defineTheme('tradebridgeDark', { ... })` matching
        the workspace CSS variables (`--page`, `--panel`, `--teal`). Falls back gracefully if theme API differs.
      - Six custom block definitions (registered with `Blockly.Blocks[...]` and `javascriptGenerator`):
        1. `trade_parameters` — symbol dropdown, contract type dropdown, duration number
        2. `trade_options` — stake amount, currency label
        3. `purchase_conditions` — allowed during session (always / only on signal)
        4. `restart_trading` — restart on win / on loss / always
        5. `stake_management` — strategy selector (fixed / martingale / d'Alembert) + parameters
        6. `stop_conditions` — profit target, loss limit, max trades, time limit (all optional numbers)
      - Toolbox JSON: categories — Trade Setup (trade_parameters, trade_options), Logic (Blockly built-in logic/math/text), Money Management (stake_management, restart_trading), Stop Conditions (stop_conditions)
      - `workspaceToBotConfig(workspace, name)` converter: walks the top-level blocks, extracts field values, returns a `BotConfig` object with a generated UUID (`crypto.randomUUID()`). Returns `null` if required blocks are missing.
      - Top toolbar (above the Blockly div):
        - Bot name input (text field)
        - "Save Bot" button → calls `workspaceToBotConfig`, calls `onSaveConfig(config)` prop
        - "Clear" button → `workspace.clear()`
        - "Quick Strategy" button → calls `onQuickStrategy()` prop (fills in the workspace from a preset)
      - `onQuickStrategy(preset)`: injects preset blocks into a fresh workspace programmatically using `Blockly.serialization.workspaces.load`.
      Props: `onSaveConfig: (config: BotConfig) => void; onQuickStrategy?: () => void`.
      CSS module: `BotBuilder.module.css`.
      Files: `src/components/bots/BotBuilder.tsx`, `src/components/bots/BotBuilderInner.tsx`, `src/components/bots/BotBuilder.module.css`
      Verify: `npx tsc --noEmit` — no errors (Blockly ships its own `.d.ts`).

- [ ] 8. **Create BotsWorkspace.tsx — outer shell with inner tab bar**
      Props: `connected: boolean; account: DerivAccount | null`.
      State: `innerTab: "dashboard" | "builder"` (default `"dashboard"`).
      - Loads configs and runs from `bot-storage` on mount.
      - Instantiates `useBotRunner(connected, account, activeConfig)`.
      - Inner tab bar (two buttons: "Dashboard" | "Bot Builder") styled like the outer workspace tabs — reuse the `.workspaceTab` / `.workspaceTabActive` CSS classes from `TradingWorkspace.module.css`.
      - Layout: tab bar at top; below it, a two-column grid (main content | run panel):
        - Left (flex 1): `BotDashboard` when `innerTab === "dashboard"`, `BotBuilder` when `innerTab === "builder"`.
        - Right (fixed ~340 px): `RunPanel` always visible regardless of active inner tab.
      - Passes `onSaveConfig` from BotBuilder → `upsertBotConfig` + updates local state.
      Files: `src/components/bots/BotsWorkspace.tsx`
      Verify: `npx tsc --noEmit` — no errors.

- [ ] 9. **Update TradingWorkspace.tsx — add `bots` to nav and render block; fix DigitAnalysis prop**
      Three targeted changes:
      a. `WorkspacePage` type: add `"bots"` — `type WorkspacePage = "dashboard" | "markets" | "trade" | "portfolio" | "bots" | "settings"`.
      b. `PRIMARY_NAV` array: insert `{ id: "bots", label: "Bots", icon: "⚡" }` before `settings`.
      c. `PAGE_TITLES`: add `bots: "Automated Bots"`.
      d. Render block: add `{page === "bots" && (<section ...><BotsWorkspace connected={connected} account={activeAccount} /></section>)}` after the `portfolio` block.
      e. **Fix build error**: `DigitAnalysis` does not accept `activeAccount` prop (confirmed by reading `DigitAnalysis.tsx` — the prop was never declared). Remove `activeAccount={activeAccount}` from the `DigitAnalysis` call at line 507.
      Files: `src/components/trading/TradingWorkspace.tsx`
      Verify: `npx tsc --noEmit` — no errors (the line-507 type error disappears).

- [ ] 10. **Append bot CSS to TradingWorkspace.module.css**
       Append new CSS classes for the bots page section wrapper that aligns with the existing pattern:
       - `.botsPage` — same base as `.workspaceSection` (display:grid; gap:20px)
       - `.botsLayout` — two-column grid: `grid-template-columns: minmax(0, 1fr) 340px; gap: 20px; align-items: start`
       - `.botsLayoutFull` — single column fallback for narrow viewports (`@media (max-width: 900px)`)
       These classes are used by `BotsWorkspace.tsx` and referenced via `TradingWorkspace.module.css`.
       Files: `src/components/trading/TradingWorkspace.module.css`
       Verify: `npx tsc --noEmit` — no change (CSS modules have no TS surface); build passes.

- [ ] 11. **TypeScript full check**
       Run `npx tsc --noEmit` from `d:\tradebridge`.
       All new files and the modified `TradingWorkspace.tsx` must produce zero errors.
       If errors exist, fix them before proceeding to the build step.
       Verify: command exits with code 0 and no diagnostic output.

- [ ] 12. **Production build verification**
       Run `npm run build` from `d:\tradebridge`.
       Expected: "Route (app) / bots" appears in the build output, exit code 0, no type errors.
       The previously reported error at `TradingWorkspace.tsx:507` (`activeAccount` prop) must be gone.
       Verify: build completes successfully with exit code 0.

---

## Dependency order summary

Steps 1 → 2 → 3 → 4 → 5 are strictly sequential (each imports the previous).
Steps 6 and 7 depend on steps 2 and 3 but are independent of each other (can be done in either order).
Step 8 depends on 4, 5, 6, 7.
Step 9 depends on 8.
Step 10 is independent CSS-only and can be done alongside step 9.
Steps 11 and 12 are verification gates — run after all prior steps.

## Key patterns to follow

- **WebSocket pattern**: mirror `useDemoTrading.ts` — `socketRef`, `sequenceRef`, `nextId()`, cleanup in `useEffect` return, `cancelled` flag, interval-based ping/refresh.
- **CSS**: CSS Modules only. No Tailwind, no styled-components. New component CSS files follow the variable naming in `TradingWorkspace.module.css` (`var(--panel)`, `var(--teal)`, etc.).
- **Dynamic import for Blockly**: `next/dynamic` with `{ ssr: false }` is mandatory — Blockly calls `document` on import.
- **No forms**: the quick-strategy modal uses controlled React state with buttons, not a `<form>` element with submit, matching the existing TradingWorkspace patterns.
- **`"use client"` directive**: all new components under `src/components/bots/` must start with `"use client"` since they use hooks, browser APIs, and Blockly.
