"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";

type Item = { id: string; name: string; source_format: string; status: string; created_at: string; account_id?: string | null; last_error?: string | null; session_pnl?: number | string | null };

export default function DigitStrategyControls({ userId }: { userId: string | null }) {
  const [items, setItems] = useState<Item[]>([]);
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    if (!userId) { setItems([]); return; }
    const { data, error } = await createClient().from("bot_strategy_definitions")
      .select("id,name,source_format,status,created_at,account_id,last_error,session_pnl")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(20);
    if (error) setError("Could not load saved strategy states.");
    else setItems((data ?? []) as Item[]);
  }
  useEffect(() => { void refresh(); }, [userId]);

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
      setMessage(action === "start" ? "Demo strategy armed. It will be evaluated by the scheduled server runner." : "Strategy paused. New entries are disabled.");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update strategy."); }
    finally { setBusy(null); }
  }

  return <section className="runtime panel" aria-labelledby="digit-runtime-title">
    <header><div><h2 id="digit-runtime-title">Digit strategy runtime</h2><p>Arm supported native strategies on Demo accounts and monitor the server-reported state.</p></div><button type="button" onClick={() => void refresh()}>Refresh</button></header>
    <label htmlFor="digit-demo-account">Linked Deriv Demo account ID</label>
    <input id="digit-demo-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="Enter your linked Demo account ID" autoComplete="off" />
    <small>Real accounts are rejected by the server. Imported Blockly XML remains non-executable until translated to the native strategy format.</small>
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p className="message" role="status">{message}</p>}
    <div className="items">{items.map((item) => <article key={item.id}>
      <div className="info"><strong>{item.name}</strong><small>{item.source_format.toUpperCase()} · {item.account_id ?? "No account linked"}</small>{item.last_error && <small className="error">{item.last_error.replaceAll("_", " ")}</small>}{item.session_pnl !== null && item.session_pnl !== undefined && <small>Session P&amp;L: {Number(item.session_pnl).toFixed(2)}</small>}</div>
      <div className="controls"><span className={item.status === "running" ? "running" : ""}>{item.status.toUpperCase()}</span>{item.status === "running" ? <button type="button" disabled={busy === item.id} onClick={() => void act(item, "pause")}>{busy === item.id ? "Working…" : "Pause"}</button> : <button type="button" disabled={busy === item.id || item.source_format === "xml"} onClick={() => void act(item, "start")}>{busy === item.id ? "Working…" : "Start Demo"}</button>}</div>
    </article>)}</div>
    <style jsx>{`
      .runtime{grid-column:1/-1;border:1px solid var(--bot-line);border-radius:14px;padding:20px;background:var(--bot-panel);min-width:0}
      header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px}
      h2{margin:0;color:var(--bot-ink);font-size:18px} header p{margin:6px 0 0;color:var(--bot-muted);font-size:13px;line-height:1.5}
      label{display:block;color:var(--bot-label);font-size:13px;font-weight:650;margin-bottom:7px}
      input{box-sizing:border-box;width:100%;border:1px solid var(--bot-border);border-radius:9px;background:var(--bot-card);color:var(--bot-ink);padding:11px 12px;font:inherit}
      small{display:block;color:var(--bot-muted);font-size:11px;margin-top:5px;overflow-wrap:anywhere}
      button{border:1px solid var(--bot-border);border-radius:8px;background:var(--bot-surface);color:var(--bot-ink);padding:8px 11px;font:inherit;font-size:12px;font-weight:700;cursor:pointer}
      button:disabled{opacity:.55;cursor:not-allowed}
      .items{margin-top:14px}.items article{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--bot-line)}
      .info{min-width:0}.info strong{font-size:13px;color:var(--bot-ink);overflow-wrap:anywhere}.controls{display:flex;align-items:center;gap:10px;flex-shrink:0}.controls span{font-size:10px;font-weight:800;color:var(--bot-muted)}.controls .running{color:var(--bot-success)}
      .error{color:#fca5a5}.message{color:var(--bot-success);font-size:13px}
      @media(max-width:600px){header,.items article{align-items:flex-start}.items article{flex-direction:column}.controls{width:100%;justify-content:space-between}}
    `}</style>
  </section>;
}
