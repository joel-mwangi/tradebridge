# AI Analyst Tab — Frontend/Backend Integration Report

## Summary

The **"AI Analyst"** tab in TradeBridge (`ForexAnalyst.tsx`) and the **Digit Analysis / Strategy** feature (DigitAnalysis + DigitStrategyPanel) are served by two different, partially-independent data paths. Neither uses a large-language model or generative AI — the word "AI" in the tab label is marketing. The real intelligence is rule-based algorithmic analysis done entirely in-process (TypeScript in the browser for the Forex chart; Python on the FastAPI backend for digit strategy signals).

**Key finding:** The backend (`d:\ai-tradingbridge`, named `ai-tradingbridge` locally) is well-integrated for the Digit/Strategy features and the OAuth/trading session flows, but the "AI Analyst" (Forex chart) tab is **not integrated with the backend at all** — it calls only the public market WebSocket proxy, does all candle analysis client-side, and has no backend endpoint backing it. There is also no LLM or AI-model API used anywhere in either repo; the `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` entry in `metadata.json` is a declared capability that is not yet implemented.

---

## 1. Component Inventory

### 1.1 `ForexAnalyst.tsx` — the "AI Analyst" tab

**Route/location:** Rendered when `page === "forex-analyst"` in `TradingWorkspace.tsx` (line 622–626). Navigation entry: `{ id: "forex-analyst", label: "AI Analyst", icon: "✦" }`.

**What it does:**
- Opens a single WebSocket to `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_MARKET_WS_URL` (the FastAPI `/deriv/live/market` proxy).
- Sends `{ active_symbols: "brief" }` on open to populate the instrument selector.
- Subscribes to tick updates (`{ ticks: symbol, subscribe: 1 }`) for the selected instrument.
- Requests candle history via `buildForexCandleHistoryRequest` (from `src/lib/forex-market-data.mjs`), which uses `{ ticks_history, style: "candles", granularity, count: 180 }`.
- Performs **all analysis locally in the browser** using `analyzeForexCandles` and `findSwingPoints` from `src/lib/forex-analysis.mjs`. This includes ATR, candle pattern detection (hammer, doji, engulfing, etc.), swing point labeling (HH/HL/LH/LL), and support/resistance zone mapping.
- Renders an SVG candlestick chart with overlaid pattern markers, swing labels, and S/R bands.

**No backend analysis call is made.** The component never calls `/analysis/digits` or any other FastAPI HTTP endpoint. The backend WebSocket only proxies raw Deriv market data (candles and ticks).

### 1.2 `DigitAnalysis.tsx` — Digit frequency display

**Location:** Used on the "Trade" page inside `TradingWorkspace`.

**What it does:**
- A purely presentational component: receives `snapshot: MarketSnapshot` and `prediction/target` props from `TradingWorkspace`.
- Reads `snapshot.digitFrequency.windows[windowSize]` for counts/percentages — this data comes from the backend.
- The comment in the file is explicit: *"Frequency percentages/counts come only from the backend snapshot; never recalculate in the browser."*

### 1.3 `DigitStrategyPanel.tsx` — Live strategy observer

**Location:** Also on the "Trade" page.

**What it does:**
- Opens its own WebSocket to `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_MARKET_WS_URL`.
- Sends `{ strategy: { action: "start", symbol, window_size, barrier, direction } }` to the backend.
- Receives `{ type: "strategy_status", state, reason, red_digits, green_digits, ... }` strategy state updates back.
- Displays the tape of last digits, digit frequency bars (from the `frequency` prop passed from the parent), and execution status from the authenticated trading session.

### 1.4 `TradingActivity.tsx`

A display-only component for open positions and account statement rows. No market or analysis data flows through it. Not relevant to AI Analyst.

---

## 2. API / WebSocket Call Map

### Frontend → Backend connections

| Component | Env var used | Backend endpoint | Protocol |
|---|---|---|---|
| `ForexAnalyst.tsx` | `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_MARKET_WS_URL` | `/deriv/live/market` | WebSocket |
| `useMarketData.ts` (Trade page) | `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_MARKET_WS_URL` | `/deriv/live/market` | WebSocket |
| `DigitStrategyPanel.tsx` | `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_MARKET_WS_URL` | `/deriv/live/market` | WebSocket |
| `useDemoTrading.ts` | `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_WS_URL` | `/deriv/ws` | WebSocket (authenticated) |
| `useMultipliersTrading.ts` | `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_WS_URL` | `/deriv/multipliers/ws` | WebSocket (authenticated) |
| `TradingWorkspace.tsx` | `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_HTTP_URL` | `/deriv/accounts` | HTTP POST |

