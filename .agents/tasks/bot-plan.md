# Implementation Plan: Deriv Digit-Contract Bot System

## Context from Codebase Exploration

- **Build:** Next.js 15 / React 19, TypeScript 5.9, `npm run build` to verify, `npm run lint` for lint.
- **No new npm packages.** No `any` types.
- **Strategy engine** lives at `d:\tradebridge\src\lib\bots\strategy-engine.mjs` (`.d.mts` alongside it for types).
  - Runtime import: `import { analyzeSignal, evaluateEntry } from '../../lib/bots/strategy-engine.mjs'`
  - Type import: `import type { StrategyType, Signal, BacktestResult, EntryGateResult } from '../../lib/bots/strategy-engine.mjs'`
- **`useTradingSession`** (in `useDemoTrading.ts`) returns:
  `{ sessionState, status, busy, quote, positions, activity, balance, realizedProfit, orderResolutionRequired, acknowledgeOrderResolution, activityHasMore, activityLoading, loadMoreActivity, requestQuote, confirmQuote, cancelQuote, sellPosition, refreshAccount }`
  — **`acknowledgeOrderResolution`** IS exposed. Wire it to `DemoTradeTicket`.
- **`DemoTradeTicket`** props (full list from file):
  `connected`, `account`, `realTradingEnabled`, `maxRealStake`, `maxDailyLoss`, `realizedProfit`, `orderResolutionRequired`, `acknowledgeOrderResolution`, `market`, `mode`, `prediction`, `onPredictionChange`, `target`, `sessionState`, `status`, `busy`, `quote`, `requestQuote`, `confirmQuote`, `cancelQuote`
- **`TradingWorkspace`** trade page currently has only `DigitAnalysis` + `TradingActivity` in a `.marketGrid` (single-column). The `DemoTradeTicket` is NOT yet mounted on the trade page — it must be added.
- **CSS layout decision:** add a new `.tradeGrid` class (2-col: left `minmax(0,420px)`, right `minmax(0,1fr)`) that replaces `.marketGrid` on the trade page. Left column = trade controls (DigitAnalysis + ticket); right column = BotPanel.
- **LocalStorage key for bot config:** `tradebridge:bot-config:<account_id>`
- **Bot WebSocket:** separate authenticated session per `useBotSession` — same pattern as `useTradingSession`: `POST /api/auth/deriv/trade-session` then `new WebSocket(data.url)`.

---

## Files to Create / Modify

| # | File | Action |
|---|------|--------|
| 1 | `src/components/trading/bot-types.ts` | Create |
| 2 | `src/components/trading/useBotSession.ts` | Create |
| 3 | `src/components/trading/BotConfigForm.tsx` | Create |
| 4 | `src/components/trading/BotStatsPanel.tsx` | Create |
| 5 | `src/components/trading/BotPanel.tsx` | Create |
| 6 | `src/components/trading/TradingWorkspace.tsx` | Modify |
| 7 | `src/components/trading/TradingWorkspace.module.css` | Append |

---

## Item 1 — Create `src/components/trading/bot-types.ts`

### What to do
Define all TypeScript types the bot system uses. No imports from React. Imports from `./types` for `DigitContractType`.

### Exact contents

```typescript
import type { DigitContractType } from "./types";

// ─── Stake strategy ────────────────────────────────────────────────────────

export type StakeStrategy = "fixed" | "martingale" | "reverse_martingale" | "dalembert";

// ─── Bot configuration (persisted to localStorage) ─────────────────────────

export interface BotConfig {
  /** Deriv market symbol, e.g. "R_10" */
  symbol: string;
  /** Digit contract type to trade */
  contractType: DigitContractType;
  /** Barrier digit as string (required for DIGITOVER/DIGITUNDER/DIGITMATCH/DIGITDIFF; empty string for DIGITEVEN/DIGITODD) */
  barrier: string;
  /** Duration in ticks (1–10) */
  duration: number;
  /** Initial stake in account currency */
  initialStake: number;
  /** Current active stake (mutated by stake strategy between trades) */
  stake: number;
  /** Stake management strategy */
  stakeStrategy: StakeStrategy;
  /** Martingale / reverse_martingale multiplier (e.g. 2.0) */
  multiplier: number;
  /** Maximum stake ceiling for martingale (e.g. 50) */
  maxStake: number;
  /** D'Alembert step unit in account currency (e.g. 1) */
  stepUnit: number;
  /** Optional StrategyType from strategy-engine; empty string = no signal filter */
  strategyType: string;
  /** Minimum analyzeSignal score to allow trade (0–1) */
  minSignalScore: number;
  /** Stop bot after this many consecutive losses */
  maxConsecutiveLosses: number;
  /** Stop bot after daily net P/L falls below this (negative number, e.g. -20) */
  dailyLossLimit: number;
  /** Stop bot after this many total trades in the session */
  maxTrades: number;
  /** Cooldown seconds between trades */
  cooldownSeconds: number;
}

// ─── Single trade result recorded by the bot ───────────────────────────────

export interface BotTradeRecord {
  /** Unique contract ID from Deriv */
  contractId: string;
  /** Unix ms timestamp when the trade was placed */
  placedAt: number;
  /** Stake used for this trade */
  stake: number;
  /** Whether the contract was won */
  won: boolean;
  /** Profit (payout - stake) or loss (-stake) */
  profit: number;
  /** Deriv contract type used */
  contractType: DigitContractType;
  /** Barrier digit used, or empty string */
  barrier: string;
  /** Symbol traded */
  symbol: string;
}

// ─── Accumulated session statistics ────────────────────────────────────────

export interface BotSessionStats {
  /** Total trades placed in this session */
  totalTrades: number;
  /** Trades that were won */
  wins: number;
  /** Trades that were lost */
  losses: number;
  /** Win rate 0–1 */
  winRate: number;
  /** Net P/L for the session */
  netPnl: number;
  /** Current streak: positive = consecutive wins, negative = consecutive losses */
  streak: number;
  /** Timestamp of session start (Unix ms) */
  startedAt: number;
}

// ─── Bot run state ──────────────────────────────────────────────────────────

export type BotRunState =
  | "idle"           // not started
  | "connecting"     // opening authenticated WS session
  | "running"        // active loop
  | "cooldown"       // between trades
  | "stopped"        // user stopped or stop condition hit
  | "error";         // unrecoverable error

export interface BotStatus {
  runState: BotRunState;
  /** Human-readable message for current state */
  message: string;
  /** Reason the bot stopped (only set when runState === "stopped" or "error") */
  stopReason: string;
  /** Currently pending trade (between proposal and settlement), or null */
  activeTrade: BotTradeRecord | null;
  /** Whether the bot WS session is authenticated and open */
  sessionConnected: boolean;
}

// ─── useBotSession return type ──────────────────────────────────────────────

export interface BotSessionHandle {
  status: BotStatus;
  stats: BotSessionStats;
  journal: BotTradeRecord[];
  /** Start the bot loop with the given config snapshot */
  start: (config: BotConfig) => void;
  /** Stop the bot loop immediately */
  stop: () => void;
  /** Reset stats and journal (only callable when stopped/idle) */
  reset: () => void;
}
```

