"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import styles from "./TradingWorkspace.module.css";
import MarketWatch from "./MarketWatch";
import DigitAnalysis from "./DigitAnalysis";
import DemoTradeTicket from "./DemoTradeTicket";
import TradingActivity from "./TradingActivity";
import { useTradingSession } from "./useDemoTrading";
import { useMarketData } from "./useMarketData";
import PriceChart from "./PriceChart";
import type { DerivAccount, DigitContractMode, DigitPrediction } from "./types";
import { MostTradedMarkets } from "./MostTradedMarkets";
import { logger } from "../../lib/logger.mjs";
import { createClient as createSupabaseBrowserClient } from "../../lib/supabase/client";

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

type WorkspacePage = "dashboard" | "markets" | "trade" | "portfolio" | "settings";

const PRIMARY_NAV: Array<{ id: WorkspacePage; label: string; icon: string }> = [
  { id: "dashboard", label: "Home", icon: "▦" },
  { id: "markets", label: "Markets", icon: "⌁" },
  { id: "trade", label: "Trade", icon: "↗" },
  { id: "portfolio", label: "Portfolio & History", icon: "◷" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

const PAGE_TITLES: Record<WorkspacePage, string> = {
  dashboard: "Dashboard",
  markets: "Markets",
  trade: "Trade",
  portfolio: "Portfolio & History",
  settings: "Settings",
};

function authErrorMessage(error: string | null) {
  const messages: Record<string, string> = {
    configuration: "Authorization is not configured correctly. Review environment settings.",
    cancelled: "Authorization was cancelled. You can reconnect whenever you're ready.",
    invalid_callback: "Could not verify authorization response. Please connect again.",
    token_exchange: "Could not complete authorization. Please try again.",
    platform_email_unverified: "Verify your email before connecting.",
    account_verification_failed: "Authorization completed, but account details could not be verified.",
    account_linking_unavailable: "Secure account linking is not ready. Apply required database migrations.",
    account_conflict: "This trading account is linked to another user.",
    deriv_auth_required: "Sign in before connecting your account.",
  };
  return error ? messages[error] ?? "" : "";
}

function accountErrorMessage(error?: string) {
  switch (error) {
    case "token_expired": return "Your session expired or was revoked. Reconnect to continue.";
    case "insufficient_scope": return "Account access denied. Reconnect and approve required trading permissions.";
    case "deriv_unavailable": return "Trading service is temporarily unavailable. Retry when reachable.";
    case "account_mismatch":
    case "owner_mismatch": return "Session does not match your signed-in account. Connect again.";
    case "account_linking_unavailable": return "Secure account linking is unavailable. Apply migrations and retry.";
    default: return "Connect your trading account to load balances and trading features.";
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
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const routeSegment = pathname.split("/").filter(Boolean)[0] ?? "dashboard";
  const page: WorkspacePage = PRIMARY_NAV.some((item) => item.id === routeSegment)
    ? routeSegment as WorkspacePage
    : "dashboard";

  // Safely retrieve query parameters
  const requestedSymbol = searchParams.get("symbol");
  const authErrorParam = searchParams.get("auth_error");
  const connectionParam = searchParams.get("connection");

  const [connected, setConnected] = useState(false);
  const [accounts, setAccounts] = useState<DerivAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [authMessage, setAuthMessage] = useState("Checking your Deriv connection…");
  const [liveTradingEnabled, setLiveTradingEnabled] = useState(false);
  const [liveConsentLoadedAccountId, setLiveConsentLoadedAccountId] = useState("");
  const [maxRealStake, setMaxRealStake] = useState(10);
  const [maxDailyLoss, setMaxDailyLoss] = useState(25);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [marketPanelOpen, setMarketPanelOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [marketPanelSearch, setMarketPanelSearch] = useState("");
  const [tradeView, setTradeView] = useState<"analyse" | "charts">("analyse");
  const [digitWindowSize, setDigitWindowSize] = useState(100);

  const [digitMode, setDigitModeState] = useState<DigitContractMode>("over-under");
  const [digitPrediction, setDigitPrediction] = useState<DigitPrediction>("OVER");
  const [digitTarget, setDigitTarget] = useState(5);

  function setDigitMode(mode: DigitContractMode) {
    setDigitModeState(mode);
    setDigitPrediction(mode === "over-under" ? "OVER" : mode === "even-odd" ? "EVEN" : "MATCHES");
    setDigitTarget(5);
  }

  function setPredictionAndValidateTarget(prediction: DigitPrediction) {
    setDigitPrediction(prediction);
    if (digitMode !== "over-under") return;
    if (prediction === "UNDER" && digitTarget < 1) setDigitTarget(5);
    if (prediction === "OVER" && digitTarget > 8) setDigitTarget(5);
  }

  useEffect(() => {
    const saved = localStorage.getItem("tradebridge_theme");
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("tradebridge_theme", next);
  }

  const {
    markets, snapshots, connection, selectedMarket, selectedSymbol, selectMarket,
    candlesByKey, requestCandles,
  } = useMarketData();

  useEffect(() => {
    if (page !== "trade") return;
    if (requestedSymbol && requestedSymbol !== selectedSymbol
      && markets.some((market) => market.symbol === requestedSymbol)) {
      selectMarket(requestedSymbol);
    }
  }, [page, requestedSymbol, selectedSymbol, markets, selectMarket]);

  function openMarket(symbol: string) {
    selectMarket(symbol);
    router.push("/trade?symbol=" + encodeURIComponent(symbol));
  }

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
  const accountSessionReady = connected && sessionConnected;
  const currency = activeAccountIsDemo || effectiveLiveTradingEnabled
    ? trading.balance.currency || activeAccount?.currency || "USD"
    : activeAccount?.currency || "USD";
  const liveBalance = activeAccountIsDemo || effectiveLiveTradingEnabled
    ? trading.balance.balance ?? activeAccount?.balance ?? null
    : activeAccount?.balance ?? null;

  useEffect(() => {
    let active = true;
    const firstAuthMessage = authErrorMessage(authErrorParam);
    if (connectionParam === "connected") setAuthMessage("Authorization completed. Verifying linked accounts and trading permissions…");
    if (authErrorParam) setAuthMessage(firstAuthMessage);
    if (connectionParam || authErrorParam) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    const accountsRequest = (async () => {
      const backendUrlRaw = process.env.NEXT_PUBLIC_TRADEBRIDGE_BACKEND_HTTP_URL?.trim();
      const backendUrl = backendUrlRaw?.endsWith("/") ? backendUrlRaw.slice(0, -1) : backendUrlRaw;
      if (!backendUrl) throw new Error("FastAPI backend is required but NEXT_PUBLIC_TRADEBRIDGE_BACKEND_HTTP_URL is not configured.");
      const supabase = createSupabaseBrowserClient();
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (sessionError || !accessToken) throw new Error("App session is unavailable. Sign in again.");
      return fetch(`${backendUrl}/deriv/accounts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
    })();

    accountsRequest
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
        else if (data.connected && eligible.length > 0) setAuthMessage("Trading account connected. Demo and real accounts verified.");
        else if (data.connected && returnedAccounts.some(isRealAccount)) setAuthMessage("Account connected. Real accounts are read-only; use a Demo account to trade.");
        else if (data.connected) setAuthMessage("Connected, but no supported trading account was returned. Refresh or reconnect.");
        else setAuthMessage(accountErrorMessage(data.error));
      })
      .catch(() => {
        if (active) {
          setConnected(false);
          setAccounts([]);
          setAuthMessage("Could not verify the FastAPI trading session. Confirm the backend URL, allowed origin, and Deriv connection.");
        }
      });

    return () => { active = false; };
  }, [authErrorParam, connectionParam]);

  useEffect(() => {
    let active = true;
    if (!connected || !activeAccountIsReal || !activeAccount) {
      setLiveTradingEnabled(false);
      setLiveConsentLoadedAccountId("");
      return () => { active = false; };
    }

    setLiveTradingEnabled(false);
    setLiveConsentLoadedAccountId("");
    const accountId = activeAccount.account_id;

    fetch("/api/auth/deriv/live-consent?account_id=" + encodeURIComponent(accountId), { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as LiveConsentResponse;
        if (!active) return;
        if (!response.ok) return;
        setMaxRealStake(Number.isFinite(Number(data.max_stake)) ? Number(data.max_stake) : 10);
        setMaxDailyLoss(Number.isFinite(Number(data.max_daily_loss)) ? Number(data.max_daily_loss) : 25);
        setLiveTradingEnabled(Boolean(data.enabled));
        setLiveConsentLoadedAccountId(accountId);
      })
      .catch((error) => {
        if (active) {
          logger.warn("deriv.live_consent.load_failed", {
            account_ref: activeAccount.account_id.slice(-4),
          }, error);
        }
      });

    return () => { active = false; };
  }, [connected, activeAccountIsReal, activeAccount]);

  function startDerivConnect() {
    window.location.href = "/api/auth/deriv/start";
  }

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

  return (
    <main className={styles.workspace} data-theme={theme}>
      <section className={styles.main}>
        <header className={styles.topbar}>
          <Link href="/dashboard" className={styles.topbarIdentity} aria-label="TradeBridge dashboard">
            <span className={styles.brandMark}>T</span>
            <span className={styles.brandWord}>tradebridge<span>.</span></span>
            <span className={styles.workspaceContext}>
              <strong>{PAGE_TITLES[page]}</strong>
              <small>{activeAccountIsReal ? "Real account · read-only by default" : activeAccountIsDemo ? "Demo trading workspace" : "Connect a broker to begin"}</small>
            </span>
          </Link>
          <div className={styles.topActions}>
            <button className={styles.secondaryButton} type="button" onClick={toggleTheme} aria-label="Toggle theme">
              {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
            </button>
            {accounts.length > 0 && (
              <label className={styles.activeAccountWrap}>
                <span className={styles.accountLabel}>ACCOUNT</span>
                <select className={styles.accountSelect} aria-label="Select trading account" value={activeAccount?.account_id ?? ""} onChange={(event) => setSelectedAccountId(event.target.value)}>
                  {accounts.map((item) => (
                    <option value={item.account_id} key={item.account_id}>
                      {item.account_id} · {item.currency ?? "Currency"} · {accountTypeLabel(item)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {connected ? (
              <form action="/api/auth/deriv/disconnect" method="post">
                <button className={styles.secondaryButton} type="submit">Disconnect</button>
              </form>
            ) : (
              <button className={styles.connectButton} type="button" onClick={startDerivConnect}>Connect Broker ↗</button>
            )}
          </div>
        </header>

        <div className={page === "trade" ? styles.workspaceBody + " " + styles.workspaceBodyTrade : styles.workspaceBody}>
          <aside
            className={sidebarExpanded ? styles.tabNavWrap + " " + styles.tabNavExpanded : styles.tabNavWrap + " " + styles.tabNavCollapsed}
            aria-label="Workspace sidebar"
          >
            <button
              className={styles.sidebarToggle}
              type="button"
              onClick={() => setSidebarExpanded((expanded) => !expanded)}
              aria-expanded={sidebarExpanded}
              aria-label={sidebarExpanded ? "Collapse navigation" : "Expand navigation"}
              title={sidebarExpanded ? "Collapse navigation" : "Expand navigation"}
            >
              <span aria-hidden="true">{sidebarExpanded ? "‹" : "›"}</span>
              {sidebarExpanded && <span>Collapse</span>}
            </button>
            <nav className={styles.workspaceTabs} aria-label="Primary navigation">
              {PRIMARY_NAV.map((item) => (
                <Link
                  className={page === item.id ? styles.workspaceTab + " " + styles.workspaceTabActive : styles.workspaceTab}
                  href={"/" + item.id}
                  aria-current={page === item.id ? "page" : undefined}
                  key={item.id}
                >
                  <span className={styles.workspaceTabIcon} aria-hidden="true">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </nav>
          </aside>

          <div className={styles.content}>
          {connected && accounts.length === 0 && (
            <section className={styles.accountEmpty}>
              <div>
                <strong>No linked trading account was returned</strong>
                <p>Create or activate a supported account with your broker, then reconnect. TradeBridge only displays accounts returned and verified as linked to your signed-in user.</p>
              </div>
              <button className={styles.connectButton} type="button" onClick={startDerivConnect}>Reconnect Broker ↗</button>
            </section>
          )}

          <div className={styles.workspaceTabPanel}>
            {page === "dashboard" && (
              <section className={styles.overviewPage} aria-label="Workspace overview">
                <div className={styles.intro}>
                  <div className={styles.introMain}>
                    <p className={styles.eyebrow}>Account overview</p>
                    <h1 className={styles.title}>Dashboard</h1>
                    <p className={styles.subtitle}>Track your account balance, open positions, and market activity at a glance.</p>
                  </div>
                  <div className={styles.introActions}>
                    {connected ? (
                      <button className={styles.secondaryButton} type="button" onClick={() => void trading.refreshAccount()}>Refresh account</button>
                    ) : (
                      <button className={styles.connectButton} type="button" onClick={startDerivConnect}>Connect Broker ↗</button>
                    )}
                  </div>
                </div>

                {authMessage && !connected && (
                  <div className={styles.notice}>
                    <span className={styles.noticeIcon}>i</span>
                    <div>
                      <strong>{authMessage}</strong>
                      <p>Connect your Deriv account to load balances, market sessions, and trade activity.</p>
                    </div>
                  </div>
                )}

                <section className={styles.statsGrid} aria-label="Selected account summary">
                  <article className={styles.statCard}>
                    <div className={styles.statLabel}><span className={styles.metricAccent}>◉</span> {activeAccountIsDemo ? "Demo balance" : activeAccountIsReal ? "Real balance" : "Account balance"}</div>
                    <strong className={styles.statValue}>{connected && activeAccount ? formatMoney(liveBalance, currency) : "—"}</strong>
                    <p className={styles.statSub}>{activeAccount ? activeAccount.account_id + (activeAccountIsReal ? " · real money" : activeAccountIsDemo ? " · virtual funds" : " · trading disabled") : "Connect and select a linked account"}</p>
                  </article>
                  <article className={styles.statCard}>
                    <div className={styles.statLabel}><span className={styles.metricAccent}>▤</span> Open positions</div>
                    <strong className={styles.statValue}>{accountSessionReady ? trading.positions.length : "—"}</strong>
                    <p className={styles.statSub}>{accountSessionReady ? "Active contracts" : trading.sessionState}</p>
                  </article>
                  <article className={styles.statCard}>
                    <div className={styles.statLabel}><span className={styles.metricAccent}>↗</span> Realized P/L today</div>
                    <strong className={styles.statValue}>{accountSessionReady && trading.realizedProfit !== null ? formatMoney(trading.realizedProfit, currency) : "—"}</strong>
                    <p className={styles.statSub}>{accountSessionReady ? "Read from account ledger" : "Available after the selected account session connects"}</p>
                  </article>
                </section>

                <MostTradedMarkets
                  markets={markets}
                  snapshots={snapshots}
                  onSelect={openMarket}
                />
              </section>
            )}

            {page === "markets" && (
              <section className={styles.workspaceSection} aria-label="Available markets">


                <MarketWatch
                  listOnly
                  markets={markets}
                  snapshots={snapshots}
                  selectedMarket={selectedMarket}
                  selectedSymbol={selectedSymbol}
                  connection={connection}
                  onSelect={openMarket}
                  candlesByKey={candlesByKey}
                  onLoadCandles={requestCandles}
                />
              </section>
            )}

            {page === "trade" && (
              <section className={styles.workspaceSection} aria-label="Trading workspace">
                {/* ── Market switcher header ── */}
                <div className={styles.tradeTabHeader}>
                  <div className={styles.tradeTabMarketInfo}>
                    <span className={styles.tradeTabMarketBadge}>↗</span>
                    <div className={styles.tradeTabMarketName}>
                      <strong>{selectedMarket?.name ?? "No market selected"}</strong>
                      <small>{selectedMarket?.symbol ?? "Choose a market to begin"}</small>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {/* View toggle */}
                    <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden" }}>
                      <button
                        type="button"
                        onClick={() => setTradeView("analyse")}
                        style={{
                          minHeight: "34px", padding: "0 14px", border: "none",
                          background: tradeView === "analyse" ? "var(--teal)" : "var(--surface)",
                          color: tradeView === "analyse" ? "#0b1320" : "var(--muted)",
                          fontSize: "11px", fontWeight: 700, cursor: "pointer", transition: "all .15s",
                        }}
                        aria-pressed={tradeView === "analyse"}
                      >⌁ Analyse</button>
                      <button
                        type="button"
                        onClick={() => setTradeView("charts")}
                        style={{
                          minHeight: "34px", padding: "0 14px", border: "none",
                          borderLeft: "1px solid var(--border)",
                          background: tradeView === "charts" ? "var(--teal)" : "var(--surface)",
                          color: tradeView === "charts" ? "#0b1320" : "var(--muted)",
                          fontSize: "11px", fontWeight: 700, cursor: "pointer", transition: "all .15s",
                        }}
                        aria-pressed={tradeView === "charts"}
                      >↗ Charts</button>
                    </div>
                    <button
                      type="button"
                      className={styles.switchMarketButton}
                      onClick={() => setMarketPanelOpen(true)}
                      aria-label="Switch market"
                    >
                      ⌁ Switch market
                    </button>
                  </div>
                </div>

                {/* ── Market switcher slide-in panel ── */}
                {marketPanelOpen && <>
                  <div
                    className={styles.marketPanelOverlay}
                    onClick={() => setMarketPanelOpen(false)}
                    aria-hidden="true"
                  />
                  <div
                    className={styles.marketSwitcherPanel}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Select market"
                  >
                    <div className={styles.marketSwitcherHead}>
                      <h2>Select market</h2>
                      <button
                        type="button"
                        className={styles.panelCloseButton}
                        onClick={() => setMarketPanelOpen(false)}
                        aria-label="Close market panel"
                      >✕</button>
                    </div>
                    <div className={styles.marketSwitcherSearch}>
                      <label className={styles.marketSearchWrap}>
                        <span aria-hidden="true">⌕</span>
                        <input
                          className={styles.marketSearch}
                          type="search"
                          value={marketPanelSearch}
                          onChange={(e) => setMarketPanelSearch(e.target.value)}
                          placeholder="Search by name or symbol…"
                          aria-label="Search markets"
                          autoFocus
                        />
                      </label>
                    </div>
                    <div className={styles.marketSwitcherList}>
                      {markets
                        .filter((m) => {
                          const q = marketPanelSearch.trim().toLowerCase();
                          return !q || m.name.toLowerCase().includes(q) || m.symbol.toLowerCase().includes(q);
                        })
                        .map((m) => {
                          const snap = snapshots[m.symbol];
                          const quote = snap?.quote;
                          const pts = snap?.points ?? [];
                          const first = pts[0]?.price;
                          const change = first && quote && first !== 0 ? ((quote - first) / first) * 100 : null;
                          const isActive = m.symbol === selectedMarket?.symbol;
                          const fmt = (v: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: v >= 100 ? 2 : 4 }).format(v);
                          return (
                            <button
                              key={m.symbol}
                              type="button"
                              className={[styles.marketSwitcherItem, isActive ? styles.marketSwitcherItemActive : ""].join(" ")}
                              onClick={() => { openMarket(m.symbol); setMarketPanelOpen(false); setMarketPanelSearch(""); }}
                              aria-pressed={isActive}
                            >
                              <span className={styles.marketSwitcherIcon}>
                                {m.market === "forex" ? "FX" : m.market === "commodities" ? "Au" : "↗"}
                              </span>
                              <span className={styles.marketSwitcherInfo}>
                                <strong>{m.name}</strong>
                                <small>{m.symbol}</small>
                              </span>
                              <span className={styles.marketSwitcherPrice}>
                                <strong>{quote !== undefined ? fmt(quote) : "—"}</strong>
                                {change !== null && (
                                  <small className={change >= 0 ? styles.positive : styles.negative}>
                                    {change >= 0 ? "+" : ""}{change.toFixed(2)}%
                                  </small>
                                )}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  </div>
                </>}

                {tradeView === "analyse" && (
                  <>
                    <div className={styles.marketGrid}>
                      <div className={styles.marketColumn}>
                        <DigitAnalysis
                          market={selectedMarket}
                          snapshot={selectedMarket ? snapshots[selectedMarket.symbol] : undefined}
                          windowSize={digitWindowSize}
                          onWindowSizeChange={setDigitWindowSize}
                          mode={digitMode}
                          onModeChange={setDigitMode}
                          prediction={digitPrediction}
                          onPredictionChange={setPredictionAndValidateTarget}
                          target={digitTarget}
                          onTargetChange={setDigitTarget}
                        />
                      </div>
                      <div className={styles.marketColumn}>
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
                          snapshot={selectedMarket ? snapshots[selectedMarket.symbol] : undefined}
                          windowSize={digitWindowSize}
                          mode={digitMode}
                          prediction={digitPrediction}
                          onPredictionChange={setPredictionAndValidateTarget}
                          target={digitTarget}
                          sessionState={trading.sessionState}
                          status={trading.status}
                          busy={trading.busy}
                          quote={trading.quote}
                          requestQuote={trading.requestQuote}
                          confirmQuote={trading.confirmQuote}
                          dismissQuote={trading.dismissQuote}
                        />
                      </div>
                    </div>
                    <TradingActivity
                      positionsOnly
                      positions={trading.positions}
                      activity={trading.activity}
                      currency={currency}
                      accountType={activeAccountIsReal ? "real" : activeAccountIsDemo ? "demo" : "other"}
                      accountDataUnavailable={activeAccountIsReal && !effectiveLiveTradingEnabled}
                      busy={trading.busy}
                      activityLoading={trading.activityLoading}
                      activityHasMore={trading.activityHasMore}
                      onSell={trading.sellPosition}
                      onRefresh={trading.refreshAccount}
                      onLoadMore={trading.loadMoreActivity}
                    />
                  </>
                )}

                {tradeView === "charts" && (
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: "20px", alignItems: "start" }}>
                    {/* Left: full price chart */}
                    <PriceChart
                      market={selectedMarket}
                      snapshot={selectedMarket ? snapshots[selectedMarket.symbol] : undefined}
                      candlesByKey={candlesByKey}
                      onLoadCandles={requestCandles}
                    />

                    {/* Automated execution is server-owned; the chart never submits bot orders. */}
                    <aside style={{
                      border: "1px solid var(--line)", borderRadius: "14px",
                      background: "var(--panel)", boxShadow: "var(--card-shadow)",
                      padding: "18px", display: "grid", alignContent: "start", gap: "10px",
                    }}>
                      <strong style={{ fontSize: "14px" }}>Automated bot execution</strong>
                      <p style={{ margin: 0, color: "var(--muted)", fontSize: "12px", lineHeight: 1.6 }}>
                        Bot runs, stop requests, trade history, and recovery status are controlled by the server. The chart does not submit automated orders from your browser.
                      </p>
                      <button type="button" onClick={() => router.push("/bots")} style={{
                        minHeight: "36px", border: "none", borderRadius: "8px",
                        background: "var(--teal)", color: "#0b1320", fontWeight: 800,
                        cursor: "pointer",
                      }}>Open Bot Workspace</button>
                    </aside>
                  </div>
                )}
              </section>
            )}

            {page === "portfolio" && (
              <section className={styles.workspaceSection} aria-label="Positions and history">
                <div className={styles.intro}>
                  <div className={styles.introMain}>
                    <p className={styles.eyebrow}>Account activity</p>
                    <h1 className={styles.title}>Portfolio &amp; History</h1>
                    <p className={styles.subtitle}>Review open contracts, monitor profit and loss, and load your Deriv statement activity.</p>
                  </div>
                  <div className={styles.introActions}>
                    <button className={styles.secondaryButton} type="button" onClick={() => void trading.refreshAccount()}>Refresh activity</button>
                  </div>
                </div>
                <TradingActivity
                  positions={trading.positions}
                  activity={trading.activity}
                  currency={currency}
                  accountType={activeAccountIsReal ? "real" : activeAccountIsDemo ? "demo" : "other"}
                  accountDataUnavailable={activeAccountIsReal && !effectiveLiveTradingEnabled}
                  busy={trading.busy}
                  activityLoading={trading.activityLoading}
                  activityHasMore={trading.activityHasMore}
                  onSell={trading.sellPosition}
                  onRefresh={trading.refreshAccount}
                  onLoadMore={trading.loadMoreActivity}
                />
              </section>
            )}
{page === "settings" && (
              <section className={styles.workspaceSection} aria-label="Settings">
                <div className={styles.intro}>
                  <div className={styles.introMain}>
                    <p className={styles.eyebrow}>Workspace preferences</p>
                    <h1 className={styles.title}>Settings</h1>
                    <p className={styles.subtitle}>Manage the appearance of TradeBridge and review the status and safety boundaries of your broker connection.</p>
                  </div>
                </div>

                <div className={styles.settingsGrid}>
                  <section className={styles.settingsPanel}>
                    <div className={styles.panelHeading}>
                      <div>
                        <p className={styles.eyebrow}>APPEARANCE</p>
                        <h2>Theme</h2>
                        <p className={styles.panelSubtext}>Your choice is saved in this browser and used across workspace pages.</p>
                      </div>
                    </div>
                    <div className={styles.settingValue}>
                      <div>
                        <strong>{theme === "dark" ? "Dark theme" : "Light theme"}</strong>
                        <small>Current workspace appearance</small>
                      </div>
                      <button className={styles.secondaryButton} type="button" onClick={toggleTheme}>{theme === "dark" ? "Switch to light" : "Switch to dark"}</button>
                    </div>
                  </section>

                  <section className={styles.settingsPanel}>
                    <div className={styles.panelHeading}>
                      <div>
                        <p className={styles.eyebrow}>BROKER CONNECTION</p>
                        <h2>Deriv account</h2>
                        <p className={styles.panelSubtext}>Account details and live connection status are verified by the server.</p>
                      </div>
                    </div>
                    <p className={styles.settingStatus}>{authMessage}</p>
                    <p className={styles.panelSubtext}>{connected ? accountState : "No verified trading connection is currently active."}</p>
                    <div className={styles.settingActions}>
                      {connected ? (
                        <form action="/api/auth/deriv/disconnect" method="post"><button className={styles.secondaryButton} type="submit">Disconnect broker</button></form>
                      ) : (
                        <button className={styles.connectButton} type="button" onClick={startDerivConnect} aria-label="Link Deriv account">
                          <span className={styles.derivIcon} aria-hidden="true">D</span>
                          <span>Link</span>
                        </button>
                      )}
                      {connected && <button className={styles.secondaryButton} type="button" onClick={() => void trading.refreshAccount()}>Refresh account</button>}
                    </div>
                  </section>

                  <section className={styles.settingsPanel}>
                    <div className={styles.panelHeading}>
                      <div>
                        <p className={styles.eyebrow}>TRADING SAFETY</p>
                        <h2>Execution controls</h2>
                        <p className={styles.panelSubtext}>Connecting an account does not bypass the execution restrictions.</p>
                      </div>
                    </div>
                    <ul className={styles.safetyList}>
                      <li>Demo accounts are the default trading practice environment.</li>
                      <li>Real-account execution remains locked unless a trusted execution gateway is available and the required consent is verified.</li>
                    </ul>
                  </section>
                </div>
              </section>
            )}
          </div>

          <footer className={styles.footer}>
            <span>TradeBridge · Professional Trading Terminal</span>
            <span>{activeAccountIsDemo ? "Demo account selected" : activeAccountIsReal ? "Real accounts read-only for order entry" : "Connect a broker to unlock account data"}</span>
          </footer>
          </div>
        </div>
      </section>
    </main>
  );
}