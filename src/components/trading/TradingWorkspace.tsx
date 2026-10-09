"use client";

import { useEffect, useState } from "react";
import styles from "./TradingWorkspace.module.css";
import DemoTradeTicket from "./DemoTradeTicket";
import MarketWatch from "./MarketWatch";
import TradingActivity from "./TradingActivity";
import { useDemoTrading } from "./useDemoTrading";
import { useMarketData } from "./useMarketData";
import type { DerivAccount } from "./types";

type AccountsResponse = {
  connected?: boolean;
  accounts?: DerivAccount[];
  error?: string;
};

function authErrorMessage(error: string | null) {
  const messages: Record<string, string> = {
    configuration: "Deriv OAuth is not configured correctly. Review the server environment and registered callback URL.",
    cancelled: "Deriv authorization was cancelled. You can reconnect whenever you're ready.",
    invalid_callback: "TradeBridge could not verify the Deriv authorization response. Please connect again.",
    token_exchange: "Deriv could not complete authorization. Please try again.",
    platform_email_unverified: "Verify your TradeBridge email before connecting Deriv.",
    account_verification_failed: "Deriv authorization completed, but account details could not be verified.",
    account_linking_unavailable: "Secure account linking is not ready. Apply the required database migrations, then retry.",
    account_conflict: "This Deriv account is linked to another TradeBridge user. Sign in with the account that originally linked it.",
    deriv_auth_required: "Sign in to TradeBridge before connecting Deriv.",
  };
  return error ? messages[error] ?? "" : "";
}

function accountErrorMessage(error?: string) {
  switch (error) {
    case "token_expired": return "Your Deriv session expired or was revoked. Reconnect Deriv to continue.";
    case "insufficient_scope": return "Deriv denied account access. Reconnect and approve the required trading permission.";
    case "deriv_unavailable": return "Deriv is temporarily unavailable. Your workspace will reconnect when you retry.";
    case "account_mismatch":
    case "owner_mismatch": return "This Deriv session does not match the signed-in TradeBridge account. Connect Deriv again.";
    case "account_linking_unavailable": return "Secure account linking is unavailable. Apply the required database migrations, then retry.";
    default: return "Connect your Deriv account to load account data and enable demo orders.";
  }
}

function formatMoney(value: number | null, currency: string) {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value) + (currency ? " " + currency : "");
}