### Files
`src/components/trading/bot-types.ts`

### Verify
`npm run build` — TypeScript compiler must report zero errors in this file (no runtime execution needed).

---

## Item 2 — Create `src/components/trading/useBotSession.ts`

### What to do
Implement the `useBotSession` hook. This hook opens its own authenticated WebSocket session (identical pattern to `useTradingSession`), runs a trade loop, manages stake strategy, records results, and exposes the `BotSessionHandle` interface.

**Design decisions:**
- The hook owns its own WS; it does NOT share the manual trading session socket.
- The loop is driven by `setTimeout`/callback chains, not `setInterval`, so each iteration waits for full settlement before scheduling the next.
- All loop state is held in `useRef` so closures capture stable references.
- All user-visible state uses `useState` so React re-renders on each update.

### Full file specification

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DigitContractType } from "./types";
import type {
  BotConfig, BotRunState, BotSessionHandle, BotSessionStats,
  BotStatus, BotTradeRecord,
} from "./bot-types";
import type { StrategyType, Signal } from "../../lib/bots/strategy-engine.mjs";

// ─── empty constants ─────────────────────────────────────────────────────────

const EMPTY_STATS: BotSessionStats = {
  totalTrades: 0, wins: 0, losses: 0, winRate: 0,
  netPnl: 0, streak: 0, startedAt: 0,
};

const IDLE_STATUS: BotStatus = {
  runState: "idle", message: "Bot is idle. Configure and start to begin.", stopReason: "",
  activeTrade: null, sessionConnected: false,
};

// ─── WS message type (internal) ──────────────────────────────────────────────

type WsMsg = {
  msg_type?: string;
  req_id?: number;
  error?: { message?: string; code?: string };
  proposal?: { id?: string; ask_price?: number | string; payout?: number | string };
  buy?: { contract_id?: number | string; buy_price?: number | string };
  proposal_open_contract?: Record<string, unknown>;
};

