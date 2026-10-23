/**
 * Demo-only strategy execution coordinator.
 *
 * This module deliberately has no Deriv transport of its own. The caller must
 * provide a demo-only execute-and-reconcile function that resolves only after
 * the contract has settled authoritatively. A rejected/unknown result halts
 * the sequence; it must never be retried automatically.
 */
export const MAX_STRATEGY_TRADES = 3;
export const MAX_CONSECUTIVE_LOSSES = 2;

export function createDemoExecutionSession({ sessionId, isDemoAccount, executeAndReconcile }) {
  if (!sessionId || typeof sessionId !== "string") throw new TypeError("sessionId is required");
  if (isDemoAccount !== true) throw new Error("Strategy auto-execution is available for Deriv Demo accounts only");
  if (typeof executeAndReconcile !== "function") throw new TypeError("executeAndReconcile must be a function");

  let state = "ready";
  let submitted = 0;
  let consecutiveLosses = 0;
  let inFlight = false;
  const contractIds = new Set();
  const results = [];

  return {
    snapshot() {
      return {
        sessionId,
        state,
        submitted,
        consecutiveLosses,
        remaining: Math.max(0, MAX_STRATEGY_TRADES - submitted),
        contractIds: [...contractIds],
        results: [...results],
      };
    },

    async runQualifiedSignal(signal, tradeInput) {
      if (state === "stopped" || state === "completed") return this.snapshot();
      if (inFlight) throw new Error("A strategy execution sequence is already in flight");
      if (!signal || signal.qualified !== true || signal.symbol !== tradeInput?.symbol) {
        throw new Error("A fresh qualified signal for the configured market is required");
      }
      if (submitted >= MAX_STRATEGY_TRADES || consecutiveLosses >= MAX_CONSECUTIVE_LOSSES) {
        state = "stopped";
        return this.snapshot();
      }

      inFlight = true;
      state = "executing";
      try {
        // Wait for each accepted contract to settle before submitting the next.
        // This is required to enforce the two-consecutive-loss stop correctly.
        while (submitted < MAX_STRATEGY_TRADES && consecutiveLosses < MAX_CONSECUTIVE_LOSSES) {
          state = "executing";
          const result = await executeAndReconcile({
            ...tradeInput,
            signal,
            sequence: submitted + 1,
            sessionId,
            accountMode: "demo",
          });

          if (!result || result.status !== "settled" || !result.contractId
              || !["won", "lost", "breakeven"].includes(result.outcome)
              || !Number.isFinite(result.profit)) {
            state = "reconciliation_required";
            return this.snapshot();
          }

          submitted += 1;
          contractIds.add(String(result.contractId));
          results.push({ sequence: submitted, ...result });
          consecutiveLosses = result.outcome === "lost"
            ? consecutiveLosses + 1
            : 0;
        }

        state = consecutiveLosses >= MAX_CONSECUTIVE_LOSSES ? "stopped" : "completed";
        return this.snapshot();
      } catch (error) {
        // Unknown provider outcomes must pause the strategy, not trigger retries.
        state = "reconciliation_required";
        throw error;
      } finally {
        inFlight = false;
      }
    },

    stop() {
      if (state !== "completed" && state !== "stopped") state = "stopped";
      return this.snapshot();
    },
  };
}
