"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import styles from "./CTraderTradePanel.module.css";

type CTraderAccount = {
  account_id: string;
  account_type: "demo" | "live";
  trader_login?: number | null;
  broker_title_short?: string | null;
};

type CTraderSymbol = { symbol_id: number; symbol_name: string };
type CTraderQuote = { bid: number; ask: number; spread: number; spread_pips: number; digits: number; pip_position: number; received_at: string; quote_age_seconds: number | null; provider_quote_at: string | null };
type OrderResult = {
  status?: string;
  message?: string;
  order_id?: string | null;
  position_id?: string | null;
  idempotency_key?: string;
  error_code?: string;
  detail?: string;
};

const DEFAULT_HTTP_URL = process.env.NEXT_PUBLIC_TRADEBRIDGE_BACKEND_HTTP_URL?.trim() ?? "";

function displayError(payload: unknown, status: number) {
  if (typeof payload === "object" && payload !== null && "detail" in payload) {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  return `cTrader request failed (${status}). Check your connection and try again.`;
}

function matchingForexSymbol(symbols: CTraderSymbol[], currentSymbol: string) {
  const normalized = currentSymbol.replace(/^frx/i, "").replace(/[^A-Z]/gi, "").toUpperCase();
  return symbols.find((item) => item.symbol_name.replace(/[^A-Z]/gi, "").toUpperCase() === normalized)
    ?? symbols.find((item) => item.symbol_name.replace(/[^A-Z]/gi, "").toUpperCase() === "EURUSD")
    ?? symbols[0]
    ?? null;
}

export default function CTraderTradePanel({ currentSymbol }: { currentSymbol: string }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [accounts, setAccounts] = useState<CTraderAccount[]>([]);
  const [permissionScope, setPermissionScope] = useState<"trading" | "accounts">("accounts");
  const [accountId, setAccountId] = useState("");
  const [symbols, setSymbols] = useState<CTraderSymbol[]>([]);
  const [symbolId, setSymbolId] = useState<number | null>(null);
  const [quote, setQuote] = useState<CTraderQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteReceivedAt, setQuoteReceivedAt] = useState<number | null>(null);
  const [quoteRevision, setQuoteRevision] = useState(0);
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [volume, setVolume] = useState("1000");
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"info" | "success" | "error">("info");
  const [lastOrderKey, setLastOrderKey] = useState("");
  const [lastOrder, setLastOrder] = useState<OrderResult | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const apiBase = useMemo(() => DEFAULT_HTTP_URL.replace(/\/$/, ""), []);
  const activeAccount = accounts.find((item) => item.account_id === accountId) ?? null;
  const activeSymbol = symbols.find((item) => item.symbol_id === symbolId) ?? null;
  const selectedAccountIsDemo = activeAccount?.account_type === "demo";

  const authenticatedFetch = useCallback(async (path: string, init: RequestInit = {}) => {
    if (!apiBase) throw new Error("FastAPI URL is not configured. Add NEXT_PUBLIC_TRADEBRIDGE_BACKEND_HTTP_URL.");
    const supabase = createClient();
    const { data, error } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (error || !accessToken) throw new Error("Sign in to TradeBridge before connecting a cTrader account.");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(apiBase + path, {
      ...init,
      headers,
      cache: "no-store",
    });
    let payload: unknown = {};
    try { payload = await response.json(); } catch { /* Empty response is valid for disconnect. */ }
    if (!response.ok) throw new Error(displayError(payload, response.status));
    return payload as Record<string, unknown>;
  }, [apiBase]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const connectedParam = params.get("ctrader");
    const errorParam = params.get("ctrader_error");
    if (connectedParam === "connected") {
      setNotice("cTrader connected. Verifying linked accounts and permissions…");
      setNoticeKind("success");
    } else if (errorParam) {
      const messages: Record<string, string> = {
        cancelled: "cTrader account linking was cancelled.",
        invalid_callback: "Could not verify cTrader's authorization response. Connect again.",
        callback_configuration: "The cTrader callback URL does not match the registered app URL.",
        token_exchange: "Could not complete cTrader authorization. Check the backend logs and retry.",
        account_verification_failed: "Authorization returned no usable cTrader accounts.",
        account_conflict: "That cTrader account is already linked to another TradeBridge user.",
        backend_session_unavailable: "The secure cTrader backend is not configured.",
        account_linking_unavailable: "Secure account linking is unavailable. Check the database migration.",
        email_unverified: "Verify your TradeBridge email before connecting cTrader.",
        configuration: "cTrader OAuth configuration is missing.",
      };
      setNotice(messages[errorParam] ?? "cTrader linking failed. Please retry.");
      setNoticeKind("error");
    }
    if (connectedParam || errorParam) window.history.replaceState({}, "", window.location.pathname);
    authenticatedFetch("/ctrader/session")
      .then((payload) => {
        if (!active) return;
        const loadedAccounts = Array.isArray(payload.accounts) ? payload.accounts as CTraderAccount[] : [];
        setConnected(payload.connected === true && loadedAccounts.length > 0);
        setAccounts(loadedAccounts);
        setPermissionScope(payload.permission_scope === "trading" ? "trading" : "accounts");
        setAccountId((current) => loadedAccounts.some((item) => item.account_id === current)
          ? current
          : loadedAccounts.find((item) => item.account_type === "demo")?.account_id ?? loadedAccounts[0]?.account_id ?? "");
      })
      .catch((error) => {
        if (!active) return;
        setConnected(false);
        setAccounts([]);
        if (!errorParam) {
          setNotice(error instanceof Error ? error.message : "Unable to verify cTrader connection.");
          setNoticeKind("error");
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [authenticatedFetch]);

  useEffect(() => {
    let active = true;
    setSymbols([]);
    setSymbolId(null);
    setConfirmed(false);
    if (!connected || !accountId) return () => { active = false; };
    authenticatedFetch("/ctrader/symbols?account_id=" + encodeURIComponent(accountId))
      .then((payload) => {
        if (!active) return;
        const loaded = Array.isArray(payload.symbols)
          ? (payload.symbols as CTraderSymbol[]).filter((item) =>
              Number.isInteger(item.symbol_id) && item.symbol_id > 0 && typeof item.symbol_name === "string")
          : [];
        setSymbols(loaded);
        const match = matchingForexSymbol(loaded, currentSymbol);
        setSymbolId(match?.symbol_id ?? null);
        if (!loaded.length) {
          setNotice("cTrader did not return an enabled Forex symbol for this account.");
          setNoticeKind("error");
        }
      })
      .catch((error) => {
        if (active) {
          setNotice(error instanceof Error ? error.message : "Could not load the cTrader Forex catalogue.");
          setNoticeKind("error");
        }
      });
    return () => { active = false; };
  }, [connected, accountId, currentSymbol, authenticatedFetch]);

  useEffect(() => {
    let active = true;
    setQuote(null);
    setQuoteReceivedAt(null);
    setConfirmed(false);
    if (!connected || !accountId || symbolId === null) {
      setQuoteLoading(false);
      return () => { active = false; };
    }
    setQuoteLoading(true);
    authenticatedFetch(
      "/ctrader/quote?account_id=" + encodeURIComponent(accountId) + "&symbol_id=" + encodeURIComponent(String(symbolId))
    )
      .then((payload) => {
        if (!active) return;
        if (
          typeof payload.bid !== "number" || typeof payload.ask !== "number"
          || typeof payload.spread !== "number" || typeof payload.spread_pips !== "number"
          || typeof payload.digits !== "number" || typeof payload.pip_position !== "number"
          || typeof payload.received_at !== "string"
          || !(typeof payload.quote_age_seconds === "number" || payload.quote_age_seconds === null)
          || !(typeof payload.provider_quote_at === "string" || payload.provider_quote_at === null)
        ) {
          throw new Error("cTrader returned an invalid bid/ask snapshot.");
        }
        setQuote({
          bid: payload.bid,
          ask: payload.ask,
          spread: payload.spread,
          spread_pips: payload.spread_pips,
          digits: payload.digits,
          pip_position: payload.pip_position,
          received_at: payload.received_at,
          quote_age_seconds: payload.quote_age_seconds,
          provider_quote_at: payload.provider_quote_at,
        });
        setQuoteReceivedAt(Date.now());
      })
      .catch((error) => {
        if (active) {
          setQuote(null);
          setNotice(error instanceof Error ? error.message : "Could not load a cTrader quote.");
          setNoticeKind("error");
        }
      })
      .finally(() => { if (active) setQuoteLoading(false); });
    return () => { active = false; };
  }, [connected, accountId, symbolId, quoteRevision, authenticatedFetch]);

  async function disconnect() {
    setBusy(true);
    try {
      await authenticatedFetch("/ctrader/session", { method: "DELETE" });
      setConnected(false);
      setAccounts([]);
      setAccountId("");
      setSymbols([]);
      setSymbolId(null);
      setQuote(null);
      setQuoteReceivedAt(null);
      setNotice("cTrader disconnected from TradeBridge. Revoke the app's access in cTrader as well to fully remove authorization.");
      setNoticeKind("success");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not disconnect cTrader.");
      setNoticeKind("error");
    } finally {
      setBusy(false);
    }
  }

  async function submitOrder() {
    if (!activeAccount || !activeSymbol || !selectedAccountIsDemo || permissionScope !== "trading") {
      setNotice("Select a linked cTrader Demo account with trading permission.");
      setNoticeKind("error");
      return;
    }
    if (!quote || quoteReceivedAt === null || Date.now() - quoteReceivedAt > 15_000 || quote.quote_age_seconds === null || quote.quote_age_seconds > 15) {
      setNotice("Refresh the cTrader bid/ask quote, then confirm the order within 15 seconds.");
      setNoticeKind("error");
      setConfirmed(false);
      return;
    }
    const parsedVolume = Number(volume);
    if (!Number.isFinite(parsedVolume) || parsedVolume <= 0) {
      setNotice("Enter a positive order volume in base-currency units.");
      setNoticeKind("error");
      return;
    }
    if (!confirmed) {
      setNotice("Confirm that this is a demo market order before submitting.");
      setNoticeKind("error");
      return;
    }

    const key = window.crypto.randomUUID().replace(/-/g, "");
    setLastOrderKey(key);
    setLastOrder(null);
    setBusy(true);
    try {
      const payload = await authenticatedFetch("/ctrader/orders", {
        method: "POST",
        body: JSON.stringify({
          account_id: activeAccount.account_id,
          symbol_id: activeSymbol.symbol_id,
          side,
          volume_units: parsedVolume,
          idempotency_key: key,
          confirmed: true,
        }),
      });
      setLastOrder(payload as OrderResult);
      setNotice(typeof payload.message === "string" ? payload.message : "cTrader returned an order acknowledgement.");
      setNoticeKind("success");
      setConfirmed(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The cTrader order could not be confirmed.");
      setNoticeKind("error");
      // The backend will reject duplicates and retains a durable unknown state
      // if a request could have reached cTrader but no acknowledgement arrived.
    } finally {
      setBusy(false);
    }
  }

  async function checkOrderStatus() {
    if (!lastOrderKey) return;
    setStatusLoading(true);
    try {
      const payload = await authenticatedFetch("/ctrader/orders/" + encodeURIComponent(lastOrderKey));
      setLastOrder(payload as OrderResult);
      setNotice("Latest recorded cTrader order state: " + String(payload.status ?? "unknown") + ".");
      setNoticeKind(payload.status === "rejected" ? "error" : "info");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not retrieve the order state.");
      setNoticeKind("error");
    } finally {
      setStatusLoading(false);
    }
  }

  return (
    <section className={styles.panel} aria-label="cTrader Forex ticket">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>FOREX EXECUTION</span>
          <h2>Trade through cTrader</h2>
          <p>Link your cTrader account to send and review Forex orders without leaving TradeBridge.</p>
        </div>
        <span className={connected ? styles.connectedPill : styles.disconnectedPill}>
          <i /> {connected ? "Account linked" : "Not linked"}
        </span>
      </header>

      {!connected ? (
        <div className={styles.connectBody}>
          <div className={styles.connectGlyph}>↗</div>
          <div className={styles.connectCopy}>
            <strong>Connect your Deriv cTrader account</strong>
            <span>You&apos;ll authorize access on cTrader, then return here. TradeBridge never asks for your cTrader password.</span>
          </div>
          <button type="button" className={styles.primaryButton} disabled={loading || busy} onClick={() => { window.location.href = "/api/auth/ctrader/start"; }}>
            {loading ? "Checking connection…" : "Connect cTrader"}
          </button>
        </div>
      ) : (
        <div className={styles.tradeBody}>
          <div className={styles.accountRow}>
            <label className={styles.field}>
              <span>TRADING ACCOUNT</span>
              <select value={accountId} onChange={(event) => setAccountId(event.target.value)} disabled={busy}>
                {accounts.map((account) => (
                  <option key={account.account_id} value={account.account_id}>
                    {(account.account_type === "demo" ? "Demo" : "Real · read-only")}{account.broker_title_short ? " · " + account.broker_title_short : ""}{account.trader_login ? " · " + account.trader_login : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.scopeInfo}>
              <span>PERMISSION</span>
              <strong>{permissionScope === "trading" ? "Trading access" : "View only"}</strong>
            </div>
            <button className={styles.textButton} type="button" onClick={disconnect} disabled={busy}>Disconnect</button>
          </div>

          {activeAccount?.account_type === "live" && (
            <div className={styles.warning}>
              <strong>Real account — view only</strong>
              <span>Live-money order execution is locked. Select a Demo account for order testing.</span>
            </div>
          )}
          {permissionScope !== "trading" && (
            <div className={styles.warning}>
              <strong>View-only authorization</strong>
              <span>Reconnect and approve the trading permission before submitting even demo orders.</span>
            </div>
          )}

          <div className={styles.orderGrid}>
            <label className={styles.field}>
              <span>FOREX SYMBOL · cTRADER CATALOGUE</span>
              <select value={symbolId ?? ""} onChange={(event) => setSymbolId(Number(event.target.value))} disabled={!symbols.length || busy}>
                {symbols.map((symbol) => <option key={symbol.symbol_id} value={symbol.symbol_id}>{symbol.symbol_name}</option>)}
              </select>
            </label>
            <div className={styles.field}>
              <span>ORDER SIDE</span>
              <div className={styles.sideButtons}>
                <button className={side === "BUY" ? styles.buyActive : styles.buyButton} type="button" onClick={() => setSide("BUY")} aria-pressed={side === "BUY"} disabled={busy}>Buy</button>
                <button className={side === "SELL" ? styles.sellActive : styles.sellButton} type="button" onClick={() => setSide("SELL")} aria-pressed={side === "SELL"} disabled={busy}>Sell</button>
              </div>
            </div>
            <label className={styles.field}>
              <span>VOLUME · BASE-CURRENCY UNITS</span>
              <input type="number" min="0.01" step="0.01" value={volume} onChange={(event) => setVolume(event.target.value)} disabled={busy} inputMode="decimal" />
            </label>
          </div>

          <section className={styles.quoteCard} aria-label="Live cTrader bid and ask">
            <div className={styles.quoteHeader}>
              <div>
                <strong>cTrader live quote</strong>
                <span>Bid is the sell price · Ask is the buy price</span>
              </div>
              <button type="button" className={styles.textButton} onClick={() => setQuoteRevision((value) => value + 1)} disabled={busy || quoteLoading || !activeAccount || !activeSymbol}>
                {quoteLoading ? "Refreshing…" : "Refresh quote"}
              </button>
            </div>
            {quote ? (
              <>
                <div className={styles.quoteValues}>
                  <div className={styles.quoteItem}>
                    <span>BID · SELL</span>
                    <strong>{quote.bid.toFixed(quote.digits)}</strong>
                  </div>
                  <div className={styles.quoteItem}>
                    <span>ASK · BUY</span>
                    <strong>{quote.ask.toFixed(quote.digits)}</strong>
                  </div>
                  <div className={styles.spreadItem}>
                    <span>SPREAD</span>
                    <strong>{quote.spread.toFixed(quote.digits)}</strong>
                    <small>{quote.spread_pips.toFixed(2)} pips</small>
                  </div>
                </div>
                <div className={styles.quoteFoot}>
                  <span>Received {new Date(quote.received_at).toLocaleTimeString()}</span>
                  <span>{quote.quote_age_seconds === null
                    ? "Provider timestamp unavailable · refresh before confirming"
                    : quote.quote_age_seconds > 15 || (quoteReceivedAt !== null && Date.now() - quoteReceivedAt > 15_000)
                      ? "Stale quote · refresh before confirming"
                      : "Provider quote age " + quote.quote_age_seconds.toFixed(1) + "s"}</span>
                </div>
              </>
            ) : (
              <div className={styles.quoteEmpty}>
                <span>{quoteLoading ? "Requesting bid/ask from the linked cTrader account…" : "No cTrader quote available. Refresh before placing an order."}</span>
              </div>
            )}
          </section>

          <div className={styles.orderNotice}>
            <span className={styles.marketIcon}>◎</span>
            <div>
              <strong>Market order · Demo only</strong>
              <span>Executed at cTrader&apos;s available market price. The chart price may differ; spread and slippage apply. Volume limits are rechecked by the backend.</span>
            </div>
          </div>

          <label className={styles.confirmLine}>
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy || !selectedAccountIsDemo || permissionScope !== "trading" || !quote || quoteLoading || quote.quote_age_seconds === null || quote.quote_age_seconds > 15 || (quoteReceivedAt !== null && Date.now() - quoteReceivedAt > 15_000)} />
            <span>I confirm this is a demo order for <strong>{activeSymbol?.symbol_name ?? "the selected Forex pair"}</strong>, <strong>{side}</strong>, volume <strong>{volume || "—"}</strong> units.</span>
          </label>

          <div className={styles.actions}>
            <button type="button" className={side === "BUY" ? styles.primaryButton : styles.dangerButton} disabled={busy || !selectedAccountIsDemo || permissionScope !== "trading" || !activeSymbol || !confirmed} onClick={submitOrder}>
              {busy ? "Sending to cTrader…" : `Confirm Demo ${side}`}
            </button>
            <span className={styles.secondaryText}>Real-money orders are disabled.</span>
          </div>

          {lastOrderKey && (
            <div className={styles.orderResult}>
              <div>
                <strong>Order request · {lastOrder?.status ?? "Needs verification"}</strong>
                <span>Reference: {lastOrderKey}</span>
                {lastOrder?.order_id && <span>cTrader order ID: {lastOrder.order_id}</span>}
                {lastOrder?.position_id && <span>Position ID: {lastOrder.position_id}</span>}
              </div>
              <button className={styles.textButton} type="button" disabled={statusLoading} onClick={checkOrderStatus}>{statusLoading ? "Checking…" : "Check status"}</button>
            </div>
          )}
        </div>
      )}

      {notice && <div className={styles.message} data-kind={noticeKind} role="status">{notice}</div>}
    </section>
  );
}