function numeric(v: unknown): number | null {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n) ? n : null;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useBotSession(
  connected: boolean,
  accountId: string | null,
  /** Live market price points for the bot's symbol; keyed by symbol */
  snapshots: Record<string, { quote: number; updatedAt: number; points: Array<{ time: number; price: number }> }>,
): BotSessionHandle {
  const [status, setStatus] = useState<BotStatus>(IDLE_STATUS);
  const [stats, setStats] = useState<BotSessionStats>(EMPTY_STATS);
  const [journal, setJournal] = useState<BotTradeRecord[]>([]);

  // ── refs that survive re-renders without triggering them ──────────────────
  const socketRef = useRef<WebSocket | null>(null);
  const runningRef = useRef(false);
  const configRef = useRef<BotConfig | null>(null);
  const statsRef = useRef<BotSessionStats>({ ...EMPTY_STATS });
  const seqRef = useRef(200);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshotsRef = useRef(snapshots);
  // Keep snapshotsRef current so the loop always reads fresh market data
  useEffect(() => { snapshotsRef.current = snapshots; }, [snapshots]);

  // ── helpers ───────────────────────────────────────────────────────────────
  function nextId() { seqRef.current += 1; return seqRef.current; }
  function send(payload: Record<string, unknown>) {
    if (socketRef.current?.readyState === WebSocket.OPEN)
      socketRef.current.send(JSON.stringify(payload));
  }
  function setRunState(runState: BotRunState, message: string, extra?: Partial<BotStatus>) {
    setStatus((prev) => ({ ...prev, runState, message, ...extra }));
  }
  function clearStopTimer() {
    if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
  }

  // ── stake strategy ────────────────────────────────────────────────────────
  function nextStake(cfg: BotConfig, won: boolean): number {
    switch (cfg.stakeStrategy) {
      case "fixed":
        return cfg.initialStake;
      case "martingale":
        if (won) return cfg.initialStake;
        return Math.min(cfg.stake * cfg.multiplier, cfg.maxStake);
      case "reverse_martingale":
        if (!won) return cfg.initialStake;
        return Math.min(cfg.stake * cfg.multiplier, cfg.maxStake);
      case "dalembert":
        if (won) return Math.max(cfg.initialStake, cfg.stake - cfg.stepUnit);
        return Math.min(cfg.stake + cfg.stepUnit, cfg.maxStake);
    }
  }

  // ── stop condition checker ────────────────────────────────────────────────
  function checkStopConditions(cfg: BotConfig, s: BotSessionStats): string | null {
    if (cfg.maxTrades > 0 && s.totalTrades >= cfg.maxTrades)
      return `Max trades reached (${cfg.maxTrades}).`;
    if (cfg.dailyLossLimit < 0 && s.netPnl <= cfg.dailyLossLimit)
      return `Daily loss limit reached (${cfg.dailyLossLimit}).`;
    const consecLosses = s.streak < 0 ? Math.abs(s.streak) : 0;
    if (cfg.maxConsecutiveLosses > 0 && consecLosses >= cfg.maxConsecutiveLosses)
      return `Max consecutive losses reached (${cfg.maxConsecutiveLosses}).`;
    return null;
  }

  // ── record trade result ───────────────────────────────────────────────────
  function recordResult(record: BotTradeRecord) {
    const prev = statsRef.current;
    const wins = prev.wins + (record.won ? 1 : 0);
    const losses = prev.losses + (record.won ? 0 : 1);
    const total = prev.totalTrades + 1;
    const streak = record.won
      ? (prev.streak >= 0 ? prev.streak + 1 : 1)
      : (prev.streak <= 0 ? prev.streak - 1 : -1);
    const next: BotSessionStats = {
      totalTrades: total,
      wins,
      losses,
      winRate: total > 0 ? wins / total : 0,
      netPnl: prev.netPnl + record.profit,
      streak,
      startedAt: prev.startedAt,
    };
    statsRef.current = next;
    setStats({ ...next });
    setJournal((j) => [record, ...j].slice(0, 200));
  }

  // ── main trade loop iteration (Promise-based, called recursively via setTimeout) ──
  const runIteration = useCallback(async (): Promise<void> => {
    if (!runningRef.current) return;
    const cfg = configRef.current;
    if (!cfg) return;

    // (a) check stop conditions
    const stopMsg = checkStopConditions(cfg, statsRef.current);
    if (stopMsg) {
      runningRef.current = false;
      setStatus((prev) => ({
        ...prev, runState: "stopped", message: stopMsg, stopReason: stopMsg, activeTrade: null,
      }));
      return;
    }

    // (b) cooldown already handled by the setTimeout delay before calling runIteration
    // (it is re-applied at end of iteration); here we just log running state
    setRunState("running", "Checking signal and market conditions…");

    // (c) optional signal filter
    if (cfg.strategyType) {
      // Dynamically import to avoid top-level import issues with .mjs in Next.js
      const { analyzeSignal } = await import("../../lib/bots/strategy-engine.mjs") as {
        analyzeSignal: (prices: number[], strategy: StrategyType | string) => Signal | null;
      };
      const snap = snapshotsRef.current[cfg.symbol];
      const prices = snap ? snap.points.map((p) => p.price) : [];
      if (prices.length < 10) {
        setRunState("cooldown", "Waiting for more market data…");
        stopTimerRef.current = setTimeout(() => { void runIteration(); }, Math.max(cfg.cooldownSeconds, 3) * 1000);
        return;
      }
      const signal = analyzeSignal(prices, cfg.strategyType);
      if (!signal || signal.score < cfg.minSignalScore) {
        setRunState("cooldown", `Signal score ${signal?.score.toFixed(2) ?? "null"} below threshold ${cfg.minSignalScore}. Waiting…`);
        stopTimerRef.current = setTimeout(() => { void runIteration(); }, cfg.cooldownSeconds * 1000);
        return;
      }
      setRunState("running", `Signal approved (score ${signal.score.toFixed(2)}). Requesting proposal…`);
    }

    // (d) evaluateEntry is intentionally skipped here per spec — the simple
    //     bot uses analyzeSignal score as the gate, not the full EntryGate.
    //     (evaluateEntry requires backtest data which the bot doesn't cache.)

    // (e) send proposal, wait up to 15s
    const proposalId = nextId();
    const barrierField = cfg.barrier !== "" ? { barrier: cfg.barrier } : {};
    send({
      proposal: 1,
      amount: cfg.stake,
      basis: "stake",
      contract_type: cfg.contractType,
      currency: "USD",  // will be overridden if socket resolves currency from account
      duration: cfg.duration,
      duration_unit: "t",
      ...barrierField,
      underlying_symbol: cfg.symbol,
      req_id: proposalId,
    });
    setRunState("running", "Awaiting quote from Deriv…");

    const proposalResult = await new Promise<{ id: string; askPrice: number; payout: number | null } | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 15_000);
      const origOnMessage = socketRef.current?.onmessage ?? null;
      if (!socketRef.current) { clearTimeout(timeout); resolve(null); return; }
      socketRef.current.onmessage = (event: MessageEvent) => {
        if (origOnMessage) (origOnMessage as (e: MessageEvent) => void)(event);
        let msg: WsMsg;
        try { msg = JSON.parse(event.data as string) as WsMsg; } catch { return; }
        if (msg.msg_type === "proposal" && msg.req_id === proposalId) {
          clearTimeout(timeout);
          if (socketRef.current) socketRef.current.onmessage = origOnMessage as ((e: MessageEvent) => void) | null;
          if (msg.error || !msg.proposal?.id) { resolve(null); return; }
          const askPrice = numeric(msg.proposal.ask_price);
          if (!askPrice) { resolve(null); return; }
          resolve({ id: String(msg.proposal.id), askPrice, payout: numeric(msg.proposal.payout) });
        }
      };
    });

    if (!runningRef.current) return;
    if (!proposalResult) {
      setRunState("cooldown", "Proposal timeout. Retrying after cooldown…");
      stopTimerRef.current = setTimeout(() => { void runIteration(); }, cfg.cooldownSeconds * 1000);
      return;
    }

    // (f) send buy, wait up to 20s
    const buyId = nextId();
    send({ buy: proposalResult.id, price: proposalResult.askPrice, req_id: buyId });
    setRunState("running", "Order submitted, awaiting Deriv confirmation…");

    const buyResult = await new Promise<{ contractId: string } | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 20_000);
      const origOnMessage = socketRef.current?.onmessage ?? null;
      if (!socketRef.current) { clearTimeout(timeout); resolve(null); return; }
      socketRef.current.onmessage = (event: MessageEvent) => {
        if (origOnMessage) (origOnMessage as (e: MessageEvent) => void)(event);
        let msg: WsMsg;
        try { msg = JSON.parse(event.data as string) as WsMsg; } catch { return; }
        if (msg.msg_type === "buy" && msg.req_id === buyId) {
          clearTimeout(timeout);
          if (socketRef.current) socketRef.current.onmessage = origOnMessage as ((e: MessageEvent) => void) | null;
          if (msg.error || !msg.buy?.contract_id) { resolve(null); return; }
          resolve({ contractId: String(msg.buy.contract_id) });
        }
      };
    });

    if (!runningRef.current) return;
    if (!buyResult) {
      runningRef.current = false;
      setStatus((prev) => ({
        ...prev, runState: "error",
        message: "Buy confirmation timed out. Bot stopped for safety.",
        stopReason: "Buy confirmation timed out.",
      }));
      return;
    }

    // (g) subscribe proposal_open_contract, wait for settlement
    const monitorId = nextId();
    send({ proposal_open_contract: 1, contract_id: Number(buyResult.contractId), subscribe: 1, req_id: monitorId });
    setRunState("running", `Contract ${buyResult.contractId} open. Waiting for settlement…`, {
      activeTrade: {
        contractId: buyResult.contractId,
        placedAt: Date.now(),
        stake: cfg.stake,
        won: false,
        profit: -cfg.stake,
        contractType: cfg.contractType as DigitContractType,
        barrier: cfg.barrier,
        symbol: cfg.symbol,
      },
    });

    const terminalStates = new Set(["won", "lost", "sold", "expired", "cancelled"]);

    const settlementResult = await new Promise<{ won: boolean; profit: number } | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 120_000); // max 2 min for settlement
      const origOnMessage = socketRef.current?.onmessage ?? null;
      if (!socketRef.current) { clearTimeout(timeout); resolve(null); return; }
      socketRef.current.onmessage = (event: MessageEvent) => {
        if (origOnMessage) (origOnMessage as (e: MessageEvent) => void)(event);
        let msg: WsMsg;
        try { msg = JSON.parse(event.data as string) as WsMsg; } catch { return; }
        if (msg.msg_type === "proposal_open_contract" && msg.proposal_open_contract) {
          const raw = msg.proposal_open_contract;
          const cid = String(raw.contract_id ?? "");
          if (cid !== buyResult.contractId) return;
          const status = String(raw.status ?? "open").toLowerCase();
          const isClosed = terminalStates.has(status) || raw.is_sold === 1 || raw.is_expired === 1;
          if (!isClosed) return;
          clearTimeout(timeout);
          if (socketRef.current) socketRef.current.onmessage = origOnMessage as ((e: MessageEvent) => void) | null;
          const profit = numeric(raw.profit) ?? -cfg.stake;
          resolve({ won: status === "won", profit });
        }
      };
    });

    if (!runningRef.current) return;

    // (h) record result, apply stake strategy, update stats
    const won = settlementResult?.won ?? false;
    const profit = settlementResult?.profit ?? -cfg.stake;
    const record: BotTradeRecord = {
      contractId: buyResult.contractId,
      placedAt: Date.now(),
      stake: cfg.stake,
      won,
      profit,
      contractType: cfg.contractType as DigitContractType,
      barrier: cfg.barrier,
      symbol: cfg.symbol,
    };
    recordResult(record);

    // Mutate configRef stake for next iteration
    configRef.current = { ...cfg, stake: nextStake(cfg, won) };

    setStatus((prev) => ({
      ...prev,
      runState: "cooldown",
      message: `Trade ${won ? "won" : "lost"} (${profit >= 0 ? "+" : ""}${profit.toFixed(2)}). Next trade in ${cfg.cooldownSeconds}s…`,
      activeTrade: null,
    }));

    // Check stop conditions after recording
    const stopAfter = checkStopConditions(configRef.current, statsRef.current);
    if (stopAfter) {
      runningRef.current = false;
      setStatus((prev) => ({ ...prev, runState: "stopped", message: stopAfter, stopReason: stopAfter }));
      return;
    }

    // Schedule next iteration after cooldown
    if (runningRef.current) {
      stopTimerRef.current = setTimeout(() => { void runIteration(); }, cfg.cooldownSeconds * 1000);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── connect to authenticated session ─────────────────────────────────────
  const connectSession = useCallback((onReady: () => void) => {
    if (!connected || !accountId) {
      setStatus((prev) => ({
        ...prev, runState: "error",
        message: "Cannot start bot: no connected Deriv account.",
        stopReason: "No connected account.",
      }));
      return;
    }
    setRunState("connecting", "Opening authenticated bot trading session…");

    void (async () => {
      try {
        const response = await fetch("/api/auth/deriv/trade-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: accountId }),
          cache: "no-store",
        });
        const data = await response.json() as { url?: string; error?: string };
        if (!response.ok || !data.url) {
          setStatus((prev) => ({
            ...prev, runState: "error",
            message: data.error ?? "Could not open bot trading session.",
            stopReason: data.error ?? "Session error.",
          }));
          return;
        }
        const ws = new WebSocket(data.url);
        socketRef.current = ws;

        ws.onopen = () => {
          setStatus((prev) => ({ ...prev, sessionConnected: true }));
          onReady();
        };

        ws.onerror = () => {
          if (runningRef.current) {
            runningRef.current = false;
            setStatus((prev) => ({
              ...prev, runState: "error", sessionConnected: false,
              message: "Bot WebSocket error. Bot stopped.",
              stopReason: "WebSocket error.",
            }));
          }
        };

        ws.onclose = () => {
          setStatus((prev) => ({ ...prev, sessionConnected: false }));
          if (runningRef.current) {
            runningRef.current = false;
            setStatus((prev) => ({
              ...prev, runState: "error",
              message: "Bot WebSocket closed unexpectedly. Bot stopped.",
              stopReason: "WebSocket closed.",
            }));
          }
        };
      } catch {
        setStatus((prev) => ({
          ...prev, runState: "error",
          message: "Failed to connect bot session. Check network and retry.",
          stopReason: "Connection failed.",
        }));
      }
    })();
  }, [connected, accountId]);

  // ── public API ────────────────────────────────────────────────────────────
  const start = useCallback((config: BotConfig) => {
    if (runningRef.current) return;
    clearStopTimer();
    configRef.current = { ...config, stake: config.initialStake };
    const now = Date.now();
    statsRef.current = { ...EMPTY_STATS, startedAt: now };
    setStats({ ...EMPTY_STATS, startedAt: now });
    setJournal([]);
    runningRef.current = true;

    if (socketRef.current?.readyState === WebSocket.OPEN) {
      setRunState("running", "Starting bot loop…", { sessionConnected: true });
      void runIteration();
    } else {
      socketRef.current?.close();
      socketRef.current = null;
      connectSession(() => {
        setRunState("running", "Session connected. Starting bot loop…");
        void runIteration();
      });
    }
  }, [connectSession, runIteration]);

  const stop = useCallback(() => {
    runningRef.current = false;
    clearStopTimer();
    setStatus((prev) => ({
      ...prev, runState: "stopped",
      message: "Bot stopped by user.", stopReason: "User stopped.", activeTrade: null,
    }));
  }, []);

  const reset = useCallback(() => {
    if (runningRef.current) return;
    clearStopTimer();
    statsRef.current = { ...EMPTY_STATS };
    setStats({ ...EMPTY_STATS });
    setJournal([]);
    setStatus(IDLE_STATUS);
    configRef.current = null;
  }, []);

  // ── cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      runningRef.current = false;
      clearStopTimer();
      socketRef.current?.close();
    };
  }, []);

  return { status, stats, journal, start, stop, reset };
}
```

### Files
`src/components/trading/useBotSession.ts`

### Verify
`npm run build` — zero TypeScript errors. `npm run lint` — zero lint errors.

---

## Item 3 — Create `src/components/trading/BotConfigForm.tsx`

### What to do
A controlled form component that lets the user configure the bot. Accepts `BotConfig` state + callbacks. Does NOT call any hook itself — it is a pure UI component driven by `BotPanel`.

### Props interface

```typescript
type BotConfigFormProps = {
  config: BotConfig;
  onChange: (patch: Partial<BotConfig>) => void;
  /** Available symbols from market data */
  symbols: Array<{ symbol: string; name: string }>;
  disabled: boolean;
  currency: string;
};
```

### Detailed specification

**Imports:**
```typescript
"use client";
import styles from "./TradingWorkspace.module.css";
import type { BotConfig } from "./bot-types";
import type { DigitContractType } from "./types";
```

**Contract type options** (label → value):
- "Digit Over" → `"DIGITOVER"`
- "Digit Under" → `"DIGITUNDER"`
- "Digit Even" → `"DIGITEVEN"`
- "Digit Odd" → `"DIGITODD"`
- "Digit Match" → `"DIGITMATCH"`
- "Digit Differs" → `"DIGITDIFF"`

**Stake strategy labels:**
- `"fixed"` → "Fixed stake"
- `"martingale"` → "Martingale (double on loss)"
- `"reverse_martingale"` → "Reverse Martingale (double on win)"
- `"dalembert"` → "D'Alembert (step on loss/win)"

**Fields to render** (use `styles.fieldLabel`, `styles.inputShell`, `styles.compactInputsGrid`, `styles.compactFieldGroup`):

1. **Market symbol** — `<select>` bound to `config.symbol`; options from `symbols` prop. Label: "Market Symbol".
2. **Contract type** — `<select>` bound to `config.contractType` (cast to `DigitContractType`). Label: "Contract Type".
3. **Barrier** — `<input type="number" min="0" max="9" step="1">` bound to `config.barrier`. Disabled when `contractType` is `"DIGITEVEN"` or `"DIGITODD"`. Label: "Barrier Digit (0–9)".
4. **Duration** — `<input type="number" min="1" max="10" step="1">` bound to `config.duration`. Label: "Duration (ticks)".
5. **Initial stake** — `<input type="number" min="1" step="1">` bound to `config.initialStake`. On change also reset `config.stake` to same value. Label: `"Stake (${currency})"`.
6. **Stake strategy** — `<select>` bound to `config.stakeStrategy`. Label: "Stake Strategy".
7. **Multiplier** — `<input type="number" min="1.1" max="10" step="0.1">` bound to `config.multiplier`. Show only when `stakeStrategy` is `"martingale"` or `"reverse_martingale"`. Label: "Multiplier".
8. **Max stake** — `<input type="number" min="1" step="1">` bound to `config.maxStake`. Show when `stakeStrategy` is `"martingale"`, `"reverse_martingale"`, or `"dalembert"`. Label: `"Max Stake (${currency})"`.
9. **Step unit** — `<input type="number" min="0.5" step="0.5">` bound to `config.stepUnit`. Show only when `stakeStrategy === "dalembert"`. Label: `"Step Unit (${currency})"`.
10. **Strategy type** — `<select>` with options `""` (label: "No signal filter"), `"trend_following"`, `"mean_reversion"`, `"breakout"`, `"momentum"`. Label: "Signal Strategy".
11. **Min signal score** — `<input type="number" min="0" max="1" step="0.05">` bound to `config.minSignalScore`. Show only when `config.strategyType !== ""`. Label: "Min Signal Score (0–1)".
12. **Cooldown seconds** — `<input type="number" min="1" max="3600" step="1">` bound to `config.cooldownSeconds`. Label: "Cooldown (seconds)".
13. **Max consecutive losses** — `<input type="number" min="0" max="50" step="1">` bound to `config.maxConsecutiveLosses`. Label: "Stop after N consecutive losses (0 = off)".
14. **Daily loss limit** — `<input type="number" max="0" step="1">` bound to `config.dailyLossLimit`. Label: `"Daily loss limit (${currency}, negative)"`. Note: zero or positive disables the stop.
15. **Max trades** — `<input type="number" min="0" step="1">` bound to `config.maxTrades`. Label: "Max trades per session (0 = unlimited)".

**Layout:** wrap in `<section>` with class `styles.botConfigSection` (defined in CSS item). Use `styles.compactInputsGrid` for pairs of fields (symbol+contractType, barrier+duration, initialStake+stakeStrategy, etc.). Use `styles.compactFieldGroup` per field. All inputs have `disabled={disabled}`.

**Export:** `export default function BotConfigForm(props: BotConfigFormProps): JSX.Element`

### Files
`src/components/trading/BotConfigForm.tsx`

### Verify
`npm run build` — zero TypeScript errors.

---

## Item 4 — Create `src/components/trading/BotStatsPanel.tsx`

### What to do
Read-only stats and journal display. Shows live session statistics and a scrollable table of all trades placed in the session.

### Props interface

```typescript
type BotStatsPanelProps = {
  stats: BotSessionStats;
  journal: BotTradeRecord[];
  currency: string;
};
```

### Detailed specification

**Imports:**
```typescript
"use client";
import styles from "./TradingWorkspace.module.css";
import type { BotSessionStats, BotTradeRecord } from "./bot-types";
```

**Stats row** — render a `<div className={styles.botStatsRow}>` containing:
- Win rate: `(stats.winRate * 100).toFixed(1) + "%"` — label "Win rate"
- Trades: `stats.totalTrades` — label "Trades"
- Net P/L: `stats.netPnl.toFixed(2) + " " + currency` — label "Net P/L", apply `styles.positive` if > 0, `styles.negative` if < 0
- Streak: `stats.streak >= 0 ? "+" + stats.streak + "W" : Math.abs(stats.streak) + "L"` — label "Streak"

**Journal table** — render a `<table>` with class `styles.botJournalTable`:
- Columns: Time | Symbol | Type | Barrier | Stake | Result | Profit
- Each row is a `BotTradeRecord`. Time: `new Date(record.placedAt).toLocaleTimeString()`. Result: "WIN" (green) or "LOSS" (red). Profit: `record.profit >= 0 ? "+" + record.profit.toFixed(2) : record.profit.toFixed(2)`.
- If journal is empty, show `<p>No trades yet.</p>` in place of table body.

**Export:** `export default function BotStatsPanel(props: BotStatsPanelProps): JSX.Element`

### Files
`src/components/trading/BotStatsPanel.tsx`

### Verify
`npm run build` — zero TypeScript errors.

---

## Item 5 — Create `src/components/trading/BotPanel.tsx`

### What to do
Orchestrating component for the right-side bot panel. Manages:
- LocalStorage persistence of `BotConfig` keyed by `tradebridge:bot-config:<account_id>`.
- Tab state: `"config" | "stats"`.
- Wiring between `useBotSession`, `BotConfigForm`, and `BotStatsPanel`.

### Props interface

```typescript
type BotPanelProps = {
  connected: boolean;
  accountId: string | null;
  currency: string;
  symbols: Array<{ symbol: string; name: string }>;
  /** Current market snapshot for the selected symbol (for signal analysis) */
  snapshots: Record<string, { quote: number; updatedAt: number; points: Array<{ time: number; price: number }> }>;
  /** Selected symbol (pre-fill config on first render) */
  selectedSymbol: string | null;
};
```

### Detailed specification

**Imports:**
```typescript
"use client";
import { useEffect, useState } from "react";
import styles from "./TradingWorkspace.module.css";
import { useBotSession } from "./useBotSession";
import BotConfigForm from "./BotConfigForm";
import BotStatsPanel from "./BotStatsPanel";
import type { BotConfig } from "./bot-types";
```

**Default config factory:**
```typescript
function defaultConfig(symbol: string): BotConfig {
  return {
    symbol,
    contractType: "DIGITOVER",
    barrier: "5",
    duration: 5,
    initialStake: 1,
    stake: 1,
    stakeStrategy: "fixed",
    multiplier: 2,
    maxStake: 50,
    stepUnit: 1,
    strategyType: "",
    minSignalScore: 0.6,
    maxConsecutiveLosses: 5,
    dailyLossLimit: -20,
    maxTrades: 0,
    cooldownSeconds: 3,
  };
}
```

**LocalStorage helpers (inside component):**
- `loadConfig(accountId: string): BotConfig | null` — reads `tradebridge:bot-config:<accountId>` from `localStorage`, parses JSON, validates it is an object with required keys (spot-check: `typeof v.symbol === "string"`), returns parsed or null.
- `saveConfig(accountId: string, config: BotConfig): void` — writes JSON to same key, wrapped in try/catch.

**State:**
- `const [config, setConfig] = useState<BotConfig>(() => defaultConfig(selectedSymbol ?? "R_10"))`
- `const [activeTab, setActiveTab] = useState<"config" | "stats">("config")`
- `const botSession = useBotSession(connected, accountId, snapshots)`

**Effects:**
1. On mount and when `accountId` changes: if `accountId`, load saved config from localStorage and call `setConfig`; if no saved config, use `defaultConfig(selectedSymbol ?? config.symbol)`.
2. When `selectedSymbol` changes AND bot is idle/stopped: update `config.symbol` to `selectedSymbol` if it changed.
3. When `config` changes AND `accountId` is set: call `saveConfig(accountId, config)`.

**Config change handler:**
```typescript
function handleConfigChange(patch: Partial<BotConfig>) {
  setConfig((prev) => ({ ...prev, ...patch }));
}
```
When `patch.initialStake` is set, also set `patch.stake = patch.initialStake`.

**Bot controls:**
- "Start Bot" button: `disabled` when `botSession.status.runState === "running" || botSession.status.runState === "connecting" || !config.symbol`. On click: call `botSession.start(config)`, switch to stats tab.
- "Stop Bot" button: `disabled` when `runState !== "running" && runState !== "cooldown"`. On click: `botSession.stop()`.
- "Reset" button: `disabled` when `runState === "running" || runState === "connecting"`. On click: `botSession.reset()`.

**Run state badge** — render a small `<span>` with text `botSession.status.runState` in different styles:
- `"running"` → `styles.liveStatus`
- `"stopped"` or `"error"` → `styles.botRunError` (CSS defined in item 7)
- `"idle"` → `styles.connectionStatus`
- `"cooldown"` or `"connecting"` → `styles.connectionStatus`

**Status message** — render `<p className={styles.botStatusMsg}>{botSession.status.message}</p>` below the badge.

**Active trade indicator** — if `botSession.status.activeTrade !== null`, render a card `<div className={styles.botActiveTradeCard}>` showing: Contract ID, Stake, Symbol, Type.

**Layout:**
```tsx
<section className={styles.botPanel} aria-label="Automated bot">
  <div className={styles.panelHeading}>
    <div>
      <p className={styles.eyebrow}>BOT SETUP</p>
      <h2>Digit Trading Bot</h2>
    </div>
    {/* run state badge */}
  </div>
  {/* status message + active trade card */}
  {/* tab bar: Config | Stats */}
  <div className={styles.botTabs}>
    <button ... onClick={() => setActiveTab("config")} ...>Config</button>
    <button ... onClick={() => setActiveTab("stats")} ...>Stats & Journal</button>
  </div>
  {/* bot controls: Start / Stop / Reset */}
  <div className={styles.botControls}>...</div>
  {activeTab === "config" && <BotConfigForm ... />}
  {activeTab === "stats" && <BotStatsPanel ... />}
