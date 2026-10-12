"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "../../lib/supabase/client";
import type { DerivAccount, DigitContractMode, DigitPrediction, MarketInstrument, MarketSnapshot } from "./types";
import styles from "./DigitAnalysis.module.css";

const DIGITS = Array.from({ length: 10 }, (_, i) => i);

type DeployedStrategy = {
  id: string;
  name: string;
  source_format: string;
  status: string;
  created_at: string;
  account_id?: string | null;
  last_error?: string | null;
  session_pnl?: number | string | null;
  session_trade_count?: number | null;
  last_evaluated_at?: string | null;
  strategy_definition?: {
    market?: string;
    contract_type?: string;
    barrier?: number | null;
    duration_ticks?: number;
    stake?: number;
    entry_rule?: string;
    frequency_window?: number;
    max_session_loss?: number;
    session_profit_target?: number;
  } | null;
};

function formatPnl(val?: number | string | null) {
  const num = Number(val ?? 0);
  if (!Number.isFinite(num)) return "$0.00";
  const sign = num > 0 ? "+" : "";
  return `${sign}$${num.toFixed(2)}`;
}

export default function DigitAnalysis({
  market,
  snapshot,
  mode,
  onModeChange,
  prediction,
  onPredictionChange,
  target,
  onTargetChange,
  activeAccount,
}: {
  market: MarketInstrument | null;
  snapshot?: MarketSnapshot;
  mode: DigitContractMode;
  onModeChange: (mode: DigitContractMode) => void;
  prediction: DigitPrediction;
  onPredictionChange?: (prediction: DigitPrediction) => void;
  target: number;
  onTargetChange: (target: number) => void;
  activeAccount?: DerivAccount | null;
}) {
  const [strategies, setStrategies] = useState<DeployedStrategy[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [demoAccounts, setDemoAccounts] = useState<Array<{ account_id: string; currency?: string | null }>>([]);

  const loadDemoAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/deriv/accounts", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { accounts?: DerivAccount[] };
      const demo = (data.accounts ?? []).filter(
        (a) => (a.account_type ?? "").toLowerCase() === "demo" && Boolean(a.account_id),
      );
      setDemoAccounts(demo);
    } catch {
      // offline or silent
    }
  }, []);

  const loadStrategies = useCallback(async () => {
    if (!market?.symbol) {
      setStrategies([]);
      return;
    }
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setStrategies([]);
        return;
      }
      const { data, error } = await supabase
        .from("bot_strategy_definitions")
        .select("id,name,source_format,status,created_at,account_id,last_error,session_pnl,session_trade_count,last_evaluated_at,strategy_definition")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const currentSymbol = market.symbol.toUpperCase();
      const matching = ((data ?? []) as DeployedStrategy[]).filter((item) => {
        const itemMarket = (item.strategy_definition?.market ?? "").toUpperCase();
        return itemMarket === currentSymbol;
      });

      setStrategies(matching);
      if (matching.length > 0) {
        setSelectedStrategyId((prev) => {
          if (matching.some((m) => m.id === prev)) return prev;
          const running = matching.find((m) => m.status === "running");
          return running ? running.id : matching[0].id;
        });
      } else {
        setSelectedStrategyId("");
      }
    } catch {
      // handled
    }
  }, [market?.symbol]);

  useEffect(() => {
    void loadDemoAccounts();
  }, [loadDemoAccounts]);

  useEffect(() => {
    setActionMsg(null);
    setActionError(null);
    void loadStrategies();
  }, [loadStrategies]);

  const activeStrategy = useMemo(() => {
    return strategies.find((s) => s.id === selectedStrategyId) ?? strategies[0] ?? null;
  }, [strategies, selectedStrategyId]);

  const targetDemoAccountId = useMemo(() => {
    if (activeAccount?.account_id && (activeAccount.account_type ?? "").toLowerCase() === "demo") {
      return activeAccount.account_id;
    }
    return activeStrategy?.account_id ?? demoAccounts[0]?.account_id ?? "";
  }, [activeAccount, activeStrategy?.account_id, demoAccounts]);

  async function handleToggleBot(strategy: DeployedStrategy, action: "start" | "pause") {
    if (action === "start" && !targetDemoAccountId) {
      setActionError("Select or connect a verified Deriv Demo account to run this bot.");
      return;
    }
    setActionBusy(true);
    setActionError(null);
    setActionMsg(null);
    try {
      const res = await fetch("/api/bots/strategies/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy_id: strategy.id,
          action,
          ...(action === "start" ? { account_id: targetDemoAccountId } : {}),
        }),
      });
      const data = (await res.json()) as { error?: string; details?: string[]; message?: string };
      if (!res.ok) {
        throw new Error([data.error, ...(data.details ?? [])].filter(Boolean).join(": "));
      }
      setActionMsg(
        action === "start"
          ? `Bot is running on Demo account ${targetDemoAccountId}. Evaluated automatically by the server runner.`
          : "Bot paused. No new positions will be opened.",
      );
      await loadStrategies();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to update bot state.");
    } finally {
      setActionBusy(false);
    }
  }

  const [windowSize, setWindowSize] = useState(100);
  const validTargets = mode === "over-under"
    ? DIGITS.filter((digit) => prediction === "UNDER" ? digit >= 1 : digit <= 8)
    : DIGITS;
  const allPoints = snapshot?.points ?? [];
  const points = useMemo(() => allPoints.slice(-windowSize), [allPoints, windowSize]);
  const digits = useMemo(() => points.flatMap((p) =>
    Number.isInteger(p.lastDigit) && p.lastDigit! >= 0 && p.lastDigit! <= 9
      ? [{ digit: p.lastDigit!, time: p.time }] : []
  ), [points]);
  const counts = useMemo(() => DIGITS.map((d) => digits.filter((p) => p.digit === d).length), [digits]);
  const total = digits.length;
  // Frequency rank and newest tick are independent signals.
  const latestDigit = digits.length ? digits[digits.length - 1].digit : null;
  const ranking = useMemo(() => [...DIGITS].sort((a, b) => counts[b] - counts[a] || a - b), [counts]);
  const rank = (d: number) => ranking.indexOf(d) + 1;
  const even = digits.filter((p) => p.digit % 2 === 0).length;
  const odd = total - even;
  const above = digits.filter((p) => p.digit > target).length;
  const below = digits.filter((p) => p.digit < target).length;
  const matches = counts[target];
  const differs = total - matches;
  const recent = [...digits].slice(-30).reverse();
  const percent = (n: number) => total ? (n / total * 100).toFixed(1) + "%" : "—";

  return <section className={styles.root} aria-label="Digit analysis">
    {activeStrategy ? (
      <div className={`${styles.botWidget} ${activeStrategy.status === "running" ? styles.botWidgetActive : ""}`}>
        <div className={styles.botHeader}>
          <div className={styles.botIdentity}>
            <span role="img" aria-label="bot">🤖</span>
            <strong className={styles.botName}>{activeStrategy.name}</strong>
            {strategies.length > 1 && (
              <select
                className={styles.botSelect}
                value={selectedStrategyId}
                onChange={(e) => { setSelectedStrategyId(e.target.value); setActionMsg(null); setActionError(null); }}
                aria-label="Select deployed strategy"
              >
                {strategies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.status.toUpperCase()})
                  </option>
                ))}
              </select>
            )}
            <span
              className={`${styles.botBadge} ${
                activeStrategy.status === "running"
                  ? styles.botBadgeRunning
                  : activeStrategy.status === "draft"
                    ? styles.botBadgeDraft
                    : styles.botBadgePaused
              }`}
            >
              {activeStrategy.status === "running" && <span className={styles.botBadgeRunningDot} />}
              {activeStrategy.status.toUpperCase()}
            </span>
          </div>

          <div className={styles.botActions}>
            {activeStrategy.status === "running" ? (
              <button
                type="button"
                className={styles.pauseButton}
                disabled={actionBusy}
                onClick={() => void handleToggleBot(activeStrategy, "pause")}
              >
                {actionBusy ? "Working…" : "⏸ Pause Bot"}
              </button>
            ) : (
              <button
                type="button"
                className={styles.runButton}
                disabled={
                  actionBusy ||
                  activeStrategy.source_format === "xml" ||
                  activeStrategy.strategy_definition?.entry_rule === "manual_review"
                }
                onClick={() => void handleToggleBot(activeStrategy, "start")}
                title={
                  activeStrategy.strategy_definition?.entry_rule === "manual_review"
                    ? "Manual review strategy cannot auto-run. Edit entry rule in Bots tab."
                    : "Run bot on verified Demo account"
                }
              >
                {actionBusy ? "Working…" : "▶ Run Bot"}
              </button>
            )}
            <Link href="/bots" className={styles.botLink}>
              ⚙ Setup in Bots
            </Link>
          </div>
        </div>

        {activeStrategy.strategy_definition && (
          <div className={styles.botMeta}>
            <div className={styles.botSpecs}>
              <span>
                <strong>{activeStrategy.strategy_definition.contract_type?.replace("DIGIT", "DIGIT ")}</strong>
                {activeStrategy.strategy_definition.barrier !== null &&
                activeStrategy.strategy_definition.barrier !== undefined
                  ? ` (Barrier ${activeStrategy.strategy_definition.barrier})`
                  : ""}
              </span>
              <span>Stake: <strong>${Number(activeStrategy.strategy_definition.stake ?? 1).toFixed(2)}</strong></span>
              <span>Window: <strong>{activeStrategy.strategy_definition.frequency_window ?? 100} ticks</strong></span>
              <span>Rule: <strong>{activeStrategy.strategy_definition.entry_rule === "last_digit_frequency" ? "Frequency" : "Manual review"}</strong></span>
            </div>

            <div className={styles.botSpecs}>
              {activeStrategy.session_pnl !== null && activeStrategy.session_pnl !== undefined && (
                <span>
                  Session P&amp;L:{" "}
                  <strong className={Number(activeStrategy.session_pnl) >= 0 ? styles.botPnlPositive : styles.botPnlNegative}>
                    {formatPnl(activeStrategy.session_pnl)}
                  </strong>
                </span>
              )}
              {activeStrategy.session_trade_count !== null && activeStrategy.session_trade_count !== undefined && (
                <span>Trades: <strong>{activeStrategy.session_trade_count}</strong></span>
              )}
            </div>
          </div>
        )}

        {actionMsg && <div className={`${styles.botNotice} ${styles.botNoticeSuccess}`}>{actionMsg}</div>}
        {actionError && <div className={`${styles.botNotice} ${styles.botNoticeError}`}>{actionError}</div>}
        {activeStrategy.strategy_definition?.entry_rule === "manual_review" && (
          <div className={`${styles.botNotice} ${styles.botNoticeWarning}`}>
            Manual review rule: This strategy cannot auto-place orders. To run it, switch its Entry Rule to Last-digit frequency in the Bots tab.
          </div>
        )}
        {activeStrategy.last_error && !actionError && (
          <div className={`${styles.botNotice} ${styles.botNoticeError}`}>
            Last runner notice: {activeStrategy.last_error.replace(/_/g, " ")}
          </div>
        )}
      </div>
    ) : (
      <div className={styles.botEmptyWidget}>
        <div>
          <span>🤖 </span>
          <strong>No bot deployed for {market?.symbol ?? "this market"}</strong>
          <span> · Configure a strategy in the Bots tab to automate trading on this instrument.</span>
        </div>
        <Link href="/bots" className={styles.botEmptyAction}>
          + Set up Bot in Bots Tab →
        </Link>
      </div>
    )}
    <div className={styles.controls}>
      <label className={styles.control}><span>Contract type</span><select value={mode} onChange={(e) => onModeChange(e.target.value as DigitContractMode)}>
        <option value="over-under">Over / Under</option><option value="even-odd">Even / Odd</option><option value="matches-differs">Matches / Differs</option>
      </select></label>
      <label className={styles.control}><span>Tick window</span><select value={windowSize} onChange={(e) => setWindowSize(Number(e.target.value))}>
        {[50,100,250,500,1000].map((n) => <option key={n} value={n}>{n.toLocaleString()} ticks</option>)}
      </select></label>
      {mode !== "even-odd" && <label className={styles.control}>
        <span>{mode === "over-under" ? "Barrier digit" : "Target digit"}</span>
        <select value={target} onChange={(e) => onTargetChange(Number(e.target.value))}>
          {validTargets.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </label>}
    </div>
    <div className={styles.modeSummary}>
      {mode === "over-under" ? <>
        <div><span>Above {target}</span><strong>{percent(above)}</strong><small>{above} observed ticks</small></div>
        <div><span>Below {target}</span><strong>{percent(below)}</strong><small>{below} observed ticks</small></div>
        <p>Digits equal to the barrier are excluded from both groups.</p>
      </> : mode === "even-odd" ? <>
        <div><span>Even digits</span><strong>{percent(even)}</strong><small>{even} observed ticks</small></div>
        <div><span>Odd digits</span><strong>{percent(odd)}</strong><small>{odd} observed ticks</small></div>
        <p>Even/odd distribution for the selected window.</p>
      </> : <>
        <div><span>Matches {target}</span><strong>{percent(matches)}</strong><small>{matches} matches</small></div>
        <div><span>Differs from {target}</span><strong>{percent(differs)}</strong><small>{differs} other digits</small></div>
        <p>Historical match rate does not predict the next tick.</p>
      </>}
    </div>
    <section className={styles.panel}>
      <div className={styles.panelTitle}><div><h3>Digit frequency</h3><p>Final digits · {total} valid ticks in selected window</p></div></div>
      <div className={styles.frequencyGrid}>{DIGITS.map((d) => {
        const r = rank(d);
        const cls = r === 1 ? styles.top : r === 2 ? styles.second : r === 10 ? styles.low : r === 9 ? styles.secondLow : "";
        return <div className={styles.frequencyItem} key={d}>
          <div className={[styles.ring, cls, d === latestDigit ? styles.latestDigitRing : ""].filter(Boolean).join(" ")} aria-label={`Digit ${d}, ${percent(counts[d])} of observed ticks`}><strong className={styles.digitNumber}>{d}</strong><span className={styles.digitPercent}>{percent(counts[d])}</span>{d === latestDigit && <span className={styles.star} aria-label="Latest incoming tick digit" title="Latest incoming tick">★</span>}</div>
          <span className={styles.count}>{counts[d]} ticks</span>
          <span className={styles.rank}>{r === 1 ? "Highest" : r === 2 ? "2nd high" : r === 9 ? "2nd low" : r === 10 ? "Lowest" : " "}</span>
        </div>;
      })}</div>
    </section>
    <div className={styles.lowerGrid}>
      <section className={styles.panel}><div className={styles.panelTitle}><div><h3>Recent tick digits</h3><p>Newest first · {recent.length} most recent valid ticks</p></div></div>
        {recent.length ? <div className={styles.recentGrid}>{recent.map((p, i) => <div key={p.time + "-" + i} className={i === 0 ? styles.recentLatest : styles.recentDigit} title={new Date(p.time * 1000).toLocaleTimeString()}>{p.digit}</div>)}</div>
          : <div className={styles.empty}>Waiting for valid tick digits from the selected market.</div>}
      </section>
      <section className={styles.panel}><div className={styles.panelTitle}><div><h3>Distribution</h3><p>Observed counts and shares</p></div></div>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Digit</th><th>Count</th><th>Share</th><th>Rank</th></tr></thead>
          <tbody>{DIGITS.map((d) => <tr key={d}><td><span className={styles.tableDigit}>{d}</span></td><td>{counts[d]}</td><td>{percent(counts[d])}</td><td>#{rank(d)}</td></tr>)}</tbody>
        </table></div>
      </section>
    </div>
    <footer className={styles.disclaimer}><strong>ⓘ Descriptive statistics only</strong><p>Observed frequency does not establish a profitable edge. Analysis settings never place or modify an order.</p></footer>
  </section>;
}
