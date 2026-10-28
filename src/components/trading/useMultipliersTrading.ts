"use client";

import { useEffect, useRef, useState } from "react";
import type { AccountActivity, DerivAccount, OpenPosition } from "./types";
import {
  clearOrderResolution as clearStoredOrderResolution,
  readOrderResolution as readStoredOrderResolution,
  writeOrderResolution as writeStoredOrderResolution,
} from "./order-resolution.mjs";
import { mergeActivityRows, numeric, statementHasMore, statementPageLimit, STATEMENT_PAGE_SIZE, toActivity, toPosition } from "./activity-helpers.mjs";
import { createClient as createSupabaseBrowserClient } from "../../lib/supabase/client";

export type MultipliersQuote = {
  id: string;
  askPrice: number;
  symbol: string;
  direction: "MULTUP" | "MULTDOWN";
  stake: number;
  multiplier: number;
  currency: string;
  takeProfit?: number;
  stopLoss?: number;
  cancellation?: string;
  receivedAt: number;
};

export type MultipliersInput = Omit<MultipliersQuote, "id" | "askPrice" | "receivedAt">;

type ApiMessage = {
  type?: string;
  enabled?: boolean;
  account_type?: string;
  msg_type?: string;
  req_id?: number;
  error?: { code?: string; message?: string };
  balance?: { balance?: number | string; currency?: string };
  portfolio?: { contracts?: Array<Record<string, unknown>> };
  statement?: { count?: number; transactions?: Array<Record<string, unknown>> };
  profit_table?: { transactions?: Array<Record<string, unknown>> };
  transaction?: Record<string, unknown>;
  proposal?: { id?: string | number; ask_price?: number | string };
  buy?: { contract_id?: string | number };
  sell?: { contract_id?: string | number };
  proposal_open_contract?: Record<string, unknown>;
};

function localDayStart(): number {
  const now = new Date();
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
}

const browserStorage = () => window.localStorage;
const readOrderResolution = (key: string | null) => readStoredOrderResolution(browserStorage, key);
const writeOrderResolution = (key: string | null, value: "pending" | "unknown") => writeStoredOrderResolution(browserStorage, key, value);
const clearOrderResolution = (key: string | null) => clearStoredOrderResolution(browserStorage, key);