### Message shapes used by ForexAnalyst

**Client → Backend (over `/deriv/live/market`):**
```json
{ "active_symbols": "brief", "req_id": 1 }
{ "ticks": "frxEURUSD", "subscribe": 1, "req_id": 70001 }
{ "ticks_history": "frxEURUSD", "style": "candles", "granularity": 900, "count": 180, "req_id": 70002 }
```

**Backend → Client:**
```json
{ "msg_type": "active_symbols", "active_symbols": [...] }
{ "msg_type": "tick", "tick": { "symbol": "...", "quote": 1.08765, "epoch": 1700000000, "pip_size": 5 }, "digit_frequency": { ... } }
{ "msg_type": "candles", "candles": [{ "epoch": ..., "open": ..., "high": ..., "low": ..., "close": ... }], "req_id": 70002 }
```

> Note: The backend attaches `digit_frequency` to tick messages for the Trade page's `useMarketData`, but `ForexAnalyst.tsx` does **not read** the `digit_frequency` field — it is unused in the Forex chart path.

### Message shapes used by DigitStrategyPanel

**Client → Backend (over `/deriv/live/market`):**
```json
{ "strategy": { "action": "start", "symbol": "1HZ100V", "window_size": 1000, "barrier": 5, "direction": "over" } }
{ "strategy": { "action": "stop" } }
{ "strategy": { "action": "status" } }
{ "ping": 1 }
```

**Backend → Client:**
```json
{
  "type": "strategy_status",
  "symbol": "1HZ100V",
  "state": "observing",
  "reason": "...",
  "selected_group": null,
  "requested_direction": "over",
  "barrier": 5,
  "trigger_digit": null,
  "signal_generated": false,
  "stability_seconds_required": 15,
  "stable_since": null,
  "red_digits": [3],
  "yellow_digits": [7],
  "blue_digits": [2],
  "green_digits": [9],
  "feed_state": "connected",
  "observation_count": 42,
  "window_seconds": 15,
  "digit_window_size": 1000,
  "qualification": { ... },
  "execution_enabled": false
}
```

---

## 3. Backend Discovery

**Correct location:** `d:\ai-tradingbridge` (not `d:\ai-tradebridge`).

The backend is a **FastAPI** Python application. Key modules:

| File | Role |
|---|---|
| `app/main.py` | App entrypoint; mounts `deriv_router` and `mt5_router`; defines `/analysis/digits` (POST, server-to-server) and `/analysis/digits/latest` (GET, Supabase-backed) |
| `app/deriv/routes.py` | All HTTP Deriv session routes: OAuth exchange, credential store, account list, session activate/deactivate |
| `app/deriv/market_proxy.py` | `WS /deriv/live/market` — proxies Deriv public WS, adds `digit_frequency` to every tick, handles `strategy.*` commands |
| `app/deriv/trading_proxy.py` | `WS /deriv/ws` — authenticated OTP-based trading proxy |
| `app/market_analysis.py` | `DigitFrequencyWindow` class; computes per-window digit counts/percentages for all 5 window sizes (50, 100, 250, 500, 1000) |
| `app/analysis.py` | `analyze_digits()`: Chi-square and frequency counts from a raw digit array; used by `/analysis/digits` |
| `app/strategy/live_feed.py` | `LiveStrategyFeed` — one per WebSocket connection; routes tick/frequency events into the strategy session |
| `app/strategy/digit_strategy.py` | Pure rule engine: barrier-generalized digit strategy qualification logic |
| `app/strategy/session.py` | `DigitStrategySession` state machine (observing → selected → signal generated) |

The backend is **not** in the docker-compose.yml — that file only builds and runs the Next.js frontend container. The FastAPI service must be deployed separately (e.g., a separate Render/Railway/VM service).

---

## 4. Real-time Data Flow

### ForexAnalyst (Forex chart) path

```
Browser
  └─ WebSocket → FastAPI /deriv/live/market
       └─ FastAPI WebSocket → Deriv public WS wss://api.derivws.com/trading/v1/options/ws/public
            ├─ active_symbols response → available instruments list
            ├─ history (candles) response → client stores up to 180 OHLC candles
            └─ tick → client merges into current candle; triggers re-analysis
                  ForexAnalyst calls analyzeForexCandles(closedCandles) client-side
                  → ATR, swing points, patterns, S/R zones computed in browser
```

Ticks flow: Deriv → FastAPI (ephemerally, not stored) → browser. No market data is persisted.

### Digit Strategy path

