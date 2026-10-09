"use client";

import { useEffect, useRef, useState } from "react";

const markets = [
  { symbol: "R_100", name: "Volatility 100 Index" },
  { symbol: "R_50", name: "Volatility 50 Index" },
  { symbol: "frxEURUSD", name: "EUR/USD" },
  { symbol: "frxXAUUSD", name: "Gold / USD" },
];

export default function Home() {
  const [selected, setSelected] = useState(markets[0]);
  const [direction, setDirection] = useState<"CALL" | "PUT">("CALL");
  const [connected, setConnected] = useState(false);
  const [accounts, setAccounts] = useState<Array<{
    account_id: string;
    balance: number | null;
    currency: string | null;
    account_type: string | null;
    status: string | null;
  }>>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [marketQuotes, setMarketQuotes] = useState<Record<string, { quote: number; baseline: number; updatedAt: number }>>({});
  const [marketNow, setMarketNow] = useState(Date.now());
  const [marketConnection, setMarketConnection] = useState("Connecting to Deriv market data…");
  const [authMessage, setAuthMessage] = useState("");
  const [stakeAmount, setStakeAmount] = useState("1");
  const [durationSeconds, setDurationSeconds] = useState("60");
  const [tradeBusy, setTradeBusy] = useState(false);
  const [tradeStatus, setTradeStatus] = useState("");
  const [quote, setQuote] = useState<{
    id: string;
    askPrice: number;
    payout: number | null;
    symbol: string;
    contractType: "CALL" | "PUT";
    stake: number;
    duration: number;
    currency: string;
  } | null>(null);
  const tradeSocket = useRef<WebSocket | null>(null);
  const tradeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTradeRequestId = useRef<number | null>(null);

  function clearTradeTimeout() {
    if (tradeTimeout.current) clearTimeout(tradeTimeout.current);
    tradeTimeout.current = null;
  }
  const activeAccount = accounts.find((account) => account.account_id === selectedAccountId) ?? accounts[0];

  async function requestDemoQuote() {
    const stake = Number(stakeAmount);
    const duration = Number(durationSeconds);
    if (!connected || !activeAccount) {
      setTradeStatus("Connect Deriv and select a demo account first.");
      return;
    }
    if ((activeAccount.account_type ?? "").toLowerCase() !== "demo") {
      setTradeStatus("Trading is restricted to demo accounts in this build. Select a demo account.");
      return;
    }
    if (!Number.isFinite(stake) || stake < 1 || stake > 1000 || !Number.isInteger(duration) || duration < 1 || duration > 86400) {
      setTradeStatus("Enter a stake from 1 to 1,000 and a duration from 1 to 86,400 seconds.");
      return;
    }

    clearTradeTimeout();
    pendingTradeRequestId.current = null;
    setTradeBusy(true);
    setTradeStatus("Requesting a demo trading session…");
    setQuote(null);
    tradeSocket.current?.close();
    try {
      const response = await fetch("/api/auth/deriv/demo-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: activeAccount.account_id }),
        cache: "no-store",
      });
      const data = await response.json() as { url?: string; error?: string };
      if (!response.ok || !data.url) {
        setTradeBusy(false);
        setTradeStatus(data.error === "demo_accounts_only"
          ? "Only demo accounts can place trades in this build."
          : data.error === "token_expired"
            ? "Your Deriv session expired. Connect Deriv again."
            : "Could not open a demo trading session. Please retry.");
        return;
      }

      const socket = new WebSocket(data.url);
      tradeSocket.current = socket;
      socket.onopen = () => {
        pendingTradeRequestId.current = 71;
        socket.send(JSON.stringify({
          proposal: 1,
          amount: stake,
          basis: "stake",
          contract_type: direction,
          currency: activeAccount.currency ?? "USD",
          duration,
          duration_unit: "s",
          underlying_symbol: selected.symbol,
          req_id: 71,
        }));
        setTradeStatus("Requesting a fresh demo quote…");
        clearTradeTimeout();
        tradeTimeout.current = setTimeout(() => {
          pendingTradeRequestId.current = null;
          setTradeBusy(false);
          setTradeStatus("Deriv did not return a quote in time. Request a fresh quote and try again.");
          socket.close();
        }, 15_000);
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as {
            msg_type?: string;
            req_id?: number;
            proposal?: { id?: string; ask_price?: number | string; payout?: number | string };
            buy?: { contract_id?: number | string; buy_price?: number | string };
            error?: { message?: string };
          };
          if (typeof message.req_id === "number" && message.req_id !== pendingTradeRequestId.current) return;
          if (message.error) {
            clearTradeTimeout();
            pendingTradeRequestId.current = null;
            setTradeBusy(false);
            setTradeStatus(message.error.message ?? "Deriv rejected the request.");
            return;
          }
          if (message.msg_type === "proposal" && message.proposal) {
            clearTradeTimeout();
            pendingTradeRequestId.current = null;
            const id = message.proposal.id;
            const askPrice = Number(message.proposal.ask_price);
            const rawPayout = message.proposal.payout;
            const payout = rawPayout === undefined ? null : Number(rawPayout);
            if (!id || !Number.isFinite(askPrice) || askPrice <= 0) {
              setTradeBusy(false);
              setTradeStatus("Deriv returned an invalid quote. Please request another.");
              return;
            }
            setQuote({
              id,
              askPrice,
              payout: payout !== null && Number.isFinite(payout) ? payout : null,
              symbol: selected.symbol,
              contractType: direction,
              stake,
              duration,
              currency: activeAccount.currency ?? "USD",
            });
            setTradeBusy(false);
            setTradeStatus("Fresh demo quote ready. Review it, then confirm the demo trade.");
          }
          if (message.msg_type === "buy" && message.buy) {
            clearTradeTimeout();
            pendingTradeRequestId.current = null;
            const contractId = message.buy.contract_id;
            setTradeBusy(false);
            setQuote(null);
            setTradeStatus(contractId
              ? `Demo trade placed successfully. Contract ID: ${contractId}. Refreshing account details…`
              : "Deriv received the demo order. Check your account activity for its status.");
            socket.close();
            if (contractId) {
              fetch("/api/auth/deriv/accounts", { cache: "no-store" })
                .then(async (response) => {
                  if (!response.ok) return;
                  const data = await response.json() as { accounts?: typeof accounts };
                  if (data.accounts) {
                    setAccounts(data.accounts);
                    setTradeStatus(`Demo trade placed successfully. Contract ID: ${contractId}. Account details refreshed.`);
                  }
                })
                .catch(() => {
                  setTradeStatus(`Demo trade placed successfully. Contract ID: ${contractId}. Account refresh failed; reload to check your balance.`);
                });
            }
          }
        } catch {
          setTradeBusy(false);
          setTradeStatus("Could not read Deriv's response. Please request a fresh quote.");
        }
      };
      socket.onerror = () => {
        clearTradeTimeout();
        pendingTradeRequestId.current = null;
        setTradeBusy(false);
        setTradeStatus("Demo trading connection failed. Please request a fresh quote and retry.");
      };
      socket.onclose = () => {
        clearTradeTimeout();
        if (tradeSocket.current === socket) tradeSocket.current = null;
        if (pendingTradeRequestId.current !== null) {
          pendingTradeRequestId.current = null;
          setTradeBusy(false);
          setTradeStatus("The demo trading connection closed before Deriv confirmed the request. Check account activity before retrying.");
        }
      };
    } catch {
      setTradeBusy(false);
      setTradeStatus("Could not connect to Deriv. Please retry.");
    }
  }

  function confirmDemoTrade() {
    if (!quote || !tradeSocket.current || tradeSocket.current.readyState !== WebSocket.OPEN || tradeBusy) {
      setTradeStatus("Request a fresh quote before confirming.");
      return;
    }
    clearTradeTimeout();
    pendingTradeRequestId.current = 72;
    setTradeBusy(true);
    setTradeStatus("Submitting your confirmed demo order…");
    tradeSocket.current.send(JSON.stringify({
      buy: quote.id,
      price: quote.askPrice,
      req_id: 72,
    }));
    tradeTimeout.current = setTimeout(() => {
      pendingTradeRequestId.current = null;
      setTradeBusy(false);
      setTradeStatus("No order confirmation arrived in time. Check Deriv account activity before submitting another order.");
      tradeSocket.current?.close();
    }, 20_000);
  }

  useEffect(() => {
    let active = true;
    const freshnessTimer = window.setInterval(() => setMarketNow(Date.now()), 1_000);
    const socket = new WebSocket("wss://api.derivws.com/trading/v1/options/ws/public");

    socket.onopen = () => {
      if (!active) return;
      setMarketConnection("Connected · waiting for live ticks");
      markets.forEach((market, index) => {
        socket.send(JSON.stringify({ ticks: market.symbol, subscribe: 1, req_id: index + 1 }));
      });
    };

    socket.onmessage = (event) => {
      if (!active) return;
      try {
        const message = JSON.parse(event.data) as {
          msg_type?: string;
          tick?: { symbol?: string; underlying_symbol?: string; quote?: number | string };
        };
        const symbol = message.tick?.underlying_symbol ?? message.tick?.symbol;
        const quote = Number(message.tick?.quote);
        if (message.msg_type !== "tick" || !symbol || !Number.isFinite(quote)) return;
        setMarketQuotes((current) => ({
          ...current,
          [symbol]: {
            quote,
            baseline: current[symbol]?.baseline ?? quote,
            updatedAt: Date.now(),
          },
        }));
        setMarketConnection("Live prices");
      } catch {
        // Ignore malformed public-stream messages; the UI remains in preview mode.
      }
    };

    socket.onerror = () => {
      if (active) setMarketConnection("Market data unavailable");
    };
    socket.onclose = () => {
      if (active) setMarketConnection("Market data disconnected");
    };

    fetch("/api/auth/deriv/accounts", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as {
          connected?: boolean;
          accounts?: Array<{
            account_id: string;
            balance: number | null;
            currency: string | null;
            account_type: string | null;
            status: string | null;
          }>;
          error?: string;
        };
        if (!active) return;
        setConnected(Boolean(data.connected));
        setAccounts(data.accounts ?? []);
        if (data.accounts?.length) setSelectedAccountId((current) =>
          data.accounts?.some((account) => account.account_id === current)
            ? current
            : data.accounts?.[0].account_id ?? ""
        );
        if (data.connected) setAuthMessage("Deriv connection verified. Account details were retrieved from Deriv.");
        else if (data.error === "token_expired") setAuthMessage("Your Deriv session expired or was revoked. Please connect again.");
        else if (data.error === "insufficient_scope") setAuthMessage("Deriv denied account access. Reconnect and approve the required trading permission.");
        else if (data.error === "deriv_unavailable") setAuthMessage("Deriv could not be reached right now. Please retry shortly.");
      })
      .catch(() => {
        if (active) {
          setConnected(false);
          setAuthMessage("Could not verify the Deriv connection. Please retry.");
        }
      });

    const params = new URLSearchParams(window.location.search);
    const error = params.get("auth_error");
    if (params.get("connection") === "connected") setAuthMessage("Authorization completed. Verifying your Deriv account…");
    if (error === "configuration") setAuthMessage("Deriv OAuth is not configured yet. Add the server environment variables and register the exact callback URL.");
    if (error === "cancelled") setAuthMessage("Deriv authorization was cancelled.");
    if (error === "invalid_callback") setAuthMessage("We could not verify the Deriv authorization response. Please try again.");
    if (error === "token_exchange") setAuthMessage("Deriv could not complete authorization. Please try again.");
    if (error) window.history.replaceState({}, "", window.location.pathname);
    return () => {
      active = false;
      window.clearInterval(freshnessTimer);
      clearTradeTimeout();
      pendingTradeRequestId.current = null;
      tradeSocket.current?.close();
      socket.close();
    };
  }, []);

  return (
    <main className="shell">
      <aside className="sidebar">
        <a className="brand" href="#"><span className="brand-icon">T</span> tradebridge<span className="accent">.</span></a>
        <p className="side-label">WORKSPACE</p>
        <nav><a className="nav active" href="#overview">▦ <span>Overview</span></a><a className="nav" href="#markets">⌁ <span>Markets</span></a><a className="nav" href="#ticket">↗ <span>Trade</span></a><a className="nav" href="#activity">◷ <span>Activity</span></a></nav>
        <div className="side-status"><span className="status-dot" /><div><strong>Deriv connection</strong><small>{connected ? "Authorized session" : "Not connected"}</small></div></div>
      </aside>
      <nav className="mobile-nav" aria-label="Main navigation"><a href="#overview" aria-label="Overview">▦<span>Home</span></a><a href="#markets" aria-label="Markets">⌁<span>Markets</span></a><a href="#ticket" aria-label="Trade">↗<span>Trade</span></a><a href="#activity" aria-label="Activity">◷<span>Activity</span></a></nav>
      <section className="main" id="overview">
        <header className="topbar"><span>Workspace <b>/</b> Overview</span><div><span className="demo-tag">● Demo environment</span><span className="avatar">JM</span></div></header>
        <div className="content">
          <div className="intro"><div><p className="eyebrow">YOUR TRADING WORKSPACE</p><h1>Trade with a clearer view.</h1><p className="muted">Markets, account information, and activity in one workspace.</p></div>{connected ? <form action="/api/auth/deriv/disconnect" method="post"><button className="primary" type="submit">Disconnect Deriv</button></form> : <div className="connect-actions"><button className="primary" onClick={() => { window.location.href = "/api/auth/deriv/start"; }}>Connect Deriv ↗</button><a className="signup-link" href="/api/auth/deriv/start?mode=signup">Create account</a></div>}</div>
          <section className="notice"><span className="notice-icon">i</span><div><strong>{connected ? "Deriv connected — demo trading only" : "No verified Deriv session"}</strong><p>{authMessage || "Market prices are live when the Deriv stream is available. Demo orders require a fresh quote and separate confirmation; real-money orders are disabled."}</p></div><b>DEMO</b></section>
          <div className="stats">
            <article className="card"><span>Available balance</span><strong>{activeAccount?.balance !== null && activeAccount?.balance !== undefined ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(activeAccount.balance) : "—"} <small>{activeAccount?.currency ?? ""}</small></strong><p>{activeAccount ? `${activeAccount.account_type ?? "Trading"} account · ${activeAccount.account_id}` : connected ? "No account details were returned" : "Connect Deriv to load verified balance"}</p>{accounts.length > 1 && <select className="account-select" aria-label="Select Deriv account" value={activeAccount?.account_id ?? ""} onChange={(event) => { setSelectedAccountId(event.target.value); setQuote(null); tradeSocket.current?.close(); setTradeStatus(""); }}>{accounts.map((account) => <option key={account.account_id} value={account.account_id}>{account.account_id} · {account.account_type ?? "Account"}</option>)}</select>}</article>
            <article className="card"><span>Open positions</span><strong className="metric-placeholder">Not available</strong><p>Position tracking is not connected yet.</p></article>
            <article className="card"><span>Today’s profit / loss</span><strong className="metric-placeholder">Not available</strong><p>Profit and loss tracking is not integrated yet.</p></article>
          </div>
          <div className="columns">
            <section className="panel" id="markets"><div className="panel-head"><div><h2>Market watch</h2><p>Choose a market to inspect</p></div><span className="sample">● {marketConnection}</span></div>
              <div className="market-list">{markets.map(m => {
                const quote = marketQuotes[m.symbol];
                const percentage = quote && quote.baseline !== 0 ? ((quote.quote - quote.baseline) / quote.baseline) * 100 : null;
                const isFresh = Boolean(quote && marketNow - quote.updatedAt <= 15_000);
                return <button key={m.symbol} className={selected.symbol === m.symbol ? "market selected" : "market"} onClick={() => { setSelected(m); setQuote(null); tradeSocket.current?.close(); setTradeStatus(""); }}><span className="symbol">{m.symbol.startsWith("frx") ? (m.symbol === "frxEURUSD" ? "€" : "Au") : "V"}</span><span className="market-title"><b>{m.name}</b><small>{m.symbol}</small></span><strong className={!isFresh ? "" : percentage === null ? "" : percentage >= 0 ? "up" : "down"}>{quote ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 5 }).format(quote.quote) : "—"}<small className="quote-change">{!quote ? "Waiting for ticks" : !isFresh ? "Price stale" : percentage === null ? "Since page opened" : `${percentage >= 0 ? "+" : ""}${percentage.toFixed(2)}% since open`}</small></strong></button>;
              })}</div>
              <div className="chart"><div><small>{marketQuotes[selected.symbol] && marketNow - marketQuotes[selected.symbol].updatedAt <= 15_000 ? "LATEST LIVE PRICE" : "LATEST RECEIVED PRICE"}</small><b>{selected.name}</b></div><span className="sample">{marketQuotes[selected.symbol] ? marketNow - marketQuotes[selected.symbol].updatedAt <= 15_000 ? "● Live" : "● Stale" : marketConnection}</span><strong className="live-price">{marketQuotes[selected.symbol] ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 5 }).format(marketQuotes[selected.symbol].quote) : "Waiting for tick data…"}</strong><p>Prices are streamed from Deriv. Percentage changes are measured from the first tick received after this page opened, not from the official daily open. Orders require a separate demo confirmation.</p></div>
            </section>
            <section className="panel" id="ticket">
              <div className="panel-head"><div><h2>Demo trade ticket</h2><p>Quotes and orders are demo-only</p></div><span className="ticket-icon">↗</span></div>
              <div className="selected-market"><span className="symbol big">V</span><div><b>{selected.name}</b><small>{selected.symbol}</small></div></div>
              <label>Contract direction</label>
              <div className="directions">
                <button className={direction === "CALL" ? "buy chosen" : "buy"} onClick={() => { setDirection("CALL"); setQuote(null); }}>↑ Higher (Call)</button>
                <button className={direction === "PUT" ? "sell chosen" : "sell"} onClick={() => { setDirection("PUT"); setQuote(null); }}>↓ Lower (Put)</button>
              </div>
              <label htmlFor="stake">Stake amount</label>
              <div className="amount"><span>{activeAccount?.currency ?? "USD"}</span><input id="stake" aria-describedby="stake-help" type="number" min="1" max="1000" step="1" value={stakeAmount} onChange={(event) => { setStakeAmount(event.target.value); setQuote(null); }} /><span>per trade</span></div>
              <p id="stake-help" className="field-help">Choose a common amount or enter your own (1–1,000 {activeAccount?.currency ?? "USD"}).</p>
              <div className="quick-values" aria-label="Suggested stake amounts">{["1", "5", "10", "25"].map((amount) => <button key={amount} type="button" className={stakeAmount === amount ? "quick-value active" : "quick-value"} onClick={() => { setStakeAmount(amount); setQuote(null); }}>{amount} {activeAccount?.currency ?? "USD"}</button>)}</div>
              <label htmlFor="duration">Contract duration</label>
              <div className="amount"><input id="duration" aria-describedby="duration-help" type="number" min="1" max="86400" step="1" value={durationSeconds} onChange={(event) => { setDurationSeconds(event.target.value); setQuote(null); }} /><span>seconds</span></div>
              <div className="quick-values" aria-label="Suggested contract durations">{[{label:"1 min",value:"60"},{label:"5 min",value:"300"},{label:"10 min",value:"600"}].map((preset) => <button key={preset.value} type="button" className={durationSeconds === preset.value ? "quick-value active" : "quick-value"} onClick={() => { setDurationSeconds(preset.value); setQuote(null); }}>{preset.label}</button>)}</div>
              <p id="duration-help" className="field-help">Duration is entered in seconds. Choose a preset or enter 1–86,400 seconds.</p>
              <p className="hint"><strong>Demo mode.</strong> Real-money orders are disabled. You’ll review a quote before confirming any demo trade.</p>
              {quote && <div className="demo-quote"><strong>Fresh demo quote</strong><span>Stake: {quote.stake} {quote.currency}</span><span>Price: {quote.askPrice} {quote.currency}</span>{quote.payout !== null && <span>Potential payout: {quote.payout} {quote.currency}</span>}<span>{quote.contractType === "CALL" ? "Higher" : "Lower"} · {quote.symbol} · {quote.duration}s</span></div>}
              {tradeStatus && <p className="trade-status" role="status">{tradeStatus}</p>}
              <button className="execute" onClick={requestDemoQuote} disabled={tradeBusy || !connected || (activeAccount?.account_type ?? "").toLowerCase() !== "demo"}>{tradeBusy ? "Working…" : "Get fresh demo quote"}</button>
              {quote && <button className="primary confirm-demo" onClick={confirmDemoTrade} disabled={tradeBusy}>Confirm demo trade</button>}
              {!connected && <p className="risk">Connect Deriv to enable demo trading.</p>}
              {connected && (activeAccount?.account_type ?? "").toLowerCase() !== "demo" && <p className="risk">Select a demo account. Real accounts cannot be traded from this build.</p>}
            </section>
          </div>
          <section className="panel activity" id="activity"><div className="panel-head"><div><h2>Recent activity</h2><p>Account events and order history</p></div></div><div className="empty"><span>◷</span><b>Trade history isn’t connected yet</b><p>Once account activity is integrated, your recent trades and transaction details will appear here.</p></div></section>
          <footer><span>TradeBridge · Built for clarity</span><span>Demo orders only · Real-money trading disabled</span></footer>
        </div>
      </section>
    </main>
  );
}