export function useMultipliersTrading(
  enabled: boolean,
  connected: boolean,
  account: DerivAccount | null,
  realTradingEnabled: boolean,
  maxRealStake: number,
  maxDailyLoss: number,
) {
  const [sessionState, setSessionState] = useState("Multipliers connection is not active");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<MultipliersQuote | null>(null);
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [activity, setActivity] = useState<AccountActivity[]>([]);
  const [balance, setBalance] = useState<{ balance: number | null; currency: string }>({ balance: null, currency: "" });
  const [realizedProfit, setRealizedProfit] = useState<number | null>(null);
  const [activityHasMore, setActivityHasMore] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [orderResolutionRequired, setOrderResolutionRequired] = useState(true);
  const [realSessionConfirmed, setRealSessionConfirmed] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const requestIdRef = useRef(300_000);
  const proposalRequestRef = useRef<number | null>(null);
  const buyRequestRef = useRef<number | null>(null);
  const sellRequestRef = useRef<{ id: number; contractId: string } | null>(null);
  const statementRequestRef = useRef<{ id: number; offset: number; limit: number } | null>(null);
  const pendingBuyContractRef = useRef<string | null>(null);
  const subscribedContractIdsRef = useRef(new Set<string>());
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef<(() => void) | null>(null);
  const pendingQuoteRef = useRef<MultipliersInput | null>(null);
  const loadedStatementCountRef = useRef(STATEMENT_PAGE_SIZE);
  const orderResolutionKey = account?.account_id ? `tradebridge:order-resolution-required:${account.account_id}` : null;

  useEffect(() => {
    setOrderResolutionRequired(Boolean(orderResolutionKey && readOrderResolution(orderResolutionKey)));
  }, [orderResolutionKey]);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    let refreshTimer: number | null = null;
    let pingTimer: number | null = null;

    const clearRequestTimer = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    };
    const nextId = () => ++requestIdRef.current;
    const send = (payload: Record<string, unknown>) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
    };
    const refresh = () => {
      send({ balance: 1, subscribe: 1, req_id: nextId() });
      send({ portfolio: 1, req_id: nextId() });
      send({ profit_table: 1, description: 1, limit: 5000, date_from: localDayStart(), date_to: Math.floor(Date.now() / 1000), req_id: nextId() });
      if (!statementRequestRef.current) {
        const id = nextId();
        const limit = statementPageLimit(loadedStatementCountRef.current);
        statementRequestRef.current = { id, offset: 0, limit };
        setActivityLoading(true);
        send({ statement: 1, limit, offset: 0, description: 1, req_id: id });
      }
    };
    refreshRef.current = refresh;

    const accountType = (account?.account_type ?? "").toLowerCase();
    const isRealAccount = accountType === "real";
    setRealSessionConfirmed(false);
    setQuote(null);
    setPositions([]);
    setActivity([]);
    setActivityHasMore(false);
    setActivityLoading(false);
    setRealizedProfit(null);
    setBalance({ balance: account?.balance ?? null, currency: account?.currency ?? "" });
    loadedStatementCountRef.current = STATEMENT_PAGE_SIZE;
    setBusy(false);

    if (!enabled || !connected || !account || !["demo", "real"].includes(accountType)) {
      setSessionState("Multipliers connection is not active");
      refreshRef.current = null;
      return () => { cancelled = true; clearRequestTimer(); };
    }

    if (isRealAccount && !realTradingEnabled) {
      setSessionState("Real account connected in read-only mode");
    } else {
      setSessionState("Opening secure Multipliers session");
    }

    async function connect() {
      try {
        const backendWs = process.env.NEXT_PUBLIC_TRADEBRIDGE_BACKEND_WS_URL?.trim();
        if (!backendWs) throw new Error("Configure the backend WebSocket URL before connecting.");
        const wsUrl = new URL(backendWs);
        wsUrl.pathname = wsUrl.pathname.replace(/\/deriv\/ws\/?$/, "") + "/deriv/multipliers/ws";
        wsUrl.search = "";
        wsUrl.searchParams.set("account_id", account.account_id);
        const backendOrigin = new URL(backendWs);
        backendOrigin.protocol = backendOrigin.protocol === "wss:" ? "https:" : "http:";
        backendOrigin.pathname = backendOrigin.pathname.replace(/\/deriv\/ws\/?$/, "") + "/deriv/ws-ticket";
        backendOrigin.search = "";

        const supabase = createSupabaseBrowserClient();
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (sessionError || !accessToken) throw new Error("Sign in again before opening the Multipliers session.");
        const ticketResponse = await fetch(backendOrigin.toString(), {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        const ticketData = await ticketResponse.json() as { ticket?: string };
        if (!ticketResponse.ok || !ticketData.ticket) throw new Error("The backend could not authorize a Multipliers session.");

        socket = new WebSocket(wsUrl.toString(), ["tradebridge", ticketData.ticket]);
        socketRef.current = socket;
        socket.onopen = () => {
          if (cancelled) return;
          setSessionState(isRealAccount && !realTradingEnabled
            ? "Real account connected in read-only mode"
            : "Authenticating Multipliers account");
          if (isRealAccount && realTradingEnabled) {
            send({ real_trading: { action: "confirm", confirmation: "ENABLE REAL TRADING" } });
          }
          pingTimer = window.setInterval(() => send({ ping: 1 }), 30_000);
        };
        socket.onmessage = (event) => {
          if (cancelled) return;
          let message: ApiMessage;
          try { message = JSON.parse(event.data) as ApiMessage; }
          catch { setStatus("The backend returned an unreadable Multipliers message."); return; }

          if (message.type === "multipliers_connection_status") {
            if (!isRealAccount || !realTradingEnabled) {
              setSessionState(isRealAccount ? "Real account connected in read-only mode" : "Demo trading connected");
              refresh();
              refreshTimer = window.setInterval(refresh, 15_000);
            }
            return;
          }
          if (message.type === "real_trading_status") {
            if (message.enabled && message.account_type === "real") {
              setRealSessionConfirmed(true);
              setSessionState("Real trading connected");
              setStatus("Real account consent and server risk controls are active.");
              refresh();
              refreshTimer = window.setInterval(refresh, 15_000);
            }
            return;
          }
          if (message.error) {
            const errorId = message.req_id;
            if (errorId === proposalRequestRef.current) {
              proposalRequestRef.current = null;
              clearRequestTimer();
              setBusy(false);
            } else if (errorId === buyRequestRef.current) {
              buyRequestRef.current = null;
              clearRequestTimer();
              if (orderResolutionKey) clearOrderResolution(orderResolutionKey);
              setOrderResolutionRequired(false);
              setBusy(false);
            } else if (errorId === sellRequestRef.current?.id) {
              sellRequestRef.current = null;
              clearRequestTimer();
              setBusy(false);
            }
            if (message.error.code?.startsWith("REAL_")) {
              setRealSessionConfirmed(false);
              setSessionState("Real trading authorization unavailable");
            }
            setStatus(message.error.message ?? "Deriv rejected the Multipliers request.");
            return;
          }
          if (message.msg_type === "balance" && message.balance) {
            setBalance({ balance: numeric(message.balance.balance), currency: message.balance.currency ?? account.currency ?? "" });
          } else if (message.msg_type === "portfolio" && message.portfolio) {
            const nextPositions = (message.portfolio.contracts ?? []).map(toPosition).filter((position): position is OpenPosition => Boolean(position));
            setPositions(nextPositions);
            for (const position of nextPositions) {
              if (subscribedContractIdsRef.current.has(position.contractId)) continue;
              subscribedContractIdsRef.current.add(position.contractId);
              send({ proposal_open_contract: 1, contract_id: Number(position.contractId), subscribe: 1, req_id: nextId() });
            }
          } else if (message.msg_type === "profit_table" && message.profit_table) {
            const profits = (message.profit_table.transactions ?? []).map((item) => numeric(item.profit)).filter((value): value is number => value !== null);
            setRealizedProfit(profits.reduce((sum, value) => sum + value, 0));
          } else if (message.msg_type === "statement" && message.statement) {
            const request = statementRequestRef.current;
            if (!request || request.id !== message.req_id) return;
            statementRequestRef.current = null;
            setActivityLoading(false);
            const rawRows = message.statement.transactions ?? [];
            const rows = rawRows.map(toActivity).filter((item): item is AccountActivity => Boolean(item));
            setActivity((current) => {
              const next = request.offset === 0 ? mergeActivityRows([], rows) : mergeActivityRows(current, rows);
              loadedStatementCountRef.current = Math.max(STATEMENT_PAGE_SIZE, next.length);
              return next;
            });
            setActivityHasMore(statementHasMore(message.statement.count, request.offset, rawRows.length, request.limit));
          } else if (message.msg_type === "transaction" && message.transaction) {
            const row = toActivity(message.transaction);
            if (row) setActivity((current) => mergeActivityRows([row, ...current], []));
          } else if (message.msg_type === "proposal" && message.proposal && proposalRequestRef.current === message.req_id) {
            proposalRequestRef.current = null;
            clearRequestTimer();
            const id = message.proposal.id === undefined ? "" : String(message.proposal.id);
            const askPrice = numeric(message.proposal.ask_price);
            setBusy(false);
            if (!id || askPrice === null || askPrice <= 0) {
              setStatus("Deriv returned an invalid Multipliers quote. Request a fresh quote.");
              return;
            }
            setQuote({ ...pendingQuoteRef.current!, id, askPrice, receivedAt: Date.now() });
            pendingQuoteRef.current = null;
            setStatus("Quote received. Review the stake, multiplier, and protection settings before confirming.");
          } else if (message.msg_type === "buy" && message.buy && buyRequestRef.current === message.req_id) {
            buyRequestRef.current = null;
            clearRequestTimer();
            const contractId = String(message.buy.contract_id ?? "");
            if (!/^\d+$/.test(contractId)) {
              if (orderResolutionKey) writeOrderResolution(orderResolutionKey, "unknown");
              setOrderResolutionRequired(true);
              setBusy(false);
              setStatus("Deriv did not confirm the contract ID. Reconcile account activity before trying again.");
              refresh();
              return;
            }
            pendingBuyContractRef.current = contractId;
            if (orderResolutionKey) clearOrderResolution(orderResolutionKey);
            setOrderResolutionRequired(false);
            setQuote(null);
            setBusy(false);
            setStatus(`Multipliers contract ${contractId} accepted. Waiting for Deriv updates…`);
            send({ proposal_open_contract: 1, contract_id: Number(contractId), subscribe: 1, req_id: nextId() });
            refresh();
          } else if (message.msg_type === "sell" && message.sell && sellRequestRef.current?.id === message.req_id) {
            const expected = sellRequestRef.current.contractId;
            sellRequestRef.current = null;
            clearRequestTimer();
            setBusy(false);
            if (String(message.sell.contract_id ?? "") !== expected) {
              if (orderResolutionKey) writeOrderResolution(orderResolutionKey, "unknown");
              setOrderResolutionRequired(true);
              setStatus("Deriv’s sale response did not match the selected contract. Reconcile it before further orders.");
              return;
            }
            setStatus(`Contract ${expected} sold. Refreshing account activity.`);
            refresh();
          } else if (message.msg_type === "proposal_open_contract" && message.proposal_open_contract) {
            const position = toPosition(message.proposal_open_contract);
            if (position) {
              if (position.status === "open") {
                setPositions((current) => [position, ...current.filter((item) => item.contractId !== position.contractId)]);
              } else {
                setPositions((current) => current.filter((item) => item.contractId !== position.contractId));
                const subscriptionId = (message.proposal_open_contract.subscription as { id?: string } | undefined)?.id
                  ?? (message as ApiMessage & { subscription?: { id?: string } }).subscription?.id;
                if (subscriptionId) send({ forget: subscriptionId, req_id: nextId() });
                subscribedContractIdsRef.current.delete(position.contractId);
                refresh();
              }
            }
          }
        };
        socket.onerror = () => {
          if (!cancelled) setStatus("Multipliers connection failed. Check the backend connection and account permissions.");
        };
        socket.onclose = () => {
          if (refreshTimer !== null) window.clearInterval(refreshTimer);
          if (pingTimer !== null) window.clearInterval(pingTimer);
          if (socketRef.current === socket) socketRef.current = null;
          if (!cancelled) setSessionState("Multipliers connection closed. Reconnect to continue.");
        };
      } catch (error) {
        if (!cancelled) {
          setSessionState("Multipliers connection unavailable");
          setStatus(error instanceof Error ? error.message : "Could not open the Multipliers session.");
        }
      }
    }

    void connect();
    return () => {
      cancelled = true;
      if (refreshTimer !== null) window.clearInterval(refreshTimer);
      if (pingTimer !== null) window.clearInterval(pingTimer);
      clearRequestTimer();
      if (orderResolutionKey && buyRequestRef.current !== null) writeOrderResolution(orderResolutionKey, "unknown");
      if (socketRef.current === socket) socketRef.current = null;
      socket?.close();
      refreshRef.current = null;
    };
  }, [enabled, connected, account, account?.account_id, account?.account_type, account?.currency, account?.balance, realTradingEnabled, orderResolutionKey]);

  const sessionReady = sessionState === "Demo trading connected" || sessionState === "Real trading connected";
  const canTrade = enabled && connected && sessionReady && account
    && ((account.account_type ?? "").toLowerCase() === "demo" || (realTradingEnabled && realSessionConfirmed));

  function requestQuote(input: MultipliersInput) {
    if (!canTrade || !account || orderResolutionRequired || busy || buyRequestRef.current !== null || sellRequestRef.current !== null) {
      setStatus("Multipliers order entry is unavailable until the account session and risk checks are ready.");
      return;
    }
    const isReal = (account.account_type ?? "").toLowerCase() === "real";
    const cap = isReal ? maxRealStake : 1000;
    if (!Number.isFinite(input.stake) || input.stake < 1 || input.stake > cap) {
      setStatus(`Enter a stake from 1 to ${cap} ${account.currency ?? "USD"}.`);
      return;
    }
    if (isReal && (realizedProfit === null || realizedProfit <= -maxDailyLoss)) {
      setStatus(realizedProfit === null ? "Waiting for today's account P/L before allowing a Real quote." : "The configured daily loss stop has been reached.");
      return;
    }
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    setBusy(true);
    setQuote(null);
    setStatus("Requesting a fresh Multipliers quote…");
    const reqId = ++requestIdRef.current;
    proposalRequestRef.current = reqId;
    pendingQuoteRef.current = input;
    const limitOrder: Record<string, number> = {};
    if (input.takeProfit !== undefined) limitOrder.take_profit = input.takeProfit;
    if (input.stopLoss !== undefined) limitOrder.stop_loss = input.stopLoss;
    socket.send(JSON.stringify({
      proposal: 1,
      amount: input.stake,
      basis: "stake",
      contract_type: input.direction,
      currency: input.currency,
      symbol: input.symbol,
      multiplier: input.multiplier,
      ...(Object.keys(limitOrder).length ? { limit_order: limitOrder } : {}),
      ...(input.cancellation ? { cancellation: input.cancellation } : {}),
      req_id: reqId,
    }));
    timeoutRef.current = setTimeout(() => {
      if (proposalRequestRef.current !== reqId) return;
      proposalRequestRef.current = null;
      pendingQuoteRef.current = null;
      setBusy(false);
      setStatus("Deriv did not return a quote before timeout. Request a fresh quote.");
    }, 15_000);
  }

  function confirmQuote() {
    const socket = socketRef.current;
    if (!quote || !socket || socket.readyState !== WebSocket.OPEN || busy || !canTrade || orderResolutionRequired) return;
    if (Date.now() - quote.receivedAt > 30_000) {
      setQuote(null);
      setStatus("This quote expired. Request a fresh Multipliers quote.");
      return;
    }
    if ((account?.account_type ?? "").toLowerCase() === "real"
      && (quote.stake > maxRealStake || realizedProfit === null || realizedProfit <= -maxDailyLoss)) {
      setQuote(null);
      setStatus("The current Real stake or daily-loss limit no longer permits this order.");
      return;
    }
    const reqId = ++requestIdRef.current;
    buyRequestRef.current = reqId;
    if (orderResolutionKey) writeOrderResolution(orderResolutionKey, "pending");
    setOrderResolutionRequired(true);
    setBusy(true);
    setStatus("Submitting the confirmed Multipliers contract…");
    socket.send(JSON.stringify({ buy: quote.id, price: quote.askPrice, req_id: reqId }));
    setQuote(null);
    timeoutRef.current = setTimeout(() => {
      if (buyRequestRef.current !== reqId) return;
      buyRequestRef.current = null;
      if (orderResolutionKey) writeOrderResolution(orderResolutionKey, "unknown");
      setOrderResolutionRequired(true);
      setBusy(false);
      setStatus("Deriv did not confirm the buy. Reconcile account activity before retrying.");
      refreshRef.current?.();
    }, 20_000);
  }

  function dismissQuote() {
    if (busy) return;
    setQuote(null);
    setStatus("Quote dismissed; no contract was purchased.");
  }

  function sellPosition(contractId: string) {
    if (orderResolutionRequired || busy || !positions.some((position) => position.contractId === contractId)) return;
    if (!window.confirm(`Sell Multipliers contract ${contractId} at the current market price?`)) return;
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const reqId = ++requestIdRef.current;
    sellRequestRef.current = { id: reqId, contractId };
    setBusy(true);
    setStatus(`Requesting market sale for contract ${contractId}…`);
    socket.send(JSON.stringify({ sell: Number(contractId), price: 0, req_id: reqId }));
    timeoutRef.current = setTimeout(() => {
      if (sellRequestRef.current?.id !== reqId) return;
      sellRequestRef.current = null;
      if (orderResolutionKey) writeOrderResolution(orderResolutionKey, "unknown");
      setOrderResolutionRequired(true);
      setBusy(false);
      setStatus("Deriv did not confirm the sale. Reconcile the contract before further orders.");
      refreshRef.current?.();
    }, 20_000);
  }

  function acknowledgeOrderResolution() {
    if (!orderResolutionRequired) return;
    const confirmed = window.confirm("Reconcile the contract and statement directly in Deriv before unlocking. Continue only after its outcome is known.");
    if (!confirmed) return;
    if (orderResolutionKey) clearOrderResolution(orderResolutionKey);
    setOrderResolutionRequired(false);
    setStatus("Reconciliation acknowledged. Request a fresh quote before trading.");
  }

  function refreshAccount() {
    refreshRef.current?.();
  }

  function loadMoreActivity() {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || activityLoading || !activityHasMore || statementRequestRef.current) return;
    const offset = activity.length;
    const limit = STATEMENT_PAGE_SIZE;
    const id = ++requestIdRef.current;
    statementRequestRef.current = { id, offset, limit };
    setActivityLoading(true);
    socket.send(JSON.stringify({ statement: 1, limit, offset, description: 1, req_id: id }));
  }

  return {
    sessionState, status, busy, quote, positions, activity, balance, realizedProfit,
    orderResolutionRequired, activityHasMore, activityLoading, requestQuote, confirmQuote,
    dismissQuote, sellPosition, acknowledgeOrderResolution, refreshAccount, loadMoreActivity,
    realSessionConfirmed,
  };
}