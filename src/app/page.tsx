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
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
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
  const demoAccounts = accounts.filter((account) => (account.account_type ?? "").toLowerCase() === "demo");
  const activeAccount = demoAccounts.find((account) => account.account_id === selectedAccountId) ?? demoAccounts[0];

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
    try {
      setOnboardingOpen(window.localStorage.getItem("tradebridge-onboarding-complete") !== "true");
    } catch {
      setOnboardingOpen(false);
    }
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
        const eligibleDemoAccounts = (data.accounts ?? []).filter((account) => (account.account_type ?? "").toLowerCase() === "demo");
        setSelectedAccountId((current) =>
          eligibleDemoAccounts.some((account) => account.account_id === current)
            ? current
            : eligibleDemoAccounts[0]?.account_id ?? ""
        );
        if (data.connected) setAuthMessage("Deriv connection verified. Account details were retrieved from Deriv.");
        else if (data.error === "token_expired") setAuthMessage("Your Deriv session expired or was revoked. Please connect again.");
        else if (data.error === "insufficient_scope") setAuthMessage("Deriv denied account access. Reconnect and approve the required trading permission.");
        else if (data.error === "deriv_unavailable") setAuthMessage("Deriv could not be reached right now. Please retry shortly.");
        else if (data.error === "account_mismatch" || data.error === "owner_mismatch") setAuthMessage("This Deriv session does not match the signed-in TradeBridge account. Connect Deriv again.");
        else if (data.error === "account_linking_unavailable") setAuthMessage("Secure account linking is not ready. Apply the TradeBridge database migrations, then retry.");
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
    if (error === "platform_email_unverified") setAuthMessage("Verify your TradeBridge email before connecting Deriv.");
    if (error === "account_verification_failed") setAuthMessage("Deriv authorization completed, but account details could not be verified. Please retry.");
    if (error === "account_linking_unavailable") setAuthMessage("Secure account linking is not ready. Apply the TradeBridge database migrations, then retry.");
    if (error === "account_conflict") setAuthMessage("A Deriv account is already linked to another TradeBridge user. Sign in to the account that originally linked it or contact support.");
    if (error === "deriv_auth_required") setAuthMessage("Sign in to TradeBridge before connecting Deriv.");
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

  function finishOnboarding() {
    try { window.localStorage.setItem("tradebridge-onboarding-complete", "true"); } catch { /* Onboarding can still be dismissed for this session. */ }
    setOnboardingOpen(false);
  }

  function startDerivConnect() {
    finishOnboarding();
    window.location.href = "/api/auth/deriv/start";
  }

  function startDemoTrading() {
    finishOnboarding();
    if (!connected) {
      startDerivConnect();
      return;
    }
    if (demoAccounts.length === 0) {
      setTradeStatus("No demo account is available. Create a virtual-money account in Deriv, then reconnect to TradeBridge.");
      document.getElementById("ticket")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setSelectedAccountId(demoAccounts[0].account_id);
    setQuote(null);
    setTradeStatus("");
    document.getElementById("ticket")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="shell">
      {onboardingOpen && <div className="onboarding-backdrop">
        <section className="onboarding-card" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" aria-describedby="onboarding-description">
          <div className="onboarding-brand"><span className="brand-icon">T</span><span>tradebridge<span className="accent">.</span></span><span className="onboarding-step-count">Step {onboardingStep + 1} of 3</span></div>
          <div className="onboarding-progress" aria-hidden="true"><span style={{ width: `${((onboardingStep + 1) / 3) * 100}%` }} /></div>
          {onboardingStep === 0 && <div className="onboarding-copy">
            <span className="onboarding-illustration" aria-hidden="true">↗</span>
            <p className="eyebrow">WELCOME TO TRADEBRIDGE</p>
            <h1 id="onboarding-title">A clearer way to explore markets.</h1>
            <p id="onboarding-description">Your market watch, verified Deriv account information, and demo trade ticket in one workspace.</p>
            <div className="onboarding-facts"><span>✓ Live market prices when available</span><span>✓ Quotes reviewed before demo orders</span><span>✓ Real-money trading is disabled</span></div>
          </div>}
          {onboardingStep === 1 && <div className="onboarding-copy">
            <span className="onboarding-illustration" aria-hidden="true">◎</span>
            <p className="eyebrow">SECURE ACCOUNT CONNECTION</p>
            <h1 id="onboarding-title">{connected ? "Your Deriv connection is ready." : "Connect your Deriv account."}</h1>
            <p id="onboarding-description">TradeBridge uses Deriv authorization to retrieve your account details. Sign in on Deriv and review the permissions requested there. Never share your Deriv password with TradeBridge.</p>
            <div className="onboarding-facts"><span>✓ No separate TradeBridge password</span><span>✓ Choose a demo account to trade</span><span>✓ Real accounts cannot place orders here</span></div>
          </div>}
          {onboardingStep === 2 && <div className="onboarding-copy">
            <span className="onboarding-illustration" aria-hidden="true">☷</span>
            <p className="eyebrow">YOUR FIRST VISIT</p>
            <h1 id="onboarding-title">Everything has a familiar place.</h1>
            <p id="onboarding-description">Use Market watch to choose an instrument, then the Demo trade ticket to set direction, stake, and duration. Review the live quote before you confirm.</p>
            <div className="onboarding-tour"><div><b>01</b><span><strong>Markets</strong><small>Inspect current prices and freshness.</small></span></div><div><b>02</b><span><strong>Demo trade</strong><small>Get a quote, review, then confirm.</small></span></div><div><b>03</b><span><strong>Activity</strong><small>Trade history will appear when integrated.</small></span></div></div>
          </div>}
          <div className="onboarding-actions">
            <button className="onboarding-skip" onClick={finishOnboarding}>Skip for now</button>
            <div className="onboarding-next-actions">
              {onboardingStep > 0 && <button className="secondary" onClick={() => setOnboardingStep((step) => step - 1)}>Back</button>}
              {onboardingStep === 0 && <button className="primary" onClick={() => setOnboardingStep(1)}>Get started <span aria-hidden="true">→</span></button>}
              {onboardingStep === 1 && <><button className="secondary" onClick={() => setOnboardingStep(2)}>Explore first</button><button className="primary" onClick={startDerivConnect}>{connected ? "Reconnect Deriv" : "Connect Deriv"} <span aria-hidden="true">↗</span></button></>}
              {onboardingStep === 2 && <button className="primary" onClick={finishOnboarding}>Open dashboard <span aria-hidden="true">→</span></button>}
            </div>
          </div>
          <p className="onboarding-footnote">Demo trading only · Market prices can be delayed or unavailable.</p>
        </section>
      </div>}
      <aside className="sidebar">
        <a className="brand" href="#"><span className="brand-icon">T</span> tradebridge<span className="accent">.</span></a>
        <p className="side-label">WORKSPACE</p>
        <nav><a className="nav active" href="#overview">▦ <span>Overview</span></a><a className="nav" href="#markets">⌁ <span>Markets</span></a><a className="nav" href="#ticket">↗ <span>Trade</span></a><a className="nav" href="#activity">◷ <span>Activity</span></a></nav>
        <div className="side-status"><span className="status-dot" /><div><strong>Deriv connection</strong><small>{connected ? "Authorized session" : "Not connected"}</small></div></div>
      </aside>
      <nav className="mobile-nav" aria-label="Main navigation"><a href="#overview" aria-label="Overview">▦<span>Home</span></a><a href="#markets" aria-label="Markets">⌁<span>Markets</span></a><a href="#ticket" aria-label="Trade">↗<span>Trade</span></a><a href="#activity" aria-label="Activity">◷<span>Activity</span></a></nav>
      <section className="main" id="overview">
        <header className="topbar"><span>Workspace <b>/</b> Overview</span><div><span className="demo-tag">● Demo environment</span><form action="/auth/signout" method="post"><button className="signout-button" type="submit">Sign out</button></form></div></header>
        <div className="content">
          <div className="intro"><div><p className="eyebrow">YOUR TRADING WORKSPACE</p><h1>Trade with a clearer view.</h1><p className="muted">Markets, account information, and activity in one workspace.</p></div><div className="intro-actions"><button className="start-demo" onClick={startDemoTrading}>Start demo trading <span aria-hidden="true">→</span></button>{connected ? <form action="/api/auth/deriv/disconnect" method="post"><button className="secondary" type="submit">Disconnect Deriv</button></form> : <div className="connect-actions"><button className="secondary" onClick={startDerivConnect}>Connect Deriv ↗</button><a className="signup-link" href="/api/auth/deriv/start?mode=signup">Create Deriv account</a></div>}</div></div>
          <section className="demo-entry" aria-labelledby="demo-entry-title"><div><p className="eyebrow">VIRTUAL FUNDS ONLY</p><h2 id="demo-entry-title">{!connected ? "Connect Deriv to get started" : demoAccounts.length === 0 ? "No demo account available" : "Ready to practise with a demo account?"}</h2><p>{!connected ? "Connect your Deriv account, then choose a virtual-money account before placing a demo trade." : demoAccounts.length === 0 ? "Your connected Deriv account has no available demo account. Create a virtual account in Deriv, then reconnect to refresh your account list. Real-money accounts cannot be traded here." : `Choose a demo account and practise with virtual funds. ${demoAccounts.length} demo account${demoAccounts.length === 1 ? " is" : "s are"} available.`}</p></div><button className="demo-entry-action" onClick={connected && demoAccounts.length === 0 ? startDerivConnect : startDemoTrading}>{!connected ? "Connect Deriv" : demoAccounts.length === 0 ? "Reconnect Deriv" : "Open demo trade ticket"} <span aria-hidden="true">↗</span></button></section>
          <section className="notice"><span className="notice-icon">i</span><div><strong>{connected ? "Deriv connected — demo trading only" : "No verified Deriv session"}</strong><p>{authMessage || "Market prices are live when the Deriv stream is available. Demo orders require a fresh quote and separate confirmation; real-money orders are disabled."}</p></div><b>DEMO</b></section>
          <div className="stats">
            <article className="card"><span>Demo account balance</span><strong>{activeAccount?.balance !== null && activeAccount?.balance !== undefined ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(activeAccount.balance) : "—"} <small>{activeAccount?.currency ?? ""}</small></strong><p>{activeAccount ? `Virtual account · ${activeAccount.account_id}` : !connected ? "Connect Deriv to load your demo account" : accounts.length === 0 ? "No linked account was returned by Deriv" : "No demo account is linked. Create a virtual account in Deriv and reconnect."}</p><label className="account-select-label" htmlFor="demo-account-select">Demo account for trading</label>{demoAccounts.length > 0 ? <select id="demo-account-select" className="account-select" aria-label="Select demo account for trading" value={activeAccount?.account_id ?? ""} onChange={(event) => { setSelectedAccountId(event.target.value); setQuote(null); tradeSocket.current?.close(); setTradeStatus(""); }}>{demoAccounts.map((account) => <option key={account.account_id} value={account.account_id}>{account.account_id} · {account.currency ?? "Currency"} · Demo</option>)}</select> : <div className="no-demo-inline" role="status"><strong>{connected ? "Demo account needed" : "Deriv not connected"}</strong><span>{connected ? "Create a virtual account in Deriv, then reconnect." : "Connect Deriv to load eligible demo accounts."}</span></div>}</article>
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
