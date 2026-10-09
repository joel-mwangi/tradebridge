"use client";

import { useState } from "react";

const markets = [
  { symbol: "R_100", name: "Volatility 100 Index", change: "+0.82%", tone: "up" },
  { symbol: "R_50", name: "Volatility 50 Index", change: "+0.24%", tone: "up" },
  { symbol: "frxEURUSD", name: "EUR/USD", change: "−0.16%", tone: "down" },
  { symbol: "frxXAUUSD", name: "Gold / USD", change: "+0.41%", tone: "up" },
];

export default function Home() {
  const [selected, setSelected] = useState(markets[0]);
  const [direction, setDirection] = useState<"Buy" | "Sell">("Buy");

  return (
    <main className="shell">
      <aside className="sidebar">
        <a className="brand" href="#"><span className="brand-icon">T</span> tradebridge<span className="accent">.</span></a>
        <p className="side-label">WORKSPACE</p>
        <nav><a className="nav active" href="#overview">▦ <span>Overview</span></a><a className="nav" href="#markets">⌁ <span>Markets</span></a><a className="nav" href="#ticket">↗ <span>Trade</span></a><a className="nav" href="#activity">◷ <span>Activity</span></a></nav>
        <div className="side-status"><span className="status-dot" /><div><strong>Deriv connection</strong><small>Not connected</small></div></div>
      </aside>
      <section className="main" id="overview">
        <header className="topbar"><span>Workspace <b>/</b> Overview</span><div><span className="demo-tag">● Demo environment</span><span className="avatar">JM</span></div></header>
        <div className="content">
          <div className="intro"><div><p className="eyebrow">YOUR TRADING WORKSPACE</p><h1>Trade with a clearer view.</h1><p className="muted">Markets, account information, and activity in one workspace.</p></div><button className="primary" onClick={() => window.alert("Deriv authorization is not implemented yet.")}>Connect Deriv ↗</button></div>
          <section className="notice"><span className="notice-icon">i</span><div><strong>Preview mode — no live account connected</strong><p>Market movements below are illustrative placeholders. This version cannot place real trades.</p></div><b>DEMO</b></section>
          <div className="stats">
            <article className="card"><span>Account balance</span><strong>— <small>USD</small></strong><p>Connect an account to load balance</p></article>
            <article className="card"><span>Open positions</span><strong>—</strong><p>No live positions loaded</p></article>
            <article className="card"><span>Today’s P/L</span><strong>— <small>USD</small></strong><p>Performance appears after connection</p></article>
          </div>
          <div className="columns">
            <section className="panel" id="markets"><div className="panel-head"><div><h2>Market watch</h2><p>Choose a market to inspect</p></div><span className="sample">● Sample data</span></div>
              <div className="market-list">{markets.map(m => <button key={m.symbol} className={selected.symbol === m.symbol ? "market selected" : "market"} onClick={() => setSelected(m)}><span className="symbol">{m.symbol.startsWith("frx") ? (m.symbol === "frxEURUSD" ? "€" : "Au") : "V"}</span><span className="market-title"><b>{m.name}</b><small>{m.symbol}</small></span><strong className={m.tone}>{m.change}</strong></button>)}</div>
              <div className="chart"><div><small>SELECTED MARKET</small><b>{selected.name}</b></div><span className="sample">Illustrative chart</span><svg viewBox="0 0 600 170" preserveAspectRatio="none" role="img" aria-label="Illustrative market trend, not live data"><defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#21b394" stopOpacity=".2"/><stop offset="100%" stopColor="#21b394" stopOpacity="0"/></linearGradient></defs><path d="M0 125 C35 120 45 90 75 102 S120 132 150 84 S190 96 225 72 S270 92 305 60 S350 80 385 40 S425 59 465 44 S520 60 550 30 S580 40 600 16 L600 170 L0 170Z" fill="url(#fill)"/><path d="M0 125 C35 120 45 90 75 102 S120 132 150 84 S190 96 225 72 S270 92 305 60 S350 80 385 40 S425 59 465 44 S520 60 550 30 S580 40 600 16" fill="none" stroke="#21b394" strokeWidth="3"/></svg><p>Illustrative trend · not live data</p></div>
            </section>
            <section className="panel" id="ticket"><div className="panel-head"><div><h2>Trade ticket</h2><p>Order preview</p></div><span className="ticket-icon">↗</span></div><div className="selected-market"><span className="symbol big">V</span><div><b>{selected.name}</b><small>{selected.symbol}</small></div></div><label>Direction</label><div className="directions"><button className={direction === "Buy" ? "buy chosen" : "buy"} onClick={() => setDirection("Buy")}>↗ Buy</button><button className={direction === "Sell" ? "sell chosen" : "sell"} onClick={() => setDirection("Sell")}>↘ Sell</button></div><label htmlFor="stake">Stake amount</label><div className="amount"><span>$</span><input id="stake" type="number" min="1" defaultValue="10" disabled/><span>USD</span></div><p className="hint">Order controls activate after secure API integration.</p><div className="order-summary"><span>Selected action</span><b className={direction === "Buy" ? "up" : "down"}>{direction} · {selected.symbol}</b></div><button className="execute" disabled>Connect account to continue</button><p className="risk">Trading involves risk. Review contract details and potential loss before confirming any future live order.</p></section>
          </div>
          <section className="panel activity" id="activity"><div className="panel-head"><div><h2>Recent activity</h2><p>Account events and order history</p></div></div><div className="empty"><span>◷</span><b>Your activity will appear here</b><p>Connect a Deriv account to load verified transactions.</p></div></section>
          <footer><span>TradeBridge · Built for clarity</span><span>Preview build · No live trading</span></footer>
        </div>
      </section>
    </main>
  );
}