```
Browser
  └─ WebSocket → FastAPI /deriv/live/market
       └─ FastAPI WebSocket → Deriv public WS
            ├─ ticks_history response → seeds DigitFrequencyWindow
            └─ tick → DigitFrequencyWindow.add_tick()
                     → tracker.snapshot() → digit_frequency attached to message
                     → strategy_feed.on_frequency() → DigitStrategySession.add_snapshot()
                     → if state==SELECTED: strategy_feed.on_tick() → PatternTracker.on_tick()
                     → status message sent back to browser

Browser also sends strategy.{action:start/stop/status} commands over the same socket.
```

Execution (buying contracts) happens over a second authenticated WebSocket (`/deriv/ws`) managed by `useDemoTrading.ts`.

---

## 5. Integration Gaps and Mismatches

### 5.1 ForexAnalyst has no backend AI integration

**Gap:** The "AI Analyst" tab is named with the word "AI" but performs zero AI-backed analysis. All analysis (candle patterns, swing points, S/R zones) runs deterministic, rule-based TypeScript in the browser. The `metadata.json` file declares `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API`, suggesting intent to integrate a generative AI model (Gemini), but no such integration exists in either repository. There is no backend route, no LLM prompt, no API key usage, and no AI-generated insight returned to the frontend.

**Impact:** Users see a tab labeled "AI Analyst" / "AI Chart Analyst" with purely algorithmic analysis. If a generative AI feature is intended, it is entirely missing.

### 5.2 `digit_frequency` field ignored by ForexAnalyst

**Gap:** The backend attaches a `digit_frequency` object to every tick message on `/deriv/live/market`. `useMarketData.ts` reads this and stores it in `MarketSnapshot.digitFrequency`. But `ForexAnalyst.tsx` has its own independent WebSocket (not using `useMarketData`) and never reads `digit_frequency` from tick messages. The digit analysis data flowing alongside every tick in the Forex chart path is silently discarded.

**Impact:** Minor — no user-visible harm since ForexAnalyst doesn't display digit data. But both components duplicate the WebSocket connection to the same backend endpoint.

### 5.3 ForexAnalyst.tsx and useMarketData.ts open separate WebSocket connections

