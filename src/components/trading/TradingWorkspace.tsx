"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import styles from "./TradingWorkspace.module.css";
import LiveTradingControls from "./LiveTradingControls";
import MarketWatch from "./MarketWatch";
import DigitAnalysis from "./DigitAnalysis";
import TradingActivity from "./TradingActivity";
import { useTradingSession } from "./useDemoTrading";
import { useMarketData } from "./useMarketData";
import type { DerivAccount, DigitContractMode, DigitPrediction } from "./types";
import { BotsWorkspace } from "../bots/BotsWorkspace";

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

type WorkspacePage = "dashboard" | "markets" | "trade" | "portfolio" | "bots" | "settings";

const PRIMARY_NAV: Array<{ id: WorkspacePage; label: string; icon: string }> = [
  { id: "dashboard", label: "Home", icon: "▦" },
  { id: "markets", label: "Markets", icon: "⌁" },
  { id: "trade", label: "Trade", icon: "↗" },
  { id: "portfolio", label: "Portfolio & History", icon: "◷" },
  { id: "bots", label: "Bots", icon: "⚡" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

const PAGE_TITLES: Record<WorkspacePage, string> = {
  dashboard: "Dashboard",
  markets: "Markets",
  trade: "Trade",
  portfolio: "Portfolio & History",
  bots: "Automated Bots",
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

// ─── Most Traded Markets section ──────────────────────────────────────────────

const MOST_TRADED_SYMBOLS = ["1HZ100V", "1HZ10V", "1HZ75V", "1HZ50V", "1HZ25V"];

function getSymbolLabel(symbol: string): string {
  const labels: Record<string, string> = {
    "1HZ100V": "100",
    "1HZ10V": "10",
    "1HZ75V": "75",
    "1HZ50V": "50",
    "1HZ25V": "25",
  };
  return labels[symbol] ?? symbol.replace(/[^0-9]/g, "");
}

function useSortedByActivity(
  snapshots: Record<string, import("./types").MarketSnapshot>,
  intervalMs = 10_000,
): string[] {
  const baselineRef = useRef<Record<string, number>>({});
  const [sorted, setSorted] = useState<string[]>(MOST_TRADED_SYMBOLS);

  useEffect(() => {
    const init: Record<string, number> = {};
    for (const sym of MOST_TRADED_SYMBOLS) {
      init[sym] = snapshots[sym]?.points.length ?? 0;
    }
    baselineRef.current = init;

    const id = setInterval(() => {
      const ticksSince: Record<string, number> = {};
      for (const sym of MOST_TRADED_SYMBOLS) {
        const current = snapshots[sym]?.points.length ?? 0;
        const baseline = baselineRef.current[sym] ?? current;
        ticksSince[sym] = current - baseline;
        baselineRef.current[sym] = current;
      }
      setSorted((prev) => {
        const next = [...MOST_TRADED_SYMBOLS].sort(
          (a, b) => (ticksSince[b] ?? 0) - (ticksSince[a] ?? 0),
        );
        return next.join(",") === prev.join(",") ? prev : next;
      });
    }, intervalMs);

    return () => clearInterval(id);
  }, [intervalMs, snapshots]);

  return sorted;
}

function MiniSparkline({ points, isUp }: { points: { price: number }[]; isUp: boolean }) {
  if (points.length < 2) {
    return (
      <svg viewBox="0 0 120 40" width="120" height="40" aria-hidden="true">
        <line x1="0" y1="20" x2="120" y2="20" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
      </svg>
    );
  }
  const prices = points.map((p) => p.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = maxP - minP || 1;
  const w = 120;
  const h = 40;
  const pad = 4;
  const plotH = h - pad * 2;
  const plotW = w;
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * plotW;
    const y = pad + ((maxP - p.price) / range) * plotH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = coords.map((c, i) => (i === 0 ? "M" : "L") + c).join(" ");
  const color = isUp ? "#10b981" : "#ef4444";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true" style={{ display: "block" }}>
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MostTradedMarkets({
  markets,
  snapshots,
  onSelect,
}: {
  markets: import("./types").MarketInstrument[];
  snapshots: Record<string, import("./types").MarketSnapshot>;
  onSelect: (symbol: string) => void;
}) {
  const sortedSymbols = useSortedByActivity(snapshots);

  const shown = sortedSymbols.flatMap((sym) => {
    const m = markets.find((item) => item.symbol === sym);
    return m ? [m] : [];
  });

  if (shown.length === 0) return null;

  return (
    <section aria-label="Most traded markets">
      <h2 style={{ margin: "0 0 16px", fontSize: "16px", fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.3px" }}>
        Most traded markets
      </h2>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        gap: "12px",
      }}>
        {shown.map((market) => {
          const snap = snapshots[market.symbol];
          const points = snap?.points ?? [];
          const recent = points.slice(-60);
          const first = recent[0]?.price;
          const last = recent[recent.length - 1]?.price ?? snap?.quote;
          const change = first && last && first !== 0 ? ((last - first) / first) * 100 : null;
          const isUp = change === null || change >= 0;
          const label = getSymbolLabel(market.symbol);
          const quote = snap?.quote;
          const formatQ = (v: number) => {
            const d = market.symbol.startsWith("frx") ? 5 : v >= 100 ? 2 : 2;
            return new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
          };

          return (
            <button
              key={market.symbol}
              type="button"
              onClick={() => onSelect(market.symbol)}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                padding: "16px",
                border: "1px solid var(--line)",
                borderRadius: "12px",
                background: "var(--panel)",
                color: "var(--ink)",
                textAlign: "left",
                cursor: "pointer",
                transition: "border-color .15s, background .15s",
                boxShadow: "var(--card-shadow)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "var(--teal)";
                (e.currentTarget as HTMLElement).style.background = "var(--surface)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "var(--line)";
                (e.currentTarget as HTMLElement).style.background = "var(--panel)";
              }}
              aria-label={`Open ${market.name} trading workspace`}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: "28px", height: "18px", borderRadius: "4px",
                  background: "var(--surface)", border: "1px solid var(--border)",
                  color: "var(--ink)", fontSize: "10px", fontWeight: 800,
                }}>{label}</span>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: "4px",
                  padding: "2px 6px", borderRadius: "99px",
                  background: "var(--teal-soft)", color: "var(--teal)",
                  fontSize: "9px", fontWeight: 700,
                }}>
                  <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "var(--teal)", display: "inline-block" }} />
                  1s
                </span>
              </div>

              <p style={{ margin: 0, fontSize: "12px", fontWeight: 600, color: "var(--muted)", lineHeight: 1.3 }}>
                {market.name}
              </p>

              <strong style={{ fontSize: "20px", fontWeight: 800, letterSpacing: "-0.5px", fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>
                {quote !== undefined ? formatQ(quote) : "—"}
              </strong>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                <div style={{ color: isUp ? "var(--teal)" : "var(--red)", flexShrink: 0 }}>
                  <MiniSparkline points={recent} isUp={isUp} />
                </div>
                <span style={{
                  fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap",
                  color: isUp ? "var(--teal)" : "var(--red)",
                }}>
                  {change !== null
                    ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}% (5m)`
                    : "—"}
                </span>
              </div>
            </button>
          );
        })}

        <a
          href="/markets"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            padding: "16px",
            border: "1px solid var(--line)",
            borderRadius: "12px",
            background: "var(--panel)",
            color: "var(--muted)",
            textDecoration: "none",
            cursor: "pointer",
            transition: "border-color .15s, background .15s",
            boxShadow: "var(--card-shadow)",
            minHeight: "160px",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = "var(--teal)";
            (e.currentTarget as HTMLElement).style.background = "var(--surface)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = "var(--line)";
            (e.currentTarget as HTMLElement).style.background = "var(--panel)";
          }}
        >
          <span style={{ fontSize: "24px", color: "var(--ink)" }}>→</span>
          <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)" }}>View all</span>
        </a>
      </div>
    </section>
  );
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
  const [liveConsentLoading, setLiveConsentLoading] = useState(false);
  const [liveConsentBusy, setLiveConsentBusy] = useState(false);
  const [liveTradingEnabled, setLiveTradingEnabled] = useState(false);
  const [liveConsentLoadedAccountId, setLiveConsentLoadedAccountId] = useState("");
  const [liveConsentMessage, setLiveConsentMessage] = useState("");
  const [maxRealStake, setMaxRealStake] = useState(10);
  const [maxDailyLoss, setMaxDailyLoss] = useState(25);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
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
        else if (data.connected && eligible.length > 0) setAuthMessage("Trading account connected. Demo and real accounts verified.");
        else if (data.connected && returnedAccounts.some(isRealAccount)) setAuthMessage("Account connected. Real accounts are read-only; use a Demo account to trade.");
        else if (data.connected) setAuthMessage("Connected, but no supported trading account was returned. Refresh or reconnect.");
        else setAuthMessage(accountErrorMessage(data.error));
      })
      .catch(() => {
        if (active) {
          setConnected(false);
          setAccounts([]);
          setAuthMessage("Could not verify the trading connection. Check your network and reconnect.");
        }
      });

    return () => { active = false; };
  }, [authErrorParam, connectionParam]);

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

        <div className={styles.tabNavWrap}>
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
        </div>

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
                <div className={styles.intro}>
                  <div className={styles.introMain}>
                    <p className={styles.eyebrow}>Explore instruments</p>
                    <h1 className={styles.title}>Markets</h1>
                    <p className={styles.subtitle}>Browse instruments eligible for digit contracts, then select one to open its live digit analysis and trade controls.</p>
                  </div>
                  <div className={styles.introActions}>
                    <span className={connection === "Live prices" ? styles.liveStatus : styles.connectionStatus}><i />{connection}</span>
                  </div>
                </div>

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
                <div className={styles.marketGrid}>
                  <div className={styles.marketColumn}>
                    <DigitAnalysis
                      market={selectedMarket}
                      snapshot={selectedMarket ? snapshots[selectedMarket.symbol] : undefined}
                      mode={digitMode}
                      onModeChange={setDigitMode}
                      prediction={digitPrediction}
                      onPredictionChange={setPredictionAndValidateTarget}
                      target={digitTarget}
                      onTargetChange={setDigitTarget}
                    />
                    <div className={styles.marketSelectionFooter}>
                      <span>
                        <strong>{selectedMarket?.name ?? "No market selected"}</strong>
                        <small>{selectedMarket?.symbol ?? "Choose an available instrument to begin"}</small>
                      </span>
                      <Link href="/markets" className={styles.secondaryButton}>Change market</Link>
                    </div>
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

            {page === "bots" && (
              <BotsWorkspace
                connected={connected}
                account={activeAccount}
                sharedSocketRef={trading.sharedSocketRef}
                nextSharedSeqId={trading.nextSharedSeqId}
                sessionState={trading.sessionState}
              />
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
                        <button className={styles.connectButton} type="button" onClick={startDerivConnect}>Connect Deriv ↗</button>
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
      </section>
    </main>
  );
}