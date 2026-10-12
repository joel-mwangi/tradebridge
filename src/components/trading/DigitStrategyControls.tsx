"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";

type Item = { id: string; name: string; source_format: string; status: string; created_at: string; account_id?: string | null; last_error?: string | null; session_pnl?: number | string | null; last_evaluated_at?: string | null; runner_last_result?: string | null; strategy_definition?: { entry_rule?: string; market?: string; contract_type?: string; stake?: number; duration_ticks?: number } | null };
type DemoAccount = { account_id: string; account_type: string | null; currency: string | null; balance?: number | null };
type Trade = { id: string; symbol: string; contract_type: string; status: string; stake: number | string; realized_pnl?: number | string | null; contract_id?: string | number | null; created_at: string };

export default function DigitStrategyControls({ userId }: { userId: string | null }) {
  const [items, setItems] = useState<Item[]>([]);
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    if (!userId) { setItems([]); return; }
    const { data, error } = await createClient().from("bot_strategy_definitions")
      .select("id,name,source_format,status,created_at,account_id,last_error,session_pnl,last_evaluated_at,runner_last_result,strategy_definition")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(20);
    if (error) setError("Could not load saved strategy states.");
    else setItems((data ?? []) as Item[]);
    const tradeResult = await createClient().from("digit_strategy_trades")
      .select("id,symbol,contract_type,status,stake,realized_pnl,contract_id,created_at")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(10);
    if (!tradeResult.error) setTrades((tradeResult.data ?? []) as Trade[]);
  }
  useEffect(() => {
    let alive = true;
    void refresh();
    void fetch("/api/auth/deriv/accounts", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const result = await response.json() as { accounts?: DemoAccount[] };
      const demo = (result.accounts ?? []).filter((item) => (item.account_type ?? "").toLowerCase() === "demo" && Boolean(item.account_id));
      if (alive) { setAccounts(demo); setAccountId((current) => current || demo[0]?.account_id || ""); }
    }).catch(() => undefined);
    const poll = window.setInterval(() => {
      if (alive) void refresh();
    }, 15000);
    return () => { alive = false; window.clearInterval(poll); };
  }, [userId]);

  async function act(item: Item, action: "start" | "pause") {
    if (action === "start" && !accountId.trim()) { setError("Enter the linked Deriv Demo account ID first."); return; }
    setBusy(item.id); setError(""); setMessage("");
    try {
      const response = await fetch("/api/bots/strategies/lifecycle", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy_id: item.id, action, ...(action === "start" ? { account_id: accountId.trim() } : {}) }),
      });
      const data = await response.json() as { error?: string; details?: string[]; status?: string };
      if (!response.ok) throw new Error([data.error, ...(data.details ?? [])].filter(Boolean).join(": "));
      setMessage(action === "start" ? "Demo strategy armed. This confirms configuration only; check Last completed evaluation and Runner result below to verify the scheduled runner is working." : "Strategy paused. New entries are disabled; an existing contract may still need settlement monitoring.");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update strategy."); }
    finally { setBusy(null); }
  }

  return <section className="runtime panel" aria-labelledby="digit-runtime-title">
    <header><div><h2 id="digit-runtime-title">Digit strategy runtime</h2><p>Demo-only execution. “Armed” means eligible for runner evaluation; it does not mean a trade is currently open or that the scheduler is healthy.</p></div><button type="button" onClick={() => void refresh()}>Refresh</button></header>
    <label htmlFor="digit-demo-account">Verified Deriv Demo account</label>
    <select id="digit-demo-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={accounts.length === 0}>
      <option value="">{accounts.length ? "Choose a Demo account" : "Connect Deriv to load Demo accounts"}</option>
      {accounts.map((account) => <option key={account.account_id} value={account.account_id}>{account.account_id} · {account.currency ?? "Currency unavailable"}{account.balance !== undefined && account.balance !== null ? " · " + Number(account.balance).toFixed(2) : ""}</option>)}
    </select>
    <small>Only linked Demo accounts appear here; the server verifies account ownership and rejects Real accounts. Imported Blockly XML remains non-executable until translated to the native strategy format.</small>
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p className="message" role="status">{message}</p>}
    <div className="items">{items.map((item) => <article key={item.id}>
      <div className="info"><strong>{item.name}</strong><small>{item.source_format.toUpperCase()} · {item.account_id ?? "No account linked"}</small>{item.strategy_definition?.market && <small>Market: {item.strategy_definition.market} · Contract: {(item.strategy_definition.contract_type ?? "").replace("DIGIT", "") || "Digit"} · Stake: {item.strategy_definition.stake ?? "—"} · Duration: {item.strategy_definition.duration_ticks ?? "—"} tick(s)</small>}{!item.account_id && <small>Selecting an account above does not link it until this strategy is successfully armed.</small>}{item.strategy_definition?.entry_rule === "manual_review" && <small className="warning">Manual review only: this strategy cannot auto-place trades. Create a strategy with the Last-digit frequency rule to enable automated Demo execution.</small>}{item.last_evaluated_at ? <small>Last completed evaluation: {new Date(item.last_evaluated_at).toLocaleString()}</small> : <small className="warning">No completed runner evaluation recorded yet.</small>}{item.runner_last_result && <small>Runner result: {item.runner_last_result.replaceAll("_", " ")}</small>}{item.last_error && <small className="error">Blocker: {item.last_error.replaceAll("_", " ")}</small>}{item.session_pnl !== null && item.session_pnl !== undefined && <small className={Number(item.session_pnl) > 0 ? "positive" : Number(item.session_pnl) < 0 ? "negative" : ""}>Realized session P&amp;L: {Number(item.session_pnl) > 0 ? "+" : ""}{Number(item.session_pnl).toFixed(2)} · {Number(item.session_pnl) > 0 ? "PROFIT" : Number(item.session_pnl) < 0 ? "LOSS" : "BREAK-EVEN"}</small>}</div>
      <div className="controls"><span className={item.status === "running" ? "running" : ""}>{item.status === "running" ? "ARMED" : item.status.toUpperCase()}</span>{item.status === "running" ? <button type="button" disabled={busy === item.id} onClick={() => void act(item, "pause")}>{busy === item.id ? "Working…" : "Pause"}</button> : <button type="button" disabled={busy === item.id || item.source_format === "xml" || item.strategy_definition?.entry_rule === "manual_review"} onClick={() => void act(item, "start")}>{busy === item.id ? "Working…" : "▶ Run"}</button>}</div>
    </article>)}</div>
    <div className="tradeHistory">
      <h3>Recent digit trades</h3>
      {trades.length === 0 ? <p>No digit contracts recorded yet.</p> : trades.map((trade) => <article key={trade.id}>
        <div><strong>{trade.symbol} · {trade.contract_type.replace("DIGIT", "")}</strong><small>{new Date(trade.created_at).toLocaleString()} · Stake {Number(trade.stake).toFixed(2)}{trade.contract_id ? " · Deriv contract " + trade.contract_id : ""}</small></div>
        <div className="tradeResult"><span className={["open","pending","unknown"].includes(trade.status) ? "warning" : ""}>{["open","pending","unknown"].includes(trade.status) ? "CONTRACT " + trade.status.toUpperCase() : trade.status.toUpperCase()}</span>{trade.realized_pnl !== null && trade.realized_pnl !== undefined && <strong className={Number(trade.realized_pnl) > 0 ? "positive" : Number(trade.realized_pnl) < 0 ? "negative" : ""}>{Number(trade.realized_pnl) > 0 ? "+" : ""}{Number(trade.realized_pnl).toFixed(2)}</strong>}</div>
      </article>)}
    </div>
    <style jsx>{`
      .runtime{grid-column:1/-1;border:1px solid var(--bot-line);border-radius:14px;padding:20px;background:var(--bot-panel);min-width:0}
      header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px}
      h2{margin:0;color:var(--bot-ink);font-size:18px} header p{margin:6px 0 0;color:var(--bot-muted);font-size:13px;line-height:1.5}
      label{display:block;color:var(--bot-label);font-size:13px;font-weight:650;margin-bottom:7px}
      input,select{box-sizing:border-box;width:100%;border:1px solid var(--bot-border);border-radius:9px;background:var(--bot-card);color:var(--bot-ink);padding:11px 12px;font:inherit}
      small{display:block;color:var(--bot-muted);font-size:11px;margin-top:5px;overflow-wrap:anywhere}
      button{border:1px solid var(--bot-border);border-radius:8px;background:var(--bot-surface);color:var(--bot-ink);padding:8px 11px;font:inherit;font-size:12px;font-weight:700;cursor:pointer}
      button:disabled{opacity:.55;cursor:not-allowed}
      .items{margin-top:14px}.items article{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--bot-line)}
      .info{min-width:0}.info strong{font-size:13px;color:var(--bot-ink);overflow-wrap:anywhere}.controls{display:flex;align-items:center;gap:10px;flex-shrink:0}.controls span{font-size:10px;font-weight:800;color:var(--bot-muted)}.controls .running{color:var(--bot-success)}
      .tradeHistory{margin-top:18px;border-top:1px solid var(--bot-line);padding-top:14px}.tradeHistory h3{font-size:14px;color:var(--bot-ink);margin:0 0 8px}.tradeHistory p{color:var(--bot-muted);font-size:12px}.tradeHistory article{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--bot-line)}.tradeHistory article strong{font-size:12px;color:var(--bot-ink)}.tradeResult{display:flex;align-items:center;gap:10px;flex-shrink:0}.tradeResult span{font-size:10px;color:var(--bot-muted);font-weight:800}.tradeResult .warning,.warning{color:#fbbf24}.positive{color:var(--bot-success)}.negative{color:#f87171}.tradeResult .positive{color:var(--bot-success)}.tradeResult .negative{color:#fca5a5}.error{color:#fca5a5}.warning{color:#fbbf24}.message{color:var(--bot-success);font-size:13px}
      @media(max-width:600px){header,.items article{align-items:flex-start}.items article{flex-direction:column}.controls{width:100%;justify-content:space-between}}
    `}</style>
  </section>;
}
