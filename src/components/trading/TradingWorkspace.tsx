"use client";

import { useEffect, useState } from "react";
import styles from "./TradingWorkspace.module.css";
import DemoTradeTicket from "./DemoTradeTicket";
import LiveTradingControls from "./LiveTradingControls";
import MarketWatch from "./MarketWatch";
import TradingActivity from "./TradingActivity";
import { useTradingSession } from "./useDemoTrading";
import { useMarketData } from "./useMarketData";
import type { DerivAccount } from "./types";

type AccountsResponse = {
  connected?: boolean;
  accounts?: DerivAccount[];
  error?: string;
};

const REAL_EXECUTION_GATEWAY_AVAILABLE = false;

type LiveConsentResponse = {
  enabled?: boolean;
  max_stake?: number;
  max_daily_loss?: number;
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
    case "deriv_unavailable": return "Deriv is temporarily unavailable. Retry when the provider is reachable.";
    case "account_mismatch":
    case "owner_mismatch": return "This Deriv session does not match the signed-in TradeBridge account. Connect Deriv again.";
    case "account_linking_unavailable": return "Secure account linking is unavailable. Apply the required database migrations, then retry.";
    default: return "Connect your Deriv account to load account data and trading features.";
  }
}

function formatMoney(value: number | null, currency: string) {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value) + (currency ? " " + currency : "");
}

function isDemoAccount(account: DerivAccount | null | undefined) {
  return (account?.account_type ?? "").toLowerCase() === "demo";
}

function isRealAccount(account: DerivAccount | null | undefined) {
  return (account?.account_type ?? "").toLowerCase() === "real";
}

function accountTypeLabel(account: DerivAccount) {
  const type = (account.account_type ?? "").toLowerCase();
  if (type === "demo") return "Demo";
  if (type === "real") return "Real";
  return "Unsupported";
}

