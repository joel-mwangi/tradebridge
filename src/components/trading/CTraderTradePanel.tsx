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
type CTraderPosition = {
  position_id: string;
  symbol_id: number;
  symbol_name: string;
  side: "BUY" | "SELL" | "UNKNOWN";
  volume_units: number;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  net_unrealized_pnl: number | null;
  pnl_currency_digits: number | null;
  opened_at: number | string | null;
  last_updated_at: number | string | null;
  used_margin: number | string | null;
};
type CTraderPendingOrder = {
  order_id: string;
  symbol_id: number | null;
  symbol_name: string;
  side: "BUY" | "SELL";
  volume_units: number | null;
  order_type: number | string | null;
  limit_price: number | string | null;
  stop_price: number | string | null;
};
type PositionDraft = { stop_loss: string; take_profit: string; partial_close: string };
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
  const [positions, setPositions] = useState<CTraderPosition[]>([]);
  const [pendingOrders, setPendingOrders] = useState<CTraderPendingOrder[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [positionsRetrievedAt, setPositionsRetrievedAt] = useState("");
  const [positionActionBusyId, setPositionActionBusyId] = useState<string | null>(null);
  const [protectionDrafts, setProtectionDrafts] = useState<Record<string, PositionDraft>>({});

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

  const refreshPositions = useCallback(async (quiet = false) => {
    if (!connected || !accountId) {
      setPositions([]);
      setPendingOrders([]);
      setPositionsRetrievedAt("");
      return;
    }
    if (!quiet) setPositionsLoading(true);
    try {
      const payload = await authenticatedFetch("/ctrader/positions?account_id=" + encodeURIComponent(accountId));
      setPositions(Array.isArray(payload.positions) ? payload.positions as CTraderPosition[] : []);
      setPendingOrders(Array.isArray(payload.pending_orders) ? payload.pending_orders as CTraderPendingOrder[] : []);
      setPositionsRetrievedAt(typeof payload.retrieved_at === "string" ? payload.retrieved_at : "");
    } catch (error) {
      if (!quiet) {
        setNotice(error instanceof Error ? error.message : "Could not refresh cTrader positions.");
        setNoticeKind("error");
      }
    } finally {
      if (!quiet) setPositionsLoading(false);
    }
  }, [connected, accountId, authenticatedFetch]);

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

  useEffect(() => {
    setProtectionDrafts({});
    if (!connected || !accountId) {
      setPositions([]);
      setPendingOrders([]);
      setPositionsRetrievedAt("");
      return;
    }
    void refreshPositions(false);
    const refreshTimer = window.setInterval(() => { void refreshPositions(true); }, 15_000);
    return () => window.clearInterval(refreshTimer);
  }, [connected, accountId, refreshPositions]);

  function positionDraft(position: CTraderPosition): PositionDraft {
    return protectionDrafts[position.position_id] ?? {
      stop_loss: position.stop_loss === null ? "" : String(position.stop_loss),
      take_profit: position.take_profit === null ? "" : String(position.take_profit),
      partial_close: "",
    };
  }

  function updatePositionDraft(positionId: string, field: keyof PositionDraft, value: string, position?: CTraderPosition) {
    setProtectionDrafts((current) => {
      const existing = current[positionId] ?? {
        stop_loss: position?.stop_loss === null || position?.stop_loss === undefined ? "" : String(position.stop_loss),
        take_profit: position?.take_profit === null || position?.take_profit === undefined ? "" : String(position.take_profit),
        partial_close: "",
      };
      return { ...current, [positionId]: { ...existing, [field]: value } };
    });
  }

  async function savePositionProtection(position: CTraderPosition) {
    if (!selectedAccountIsDemo || permissionScope !== "trading") return;
    const draft = positionDraft(position);
    const enteredStopLoss = draft.stop_loss.trim() === "" ? undefined : Number(draft.stop_loss);
    const enteredTakeProfit = draft.take_profit.trim() === "" ? undefined : Number(draft.take_profit);
    const stopLoss = enteredStopLoss !== undefined
      && (position.stop_loss === null || enteredStopLoss !== position.stop_loss)
      ? enteredStopLoss : undefined;
    const takeProfit = enteredTakeProfit !== undefined
      && (position.take_profit === null || enteredTakeProfit !== position.take_profit)
      ? enteredTakeProfit : undefined;
    if ((stopLoss === undefined && takeProfit === undefined)
      || (stopLoss !== undefined && (!Number.isFinite(stopLoss) || stopLoss <= 0))
      || (takeProfit !== undefined && (!Number.isFinite(takeProfit) || takeProfit <= 0))) {
      setNotice("Enter a valid changed stop-loss and/or take-profit price. Do not clear a protection level in this version.");
      setNoticeKind("error");
      return;
    }
    const changes = [
      stopLoss !== undefined ? "SL " + stopLoss : "",
      takeProfit !== undefined ? "TP " + takeProfit : "",
    ].filter(Boolean).join(" · ");
    if (!window.confirm("Apply protection changes to " + position.symbol_name + " position #" + position.position_id + "?\n" + changes + "\nThe broker will validate the price levels.")) return;
    setPositionActionBusyId(position.position_id);
    try {
      const payload = await authenticatedFetch("/ctrader/positions/" + encodeURIComponent(position.position_id) + "/protection", {
        method: "POST",
        body: JSON.stringify({
          account_id: accountId,
          idempotency_key: window.crypto.randomUUID().replace(/-/g, ""),
          confirmed: true,
          ...(stopLoss !== undefined ? { stop_loss: stopLoss } : {}),
          ...(takeProfit !== undefined ? { take_profit: takeProfit } : {}),
        }),
      });
      setNotice(typeof payload.message === "string" ? payload.message : "cTrader acknowledged the protection change.");
      setNoticeKind("success");
      setProtectionDrafts((current) => {
        const next = { ...current };
        delete next[position.position_id];
        return next;
      });
      await refreshPositions(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not change position protection.");
      setNoticeKind("error");
    } finally {
      setPositionActionBusyId(null);
    }
  }

  async function closePosition(position: CTraderPosition, partial: boolean) {
    if (!selectedAccountIsDemo || permissionScope !== "trading") return;
    const draft = positionDraft(position);
    const closeVolume = partial ? Number(draft.partial_close) : undefined;
    if (partial && (closeVolume === undefined || !Number.isFinite(closeVolume) || closeVolume <= 0 || closeVolume >= position.volume_units)) {
      setNotice("Partial-close volume must be positive and smaller than the open position volume.");
      setNoticeKind("error");
      return;
    }
    const confirmation = partial
      ? "Close " + closeVolume + " units of " + position.symbol_name + " position #" + position.position_id + "?"
      : "Close the FULL " + position.symbol_name + " position #" + position.position_id + " (" + position.volume_units + " units) at the available market price?";
    if (!window.confirm(confirmation + "\nThis submits a real provider action on the selected DEMO account only.")) return;
    setPositionActionBusyId(position.position_id);
    try {
      const payload = await authenticatedFetch("/ctrader/positions/" + encodeURIComponent(position.position_id) + "/close", {
        method: "POST",
        body: JSON.stringify({
          account_id: accountId,
          idempotency_key: window.crypto.randomUUID().replace(/-/g, ""),
          confirmed: true,
          ...(partial && closeVolume !== undefined ? { volume_units: closeVolume } : {}),
        }),
      });
      setNotice(typeof payload.message === "string" ? payload.message : "cTrader acknowledged the close request.");
      setNoticeKind("success");
      setProtectionDrafts((current) => {
        const next = { ...current };
        delete next[position.position_id];
        return next;
      });
      await refreshPositions(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not close the position.");
      setNoticeKind("error");
    } finally {
      setPositionActionBusyId(null);
    }
  }

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
              <select value={accountId} onChange={(event) => { setAccountId(event.target.value); setConfirmed(false); setQuote(null); setQuoteReceivedAt(null); }} disabled={busy}>
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
              <select value={symbolId ?? ""} onChange={(event) => { setSymbolId(Number(event.target.value)); setConfirmed(false); setQuote(null); setQuoteReceivedAt(null); }} disabled={!symbols.length || busy}>
                {symbols.map((symbol) => <option key={symbol.symbol_id} value={symbol.symbol_id}>{symbol.symbol_name}</option>)}
              </select>
            </label>
            <div className={styles.field}>
              <span>ORDER SIDE</span>
              <div className={styles.sideButtons}>
                <button className={side === "BUY" ? styles.buyActive : styles.buyButton} type="button" onClick={() => { setSide("BUY"); setConfirmed(false); }} aria-pressed={side === "BUY"} disabled={busy}>Buy</button>
                <button className={side === "SELL" ? styles.sellActive : styles.sellButton} type="button" onClick={() => { setSide("SELL"); setConfirmed(false); }} aria-pressed={side === "SELL"} disabled={busy}>Sell</button>
              </div>
            </div>
            <label className={styles.field}>
              <span>VOLUME · BASE-CURRENCY UNITS</span>
              <input type="number" min="0.01" step="0.01" value={volume} onChange={(event) => { setVolume(event.target.value); setConfirmed(false); }} disabled={busy} inputMode="decimal" />
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

          <section className={styles.positionSection} aria-label="Open cTrader positions">
            <header className={styles.positionHeader}>
              <div>
                <span className={styles.eyebrow}>POSITION MANAGEMENT</span>
                <h3>Open positions</h3>
                <p>Position data and P/L are retrieved from cTrader. The view refreshes every 15 seconds.</p>
              </div>
              <button className={styles.textButton} type="button" onClick={() => { void refreshPositions(false); }} disabled={positionsLoading || Boolean(positionActionBusyId)}>
                {positionsLoading ? "Refreshing…" : "Refresh positions"}
              </button>
            </header>
            {!selectedAccountIsDemo && (
              <div className={styles.warning}>
                <strong>Live account · view only</strong>
                <span>Positions can be inspected, but all TradeBridge position-changing actions remain locked for live accounts.</span>
              </div>
            )}
            {positionsLoading && positions.length === 0 ? (
              <div className={styles.positionEmpty}>Loading positions from cTrader…</div>
            ) : positions.length === 0 ? (
              <div className={styles.positionEmpty}>
                <strong>No open positions on this account</strong>
                <span>Open a demo trade above to test position monitoring and management.</span>
              </div>
            ) : (
              <div className={styles.positionList}>
                {positions.map((position) => {
                  const draft = positionDraft(position);
                  const protectionChanged = (draft.stop_loss.trim() !== "" && draft.stop_loss !== (position.stop_loss === null ? "" : String(position.stop_loss)))
                    || (draft.take_profit.trim() !== "" && draft.take_profit !== (position.take_profit === null ? "" : String(position.take_profit)));
                  const actionDisabled = !selectedAccountIsDemo || permissionScope !== "trading" || Boolean(positionActionBusyId);
                  const priceDigits = position.symbol_name.toUpperCase().includes("JPY") ? 3 : 5;
                  return (
                    <article className={styles.positionCard} key={position.position_id}>
                      <div className={styles.positionTop}>
                        <div className={styles.positionIdentity}>
                          <strong>{position.symbol_name}</strong>
                          <span>#{position.position_id} · {position.side} · {position.volume_units.toLocaleString()} units</span>
                        </div>
                        <div className={styles.positionPnl}>
                          <span>NET P/L · ACCOUNT CURRENCY</span>
                          <strong data-negative={position.net_unrealized_pnl !== null && position.net_unrealized_pnl < 0}>
                            {position.net_unrealized_pnl === null ? "—" : (position.net_unrealized_pnl > 0 ? "+" : "") + position.net_unrealized_pnl.toFixed(2)}
                          </strong>
                        </div>
                      </div>
                      <div className={styles.positionMetrics}>
                        <div><span>ENTRY PRICE</span><strong>{position.entry_price === null ? "—" : position.entry_price.toFixed(priceDigits)}</strong></div>
                        <div><span>STOP-LOSS</span><strong>{position.stop_loss === null ? "Not set" : position.stop_loss.toFixed(priceDigits)}</strong></div>
                        <div><span>TAKE-PROFIT</span><strong>{position.take_profit === null ? "Not set" : position.take_profit.toFixed(priceDigits)}</strong></div>
                      </div>
                      <div className={styles.positionProtectionForm}>
                        <label className={styles.field}>
                          <span>NEW STOP-LOSS PRICE</span>
                          <input type="number" inputMode="decimal" step="any" min="0.000001" placeholder="Leave blank to keep unchanged" value={draft.stop_loss} onChange={(event) => updatePositionDraft(position.position_id, "stop_loss", event.target.value, position)} disabled={Boolean(positionActionBusyId) || actionDisabled} />
                        </label>
                        <label className={styles.field}>
                          <span>NEW TAKE-PROFIT PRICE</span>
                          <input type="number" inputMode="decimal" step="any" min="0.000001" placeholder="Leave blank to keep unchanged" value={draft.take_profit} onChange={(event) => updatePositionDraft(position.position_id, "take_profit", event.target.value, position)} disabled={Boolean(positionActionBusyId) || actionDisabled} />
                        </label>
                        <button type="button" className={styles.primaryButton} onClick={() => { void savePositionProtection(position); }} disabled={actionDisabled || !protectionChanged}>
                          {positionActionBusyId === position.position_id ? "Processing…" : "Apply protection"}
                        </button>
                      </div>
                      <div className={styles.positionCloseRow}>
                        <label className={styles.field}>
                          <span>PARTIAL CLOSE · UNITS</span>
                          <input type="number" inputMode="decimal" min="0.01" step="0.01" max={Math.max(0, position.volume_units - 0.01)} placeholder="Volume to close" value={draft.partial_close} onChange={(event) => updatePositionDraft(position.position_id, "partial_close", event.target.value, position)} disabled={actionDisabled} />
                        </label>
                        <button type="button" className={styles.textButton} onClick={() => { void closePosition(position, true); }} disabled={actionDisabled || !draft.partial_close.trim()}>
                          Partial close
                        </button>
                        <button type="button" className={styles.dangerButton} onClick={() => { void closePosition(position, false); }} disabled={actionDisabled}>
                          Close full position
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {pendingOrders.length > 0 && (
              <div className={styles.pendingOrders}>
                <strong>Pending orders · {pendingOrders.length}</strong>
                {pendingOrders.map((order) => (
                  <div className={styles.pendingOrder} key={order.order_id}>
                    <span>{order.symbol_name} · {order.side} · {order.volume_units === null ? "—" : order.volume_units.toLocaleString()} units</span>
                    <small>Order #{order.order_id}{order.limit_price ? " · Limit " + order.limit_price : ""}{order.stop_price ? " · Stop " + order.stop_price : ""}</small>
                  </div>
                ))}
              </div>
            )}
            <div className={styles.positionFoot}>
              <span>{positionsRetrievedAt ? "Broker data as of " + new Date(positionsRetrievedAt).toLocaleTimeString() : "Waiting for broker position data"}</span>
              <span>{permissionScope === "trading" ? "Trading permission granted" : "View-only permission"}</span>
            </div>
          </section>
        </div>
      )}

      {notice && <div className={styles.message} data-kind={noticeKind} role="status">{notice}</div>}
    </section>
  );
}
