# M1 Signal Engine — Code Review

## Evidence base
- Diff: `git -C d:\tradebridge diff HEAD~1..HEAD`
- Full files read: `forex-analysis.mjs`, `forex-analysis.d.mts`, `ForexAnalyst.tsx` (relevant sections), `ForexAnalyst.module.css`
- Build evidence from commit message: `npx tsc --noEmit` passed with no errors.

---

## 1. `calculateEma` — `forex-analysis.mjs`

**Formula**: seeds with the SMA of the first `period` closes, then applies `k = 2 / (period + 1)` for each subsequent bar. This is the standard EMA definition. ✓

**Guard**: returns `0` when `bars.length < safePeriod`. ✓

**Period fallback**: non-integer or ≤0 period falls back to 9 — acceptable default. ✓

---

## 2. `computeSignal` — `forex-analysis.mjs`

### ATR activity filter
`currentAtr >= 0.7 * avgAtr` — matches the approved requirement. ✓

The sampling window (`startIdx = Math.max(14, bars.length - 20)`) means the average is taken over at most the last ~6 bars when the history is short, but the `bars.length >= 15` guard ensures we never reach this branch with too little data. Acceptable.

### Score-to-signal mapping
| Condition | Signal |
|---|---|
| `score >= 4` | `STRONG_BUY` ✓ |
| `score === 3` | `BUY` ✓ |
| `score === -3` | `SELL` ✓ |
| `score <= -4` | `STRONG_SELL` ✓ |
| else | `WAIT` ✓ |

### SL/TP maths

**BUY path** (lines in mjs):
- `entryPrice` = ask (or last close)
- `suggestedSl = Math.min(...last3Lows) - 0.3 * currentAtr` ✓
- `suggestedTp = entryPrice + (entryPrice - suggestedSl) * 1.5` ✓

**SELL path**:
- `entryPrice` = bid (or last close)
- `suggestedSl = Math.max(...last3Highs) + 0.3 * currentAtr` ✓
- `suggestedTp = entryPrice - (suggestedSl - entryPrice) * 1.5` ✓

### NO_SIGNAL on low ATR
When `atrActive` is `false`, the function returns early with `signal: 'NO_SIGNAL'`. ✓

---

## 3. `forex-analysis.d.mts`

All new exports are present and match the implementation:

| Export | Present | Matches impl |
|---|---|---|
| `TradeSignal` type union | ✓ | ✓ |
| `SignalComponents` interface | ✓ | ✓ |
| `SignalResult` interface | ✓ | ✓ |
| `calculateEma` signature | ✓ | ✓ |
| `computeSignal` signature | ✓ | ✓ |

`computeSignal` parameter order in `.d.mts` (`m1Candles, m15Structure, entryBid?, entryAsk?`) matches the implementation and the call site. ✓

---

## 4. `ForexAnalyst.tsx`

### Default timeframe
`useState<number>(60)` — changed from 900. ✓

### Always-fetch M1 and M15
```ts
requestCandles(selectedSymbol, timeframe);
if (timeframe !== 60) requestCandles(selectedSymbol, 60);
if (timeframe !== 900) requestCandles(selectedSymbol, 900);
```
This ensures both M1 (60 s) and M15 (900 s) candles are always requested regardless of the selected timeframe. ✓

### `signalResult` recomputed on every tick
The `useMemo` dependency array includes `liveQuote`, which changes on every tick from the WebSocket handler. ✓

### SignalCard above ForexOrderPanel
In the JSX, `<SignalCard ... />` precedes `<ForexOrderPanel ... />` inside `<div className={styles.analysisRight}>`. ✓

### Existing functionality
- `ForexOrderPanel` props are unchanged.
- The `analysis` memo, chart logic, and position panels are unmodified.
- `closedCandles` / `analysis` still derive from `candles` (the selected-timeframe key). ✓

### Observation — tick merge only updates selected-timeframe key
`setCandlesByKey` in the tick handler only merges into `keyFor(symbol, timeframeRef.current)`. When the user is viewing e.g. M5, the M1 candle store is **not** live-merged; it only updates when a new full candle arrives via `requestCandles`. This means the M1 signal may lag by up to one full M1 bar between polling cycles (every 3 s per the existing interval). This is a pre-existing polling architecture decision and is **not a regression** introduced by this change — the approved design says M1 candles are always fetched (via `requestCandles`), not that ticks are merged into every timeframe key. The `signalResult` dependency on `liveQuote` still causes the signal to recompute on every tick even though the underlying M1 candles update less frequently than the display timeframe; the signal will therefore reflect the most recent closed M1 bar plus the live bid/ask. Acceptable trade-off within the approved scope.

---

## 5. `ForexAnalyst.module.css`

All required classes are present:

| Class | Present |
|---|---|
| `.analysisRight` | ✓ |
| `.signalCard` | ✓ |
| `.signalCardHeader` | ✓ |
| `.signalBadge` | ✓ |
| `.signalStrongBuy`, `.signalBuy`, `.signalSell`, `.signalStrongSell`, `.signalWait`, `.signalNone` | ✓ |
| `.signalScore`, `.signalComponents`, `.signalRow` | ✓ |
| `.signalLevels`, `.signalLevelRow`, `.signalSlValue`, `.signalTpValue` | ✓ |
| `.signalDisclaimer` | ✓ |

---

## Verdict

No blockers found. All approved requirements are correctly implemented.
