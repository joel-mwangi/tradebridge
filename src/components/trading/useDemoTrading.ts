"use client";

import { useEffect, useRef, useState } from "react";
import type { AccountActivity, DemoQuote, DerivAccount, OpenPosition } from "./types";

const EMPTY_BALANCE = { balance: null as number | null, currency: "" };

type TradeInput = {
  symbol: string;
  contractType: "CALL" | "PUT";
  stake: number;
  duration: number;
};

type ApiMessage = {
  msg_type?: string;
  req_id?: number;
  error?: { message?: string; code?: string };
  balance?: { balance?: number | string; currency?: string };
  portfolio?: { contracts?: Array<Record<string, unknown>> };
  statement?: { transactions?: Array<Record<string, unknown>> };
  profit_table?: { transactions?: Array<Record<string, unknown>> };
  proposal?: { id?: string; ask_price?: number | string; payout?: number | string };
  buy?: { contract_id?: number | string; buy_price?: number | string };
  proposal_open_contract?: Record<string, unknown>;
};

function numeric(value: unknown): number | null {
  const parsed = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(parsed) ? parsed : null;
}

function toPosition(raw: Record<string, unknown>): OpenPosition | null {
  const contractId = String(raw.contract_id ?? "");
  if (!contractId) return null;
  return {
    contractId,
    symbol: String(raw.underlying_symbol ?? raw.symbol ?? "—"),
    contractType: String(raw.contract_type ?? "Contract"),
    buyPrice: numeric(raw.buy_price),
    currentSpot: numeric(raw.current_spot ?? raw.current_spot_display_value),
    payout: numeric(raw.payout),
    profit: numeric(raw.profit),
    currency: String(raw.currency ?? "USD"),
    startedAt: numeric(raw.date_start ?? raw.purchase_time),
    expiresAt: numeric(raw.date_expiry ?? raw.expiry_time),
    status: String(raw.status ?? "open"),
    longcode: String(raw.longcode ?? raw.display_name ?? ""),
  };
}

function toActivity(raw: Record<string, unknown>): AccountActivity | null {
  const id = String(raw.transaction_id ?? raw.id ?? "");
  if (!id) return null;
  return {
    id,
    time: numeric(raw.transaction_time ?? raw.time ?? raw.transaction_timestamp),
    action: String(raw.action_type ?? raw.action ?? raw.type ?? "transaction"),
    description: String(raw.longcode ?? raw.description ?? raw.shortcode ?? "Account transaction"),
    amount: numeric(raw.amount),
    balance: numeric(raw.balance),
    currency: String(raw.currency ?? "USD"),
    contractId: raw.contract_id === undefined ? undefined : String(raw.contract_id),
    profit: numeric(raw.profit),
  };
}

function startOfLocalDayEpoch(): number {
  const now = new Date();
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
}