export default function TradingWorkspace() {
  const [connected, setConnected] = useState(false);
  const [accounts, setAccounts] = useState<DerivAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [authMessage, setAuthMessage] = useState("Checking your Deriv connection…");
  const { markets, snapshots, connection, selectedMarket, selectedSymbol, selectMarket } = useMarketData();
  const demoAccounts = accounts.filter((item) => (item.account_type ?? "").toLowerCase() === "demo");
  const activeAccount = demoAccounts.find((item) => item.account_id === selectedAccountId) ?? demoAccounts[0] ?? null;
  const trading = useDemoTrading(connected, activeAccount);
  const currency = trading.balance.currency || activeAccount?.currency || "USD";
  const liveBalance = trading.balance.balance ?? activeAccount?.balance ?? null;

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const firstAuthMessage = authErrorMessage(params.get("auth_error"));
    if (params.get("connection") === "connected") setAuthMessage("Deriv authorization completed. Verifying your account and trading permissions…");
    if (params.get("auth_error")) setAuthMessage(firstAuthMessage);
    if (params.has("connection") || params.has("auth_error")) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    fetch("/api/auth/deriv/accounts", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as AccountsResponse;
        if (!active) return;
        setConnected(Boolean(data.connected));
        setAccounts(data.accounts ?? []);
        const eligible = (data.accounts ?? []).filter((item) => (item.account_type ?? "").toLowerCase() === "demo");
        setSelectedAccountId((current) => eligible.some((item) => item.account_id === current) ? current : eligible[0]?.account_id ?? "");
        if (firstAuthMessage) setAuthMessage(firstAuthMessage);
        else if (data.connected && eligible.length > 0) setAuthMessage("Deriv connected. Your demo trading account is available.");
        else if (data.connected) setAuthMessage("Deriv connected, but no linked demo account was returned. Reconnect after switching to a virtual-money account in Deriv.");
        else setAuthMessage(accountErrorMessage(data.error));
      })
      .catch(() => {
        if (active) {
          setConnected(false);
          setAccounts([]);
          setAuthMessage("Could not verify the Deriv connection. Check your connection, then reconnect Deriv.");
        }
      });

    return () => { active = false; };
  }, []);

  function startDerivConnect() {
    window.location.href = "/api/auth/deriv/start";
  }

  function startDemoTrading() {
    if (!connected || demoAccounts.length === 0) {
      startDerivConnect();
      return;
    }
    document.getElementById("ticket")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const demoReady = connected && Boolean(activeAccount);
  const accountState = !connected
    ? "Not connected"
    : activeAccount
      ? "Demo account selected"
      : "Demo account required";

  return <main className={styles.workspace} id="overview">
    <aside className={styles.sidebar}>
      <a className={styles.brand} href="#overview" aria-label="TradeBridge workspace home"><span className={styles.brandMark}>T</span><span className={styles.brandWord}>tradebridge<span>.</span></span></a>
      <p className={styles.sidebarMeta}>TRADING WORKSPACE</p>
      <nav className={styles.nav} aria-label="Workspace navigation">
        <a className={styles.navLink + " " + styles.navActive} href="#overview"><span className={styles.navIcon}>▦</span><span>Overview</span></a>
        <a className={styles.navLink} href="#markets"><span className={styles.navIcon}>⌁</span><span>Markets & chart</span></a>
        <a className={styles.navLink} href="#ticket"><span className={styles.navIcon}>↗</span><span>Demo trade</span></a>
        <a className={styles.navLink} href="#activity"><span className={styles.navIcon}>◷</span><span>Positions & activity</span></a>
      </nav>
      <div className={styles.sidebarMetaBottom}>
        <span className={demoReady ? styles.statusDotConnected : styles.statusDot} />
        <div><strong>{accountState}</strong><small>{activeAccount ? activeAccount.account_id : connected ? "Select a virtual account" : "Connect Deriv to continue"}</small></div>
      </div>
    </aside>

    <section className={styles.main}>
      <header className={styles.topbar}>
        <div className={styles.breadcrumb}>Workspace <b>/</b> Demo trading</div>
        <div className={styles.topActions}>
          {demoAccounts.length > 0 && <label className={styles.activeAccountWrap}>
            <span className={styles.accountLabel}>ACCOUNT</span>
            <select className={styles.accountSelect} aria-label="Select demo trading account" value={activeAccount?.account_id ?? ""} onChange={(event) => setSelectedAccountId(event.target.value)}>
              {demoAccounts.map((item) => <option value={item.account_id} key={item.account_id}>{item.account_id} · {item.currency ?? "Currency"} · Demo</option>)}
            </select>
          </label>}
          {connected
            ? <form action="/api/auth/deriv/disconnect" method="post"><button className={styles.secondaryButton} type="submit">Disconnect</button></form>
            : <button className={styles.connectButton} type="button" onClick={startDerivConnect}>Connect Deriv ↗</button>}
        </div>
      </header>

      <div className={styles.content}>
        <section className={styles.intro}>
          <div className={styles.introMain}>
            <p className={styles.eyebrow}>YOUR MARKETS, YOUR DEMO ACCOUNT</p>
            <h1 className={styles.title}>Trade with a clearer view.</h1>
            <p className={styles.subtitle}>Inspect real market prices, review a live Deriv quote, and confirm demo orders. Active positions and account activity are loaded from your selected demo account.</p>
          </div>
          <div className={styles.introActions}>
            {!connected && <button className={styles.secondaryButton} type="button" onClick={startDerivConnect}>Connect Deriv ↗</button>}
            <button className={styles.primaryButton} type="button" onClick={startDemoTrading}>{!connected ? "Connect to start" : demoAccounts.length === 0 ? "Reconnect Deriv" : "Open demo trade ticket"} <span aria-hidden="true">→</span></button>
          </div>
        </section>

        <section className={styles.notice} aria-live="polite">
          <span className={styles.noticeIcon}>i</span>
          <div className={styles.noticeCopy}>
            <strong>{connected ? activeAccount ? "Demo account selected · virtual funds only" : "Deriv connected · demo account required" : "Connect Deriv to activate trading"}</strong>
            <p>{authMessage}</p>
          </div>
        </section>

        {connected && demoAccounts.length === 0 && <section className={styles.accountEmpty}>
          <div><strong>No demo account is linked to this workspace</strong><p>In Deriv, switch to or create a virtual-money account, then reconnect. TradeBridge validates account ownership and blocks real-money accounts from placing orders.</p></div>
          <button className={styles.connectButton} type="button" onClick={startDerivConnect}>Reconnect Deriv ↗</button>
        </section>}

        <section className={styles.statsGrid} aria-label="Demo account summary">
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span className={styles.metricAccent}>◉</span> Demo balance</div>
            <strong className={styles.statValue}>{connected && activeAccount ? formatMoney(liveBalance, currency) : "—"}</strong>
            <p className={styles.statSub}>{activeAccount ? activeAccount.account_id + " · Live account balance" : "Connect and select an eligible demo account"}</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span className={styles.metricAccent}>▤</span> Open positions</div>
            <strong className={styles.statValue}>{demoReady && trading.sessionState === "Demo trading connected" ? trading.positions.length : "—"}</strong>
            <p className={styles.statSub}>{trading.sessionState === "Demo trading connected" ? "Active Deriv contracts" : trading.sessionState}</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span className={styles.metricAccent}>↗</span> Realized P/L today</div>
            <strong className={styles.statValue}>{demoReady && trading.realizedProfit !== null ? formatMoney(trading.realizedProfit, currency) : "—"}</strong>
            <p className={styles.statSub}>{demoReady ? "Read from Deriv's daily profit table" : "Available after connecting a demo account"}</p>
          </article>
        </section>

        <div className={styles.marketGrid}>
          <MarketWatch
            markets={markets}
            snapshots={snapshots}
            selectedMarket={selectedMarket}
            selectedSymbol={selectedSymbol}
            connection={connection}
            onSelect={selectMarket}
          />
          <DemoTradeTicket
            connected={connected}
            account={activeAccount}
            market={selectedMarket}
            sessionState={trading.sessionState}
            status={trading.status}
            busy={trading.busy}
            quote={trading.quote}
            requestQuote={trading.requestQuote}
            confirmQuote={trading.confirmQuote}
          />
        </div>

        <TradingActivity positions={trading.positions} activity={trading.activity} currency={currency} />

        <footer className={styles.footer}><span>TradeBridge · Market data and order state from Deriv</span><span>Demo orders only · Real-money accounts are blocked</span></footer>
      </div>
    </section>

    <nav className={styles.mobileNav} aria-label="Workspace navigation">
      <a href="#overview">▦<span>Home</span></a>
      <a href="#markets">⌁<span>Markets</span></a>
      <a href="#ticket">↗<span>Trade</span></a>
      <a href="#activity">◷<span>Activity</span></a>
    </nav>
  </main>;
}
