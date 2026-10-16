"use client";
import { useEffect, useState } from "react";
export default function FastApiLiveMarketFeed() {
 const [symbol, setSymbol] = useState("1HZ100V");
 const [quote, setQuote] = useState("—");
 const [status, setStatus] = useState("connecting");
 const [error, setError] = useState("");
 useEffect(() => {
  const base = process.env.NEXT_PUBLIC_TRADEBRIDGE_LIVE_WS_URL;
  if (!base) { setStatus("setup required"); setError("Set NEXT_PUBLIC_TRADEBRIDGE_LIVE_WS_URL."); return; }
  let stopped = false; let socket: WebSocket | null = null; let timer: ReturnType<typeof setTimeout>;
  let attempt = 0;
  const connect = () => {
   if (stopped) return;
   const url = new URL(base); url.searchParams.set("symbol", symbol);
   setStatus(attempt ? "reconnecting" : "connecting"); socket = new WebSocket(url.toString());
   socket.onopen = () => { attempt = 0; setStatus("connected"); setError(""); };
   socket.onmessage = (event) => {
    try { const m = JSON.parse(String(event.data));
     if (m.type === "status") setStatus(m.status);
     if (m.type === "error") { setError(m.message || "Feed unavailable"); setStatus("unavailable"); }
     if (m.type === "tick" && m.symbol === symbol && Number.isFinite(Number(m.quote))) setQuote(Number(m.quote).toLocaleString());
    } catch {}
   };
   socket.onclose = () => { if (!stopped) { attempt++; setStatus("reconnecting"); timer = setTimeout(connect, Math.min(1000 * 2 ** Math.min(attempt, 4), 15000)); } };
   socket.onerror = () => { if (!stopped) setStatus("reconnecting"); };
  };
  try { connect(); } catch { setStatus("unavailable"); setError("Invalid FastAPI WebSocket URL."); }
  return () => { stopped = true; clearTimeout(timer); socket?.close(); };
 }, [symbol]);
 return <section style={{ padding: 16, marginBottom: 16, border: "1px solid var(--border)", borderRadius: 12 }}>
  <h2>Live market feed · FastAPI</h2><p role="status">{status}</p>
  <label>Market <select value={symbol} onChange={e => { setSymbol(e.target.value); setQuote("—"); }}>{["1HZ100V","1HZ75V","1HZ50V","1HZ25V","1HZ10V"].map(s => <option key={s}>{s}</option>)}</select></label>
  <p style={{ fontSize: 28 }}>{quote}</p>{error && <p role="alert">{error}</p>}
  <small>Live ticks are not stored. This panel does not place trades.</small>
 </section>;
}
