# SMC Signal Engine — Code Review

**Commit:** f3138d0 feat: add SMC signal engine with liquidity sweep detection and BoS signals  
**Build verification:** `npx tsc --noEmit` passed with 0 errors (stated in commit message)  
**Verdict:** APPROVED

---

## Evidence Summary

### forex-analysis.mjs — SMC Logic

**findLiquidityLevels**  
Uses `findSwingPoints(bars, 2)` (strength = 2) on the supplied candle array.  
Takes last 5 swing highs/lows, filters to "untapped" by checking no candle after the swing has a *close* strictly beyond it. Returns the most recent 3 of each, sorted by recency. Logic is correct per SMC definition of untapped pool.

**detectLiquiditySweep**  
Checks only the *last* candle. Sweep conditions are correctly stated:
- BSL: `last.high > level && last.close < level` (wick through, close back below — bearish rejection)
- SSL: `last.low < level && last.close > level` (wick through, close back above — bullish rejection)

When multiple levels are simultaneously swept, picks the *most significant* (highest BSL / lowest SSL), which is correct SMC practice. Returns `null` cleanly when no sweep is present.

**detectBreakOfStructure**  
Takes up to 10 M1 candles after the sweep bar. Pivot is the last confirmed swing high (SSL/bullish setup) or swing low (BSL/bearish setup) computed from bars *up to and including* the sweep index. Confirms BoS on the first candle whose close crosses the pivot. Correctly returns `{ confirmed: false }` when sweep index is not the last bar (no post-sweep candles) or when no qualifying swing exists.

**M15→M1 epoch alignment verified:**  
M15 bar epochs are always multiples of 900s, which are also multiples of 60s, so the epoch always matches a valid M1 bar epoch. The `sweepEpochInM1` check is reliable — the M15 sweep candle will exist in M1 history as long as history covers that range. When it does not, `bosEpoch` falls back to the last M1 bar, `postSweep` is empty, and BoS returns `{ confirmed: false }` → WAIT. Safe and non-crashing.

**computeSmcSignal**  
Correct multi-step pipeline:
1. H1 liquidity levels (structural context)
2. M15 sweep against H1 levels (HIGH confidence) or M15-own levels (MEDIUM confidence)
3. M1 BoS confirmation (10-candle window)
4. Entry (ask for BUY, bid for SELL, last close fallback), SL (wick extreme ± ATR×0.3), TP (nearest opposing H1 level, or 2R fallback)

All arithmetic is guarded with `Number.isFinite`. Division by zero in R:R guarded by `slDist > 0`. TP fallback applied if `!Number.isFinite(tp)`. WAIT returned on any step that fails.

**TP selection correctness:**  
BUY targets nearest H1 BSL *above* entry. H1 BSL levels are untapped by definition (`findLiquidityLevels` filters out tapped levels). The M15 sweep was against H1 levels at-or-below current price; H1 BSL above entry is a valid target. No contradiction.

---

### ForexAnalyst.tsx — UI Changes

**H1 fetch:**  
Added `if (timeframe !== 3600) requestCandles(selectedSymbol, 3600)` inside the existing effect alongside the M1/M15 background fetches. Follows exact same pattern. Dep array unchanged; correct.

**closedH1Candles useMemo:**  
Pattern is consistent with pre-existing `closedM1Candles` and `closedM15Candles`. Bucket computed inline; memo re-runs whenever `h1Candles` array reference changes (which happens on every tick-driven candle merge). Not a regression.

**smcSignal memo:**  
Deps `[closedM1Candles, closedM15Candles, closedH1Candles, liveQuote]` — all inputs to `computeSmcSignal` are listed. No missing deps.

**SVG overlays:**  
Wrapped in `(timeframe === 60 || timeframe === 900)` — overlays only on M1 and M15 charts as intended. Bounds check `y < chart.top || y > chart.height - chart.bottom` matches the identical guard on the pre-existing support/resistance zone overlays. BSL lines (purple), SSL lines (orange), BoS line (teal dashed), sweep triangle markers — all use appropriate CSS classes and correct SVG geometry.

Sweep marker direction verified: BSL sweep (bearish) places triangle *above* the candle high (y = `yFor(high) - 8`, apex at that y, wings 7px higher in SVG space — correctly reads as a downward-pointing arrow outside the high). SSL places triangle below the candle low symmetrically.

**SmcSignalCard placement:**  
Line 1229–1231: `SignalCard` → `SmcSignalCard` → `ForexOrderPanel`. Correct.

**SmcSignalCard null/NaN safety:**  
- `fmt(n)`: guards `n == null || !Number.isFinite(n)` → `'—'`
- `pips(a, b)`: guards both operands
- `rrRatio != null` check before `.toFixed(2)`
- `{confidence && <span>}` — confidence badge hidden when `null`
- Entry grid and R:R row only rendered when `isActive`

---

### forex-analysis.d.mts — Types

All four new functions declared with correct parameter and return types matching the JS implementation. `SmcSignal` interface fields exactly match every property returned by `computeSmcSignal` in both the WAIT and active-signal branches. `LiquidityLevels`, `SweepEvent`, `BosEvent` interfaces are accurate.

---

### Existing Functionality — Not Regressed

- `SignalCard` (M1 EMA signal) still rendered at line 1229, unchanged
- `computeSignal` / `m15Analysis` / `signalResult` memo unchanged
- Support/resistance zones unchanged
- Chart, pan/zoom, position lines, live quote line unchanged
- `ForexOrderPanel` unchanged

---

## Findings

No blockers found.