**Gap:** `ForexAnalyst.tsx` creates its own WebSocket to `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_MARKET_WS_URL`. `useMarketData.ts` (used by the Trade page) creates a separate WebSocket to the same URL. When both are mounted simultaneously (which is impossible today since they're on different nav pages, but relevant if routing changes), there would be two concurrent connections from the same browser.

**Impact:** Low in current routing but a structural fragility.

### 5.4 `active_symbols` request differences

**Gap:** `ForexAnalyst.tsx` sends `{ active_symbols: "brief", req_id: 1 }` without `contract_type`. `useMarketData.ts` sends `{ active_symbols: "brief", contract_type: ["DIGITOVER", "DIGITUNDER", ...], req_id: 1 }`. The ForexAnalyst therefore receives all market types (forex, crypto, commodities, indices, synthetics), while the trade page filters for digit-eligible markets only.

**Impact:** Functional difference in the instruments shown between the two pages. This is intentional per the comment in ForexAnalyst ("Deliberately no digit-contract filter: this workspace is for forex chart analysis"), but it means the same backend proxy handles two different use-cases from one endpoint.

### 5.5 `analysis/digits` endpoint not called from the frontend

**Gap:** The backend exposes `POST /analysis/digits` (server-to-server bearer auth) and `GET /analysis/digits/latest` (also bearer auth). Neither is called anywhere in the Next.js frontend. These are server-to-server research endpoints and not exposed to the browser, but they are the only analytical HTTP endpoints the backend provides — and they are not wired to the Analyst tab.

### 5.6 No LLM/AI model despite the metadata declaration

**Gap:** `metadata.json` at the project root declares `"MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API"`. Neither the Next.js frontend nor the FastAPI backend has any code that calls Gemini (or any other LLM). There is no `@google/generative-ai` package in `package.json`, no `GEMINI_API_KEY` in `.env.example`, no `google-generativeai` in `requirements.txt`.

**Impact:** This is a declared but unimplemented capability. If a coding agent reads `metadata.json` to determine available tools, it would incorrectly believe Gemini is integrated.

### 5.7 `ForexOrderPanel` — integration scope unclear

`ForexAnalyst.tsx` imports and renders `ForexOrderPanel` (not read in this investigation). If ForexOrderPanel places actual trades, it should use the authenticated trading WebSocket. It's worth verifying that ForexOrderPanel uses `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_WS_URL` (the authenticated session) and not the public market socket.

---

## 6. Field Name Alignment

For fields that cross the boundary:

| Backend field (Python) | Frontend field (TypeScript) | Match? |
|---|---|---|
| `digit_frequency.source` | `BackendDigitFrequency.source` | ✅ |
| `digit_frequency.windows[n].counts` | `BackendDigitFrequencyWindow.counts` | ✅ |
| `digit_frequency.windows[n].percentages` | `BackendDigitFrequencyWindow.percentages` | ✅ |
| `digit_frequency.windows[n].sample_size` | `BackendDigitFrequencyWindow.sample_size` | ✅ |
| `strategy_status.type` | `StrategyStatus.type` | ✅ |
| `strategy_status.state` | `StrategyStatus.state` | ✅ |
| `strategy_status.red_digits` | `StrategyStatus.red_digits` | ✅ |
| `strategy_status.selected_group` | `StrategyStatus.selected_group` | ✅ |
| `strategy_status.requested_direction` | `StrategyStatus.requested_direction` | ✅ |
| `strategy_status.execution_enabled` | `StrategyStatus.execution_enabled` | ✅ |
| `strategy_status.qualification.under_qualifies` (backend) | `StrategyStatus.qualification.under_threshold_passes` etc. | ⚠️ Partial: backend emits `under_qualifies` and `over_qualifies` in `_qualification_summary`; frontend `StrategyStatus` type (in `DigitStrategyPanel.tsx`) uses `under_threshold_passes`, `under_stability_passes`, etc., which match the backend's individual sub-fields correctly |
| `tick.underlying_symbol` | `tick.underlying_symbol` | ✅ |
| `tick.pip_size` | `tick.pip_size` | ✅ |

No critical field-name mismatches were found on the existing Trade/Digit path. The ForexAnalyst candle fields (`epoch`, `open`, `high`, `low`, `close`) also match between the frontend normalization and the backend proxy passthrough.

---

## 7. Conclusions

1. **The "AI Analyst" tab is a local chart analysis tool**, not an AI-backed analyst. It connects to the backend only to stream raw candle/tick data (the same market proxy used by every other component) and performs all pattern recognition and technical analysis in the browser with deterministic code.

2. **The Digit Strategy feature is well-integrated.** The backend (`LiveStrategyFeed`, `DigitStrategySession`, `digit_strategy.py`) and frontend (`DigitStrategyPanel`, `DigitAnalysis`) share a clean, well-typed protocol over the market WebSocket. Field names match. The observation → signal state machine is entirely server-side.

3. **The `ai-tradingbridge` backend exists at `d:\ai-tradingbridge`** (not `d:\ai-tradebridge`). It is not referenced in docker-compose.yml and must be deployed as a separate service. The frontend connects to it via env vars.

4. **No LLM is integrated in either repo.** The `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` in `metadata.json` is an unimplemented capability declaration.

---

## 8. Recommendations

### R1 — Implement or remove the AI capability claim
Either integrate the declared Gemini API (or another LLM) to provide genuine AI-generated analysis on the ForexAnalyst tab, or update `metadata.json` to remove `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API`. A half-implemented declaration misleads automated agents and future developers.

**Implementation path for genuine AI integration:**
- Add a FastAPI endpoint (e.g., `POST /analysis/forex/insight`) that accepts recent OHLC candles and calls Gemini/OpenAI with a structured prompt, returning a trading insight summary.
- Add `GEMINI_API_KEY` to `.env.example` and the backend's env vars.
- Add a call in `ForexAnalyst.tsx` to fetch the AI insight (via Next.js API route as a backend proxy, not directly from the browser) and display it as a text panel alongside the chart.

### R2 — Add a backend candle-analysis endpoint to justify the "AI Analyst" label
Even without an LLM, a dedicated `/analysis/candles` endpoint on FastAPI could centralize pattern recognition and serve both the frontend and future integrations. Currently all analysis is duplicated client-side and has no server-side counterpart.

### R3 — Unify the market WebSocket connections
`ForexAnalyst.tsx` and `useMarketData.ts` both open their own WebSocket to the same backend endpoint. Consider a shared market data context/provider so the browser maintains one connection per session, routing data to both the Trade and ForexAnalyst pages.

### R4 — Verify `ForexOrderPanel` uses the authenticated trading WebSocket
The ForexOrderPanel imported by `ForexAnalyst.tsx` was not read in this investigation. Confirm it routes trade execution through `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_WS_URL` (the `useDemoTrading` or equivalent hook) rather than the public market socket.

### R5 — Document the `metadata.json` capability registry
Add a comment or companion `metadata-guide.md` explaining what `request_capabilities` entries mean and what must be true before they are listed, to prevent stale declarations from misleading automated agents.

---

*Report generated by read-only investigation of `d:\tradebridge` and `d:\ai-tradingbridge`. No code was modified.*