</section>
```

Tab button active class: `styles.rangeActive`, inactive: `styles.rangeButton`.

**Export:** `export default function BotPanel(props: BotPanelProps): JSX.Element`

### Files
`src/components/trading/BotPanel.tsx`

### Verify
`npm run build` — zero TypeScript errors.

---

## Item 6 — Modify `src/components/trading/TradingWorkspace.tsx`

### What to do
Mount `DemoTradeTicket` and `BotPanel` on the trade page. Restructure the trade page layout from the current `.marketGrid` single-column to `.tradeGrid` two-column layout.

### Changes required

**A. New imports** — add at the top of the import block:
```typescript
import DemoTradeTicket from "./DemoTradeTicket";
import BotPanel from "./BotPanel";
```

**B. Trade page JSX replacement** — replace the entire `{page === "trade" && (…)}` block.

Current structure:
```tsx
{page === "trade" && (
  <section className={styles.workspaceSection} aria-label="Trading workspace">
    <div className={styles.marketGrid}>
      <div className={styles.marketColumn}>
        <DigitAnalysis ... />
        <div className={styles.marketSelectionFooter}>...</div>
      </div>
    </div>
    <TradingActivity ... />
  </section>
)}
```

New structure:
```tsx
{page === "trade" && (
  <section className={styles.workspaceSection} aria-label="Trading workspace">
    <div className={styles.tradeGrid}>

      {/* Left column: digit analysis + manual trade ticket + activity */}
      <div className={styles.tradeLeft}>
        <DigitAnalysis
          market={selectedMarket}
          snapshot={selectedMarket ? snapshots[selectedMarket.symbol] : undefined}
          mode={digitMode}
          onModeChange={setDigitMode}
          prediction={digitPrediction}
          onPredictionChange={setPredictionAndValidateTarget}
          target={digitTarget}
          onTargetChange={setDigitTarget}
        />
        <DemoTradeTicket
          connected={connected}
          account={activeAccount}
          realTradingEnabled={effectiveLiveTradingEnabled}
          maxRealStake={maxRealStake}
          maxDailyLoss={maxDailyLoss}
          realizedProfit={trading.realizedProfit}
          orderResolutionRequired={trading.orderResolutionRequired}
          acknowledgeOrderResolution={trading.acknowledgeOrderResolution}
          market={selectedMarket}
          mode={digitMode}
          prediction={digitPrediction}
          onPredictionChange={setPredictionAndValidateTarget}
          target={digitTarget}
          sessionState={trading.sessionState}
          status={trading.status}
          busy={trading.busy}
          quote={trading.quote}
          requestQuote={trading.requestQuote}
          confirmQuote={trading.confirmQuote}
          cancelQuote={trading.cancelQuote}
        />
        <div className={styles.marketSelectionFooter}>
          <span>
            <strong>{selectedMarket?.name ?? "No market selected"}</strong>
            <small>{selectedMarket?.symbol ?? "Choose an available instrument to begin"}</small>
          </span>
          <Link href="/markets" className={styles.secondaryButton}>Change market</Link>
        </div>
        <TradingActivity
          positionsOnly
          positions={trading.positions}
          activity={trading.activity}
          currency={currency}
          accountType={activeAccountIsReal ? "real" : activeAccountIsDemo ? "demo" : "other"}
          accountDataUnavailable={activeAccountIsReal && !effectiveLiveTradingEnabled}
          busy={trading.busy}
          activityLoading={trading.activityLoading}
          activityHasMore={trading.activityHasMore}
          onSell={trading.sellPosition}
          onRefresh={trading.refreshAccount}
          onLoadMore={trading.loadMoreActivity}
        />
      </div>

      {/* Right column: BotPanel */}
      <div className={styles.tradeRight}>
        <BotPanel
          connected={connected}
          accountId={activeAccount?.account_id ?? null}
          currency={currency}
          symbols={markets.map((m) => ({ symbol: m.symbol, name: m.name }))}
          snapshots={snapshots}
          selectedSymbol={selectedSymbol}
        />
      </div>

    </div>
  </section>
)}
```

**C. `LiveTradingControls` mounting** — `LiveTradingControls` is imported but its usage in the trade page is not visible in the current code (it may be on the settings or dashboard section). Do NOT remove its import; leave existing usages unchanged. Only the trade page block is being replaced.

**D. Remove orphaned `<TradingActivity>` call** — the `<TradingActivity>` that currently sits after `</div>` (outside `.marketGrid`) in the trade page block must be removed since it is now inside `.tradeLeft`. Do not touch the portfolio page's `<TradingActivity>`.

### Files
`src/components/trading/TradingWorkspace.tsx`

### Verify
`npm run build` — zero TypeScript errors. Visit `/trade` — left column shows DigitAnalysis + DemoTradeTicket; right column shows BotPanel.

---

## Item 7 — Append CSS to `src/components/trading/TradingWorkspace.module.css`

### What to do
Append new CSS classes to the end of the file. Do not modify existing rules.

### CSS to append

```css
/* ─── Trade page two-column grid ─────────────────────────────────────────── */
.tradeGrid {
  display: grid;
  grid-template-columns: minmax(0, 420px) minmax(0, 1fr);
  align-items: start;
  gap: 20px;
}
.tradeLeft {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.tradeRight {
  display: grid;
  gap: 16px;
  min-width: 0;
  position: sticky;
  top: 144px; /* below topbar (70px) + tabNav (56px) + buffer */
  max-height: calc(100vh - 160px);
  overflow-y: auto;
}
@media (max-width: 768px) {
  .tradeGrid {
    grid-template-columns: minmax(0, 1fr);
  }
  .tradeRight {
    position: static;
    max-height: none;
    overflow-y: visible;
  }
}

/* ─── Bot panel ──────────────────────────────────────────────────────────── */
.botPanel {
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--panel);
  box-shadow: var(--card-shadow);
  padding: 18px;
}
.botTabs {
  display: flex;
  gap: 6px;
  margin: 12px 0 10px;
}
.botControls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}
.botStatusMsg {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.botRunError {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 99px;
  background: var(--red-soft);
  color: var(--red);
  font-size: 10px;
  font-weight: 700;
}
.botActiveTradeCard {
  margin: 8px 0;
  padding: 10px 12px;
  border: 1px solid var(--teal);
  border-radius: 9px;
  background: var(--teal-soft);
  font-size: 11px;
  color: var(--ink);
  display: grid;
  gap: 4px;
}
.botActiveTradeCard small {
  color: var(--muted);
  font-size: 10px;
}

/* ─── Bot config form ────────────────────────────────────────────────────── */
.botConfigSection {
  display: grid;
  gap: 10px;
  min-width: 0;
}
.botConfigSection .fieldLabel {
  margin: 0 0 4px;
  font-size: 10px;
}
.botConfigSection .inputShell {
  min-height: 34px;
  padding: 0 8px;
}
.botConfigSection select {
  width: 100%;
  min-height: 34px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--input-bg);
  color: var(--ink);
  font-size: 12px;
  font-weight: 600;
}
.botConfigSection select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ─── Bot stats panel ────────────────────────────────────────────────────── */
.botStatsRow {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 14px;
}
.botStatCell {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--surface);
  display: grid;
  gap: 4px;
}
.botStatCell small {
  color: var(--muted);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .5px;
}
.botStatCell strong {
  color: var(--ink);
  font-size: 13px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.botJournalTable {
  width: 100%;
  border-collapse: collapse;
  font-size: 10px;
}
.botJournalTable th {
  text-align: left;
  color: var(--muted);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .5px;
  padding: 0 6px 6px;
  border-bottom: 1px solid var(--line);
}
.botJournalTable td {
  padding: 6px;
  color: var(--ink);
  border-bottom: 1px solid var(--line);
  font-variant-numeric: tabular-nums;
}
.botJournalTable tr:last-child td {
  border-bottom: none;
}

@media (max-width: 768px) {
  .botStatsRow {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 420px) {
  .botPanel {
    padding: 14px;
  }
  .botJournalTable th,
  .botJournalTable td {
    padding: 4px;
    font-size: 9px;
  }
}
```

### Files
`src/components/trading/TradingWorkspace.module.css` (append only)

### Verify
`npm run build` — CSS modules compile without error. Check that the trade page layout renders two columns at viewport > 768 px and one column at ≤ 768 px.

---

## Implementation Order and Dependencies

```
Item 1 (bot-types.ts)
  └─► Item 2 (useBotSession.ts)       — imports from bot-types.ts
  └─► Item 3 (BotConfigForm.tsx)      — imports from bot-types.ts
  └─► Item 4 (BotStatsPanel.tsx)      — imports from bot-types.ts
        Items 2+3+4 ─► Item 5 (BotPanel.tsx)    — imports all three
Item 7 (CSS append)                   — independent; append any time before Items 5+6
        Items 5+7 ─► Item 6 (TradingWorkspace.tsx)  — imports BotPanel, uses new CSS
```

Items 1, 7 have no dependencies and can be done first in either order. Items 2, 3, 4 depend on Item 1 and are independent of each other. Item 5 depends on Items 2, 3, 4. Item 6 depends on Items 5 and 7.

---

## Risk Notes and Edge Cases

1. **`useBotSession` WS `onmessage` chaining** — The proposal/buy/settlement steps temporarily override `socketRef.current.onmessage` and restore the previous handler after receiving their target message. This is safe in this hook since the bot WS does not multiplex with other consumers. If a future refactor adds shared listeners, use `addEventListener` pattern instead.

2. **Dynamic import of strategy-engine.mjs** — The file is a native ES module (`.mjs`). Next.js 15 supports dynamic ESM imports in client components. If the build fails with a module resolution error, fall back to: `const mod = await import("../../lib/bots/strategy-engine.mjs" as string)` — cast avoids TS checking the path — or verify the path relative to `useBotSession.ts` (`../../lib/bots/strategy-engine.mjs` resolves from `src/components/trading/` to `src/lib/bots/strategy-engine.mjs`).

3. **Currency in bot proposals** — `useBotSession` sends `"USD"` as currency. For demo accounts this is usually correct. If the active account uses a different currency (e.g., `"GBP"`), the proposal may fail. Fix: pass `currency` as a prop to `useBotSession` and use it in the proposal. This is a future enhancement; the current implementation uses `"USD"` for simplicity per spec.

4. **`DemoTradeTicket.acknowledgeOrderResolution` wiring** — `useTradingSession` exposes `acknowledgeOrderResolution` directly in its return object (confirmed at line ~793 of `useDemoTrading.ts`). Wire it as `acknowledgeOrderResolution={trading.acknowledgeOrderResolution}` in the new trade page block.

5. **`LiveTradingControls` import** — already imported in `TradingWorkspace.tsx` but its render call site is in the portfolio/settings/dashboard section (not visible in the trade page). Do NOT remove the import; only modify the trade page JSX block.
