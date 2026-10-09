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
  sell?: { contract_id?: number | string; sold_for?: number | string };
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

function readOrderResolution(key: string | null): string | null {
  if (!key) return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    // If storage is unavailable, fail closed for this session.
    return "unknown";
  }
}

function writeOrderResolution(key: string | null, value: "pending" | "unknown") {
  if (!key) return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // In-memory lock still protects the active React session.
  }
}

function clearOrderResolution(key: string | null) {
  if (!key) return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // In-memory reconciliation state will still remain active until cleared.
  }
}

export function useTradingSession(
  connected: boolean,
  account: DerivAccount | null,
  realTradingEnabled = false,
  maxRealStake = 10,
  maxDailyLoss = 25,
) {
  const [sessionState, setSessionState] = useState("Select a verified demo account to connect trading");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<DemoQuote | null>(null);
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [activity, setActivity] = useState<AccountActivity[]>([]);
  const [balance, setBalance] = useState(EMPTY_BALANCE);
  const [realizedProfit, setRealizedProfit] = useState<number | null>(null);
  const [orderResolutionRequired, setOrderResolutionRequired] = useState(true);
  const orderResolutionKey = account?.account_id
    ? `tradebridge:order-resolution-required:${account.account_id}`
    : null;

  const socketRef = useRef<WebSocket | null>(null);
  const sequenceRef = useRef(100);
  const quoteRequestRef = useRef<{ id: number; input: TradeInput } | null>(null);
  const buyRequestRef = useRef<number | null>(null);
  const sellRequestRef = useRef<{ id: number; contractId: string } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedContractIdsRef = useRef<Set<string>>(new Set());
  const subscribedContractIdsRef = useRef<Set<string>>(new Set());
  const refreshAccountRef = useRef<(() => void) | null>(null);

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

    const storedOrderState = readOrderResolution(orderResolutionKey);
    if (storedOrderState) {
      // If the tab was refreshed or navigated away while a buy was pending,
      // treat it as ambiguous until the user reconciles it in Deriv.
      if (storedOrderState === "pending") {
        writeOrderResolution(orderResolutionKey, "unknown");
      }
      setOrderResolutionRequired(true);
    } else {
      setOrderResolutionRequired(false);
    }

    setQuote(null);
    setStatus("");
    setPositions([]);
    setActivity([]);
    setRealizedProfit(null);
    setBalance({ balance: account?.balance ?? null, currency: account?.currency ?? "" });
    quoteRequestRef.current = null;
    buyRequestRef.current = null;
    sellRequestRef.current = null;
    closedContractIdsRef.current.clear();
    subscribedContractIdsRef.current.clear();
    clearTimeoutRef();

    const accountType = (account?.account_type ?? "").toLowerCase();
    const isDemoAccount = accountType === "demo";
    const isRealAccount = accountType === "real";
    const canOpenSession = isDemoAccount || (isRealAccount && realTradingEnabled);

    if (!connected || !account || !canOpenSession) {
      setSessionState(!connected
        ? "Connect Deriv to enable trading"
        : !account
          ? "No account selected"
          : isRealAccount
            ? "Real trading is locked until you explicitly enable it"
            : "This account type is not supported for trading");
      return () => {
        cancelled = true;
        clearTimeoutRef();
      };
    }

    const activeAccount = account;
    const sessionLabel = isRealAccount ? "Live trading" : "Demo trading";
    setSessionState("Opening secure " + sessionLabel.toLowerCase() + " session");

    async function connect() {
      try {
        const response = await fetch("/api/auth/deriv/trade-session", {
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
              : data.error === "live_consent_schema_missing"
                ? "Apply the live-trading consent migration in Supabase before enabling real trades."
                : data.error === "live_consent_required"
                  ? "Explicitly acknowledge the live-trading risk disclosure to enable this real account."
                  : data.error === "account_not_linked" || data.error === "account_mismatch"
                    ? "This account is not linked to the signed-in TradeBridge user."
                    : data.error === "unsupported_account_type"
                      ? "This account type is not supported for Options trading."
                      : "Could not open the authenticated trading session. Check Deriv permissions and retry.";
          setSessionState(isRealAccount ? "Live trading session unavailable" : "Demo session unavailable");
          setStatus(message);
          return;
        }

        localSocket = new WebSocket(data.url);
        socketRef.current = localSocket;

        localSocket.onopen = () => {
          if (cancelled) return;
          setSessionState(isRealAccount ? "Real trading connected" : "Demo trading connected");
          setStatus(isRealAccount
            ? "Connected to your selected real Deriv account. Live orders use real funds; review every order carefully."
            : "Connected to your selected Deriv demo account. Quotes and balances come from Deriv.");
          send({ balance: 1, subscribe: 1, req_id: nextId() });
          refreshAccountRef.current = refreshAccount;
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
              if (orderResolutionKey) clearOrderResolution(orderResolutionKey);
              setOrderResolutionRequired(false);
              setQuote(null);
              setBusy(false);
              setStatus(message.error.message ?? "Deriv rejected the order. Check account activity before retrying.");
            } else if (sellRequestRef.current !== null && requestId === sellRequestRef.current.id) {
              clearTimeoutRef();
              const contractId = sellRequestRef.current.contractId;
              sellRequestRef.current = null;
              setBusy(false);
              setStatus(message.error.message ?? "Deriv could not close contract " + contractId + ". The position remains under Deriv's control.");
              refreshAccount();
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
              if (subscribedContractIdsRef.current.has(position.contractId)) continue;
              subscribedContractIdsRef.current.add(position.contractId);
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
              receivedAt: Date.now(),
            });
            setBusy(false);
            setStatus("Fresh quote received from Deriv. Review the price and potential payout, then confirm the " + (isRealAccount ? "real-money order" : "demo order") + ".");
            return;
          }

          if (message.msg_type === "buy" && message.buy && buyRequestRef.current !== null && message.req_id === buyRequestRef.current) {
            clearTimeoutRef();
            buyRequestRef.current = null;
            setBusy(false);
            setQuote(null);
            const contractId = String(message.buy.contract_id ?? "");
            if (!contractId) {
              // A success-shaped response without a contract ID is not proof
              // that the order failed. Keep the account locked for reconciliation.
              if (orderResolutionKey) writeOrderResolution(orderResolutionKey, "unknown");
              setOrderResolutionRequired(true);
              setStatus("Deriv returned a buy response without a contract ID. Order entry is paused; reconcile positions and statement before retrying.");
              refreshAccount();
              return;
            }
            if (orderResolutionKey) clearOrderResolution(orderResolutionKey);
            setOrderResolutionRequired(false);
            setStatus((isRealAccount ? "Real-money trade" : "Demo trade") + " confirmed by Deriv. Contract " + contractId + " is being added to your account activity.");
            const monitorId = nextId();
            subscribedContractIdsRef.current.add(contractId);
            send({ proposal_open_contract: 1, contract_id: Number(contractId), subscribe: 1, req_id: monitorId });
            refreshAccount();
            return;
          }

          if (message.msg_type === "sell" && message.sell && sellRequestRef.current && message.req_id === sellRequestRef.current.id) {
            clearTimeoutRef();
            const soldContractId = sellRequestRef.current.contractId;
            sellRequestRef.current = null;
            setBusy(false);
            setQuote(null);
            setStatus("Deriv confirmed the sale of contract " + soldContractId + ". Balance, positions, and history are refreshing.");
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
              subscribedContractIdsRef.current.delete(position.contractId);
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
          setSessionState(isRealAccount ? "Real trading connection failed" : "Demo trading connection failed");
          setStatus("The authenticated Deriv WebSocket failed. Refresh the session or reconnect Deriv, then retry.");
          setBusy(false);
        };

        localSocket.onclose = () => {
          if (cancelled) return;
          if (socketRef.current === localSocket) socketRef.current = null;
          if (refreshTimer) window.clearInterval(refreshTimer);
          refreshTimer = null;
          if (buyRequestRef.current !== null) {
            if (orderResolutionKey) writeOrderResolution(orderResolutionKey, "unknown");
            setOrderResolutionRequired(true);
            setQuote(null);
          }
          if (quoteRequestRef.current || buyRequestRef.current !== null || sellRequestRef.current !== null) {
            clearTimeoutRef();
            quoteRequestRef.current = null;
            buyRequestRef.current = null;
            sellRequestRef.current = null;
            setBusy(false);
            setStatus("The connection closed before the request was confirmed. Check Deriv directly; the order outcome may be unknown.");
          }
          setSessionState(isRealAccount ? "Real trading disconnected" : "Demo trading disconnected");
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
      refreshAccountRef.current = null;
      if (buyRequestRef.current !== null && orderResolutionKey) {
        // A navigation during a submitted buy must not silently reset its state.
        writeOrderResolution(orderResolutionKey, "unknown");
      }
      clearTimeoutRef();
      quoteRequestRef.current = null;
      buyRequestRef.current = null;
      sellRequestRef.current = null;
      if (socketRef.current === localSocket) socketRef.current = null;
      localSocket?.close();
    };
    // The account ID, connection state, and currency define this authenticated socket.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, account?.account_id, account?.account_type, account?.currency, realTradingEnabled]);

  function requestQuote(input: TradeInput) {
    if (orderResolutionRequired || buyRequestRef.current !== null) {
      setStatus("Order entry is paused because a previous buy has an unknown outcome. Check open positions and account statement in Deriv before unlocking.");
      return;
    }
    const activeSocket = socketRef.current;
    const accountType = (account?.account_type ?? "").toLowerCase();
    const isDemoAccount = accountType === "demo";
    const isRealAccount = accountType === "real";
    if (!connected || !account || (!isDemoAccount && !(isRealAccount && realTradingEnabled))) {
      setStatus(isRealAccount
        ? "Enable live trading and accept the risk disclosure before requesting a real-money quote."
        : "Select a verified, supported Deriv account before requesting a quote.");
      return;
    }
    if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
      setStatus("The authenticated trading session is still connecting. Wait until it shows connected, then request a quote.");
      return;
    }
    const allowedStake = isRealAccount ? maxRealStake : 1000;
    if (!Number.isFinite(input.stake) || input.stake < 1 || input.stake > allowedStake) {
      setStatus("Enter a stake between 1 and " + allowedStake.toLocaleString() + " " + (account.currency ?? "USD") + (isRealAccount ? " (your configured live-trading limit)." : "."));
      return;
    }
    if (isRealAccount && realizedProfit === null) {
      setStatus("Waiting for Deriv to load today's realized profit/loss before allowing a live quote.");
      return;
    }
    if (isRealAccount && realizedProfit !== null && realizedProfit <= -maxDailyLoss) {
      setStatus("Your configured daily loss stop has been reached. Live entries are blocked for this session; review your account directly with Deriv.");
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
      currency: account.currency ?? "USD",
      duration: input.duration,
      duration_unit: "s",
      underlying_symbol: input.symbol,
      req_id: reqId,
    }));
    timeoutRef.current = setTimeout(() => {
      if (quoteRequestRef.current?.id !== reqId) return;
      quoteRequestRef.current = null;
      setBusy(false);
      setStatus("Deriv did not return a quote in time. Check the selected market, account permissions, and connection, then retry.");
    }, 15_000);
  }

  function confirmQuote() {
    if (orderResolutionRequired || buyRequestRef.current !== null) {
      setStatus("Order entry is paused until the previous submission outcome is resolved.");
      return;
    }
    const activeSocket = socketRef.current;
    if (!quote || !activeSocket || activeSocket.readyState !== WebSocket.OPEN || busy) {
      setStatus("Request a fresh quote and wait for it to arrive before confirming.");
      return;
    }
    const accountType = (account?.account_type ?? "").toLowerCase();
    const isDemoAccount = accountType === "demo";
    const isRealAccount = accountType === "real";
    if (!account || (!isDemoAccount && !(isRealAccount && realTradingEnabled))) {
      setStatus("The selected account is not enabled for trading.");
      return;
    }
    if (isRealAccount && quote.stake > maxRealStake) {
      setQuote(null);
      setStatus("The quoted stake exceeds your configured live-trading limit. Request a new quote with a lower stake.");
      return;
    }
    if (isRealAccount && (realizedProfit === null || realizedProfit <= -maxDailyLoss)) {
      setQuote(null);
      setStatus(realizedProfit === null
        ? "Today's realized profit/loss is not available. Live order confirmation is blocked until it loads."
        : "Your configured daily loss stop has been reached. Live order confirmation is blocked.");
      return;
    }
    if (Date.now() - quote.receivedAt > 30_000) {
      setQuote(null);
      setStatus("This quote has expired. Request a fresh quote before confirming a trade.");
      return;
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    const reqId = ++sequenceRef.current;
    buyRequestRef.current = reqId;
    if (orderResolutionKey) writeOrderResolution(orderResolutionKey, "pending");
    setBusy(true);
    setStatus("Submitting the confirmed " + (isRealAccount ? "real-money" : "demo") + " order to Deriv…");
    activeSocket.send(JSON.stringify({ buy: quote.id, price: quote.askPrice, req_id: reqId }));
    setQuote(null);
    timeoutRef.current = setTimeout(() => {
      if (buyRequestRef.current !== reqId) return;
      buyRequestRef.current = null;
      if (orderResolutionKey) writeOrderResolution(orderResolutionKey, "unknown");
      setOrderResolutionRequired(true);
      setQuote(null);
      setBusy(false);
      refreshAfterTimeout();
      setStatus("Deriv did not confirm the order in time. Trading is paused; reconcile positions and statement in Deriv before unlocking.");
    }, 20_000);
  }

  function refreshAccountNow() {
    refreshAccountRef.current?.();
  }

  function acknowledgeOrderResolution() {
    if (!orderResolutionRequired) return;
    const confirmed = window.confirm(
      "Before unlocking, open Deriv directly and reconcile open positions and account statement around the submission time. Only continue if you have resolved the outcome and are sure no duplicate trade will be placed. If anything is unclear, cancel and keep trading paused."
    );
    if (!confirmed) return;
    if (orderResolutionKey) clearOrderResolution(orderResolutionKey);
    setOrderResolutionRequired(false);
    setStatus("Manual reconciliation acknowledged. Request a fresh quote before trading.");
  }

  function sellPosition(contractId: string) {
    const activeSocket = socketRef.current;
    const accountType = (account?.account_type ?? "").toLowerCase();
    const canTrade = accountType === "demo" || (accountType === "real" && realTradingEnabled);
    const isOpenPosition = positions.some((position) => position.contractId === contractId);
    if (!connected || !account || !canTrade || !isOpenPosition) {
      setStatus("This position is not available to close from the current account session.");
      return;
    }
    if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN || busy) {
      setStatus("The authenticated trading session is not ready. Check connection status before selling.");
      return;
    }
    if (!/^\d+$/.test(contractId)) {
      setStatus("Deriv returned an invalid contract ID. Refresh positions before retrying.");
      return;
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    const reqId = ++sequenceRef.current;
    sellRequestRef.current = { id: reqId, contractId };
    setBusy(true);
    setStatus("Requesting a market sale for contract " + contractId + "…");
    activeSocket.send(JSON.stringify({ sell: Number(contractId), price: 0, req_id: reqId }));
    timeoutRef.current = setTimeout(() => {
      if (sellRequestRef.current?.id !== reqId) return;
      sellRequestRef.current = null;
      setBusy(false);
      setStatus("Deriv did not confirm the sale in time. Check positions and statement before trying again.");
      refreshAfterTimeout();
    }, 20_000);
  }

  function refreshAfterTimeout() {
    const activeSocket = socketRef.current;
    if (activeSocket?.readyState === WebSocket.OPEN) {
      activeSocket.send(JSON.stringify({ portfolio: 1, req_id: ++sequenceRef.current }));
      activeSocket.send(JSON.stringify({ statement: 1, limit: 30, description: 1, req_id: ++sequenceRef.current }));
      activeSocket.send(JSON.stringify({ balance: 1, req_id: ++sequenceRef.current }));
    }
  }

  return {
    sessionState, status, busy, quote, positions, activity, balance, realizedProfit,
    orderResolutionRequired, acknowledgeOrderResolution,
    requestQuote, confirmQuote, sellPosition, refreshAccount: refreshAccountNow,
  };
}