export default function TradingWorkspace() {
  const [connected, setConnected] = useState(false);
  const [accounts, setAccounts] = useState<DerivAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [authMessage, setAuthMessage] = useState("Checking your Deriv connection…");
  const [liveConsentLoading, setLiveConsentLoading] = useState(false);
  const [liveConsentBusy, setLiveConsentBusy] = useState(false);
  const [liveTradingEnabled, setLiveTradingEnabled] = useState(false);
  const [liveConsentLoadedAccountId, setLiveConsentLoadedAccountId] = useState("");
  const [liveConsentMessage, setLiveConsentMessage] = useState("");
  const [maxRealStake, setMaxRealStake] = useState(10);
  const [maxDailyLoss, setMaxDailyLoss] = useState(25);
  const { markets, snapshots, connection, selectedMarket, selectedSymbol, selectMarket } = useMarketData();

  const demoAccounts = accounts.filter(isDemoAccount);
  const realAccounts = accounts.filter(isRealAccount);
  const activeAccount = accounts.find((item) => item.account_id === selectedAccountId)
    ?? demoAccounts[0]
    ?? realAccounts[0]
    ?? accounts[0]
    ?? null;
  const activeAccountIsDemo = isDemoAccount(activeAccount);
  const activeAccountIsReal = isRealAccount(activeAccount);
  const effectiveLiveTradingEnabled = REAL_EXECUTION_GATEWAY_AVAILABLE
    && activeAccountIsReal
    && liveTradingEnabled
    && liveConsentLoadedAccountId === activeAccount?.account_id;
  const trading = useTradingSession(connected, activeAccount, effectiveLiveTradingEnabled, maxRealStake, maxDailyLoss);
  const sessionConnected = trading.sessionState === "Demo trading connected" || trading.sessionState === "Real trading connected";
  const currency = activeAccountIsDemo || effectiveLiveTradingEnabled
    ? trading.balance.currency || activeAccount?.currency || "USD"
    : activeAccount?.currency || "USD";
  const liveBalance = activeAccountIsDemo || effectiveLiveTradingEnabled
    ? trading.balance.balance ?? activeAccount?.balance ?? null
    : activeAccount?.balance ?? null;

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const firstAuthMessage = authErrorMessage(params.get("auth_error"));
    if (params.get("connection") === "connected") setAuthMessage("Deriv authorization completed. Verifying linked accounts and trading permissions…");
    if (params.get("auth_error")) setAuthMessage(firstAuthMessage);
    if (params.has("connection") || params.has("auth_error")) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    fetch("/api/auth/deriv/accounts", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as AccountsResponse;
        if (!active) return;
        setConnected(Boolean(data.connected));
        const returnedAccounts = data.accounts ?? [];
        setAccounts(returnedAccounts);
        const eligible = returnedAccounts.filter(isDemoAccount);
        setSelectedAccountId((current) => returnedAccounts.some((item) => item.account_id === current)
          ? current
          : eligible[0]?.account_id ?? returnedAccounts.find(isRealAccount)?.account_id ?? returnedAccounts[0]?.account_id ?? "");
        if (firstAuthMessage) setAuthMessage(firstAuthMessage);
        else if (data.connected && eligible.length > 0) setAuthMessage("Deriv connected. Demo and real accounts are checked against your linked account ownership.");
        else if (data.connected && returnedAccounts.some(isRealAccount)) setAuthMessage("Deriv connected. A linked real account is available; live order entry stays locked until you accept the risk disclosure.");
        else if (data.connected) setAuthMessage("Deriv connected, but no supported Options account was returned. Refresh or reconnect Deriv.");
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

  useEffect(() => {
    let active = true;
    if (!connected || !activeAccountIsReal || !activeAccount) {
      setLiveConsentLoading(false);
      setLiveTradingEnabled(false);
      setLiveConsentLoadedAccountId("");
      setLiveConsentMessage("");
      return () => { active = false; };
    }

    setLiveConsentLoading(true);
    setLiveTradingEnabled(false);
    setLiveConsentLoadedAccountId("");
    setLiveConsentMessage("");
    const accountId = activeAccount.account_id;

    fetch("/api/auth/deriv/live-consent?account_id=" + encodeURIComponent(accountId), { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as LiveConsentResponse;
        if (!active) return;
        if (!response.ok) {
          setLiveConsentMessage(data.error === "live_consent_schema_missing"
            ? "Live trading setup is incomplete. Apply supabase/migrations/20261009140000_add_real_trading_consent.sql, then reload."
            : data.error === "account_not_linked"
              ? "This account is not linked to the signed-in TradeBridge user. Reconnect Deriv to verify ownership."
              : "Could not load live-trading consent. Retry the request before trading.");
          return;
        }
        setMaxRealStake(Number.isFinite(Number(data.max_stake)) ? Number(data.max_stake) : 10);
        setMaxDailyLoss(Number.isFinite(Number(data.max_daily_loss)) ? Number(data.max_daily_loss) : 25);
        setLiveTradingEnabled(Boolean(data.enabled));
        setLiveConsentLoadedAccountId(accountId);
        setLiveConsentMessage(data.enabled
          ? "Previously acknowledged live-trading consent is active for this account."
          : "Live trading is locked until you review the risk disclosure and explicitly enable it.");
      })
      .catch(() => {
        if (active) setLiveConsentMessage("Unable to load live-trading consent. Check your connection and retry.");
      })
      .finally(() => {
        if (active) setLiveConsentLoading(false);
      });

    return () => { active = false; };
  }, [connected, activeAccountIsReal, activeAccount?.account_id]);

  function startDerivConnect() {
    window.location.href = "/api/auth/deriv/start";
  }

  function startTrading() {
    if (!connected || !activeAccount) {
      startDerivConnect();
      return;
    }
    if (activeAccountIsReal && !effectiveLiveTradingEnabled) {
      document.getElementById("live-controls")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (!activeAccountIsDemo && !activeAccountIsReal && demoAccounts.length > 0) {
      setSelectedAccountId(demoAccounts[0].account_id);
    }
    document.getElementById("ticket")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function enableLiveTrading(stakeLimit: number, dailyLossLimit: number) {
    if (!activeAccountIsReal || !activeAccount) return;
    setLiveConsentBusy(true);
    setLiveConsentMessage("Saving your risk acknowledgement and limits…");
    try {
      const response = await fetch("/api/auth/deriv/live-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: activeAccount.account_id,
          enabled: true,
          acknowledgement: "REAL_MONEY_RISK_ACKNOWLEDGEMENT_V1",
          max_stake: stakeLimit,
          max_daily_loss: dailyLossLimit,
        }),
        cache: "no-store",
      });
      const data = await response.json() as LiveConsentResponse;
      if (!response.ok) {
        setLiveConsentMessage(data.error === "live_consent_schema_missing"
          ? "The required Supabase migration has not been applied. Apply the live-trading consent migration, then retry."
          : data.error === "risk_acknowledgement_required"
            ? "Tick the risk acknowledgement before enabling live trading."
            : data.error === "real_account_required"
              ? "Only a verified Real account can enable live trading."
              : "Could not save live-trading consent. No new live trading session was opened.");
        return;
      }
      setMaxRealStake(Number(data.max_stake ?? stakeLimit));
      setMaxDailyLoss(Number(data.max_daily_loss ?? dailyLossLimit));
      setLiveConsentLoadedAccountId(activeAccount.account_id);
      setLiveTradingEnabled(true);
      setLiveConsentMessage("Risk acknowledgement recorded. TradeBridge is requesting a real-account session; no order has been placed.");
    } catch {
      setLiveConsentMessage("Unable to save live-trading consent. Check your connection and try again.");
    } finally {
      setLiveConsentBusy(false);
    }
  }

  async function disableLiveTrading() {
    if (!activeAccountIsReal || !activeAccount) return;
    const accountId = activeAccount.account_id;
    // Lock this tab immediately so no new quote/order can be initiated while consent is revoked.
    setLiveTradingEnabled(false);
    setLiveConsentLoadedAccountId("");
    setLiveConsentBusy(true);
    setLiveConsentMessage("Locking live order entry and revoking consent…");
    try {
      const response = await fetch("/api/auth/deriv/live-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId, enabled: false }),
        cache: "no-store",
      });
      const data = await response.json() as LiveConsentResponse;
      if (!response.ok) {
        setLiveConsentMessage(data.error === "live_consent_schema_missing"
          ? "Live trading is locked in this tab, but the consent record could not be updated. Apply the migration and retry."
          : "Live trading is locked in this tab, but server-side consent could not be revoked. Retry before using a new session.");
        return;
      }
      setLiveConsentMessage("Live trading disabled. The current trading socket has been closed.");
      setLiveConsentLoadedAccountId(accountId);
    } catch {
      setLiveConsentMessage("Live trading is locked in this tab, but server-side consent could not be revoked. Retry before using a new session.");
    } finally {
      setLiveConsentBusy(false);
    }
  }

  const accountSessionReady = connected && sessionConnected;
  const accountState = !connected
    ? "Not connected"
    : activeAccountIsDemo
      ? "Demo account selected"
      : activeAccountIsReal
        ? effectiveLiveTradingEnabled
          ? "Real account · live trading enabled"
          : "Real account · live trading locked"
        : activeAccount
          ? "Unsupported account type · trading disabled"
          : "Account required";

  return <main className={styles.workspace} id="overview">
    <aside className={styles.sidebar}>
      <a className={styles.brand} href="#overview" aria-label="TradeBridge workspace home"><span className={styles.brandMark}>T</span><span className={styles.brandWord}>tradebridge<span>.</span></span></a>
      <p className={styles.sidebarMeta}>TRADING WORKSPACE</p>
      <nav className={styles.nav} aria-label="Workspace navigation">
        <a className={styles.navLink + " " + styles.navActive} href="#overview"><span className={styles.navIcon}>▦</span><span>Overview</span></a>
        <a className={styles.navLink} href="#markets"><span className={styles.navIcon}>⌁</span><span>Markets & chart</span></a>
        <a className={styles.navLink} href="#ticket"><span className={styles.navIcon}>↗</span><span>Trade ticket</span></a>
        <a className={styles.navLink} href="#activity"><span className={styles.navIcon}>◷</span><span>Positions & history</span></a>
      </nav>
      <div className={styles.sidebarMetaBottom}>
        <span className={accountSessionReady ? styles.statusDotConnected : styles.statusDot} />
        <div><strong>{accountState}</strong><small>{activeAccount ? activeAccount.account_id : connected ? "Select a linked account" : "Connect Deriv to continue"}</small></div>
      </div>
    </aside>

    <section className={styles.main}>
      <header className={styles.topbar}>
        <div className={styles.breadcrumb}>Workspace <b>/</b> {activeAccountIsReal ? effectiveLiveTradingEnabled ? "Live trading" : "Real account · read-only" : "Demo trading"}</div>
        <div className={styles.topActions}>
          {accounts.length > 0 && <label className={styles.activeAccountWrap}>
            <span className={styles.accountLabel}>ACCOUNT</span>
            <select className={styles.accountSelect} aria-label="Select Deriv account" value={activeAccount?.account_id ?? ""} onChange={(event) => setSelectedAccountId(event.target.value)}>
              {accounts.map((item) => <option value={item.account_id} key={item.account_id}>{item.account_id} · {item.currency ?? "Currency"} · {accountTypeLabel(item)}</option>)}
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
            <p className={styles.eyebrow}>{activeAccountIsReal ? effectiveLiveTradingEnabled ? "REAL ACCOUNT · LIVE ORDERS ENABLED" : "REAL ACCOUNT · ORDER ENTRY LOCKED" : "YOUR MARKETS, YOUR DERIV ACCOUNT"}</p>
            <h1 className={styles.title}>Trade with a clearer view.</h1>
            <p className={styles.subtitle}>{activeAccountIsReal
              ? effectiveLiveTradingEnabled
                ? "Monitor real balance, live contract P/L, open positions, and account history. Every entry requires a fresh Deriv quote and a separate confirmation."
                : "Your linked Real account is read-only in TradeBridge. Live orders are disabled until a server-side gateway can enforce stake caps, daily-loss stops, and revocation for every order."
              : "Inspect real market prices, review a live Deriv quote, confirm trades, monitor open contracts, and check account activity. All figures are sourced from Deriv."}</p>
          </div>
          <div className={styles.introActions}>
            {!connected && <button className={styles.secondaryButton} type="button" onClick={startDerivConnect}>Connect Deriv ↗</button>}
            <button className={styles.primaryButton} type="button" onClick={startTrading}>{!connected ? "Connect to start" : !activeAccount ? "Refresh accounts" : activeAccountIsReal ? effectiveLiveTradingEnabled ? "Open live trade ticket" : "View account safety status" : activeAccountIsDemo ? "Open demo trade ticket" : "Switch to demo"} <span aria-hidden="true">→</span></button>
          </div>
        </section>

        <section className={styles.notice} aria-live="polite">
          <span className={styles.noticeIcon}>i</span>
          <div className={styles.noticeCopy}>
            <strong>{!connected ? "Connect Deriv to activate trading" : activeAccountIsDemo ? "Demo account selected · virtual funds only" : activeAccountIsReal ? effectiveLiveTradingEnabled ? "Real account selected · live orders enabled" : "Real account selected · read-only; live orders disabled for safety" : "Deriv connected · supported account required"}</strong>
            <p>{activeAccountIsReal
              ? REAL_EXECUTION_GATEWAY_AVAILABLE
                ? liveConsentMessage || "Live account actions require explicit risk acknowledgement."
                : "Real-money order execution is disabled in this build. Use a Demo account to place trades; a browser-only limit is not a secure live-trading control."
              : authMessage}</p>
          </div>
        </section>

        {connected && accounts.length === 0 && <section className={styles.accountEmpty}>
          <div><strong>No linked Deriv Options account was returned</strong><p>Create or activate a supported account in Deriv, then reconnect. TradeBridge only displays accounts returned by Deriv and verified as linked to your signed-in user.</p></div>
          <button className={styles.connectButton} type="button" onClick={startDerivConnect}>Reconnect Deriv ↗</button>
        </section>}

        {connected && activeAccountIsReal && activeAccount && <div id="live-controls">
          <LiveTradingControls
            account={activeAccount}
            executionGatewayAvailable={REAL_EXECUTION_GATEWAY_AVAILABLE}
            consentEnabled={liveTradingEnabled}
            enabled={effectiveLiveTradingEnabled}
            loading={liveConsentLoading}
            busy={liveConsentBusy}
            maxStake={maxRealStake}
            maxDailyLoss={maxDailyLoss}
            message={liveConsentMessage}
            onEnable={enableLiveTrading}
            onDisable={disableLiveTrading}
          />
        </div>}

        <section className={styles.statsGrid} aria-label="Selected account summary">
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span className={styles.metricAccent}>◉</span> {activeAccountIsDemo ? "Demo balance" : activeAccountIsReal ? "Real balance" : "Account balance"}</div>
            <strong className={styles.statValue}>{connected && activeAccount ? formatMoney(liveBalance, currency) : "—"}</strong>
            <p className={styles.statSub}>{activeAccount ? activeAccount.account_id + (activeAccountIsReal ? " · real money" : activeAccountIsDemo ? " · virtual funds" : " · trading disabled") : "Connect and select a linked account"}</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span className={styles.metricAccent}>▤</span> Open positions</div>
            <strong className={styles.statValue}>{accountSessionReady ? trading.positions.length : "—"}</strong>
            <p className={styles.statSub}>{accountSessionReady ? "Active Deriv contracts" : trading.sessionState}</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span className={styles.metricAccent}>↗</span> Realized P/L today</div>
            <strong className={styles.statValue}>{accountSessionReady && trading.realizedProfit !== null ? formatMoney(trading.realizedProfit, currency) : "—"}</strong>
            <p className={styles.statSub}>{accountSessionReady ? "Read from Deriv's profit table" : "Available after the selected account session connects"}</p>
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
            realTradingEnabled={effectiveLiveTradingEnabled}
            maxRealStake={maxRealStake}
            maxDailyLoss={maxDailyLoss}
            realizedProfit={trading.realizedProfit}
            orderResolutionRequired={trading.orderResolutionRequired}
            acknowledgeOrderResolution={trading.acknowledgeOrderResolution}
            market={selectedMarket}
            sessionState={trading.sessionState}
            status={trading.status}
            busy={trading.busy}
            quote={trading.quote}
            requestQuote={trading.requestQuote}
            confirmQuote={trading.confirmQuote}
          />
        </div>

        <TradingActivity
          positions={trading.positions}
          activity={trading.activity}
          currency={currency}
          accountType={activeAccountIsReal ? "real" : activeAccountIsDemo ? "demo" : "other"}
          busy={trading.busy}
          activityLoading={trading.activityLoading}
          activityHasMore={trading.activityHasMore}
          onSell={trading.sellPosition}
          onRefresh={trading.refreshAccount}
          onLoadMore={trading.loadMoreActivity}
        />

        <footer className={styles.footer}><span>TradeBridge · Quotes, balances, and positions from Deriv</span><span>Deriv Options · Demo orders only; Real accounts are read-only</span></footer>
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