export function useDemoTrading(connected: boolean, account: DerivAccount | null) {
  const [sessionState, setSessionState] = useState("Select a verified demo account to connect trading");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<DemoQuote | null>(null);
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [activity, setActivity] = useState<AccountActivity[]>([]);
  const [balance, setBalance] = useState(EMPTY_BALANCE);
  const [realizedProfit, setRealizedProfit] = useState<number | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const sequenceRef = useRef(100);
  const quoteRequestRef = useRef<{ id: number; input: TradeInput } | null>(null);
  const buyRequestRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedContractIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    let localSocket: WebSocket | null = null;
    let refreshTimer: number | null = null;

    const clearTimeoutRef = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    };
    const nextId = () => {
      sequenceRef.current += 1;
      return sequenceRef.current;
    };
    const send = (payload: Record<string, unknown>) => {
      if (localSocket?.readyState === WebSocket.OPEN) localSocket.send(JSON.stringify(payload));
    };
    const refreshAccount = () => {
      const portfolioId = nextId();
      const statementId = nextId();
      const profitId = nextId();
      send({ portfolio: 1, req_id: portfolioId });
      send({ statement: 1, limit: 30, description: 1, req_id: statementId });
      send({
        profit_table: 1,
        description: 1,
        limit: 100,
        date_from: startOfLocalDayEpoch(),
        date_to: Math.floor(Date.now() / 1000),
        req_id: profitId,
      });
    };

    setQuote(null);
    setStatus("");
    setPositions([]);
    setActivity([]);
    setRealizedProfit(null);
    setBalance({ balance: account?.balance ?? null, currency: account?.currency ?? "" });
    quoteRequestRef.current = null;
    buyRequestRef.current = null;
    closedContractIdsRef.current.clear();
    clearTimeoutRef();

    if (!connected || !account || (account.account_type ?? "").toLowerCase() !== "demo") {
      setSessionState(!connected
        ? "Connect Deriv to enable demo trading"
        : !account
          ? "No demo account selected"
          : "Real-money accounts are disabled");
      return () => {
        cancelled = true;
        clearTimeoutRef();
      };
    }

    const activeAccount = account;
    setSessionState("Opening secure demo trading session");

    async function connect() {
      try {
        const response = await fetch("/api/auth/deriv/demo-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: activeAccount.account_id }),
          cache: "no-store",
        });
        const data = await response.json() as { url?: string; error?: string };
        if (cancelled) return;
        if (!response.ok || !data.url) {
          const message = data.error === "token_expired"
            ? "Your Deriv authorization expired. Reconnect Deriv to continue."
            : data.error === "account_linking_unavailable"
              ? "Secure account linking is unavailable. Apply the required database migrations, then retry."
              : data.error === "account_not_linked" || data.error === "account_mismatch"
                ? "This demo account is not linked to the signed-in TradeBridge user."
                : data.error === "demo_accounts_only"
                  ? "Deriv rejected this account because it is not a demo account."
                  : "Could not open the authenticated demo session. Check Deriv permissions and retry.";
          setSessionState("Demo session unavailable");
          setStatus(message);
          return;
        }

        localSocket = new WebSocket(data.url);
        socketRef.current = localSocket;

        localSocket.onopen = () => {
          if (cancelled) return;
          setSessionState("Demo trading connected");
          setStatus("Connected to your selected Deriv demo account. Quotes and balances come from Deriv.");
          send({ balance: 1, subscribe: 1, req_id: nextId() });
          refreshAccount();
          refreshTimer = window.setInterval(refreshAccount, 15_000);
        };

        localSocket.onmessage = (event) => {
          if (cancelled) return;
          let message: ApiMessage;
          try {
            message = JSON.parse(event.data) as ApiMessage;
          } catch {
            setStatus("Deriv returned a message TradeBridge could not read.");
            return;
          }

          if (message.error) {
            const requestId = message.req_id;
            if (quoteRequestRef.current && requestId === quoteRequestRef.current.id) {
              clearTimeoutRef();
              quoteRequestRef.current = null;
              setBusy(false);
              setQuote(null);
              setStatus(message.error.message ?? "Deriv could not price this contract. Check the instrument, stake, and duration.");
            } else if (buyRequestRef.current !== null && requestId === buyRequestRef.current) {
              clearTimeoutRef();
              buyRequestRef.current = null;
              setBusy(false);
              setStatus(message.error.message ?? "Deriv rejected the demo order. No successful confirmation was received.");
            } else {
              // An account-summary failure must not disable an authenticated trading session.
              setStatus(message.error.message ?? "Deriv could not load one of the account panels.");
            }
            return;
          }

          if (message.msg_type === "balance" && message.balance) {
            setBalance({
              balance: numeric(message.balance.balance),
              currency: String(message.balance.currency ?? activeAccount.currency ?? ""),
            });
            return;
          }

          if (message.msg_type === "portfolio" && message.portfolio) {
            const nextPositions = (message.portfolio.contracts ?? [])
              .map((item) => toPosition(item))
              .filter((item): item is OpenPosition => item !== null);
            setPositions(nextPositions);
            // Subscribe to each already-open contract so its live profit/status
            // updates are not limited to contracts placed during this page visit.
            for (const position of nextPositions) {
              send({
                proposal_open_contract: 1,
                contract_id: Number(position.contractId),
                subscribe: 1,
                req_id: nextId(),
              });
            }
            return;
          }

          if (message.msg_type === "statement" && message.statement) {
            const nextActivity = (message.statement.transactions ?? [])
              .map((item) => toActivity(item))
              .filter((item): item is AccountActivity => item !== null)
              .sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
            setActivity(nextActivity);
            return;
          }

          if (message.msg_type === "profit_table" && message.profit_table) {
            const profits = (message.profit_table.transactions ?? [])
              .map((item) => numeric(item.profit))
              .filter((item): item is number => item !== null);
            setRealizedProfit(profits.length ? profits.reduce((sum, value) => sum + value, 0) : 0);
            return;
          }

          if (message.msg_type === "proposal" && message.proposal && quoteRequestRef.current && message.req_id === quoteRequestRef.current.id) {
            clearTimeoutRef();
            const input = quoteRequestRef.current.input;
            quoteRequestRef.current = null;
            const id = message.proposal.id;
            const askPrice = numeric(message.proposal.ask_price);
            const payout = numeric(message.proposal.payout);
            if (!id || askPrice === null || askPrice <= 0) {
              setBusy(false);
              setStatus("Deriv returned an invalid quote. Request a new quote before confirming.");
              return;
            }
            setQuote({
              id,
              askPrice,
              payout,
              symbol: input.symbol,
              contractType: input.contractType,
              stake: input.stake,
              duration: input.duration,
              currency: activeAccount.currency ?? "USD",
            });
            setBusy(false);
            setStatus("Fresh quote received from Deriv. Review the price and potential payout, then confirm the demo order.");
            return;
          }

          if (message.msg_type === "buy" && message.buy && buyRequestRef.current !== null && message.req_id === buyRequestRef.current) {
            clearTimeoutRef();
            buyRequestRef.current = null;
            setBusy(false);
            setQuote(null);
            const contractId = String(message.buy.contract_id ?? "");
            if (!contractId) {
              setStatus("Deriv returned a buy response without a contract ID. Check account activity before retrying.");
              refreshAccount();
              return;
            }
            setStatus("Demo trade confirmed by Deriv. Contract " + contractId + " is being added to your account activity.");
            const monitorId = nextId();
            send({ proposal_open_contract: 1, contract_id: Number(contractId), subscribe: 1, req_id: monitorId });
            refreshAccount();
            return;
          }

          if (message.msg_type === "proposal_open_contract" && message.proposal_open_contract) {
            const raw = message.proposal_open_contract;
            const position = toPosition(raw);
            if (!position) return;
            const terminalStates = new Set(["won", "lost", "sold", "expired", "cancelled"]);
            const isClosed = terminalStates.has(position.status.toLowerCase()) || raw.is_sold === 1 || raw.is_expired === 1;
            if (isClosed) {
              setPositions((current) => current.filter((item) => item.contractId !== position.contractId));
              if (!closedContractIdsRef.current.has(position.contractId)) {
                closedContractIdsRef.current.add(position.contractId);
                setStatus("Contract " + position.contractId + " settled. Account activity has been refreshed.");
              }
              refreshAccount();
            } else {
              setPositions((current) => [
                position,
                ...current.filter((item) => item.contractId !== position.contractId),
              ]);
            }
          }
        };

        localSocket.onerror = () => {
          if (cancelled) return;
          setSessionState("Demo trading connection failed");
          setStatus("The authenticated Deriv WebSocket failed. Refresh the session or reconnect Deriv, then retry.");
          setBusy(false);
        };

        localSocket.onclose = () => {
          if (cancelled) return;
          if (socketRef.current === localSocket) socketRef.current = null;
          if (refreshTimer) window.clearInterval(refreshTimer);
          refreshTimer = null;
          if (quoteRequestRef.current || buyRequestRef.current !== null) {
            clearTimeoutRef();
            quoteRequestRef.current = null;
            buyRequestRef.current = null;
            setBusy(false);
            setStatus("The trading connection closed before the request was confirmed. Check activity before submitting another order.");
          }
          setSessionState("Demo trading disconnected");
        };
      } catch {
        if (!cancelled) {
          setSessionState("Demo session unavailable");
          setStatus("Could not connect to Deriv. Check your internet connection and retry.");
        }
      }
    }

    void connect();

    return () => {
      cancelled = true;
      if (refreshTimer) window.clearInterval(refreshTimer);
      clearTimeoutRef();
      quoteRequestRef.current = null;
      buyRequestRef.current = null;
      if (socketRef.current === localSocket) socketRef.current = null;
      localSocket?.close();
    };
    // The account ID, connection state, and currency define this authenticated socket.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, account?.account_id, account?.account_type, account?.currency]);

  function requestQuote(input: TradeInput) {
    const activeSocket = socketRef.current;
    if (!connected || !account || (account.account_type ?? "").toLowerCase() !== "demo") {
      setStatus("Select a verified demo account. Real-money accounts cannot place orders here.");
      return;
    }
    if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
      setStatus("The authenticated demo session is still connecting. Wait until it shows connected, then request a quote.");
      return;
    }
    if (!Number.isFinite(input.stake) || input.stake < 1 || input.stake > 1000) {
      setStatus("Enter a stake between 1 and 1,000 " + (activeAccount.currency ?? "USD") + ".");
      return;
    }
    if (!Number.isInteger(input.duration) || input.duration < 1 || input.duration > 86400) {
      setStatus("Enter a contract duration between 1 and 86,400 seconds.");
      return;
    }

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setQuote(null);
    setBusy(true);
    setStatus("Requesting a fresh price from Deriv…");
    const reqId = ++sequenceRef.current;
    quoteRequestRef.current = { id: reqId, input };
    activeSocket.send(JSON.stringify({
      proposal: 1,
      amount: input.stake,
      basis: "stake",
      contract_type: input.contractType,
      currency: activeAccount.currency ?? "USD",
      duration: input.duration,
      duration_unit: "s",
      underlying_symbol: input.symbol,
      req_id: reqId,
    }));
    timeoutRef.current = setTimeout(() => {
      if (quoteRequestRef.current?.id !== reqId) return;
      quoteRequestRef.current = null;
      setBusy(false);
      setStatus("Deriv did not return a quote in time. Try a different active market or check your demo account permissions.");
    }, 15_000);
  }

  function confirmQuote() {
    const activeSocket = socketRef.current;
    if (!quote || !activeSocket || activeSocket.readyState !== WebSocket.OPEN || busy) {
      setStatus("Request a fresh quote and wait for it to arrive before confirming.");
      return;
    }
    if (!account || (account.account_type ?? "").toLowerCase() !== "demo") {
      setStatus("Orders are limited to verified demo accounts.");
      return;
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    const reqId = ++sequenceRef.current;
    buyRequestRef.current = reqId;
    setBusy(true);
    setStatus("Submitting the confirmed demo order to Deriv…");
    activeSocket.send(JSON.stringify({ buy: quote.id, price: quote.askPrice, req_id: reqId }));
    timeoutRef.current = setTimeout(() => {
      if (buyRequestRef.current !== reqId) return;
      buyRequestRef.current = null;
      setBusy(false);
      setStatus("Deriv did not confirm the order in time. Check account activity before trying again to avoid a duplicate.");
    }, 20_000);
  }

  return { sessionState, status, busy, quote, positions, activity, balance, realizedProfit, requestQuote, confirmQuote };
}
