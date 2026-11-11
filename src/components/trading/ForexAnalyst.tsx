"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./ForexAnalyst.module.css";
import ForexOrderPanel from "./ForexOrderPanel";
import { useMt5Device } from "./useMt5Device";
import { buildForexCandleHistoryRequest } from "../../lib/forex-market-data.mjs";
import { panChartViewport, zoomChartViewport } from "../../lib/forex-chart-viewport.mjs";
import {
  analyzeForexCandles,
  buildTrendlines,
  computeSignal,
  computeSentiment,
  computeSmcSignal,
  computeTradeSetup,
  computeVolumeProfile,
  findSwingPoints,
  type CandlePattern,
  type ForexCandle,
  type PriceZone,
  type SentimentResult,
  type SignalResult,
  type SmcSignal,
  type SwingPoint,
  type TradeSetupResult,
  type VolumeProfileResult,
} from "../../lib/forex-analysis.mjs";

const MARKET_SOCKET = process.env.NEXT_PUBLIC_TRADEBRIDGE_BACKEND_MARKET_WS_URL?.trim() ?? "";
const DEFAULT_SYMBOL = "frxEURUSD";

type MarketCategory = "all" | "forex" | "commodities" | "indices" | "cryptocurrency" | "synthetic_index";

const CATEGORIES: Array<{ id: MarketCategory; label: string; icon: string }> = [
  { id: "all", label: "All Markets", icon: "🌐" },
  { id: "forex", label: "Forex", icon: "💱" },
  { id: "commodities", label: "Commodities", icon: "🪙" },
  { id: "indices", label: "Stock Indices", icon: "📈" },
  { id: "cryptocurrency", label: "Crypto", icon: "₿" },
  { id: "synthetic_index", label: "Synthetics", icon: "⚡" },
];

const CATEGORY_DEFAULT_SYMBOL: Record<MarketCategory, string> = {
  all: "frxEURUSD",
  forex: "frxEURUSD",
  commodities: "frxXAUUSD",
  indices: "OTC_DJI",
  cryptocurrency: "cryBTCUSD",
  synthetic_index: "1HZ100V",
};

const SYMBOL_PRIORITY: Record<string, number> = {
  // Forex
  frxEURUSD: 1, frxGBPUSD: 2, frxUSDJPY: 3, frxAUDUSD: 4, frxUSDCAD: 5,
  frxUSDCHF: 6, frxNZDUSD: 7, frxEURGBP: 8, frxEURJPY: 9, frxGBPJPY: 10,
  // Commodities
  frxXAUUSD: 20, frxXAGUSD: 21, frxXPDUSD: 22,
  // Indices
  OTC_DJI: 30, OTC_NDX: 31, OTC_SPC: 32, OTC_AS51: 33, OTC_AEX: 34,
  // Crypto
  cryBTCUSD: 40, cryETHUSD: 41,
  // Synthetics
  "1HZ100V": 50, "1HZ75V": 51, "1HZ50V": 52, "R_100": 53, "R_50": 54,
};

const TIMEFRAMES = [
  { label: "M1", seconds: 60 },
  { label: "M5", seconds: 300 },
  { label: "M15", seconds: 900 },
  { label: "H1", seconds: 3600 },
] as const;
const CANDLE_LIMIT = 180;
const VIEW_LIMIT = 100;
const EMPTY_CANDLES: ForexCandle[] = [];

type AnalystInstrument = {
  symbol: string;
  name: string;
  market: string;
  marketDisplayName?: string;
  pipSize?: number;
};
function normalizeOptionalQuotePrice(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : undefined;
}

function calculateQuoteSpread(bid: number | undefined, ask: number | undefined): number | undefined {
  if (typeof bid !== "number" || !Number.isFinite(bid) || bid <= 0 ||
      typeof ask !== "number" || !Number.isFinite(ask) || ask <= 0 || ask < bid) return undefined;
  return ask - bid;
}

type LiveQuote = { price: number; epoch: number; pipSize?: number; bid?: number; ask?: number };
type PendingHistory = { key: string; symbol: string; seconds: number };
type HistoryLoad = { status: "loading" | "loaded" | "insufficient" | "error"; count: number; message?: string };
type FeedMessage = {
  msg_type?: string;
  req_id?: number;
  error?: { message?: string; code?: string };
  active_symbols?: Array<{
    symbol?: string;
    underlying_symbol?: string;
    display_name?: string;
    underlying_symbol_name?: string;
    market?: string;
    market_display_name?: string;
    is_trading_suspended?: number;
    pip?: number;
  }>;
  tick?: {
    symbol?: string;
    underlying_symbol?: string;
    quote?: number | string;
    bid?: number | string;
    ask?: number | string;
    epoch?: number | string;
    pip_size?: number;
  };
  subscription?: { id?: string };
  candles?: Array<{
    epoch?: number | string;
    open?: number | string;
    high?: number | string;
    low?: number | string;
    close?: number | string;
  }>;
  pip_size?: number;
};

function keyFor(symbol: string, seconds: number) {
  return symbol + ":" + seconds;
}

function normalizeFeedCandles(values: NonNullable<FeedMessage["candles"]>): ForexCandle[] {
  const byEpoch = new Map<number, ForexCandle>();
  for (const raw of values) {
    const candle = {
      epoch: Number(raw.epoch),
      open: Number(raw.open),
      high: Number(raw.high),
      low: Number(raw.low),
      close: Number(raw.close),
    };
    if (
      Number.isFinite(candle.epoch) &&
      Number.isFinite(candle.open) &&
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close) &&
      candle.high >= Math.max(candle.open, candle.close) &&
      candle.low <= Math.min(candle.open, candle.close) &&
      candle.high >= candle.low
    ) byEpoch.set(candle.epoch, candle);
  }
  return [...byEpoch.values()].sort((a, b) => a.epoch - b.epoch).slice(-CANDLE_LIMIT);
}

function getDecimals(symbol: string, pipSize?: number): number {
  if (typeof pipSize === "number" && pipSize > 0) {
    if (pipSize < 1) {
      const str = pipSize.toString();
      if (str.includes("e-")) {
        const exp = parseInt(str.split("e-")[1], 10);
        return Math.min(Math.max(exp, 1), 6);
      }
      const decimals = str.split(".")[1]?.length ?? 2;
      return Math.min(Math.max(decimals, 1), 6);
    }
  }
  if (symbol.startsWith("frx")) {
    if (symbol.includes("XAU") || symbol.includes("XPD")) return 2;
    if (symbol.includes("XAG")) return 4;
    return symbol.includes("JPY") ? 3 : 5;
  }
  if (symbol.startsWith("OTC_")) return 2;
  if (symbol.startsWith("cry")) return symbol.includes("BTC") ? 2 : 4;
  return 2;
}

function formatPrice(price: number, symbol: string, pipSize?: number) {
  const digits = getDecimals(symbol, pipSize);
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Math.min(digits, 2),
    maximumFractionDigits: digits,
  }).format(price);
}

function formatTime(epoch: number, includeDate = false) {
  const date = new Date(epoch * 1000);
  return includeDate
    ? date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function shortPattern(label: string) {
  const labels: Record<string, string> = {
    "Hammer / lower-wick rejection": "HAMMER",
    "Shooting star / upper-wick rejection": "SHOOTING STAR",
    "Bullish engulfing": "BULL ENGULF",
    "Bearish engulfing": "BEAR ENGULF",
    "Morning star": "MORNING STAR",
    "Evening star": "EVENING STAR",
    "Inside bar": "INSIDE BAR",
    "Doji": "DOJI",
  };
  return labels[label] ?? label.toUpperCase();
}

function buildSwingLabels(swings: SwingPoint[], atr: number) {
  const labels = new Map<number, string>();
  const prior: Record<"high" | "low", number | null> = { high: null, low: null };
  const tolerance = Math.max(atr * 0.08, Number.EPSILON);

  for (const swing of swings) {
    const previous = prior[swing.kind];
    let label = swing.kind === "high" ? "SH" : "SL";
    if (previous !== null) {
      if (swing.kind === "high") {
        label = swing.price > previous + tolerance ? "HH"
          : swing.price < previous - tolerance ? "LH" : "EQH";
      } else {
        label = swing.price > previous + tolerance ? "HL"
          : swing.price < previous - tolerance ? "LL" : "EQL";
      }
    }
    prior[swing.kind] = swing.price;
    labels.set(swing.epoch, label);
  }
  return labels;
}

function nearestZone(zones: PriceZone[], symbol: string, pipSize?: number) {
  const zone = zones[0];
  return zone ? { ...zone, priceText: formatPrice(zone.price, symbol, pipSize) } : null;
}

export default function ForexAnalyst({ accountType = "demo" }: { accountType?: "demo" | "real" }) {
  const { device: mt5Device } = useMt5Device();
  const [instruments, setInstruments] = useState<AnalystInstrument[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<MarketCategory>("all");
  const [selectedSymbol, setSelectedSymbol] = useState(DEFAULT_SYMBOL);
  const [quotePanelOpen, setQuotePanelOpen] = useState(false);
  const [positionsPanelOpen, setPositionsPanelOpen] = useState(false);

  // ── Live MT5 positions ────────────────────────────────────────────────────
  interface LivePosition {
    id: string;
    mt5_ticket: number;
    symbol: string;
    order_side: "buy" | "sell";
    volume: string;
    open_price: number;
    current_price: number;
    floating_pl: number;
    stop_loss?: number | null;
    take_profit?: number | null;
    account_type: string;
    is_open: boolean;
    opened_at: string;
    closed_at?: string | null;
  }
  const [positionLines, setPositionLines] = useState<LivePosition[]>([]);
  const positionLinesFetchRef = useRef<number>(0);

  useEffect(() => {
    const deviceId = mt5Device?.id;
    if (!deviceId) { setPositionLines([]); return; }

    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/mt5/devices/${deviceId}/positions`, { cache: "no-store" });
        if (!res.ok || !alive) return;
        const data = (await res.json()) as { positions: LivePosition[] };
        if (!alive) return;
        setPositionLines(data.positions ?? []);
      } catch { /* non-critical */ }
    };

    void load();
    const interval = window.setInterval(() => void load(), 3_000);
    return () => { alive = false; clearInterval(interval); };
  }, [mt5Device?.id, positionLinesFetchRef.current]);
  const [timeframe, setTimeframe] = useState<number>(60);
  const [chartViewCount, setChartViewCount] = useState<number>(VIEW_LIMIT);
  const [chartViewOffset, setChartViewOffset] = useState<number>(0);
  const [isChartDragging, setIsChartDragging] = useState(false);
  const chartDragRef = useRef<{ pointerId: number; startX: number; startOffset: number } | null>(null);
  const lastViewportTailRef = useRef<{ key: string; epoch: number } | null>(null);
  const [candlesByKey, setCandlesByKey] = useState<Record<string, ForexCandle[]>>({});
  const [historyByKey, setHistoryByKey] = useState<Record<string, HistoryLoad>>({});
  const [quotesBySymbol, setQuotesBySymbol] = useState<Record<string, LiveQuote>>({});
  const [feedStatus, setFeedStatus] = useState("Connecting to TradeBridge market gateway");
  const [feedReady, setFeedReady] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const requestSequenceRef = useRef(70_000);
  const pendingHistoryRef = useRef(new Map<number, PendingHistory>());
  const historyTimeoutsRef = useRef(new Map<number, number>());
  const subscribedSymbolsRef = useRef(new Set<string>());
  const subscriptionsBySymbolRef = useRef(new Map<string, string>());
  const activeTickSymbolRef = useRef("");
  const selectedSymbolRef = useRef(selectedSymbol);
  const timeframeRef = useRef(timeframe);
  const latestTickRef = useRef<{ symbol: string; quote: LiveQuote } | null>(null);

  selectedSymbolRef.current = selectedSymbol;
  timeframeRef.current = timeframe;

  const requestCandles = useCallback((symbol: string, seconds: number) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !symbol) return;
    const reqId = ++requestSequenceRef.current;
    const key = keyFor(symbol, seconds);
    pendingHistoryRef.current.set(reqId, { key, symbol, seconds });
    const timeoutId = window.setTimeout(() => {
      const pending = pendingHistoryRef.current.get(reqId);
      if (!pending) return;
      pendingHistoryRef.current.delete(reqId);
      historyTimeoutsRef.current.delete(reqId);
      const reason = "No historical-candle response arrived within 12 seconds. Live ticks are not a substitute for history.";
      setHistoryByKey((current) => ({
        ...current,
        [pending.key]: { status: "error", count: current[pending.key]?.count ?? 0, message: reason },
      }));
    }, 12_000);
    historyTimeoutsRef.current.set(reqId, timeoutId);
    setHistoryByKey((current) => ({
      ...current,
      [key]: { status: "loading", count: current[key]?.count ?? 0 },
    }));
    setFeedStatus("Loading " + symbol + " candle history");
    // Count-based history returns the latest candles. Live ticks are subscribed
    // to separately; don't mix start/count or send subscribe=0 to the legacy endpoint.
    socket.send(JSON.stringify(
      buildForexCandleHistoryRequest(symbol, seconds, reqId, CANDLE_LIMIT),
    ));
  }, []);

  useEffect(() => {
    const pendingHistory = pendingHistoryRef.current;
    const historyTimeouts = historyTimeoutsRef.current;
    const subscribedSymbols = subscribedSymbolsRef.current;
    const subscriptionsBySymbol = subscriptionsBySymbolRef.current;
    let alive = true;
    let socket: WebSocket | null = null;
    let connectionOpened = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;

    pendingHistoryRef.current.clear();
    subscribedSymbolsRef.current.clear();
    subscriptionsBySymbolRef.current.clear();
    activeTickSymbolRef.current = "";
    setFeedReady(false);

    if (!MARKET_SOCKET) {
      setFeedStatus("Backend market feed is not configured");
      return () => { alive = false; };
    }

    try {
      socket = new WebSocket(MARKET_SOCKET);
      socketRef.current = socket;
    } catch {
      setFeedStatus("Could not open TradeBridge market connection");
      return () => { alive = false; };
    }

    socket.onopen = () => {
      if (!alive || !socket) return;
      reconnectAttempts = 0;
      connectionOpened = true;
      setFeedStatus("Discovering available forex pairs");
      // Deliberately no digit-contract filter: this workspace is for forex chart analysis.
      socket.send(JSON.stringify({ active_symbols: "brief", req_id: 1 }));
    };

    socket.onmessage = (event) => {
      if (!alive) return;
      let message: FeedMessage;
      try {
        const parsed: unknown = JSON.parse(event.data);
        if (!parsed || typeof parsed !== "object") {
          setFeedStatus("Received an unreadable market-data response");
          return;
        }
        message = parsed as FeedMessage;
      } catch {
        setFeedStatus("Received an unreadable market-data response");
        return;
      }

      if (message.msg_type === "ping") return;

      if (message.error) {
        const pending = message.req_id === undefined
          ? undefined
          : pendingHistoryRef.current.get(message.req_id);
        if (message.req_id !== undefined) {
          pendingHistoryRef.current.delete(message.req_id);
          const timeoutId = historyTimeoutsRef.current.get(message.req_id);
          if (timeoutId !== undefined) window.clearTimeout(timeoutId);
          historyTimeoutsRef.current.delete(message.req_id);
        }
        if (message.req_id === 1) {
          setFeedReady(false);
          setFeedStatus("Forex symbol discovery failed: " + (message.error.message ?? "provider error"));
        } else if (pending) {
          const reason = message.error.message ?? "provider error";
          setHistoryByKey((current) => ({
            ...current,
            [pending.key]: { status: "error", count: current[pending.key]?.count ?? 0, message: reason },
          }));
          setFeedStatus("Candle history unavailable for " + pending.symbol + ": " + reason);
        }
        return;
      }

      if (message.msg_type === "active_symbols" && message.active_symbols) {
        const symbols: AnalystInstrument[] = message.active_symbols
          .map((item) => {
            const symbol = item.underlying_symbol ?? item.symbol ?? "";
            return {
              symbol,
              name: item.underlying_symbol_name ?? item.display_name ?? symbol,
              market: (item.market ?? "").trim().toLowerCase(),
              marketDisplayName: (item.market_display_name ?? "").trim(),
              pipSize: typeof item.pip === "number" ? item.pip : undefined,
              isTradingSuspended: item.is_trading_suspended === 1,
            };
          })
          .filter((item) =>
            item.symbol &&
            !item.isTradingSuspended &&
            (item.market === "forex" || item.market === "commodities" || item.market === "indices" || item.market === "cryptocurrency" || item.market === "synthetic_index")
          );

        const bySymbol = new Map<string, AnalystInstrument>();
        symbols.forEach((item) => bySymbol.set(item.symbol, item));
        const available = [...bySymbol.values()].sort((a, b) => {
          const aRank = SYMBOL_PRIORITY[a.symbol] ?? 1000;
          const bRank = SYMBOL_PRIORITY[b.symbol] ?? 1000;
          return aRank - bRank || a.name.localeCompare(b.name);
        });

        setInstruments(available);
        if (!available.length) {
          setFeedReady(false);
          setFeedStatus("The feed did not return eligible instruments");
          return;
        }
        setSelectedSymbol((current) =>
          available.some((pair) => pair.symbol === current)
            ? current
            : available.find((pair) => pair.symbol === DEFAULT_SYMBOL)?.symbol ?? available[0].symbol
        );
        setFeedReady(true);
        setFeedStatus("Markets loaded · waiting for live quotes");
        return;
      }

      if ((message.msg_type === "candles" || message.msg_type === "history") && message.candles) {
        const request = message.req_id === undefined
          ? undefined
          : pendingHistoryRef.current.get(message.req_id);
        if (!request) return;
        pendingHistoryRef.current.delete(message.req_id as number);
        const timeoutId = historyTimeoutsRef.current.get(message.req_id as number);
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        historyTimeoutsRef.current.delete(message.req_id as number);
        const history = normalizeFeedCandles(message.candles);
        if (!history.length) {
          const reason = "The provider returned no valid OHLC candles. Live ticks are arriving separately.";
          setHistoryByKey((current) => ({
            ...current,
            [request.key]: { status: "insufficient", count: 0, message: reason },
          }));
          setFeedStatus("No valid candle history received for " + request.symbol);
          return;
        }

        const historyLoad: HistoryLoad = history.length >= 10
          ? { status: "loaded", count: history.length }
          : {
              status: "insufficient",
              count: history.length,
              message: "Only " + history.length + " historical candle(s) arrived; at least 10 are required to draw a useful chart. Live ticks are not a substitute for history.",
            };
        setHistoryByKey((current) => ({ ...current, [request.key]: historyLoad }));
        setCandlesByKey((current) => {
          const key = request.key;
          const byEpoch = new Map<number, ForexCandle>();
          for (const candle of [...(current[key] ?? []), ...history]) byEpoch.set(candle.epoch, candle);
          let merged = [...byEpoch.values()].sort((a, b) => a.epoch - b.epoch).slice(-CANDLE_LIMIT);
          const latestTick = latestTickRef.current;
          if (latestTick && latestTick.symbol === request.symbol) {
            merged = mergeTickIntoCandles(merged, latestTick.quote, request.seconds);
          }
          return { ...current, [key]: merged };
        });
        setFeedStatus("Forex candle history received");
        return;
      }

      if (message.msg_type === "tick" && message.tick) {
        const symbol = message.tick.underlying_symbol ?? message.tick.symbol ?? "";
        const subscriptionId = message.subscription?.id;
        if (symbol && subscriptionId) {
          subscriptionsBySymbolRef.current.set(symbol, subscriptionId);
          if (symbol !== selectedSymbolRef.current && socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ forget: subscriptionId }));
            subscriptionsBySymbolRef.current.delete(symbol);
            subscribedSymbolsRef.current.delete(symbol);
          }
        }
        const price = Number(message.tick.quote);
        const epoch = Number(message.tick.epoch);
        if (!symbol || !Number.isFinite(price) || price <= 0 || !Number.isFinite(epoch) || epoch <= 0) {
          setFeedStatus("Rejected tick with invalid price or provider timestamp");
          return;
        }
        const quote: LiveQuote = {
          price,
          epoch,
          pipSize: message.tick.pip_size ?? message.pip_size,
          bid: normalizeOptionalQuotePrice(message.tick.bid),
          ask: normalizeOptionalQuotePrice(message.tick.ask),
        };
        latestTickRef.current = { symbol, quote };
        setQuotesBySymbol((current) => ({ ...current, [symbol]: quote }));
        if (symbol === selectedSymbolRef.current) {
          setCandlesByKey((current) => {
            const key = keyFor(symbol, timeframeRef.current);
            const next = mergeTickIntoCandles(current[key] ?? [], quote, timeframeRef.current);
            return next === current[key] ? current : { ...current, [key]: next };
          });
          setFeedStatus("Live forex tick received");
        }
      }
    };

    socket.onerror = () => {
      if (alive) setFeedStatus("Market-data connection failed");
    };
    socket.onclose = () => {
      if (!alive) return;
      setFeedReady(false);
      setFeedStatus(connectionOpened ? "Market-data connection disconnected; reconnecting" : "Could not connect to market data; reconnecting");
      reconnectAttempts += 1;
      const delay = Math.min(1000 * 2 ** Math.min(reconnectAttempts - 1, 5), 30_000);
      reconnectTimer = setTimeout(() => setRetryCount((count) => count + 1), delay);
    };

    return () => {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socketRef.current === socket) socketRef.current = null;
      pendingHistory.clear();
      for (const timeoutId of historyTimeouts.values()) window.clearTimeout(timeoutId);
      historyTimeouts.clear();
      subscribedSymbols.clear();
      subscriptionsBySymbol.clear();
      activeTickSymbolRef.current = "";
      socket?.close();
    };
  }, [retryCount]);

  useEffect(() => {
    if (!feedReady || !selectedSymbol || !socketRef.current ||
        socketRef.current.readyState !== WebSocket.OPEN) return;
    const socket = socketRef.current;

    const previousSymbol = activeTickSymbolRef.current;
    if (previousSymbol && previousSymbol !== selectedSymbol) {
      const previousSubscription = subscriptionsBySymbolRef.current.get(previousSymbol);
      if (previousSubscription) socket.send(JSON.stringify({ forget: previousSubscription }));
      subscriptionsBySymbolRef.current.delete(previousSymbol);
      subscribedSymbolsRef.current.delete(previousSymbol);
    }

    if (!subscribedSymbolsRef.current.has(selectedSymbol)) {
      const subscriptionReqId = ++requestSequenceRef.current;
      socket.send(JSON.stringify({ ticks: selectedSymbol, subscribe: 1, req_id: subscriptionReqId }));
      subscribedSymbolsRef.current.add(selectedSymbol);
    }
    activeTickSymbolRef.current = selectedSymbol;
    requestCandles(selectedSymbol, timeframe);
    // Always fetch M15 for signal structure and M1 for signal momentum
    if (timeframe !== 60) requestCandles(selectedSymbol, 60);
    if (timeframe !== 300) requestCandles(selectedSymbol, 300);
    if (timeframe !== 900) requestCandles(selectedSymbol, 900);
    // Always fetch H1 for SMC context regardless of chart timeframe
    if (timeframe !== 3600) requestCandles(selectedSymbol, 3600);
  }, [feedReady, selectedSymbol, timeframe, requestCandles]);

  useEffect(() => {
    setChartViewCount(VIEW_LIMIT);
    setChartViewOffset(0);
    setIsChartDragging(false);
    chartDragRef.current = null;
  }, [selectedSymbol, timeframe]);

  const activeInstrument = instruments.find((pair) => pair.symbol === selectedSymbol) ?? null;
  const activePair = activeInstrument;

  const filteredInstruments = useMemo(() => {
    if (selectedCategory === "all") return instruments;
    return instruments.filter((inst) => inst.market === selectedCategory);
  }, [instruments, selectedCategory]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: instruments.length };
    for (const inst of instruments) {
      counts[inst.market] = (counts[inst.market] ?? 0) + 1;
    }
    return counts;
  }, [instruments]);

  const handleCategorySelect = (category: MarketCategory) => {
    setSelectedCategory(category);
    const matching = category === "all" ? instruments : instruments.filter((inst) => inst.market === category);
    if (!matching.some((item) => item.symbol === selectedSymbol)) {
      const defaultForCat = CATEGORY_DEFAULT_SYMBOL[category];
      const next = matching.find((item) => item.symbol === defaultForCat) ?? matching[0];
      if (next) setSelectedSymbol(next.symbol);
    }
  };
  const liveQuote = quotesBySymbol[selectedSymbol] ?? null;
  const activeHistoryKey = keyFor(selectedSymbol, timeframe);
  const candles = candlesByKey[activeHistoryKey] ?? EMPTY_CANDLES;
  useEffect(() => {
    const tail = candles[candles.length - 1];
    const previous = lastViewportTailRef.current;
    if (previous?.key === activeHistoryKey && tail && tail.epoch > previous.epoch && chartViewOffset > 0) {
      const advancedBy = Math.max(1, Math.round((tail.epoch - previous.epoch) / timeframe));
      setChartViewOffset((current) => Math.min(Math.max(0, candles.length - chartViewCount), current + advancedBy));
    }
    lastViewportTailRef.current = { key: activeHistoryKey, epoch: tail?.epoch ?? 0 };
  }, [activeHistoryKey, candles, timeframe, chartViewOffset, chartViewCount]);

  const historyLoad = historyByKey[activeHistoryKey];
  const hasUsableHistory = historyLoad?.status === "loaded" && historyLoad.count >= 10;
  const currentBucket = Math.floor(Date.now() / 1000 / timeframe) * timeframe;
  const closedCandles = useMemo(
    () => candles.filter((candle) => candle.epoch + timeframe <= currentBucket),
    [candles, timeframe, currentBucket],
  );
  const analysis = useMemo(() => analyzeForexCandles(closedCandles), [closedCandles]);

  // M1 closed candles (always needed for signal, regardless of current timeframe)
  const m1Key = keyFor(selectedSymbol, 60);
  const m1Candles = candlesByKey[m1Key] ?? EMPTY_CANDLES;
  const closedM1Candles = useMemo(() => {
    const bucket = Math.floor(Date.now() / 1000 / 60) * 60;
    return m1Candles.filter((c) => c.epoch + 60 <= bucket);
  }, [m1Candles]);

  // M15 closed candles for structure
  const m15Key = keyFor(selectedSymbol, 900);
  const m15Candles = candlesByKey[m15Key] ?? EMPTY_CANDLES;
  const closedM15Candles = useMemo(() => {
    const bucket = Math.floor(Date.now() / 1000 / 900) * 900;
    return m15Candles.filter((c) => c.epoch + 900 <= bucket);
  }, [m15Candles]);

  // M5 closed candles for precision analyst displacement/BoS detection
  const m5Key = keyFor(selectedSymbol, 300);
  const m5Candles = candlesByKey[m5Key] ?? EMPTY_CANDLES;
  const closedM5Candles = useMemo(() => {
    const bucket = Math.floor(Date.now() / 1000 / 300) * 300;
    return m5Candles.filter((c) => c.epoch + 300 <= bucket);
  }, [m5Candles]);

  const m15Analysis = useMemo(() => analyzeForexCandles(closedM15Candles), [closedM15Candles]);

  const h1Key = keyFor(selectedSymbol, 3600);
  const h1Candles = candlesByKey[h1Key] ?? EMPTY_CANDLES;
  const closedH1Candles = useMemo(() => {
    const bucket = Math.floor(Date.now() / 1000 / 3600) * 3600;
    return h1Candles.filter((c) => c.epoch + 3600 <= bucket);
  }, [h1Candles]);

  const signalResult = useMemo(
    () => computeSignal(
      closedM1Candles,
      m15Analysis.structure,
      liveQuote?.bid,
      liveQuote?.ask,
    ),
    // Re-run on every tick (liveQuote) and whenever M1 candles update
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [closedM1Candles, m15Analysis.structure, liveQuote],
  );

  const smcSignal = useMemo(
    () => computeSmcSignal(closedM1Candles, closedM15Candles, closedH1Candles, liveQuote?.bid, liveQuote?.ask),
    [closedM1Candles, closedM15Candles, closedH1Candles, liveQuote],
  );
  const safeViewCount = Math.max(1, Math.min(chartViewCount, candles.length || chartViewCount));
  const maxViewOffset = Math.max(0, candles.length - safeViewCount);
  const safeViewOffset = Math.min(chartViewOffset, maxViewOffset);
  const visibleEnd = candles.length - safeViewOffset;
  const visibleCandles = candles.slice(Math.max(0, visibleEnd - safeViewCount), visibleEnd);
  const support = nearestZone(analysis.support, selectedSymbol, activeInstrument?.pipSize);
  const resistance = nearestZone(analysis.resistance, selectedSymbol, activeInstrument?.pipSize);
  const latestClosed = closedCandles[closedCandles.length - 1];
  const latestPattern = latestClosed
    ? analysis.patterns.find((pattern) => pattern.epoch === latestClosed.epoch) ?? null
    : null;
  const zoneHalfWidth = Math.max(analysis.atr * 0.1, Math.abs(analysis.lastPrice ?? 1) * 0.00001);
  const chart = useMemo(() => {
    const width = 1000;
    const height = 410;
    const left = 66;
    const right = 105;
    const top = 24;
    const bottom = 36;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const prices = visibleCandles.flatMap((candle) => [candle.high, candle.low]);
    const minRaw = prices.length ? Math.min(...prices) : 0;
    const maxRaw = prices.length ? Math.max(...prices) : 1;
    const rawRange = maxRaw - minRaw;
    const padding = rawRange > 0 ? rawRange * 0.09 : Math.max(Math.abs(maxRaw) * 0.0003, 0.00001);
    const min = minRaw - padding;
    const max = maxRaw + padding;
    const yFor = (price: number) => top + ((max - price) / (max - min)) * plotHeight;
    const barWidth = visibleCandles.length ? Math.max(2, Math.min(11, plotWidth / visibleCandles.length * 0.64)) : 4;
    const xForIndex = (index: number) => left + ((index + 0.5) / Math.max(visibleCandles.length, 1)) * plotWidth;
    return { width, height, left, right, top, bottom, plotWidth, plotHeight, min, max, yFor, barWidth, xForIndex };
  }, [visibleCandles]);

  const patternByEpoch = new Map<number, CandlePattern>(analysis.patterns.map((pattern): [number, CandlePattern] => [pattern.epoch, pattern]));
  const swingPoints = useMemo(() => findSwingPoints(closedCandles, 2), [closedCandles]);
  const swingLabels = useMemo(() => buildSwingLabels(swingPoints, analysis.atr), [swingPoints, analysis.atr]);

  // ── Layer 1: Trendlines ────────────────────────────────────────────────
  const trendlines = useMemo(() => buildTrendlines(swingPoints, analysis.structure), [swingPoints, analysis.structure]);

  // ── Layer 2: Sentiment ─────────────────────────────────────────────────
  const sentiment = useMemo(() => computeSentiment(closedCandles, analysis.structure), [closedCandles, analysis.structure]);

  // ── Layer 3: Volume Profile anchor epoch ──────────────────────────────
  const anchorEpoch = useMemo(() => {
    if (analysis.structure.bullish) {
      const lows = swingPoints.filter((s) => s.kind === 'low');
      return lows.length ? lows[lows.length - 1].epoch : (closedCandles[0]?.epoch ?? 0);
    } else if (analysis.structure.bearish) {
      const highs = swingPoints.filter((s) => s.kind === 'high');
      return highs.length ? highs[highs.length - 1].epoch : (closedCandles[0]?.epoch ?? 0);
    } else {
      const lows = swingPoints.filter((s) => s.kind === 'low');
      if (!lows.length) return closedCandles[0]?.epoch ?? 0;
      const lowest = lows.reduce((a, b) => a.price < b.price ? a : b);
      return lowest.epoch;
    }
  }, [analysis.structure, swingPoints, closedCandles]);

  const volumeProfile = useMemo(
    () => hasUsableHistory ? computeVolumeProfile(closedCandles, anchorEpoch, 40) : { buckets: [], poc: 0, vah: 0, val: 0 },
    [closedCandles, anchorEpoch, hasUsableHistory],
  );

  // ── Layer 4: Trade Setup ───────────────────────────────────────────────
  const tradeSetup = useMemo(
    () => computeTradeSetup(closedM1Candles, analysis.structure, sentiment, volumeProfile, liveQuote?.price ?? null, analysis.atr),
    [closedM1Candles, analysis.structure, sentiment, volumeProfile, liveQuote, analysis.atr],
  );

  // ── Precision Analyst ─────────────────────────────────────────────────
  // Session is held in a ref (mutable, not reactive) so candle feeds do not
  // cause render cycles. Display state is a plain JS snapshot from getState().
  type PrecisionSessionModule = typeof import("./precision-analyst.mjs");
  const precisionModuleRef = useRef<PrecisionSessionModule | null>(null);
  const precisionSessionRef = useRef<ReturnType<PrecisionSessionModule["createPrecisionSession"]> | null>(null);
  const [precisionState, setPrecisionState] = useState<PrecisionSnap | null>(null);
  const precisionSymbolRef = useRef<string>("");

  // Load the ESM module once
  useEffect(() => {
    import("./precision-analyst.mjs").then((mod) => {
      precisionModuleRef.current = mod;
    }).catch(() => { /* non-critical — card just won't show */ });
  }, []);

  // Reset session when symbol changes
  useEffect(() => {
    const mod = precisionModuleRef.current;
    if (!mod || !selectedSymbol) return;
    if (precisionSymbolRef.current === selectedSymbol) return;
    precisionSymbolRef.current = selectedSymbol;
    precisionSessionRef.current = mod.createPrecisionSession({
      symbol: selectedSymbol,
      accountBalance: 1000,
      maxRiskPct: 0.5,
      minRR: 1.5,
    });
    setPrecisionState(precisionSessionRef.current.getState() as PrecisionSnap);
  }, [selectedSymbol, precisionModuleRef.current]); // eslint-disable-line react-hooks/exhaustive-deps

  // Feed closed M15 candles to the precision session
  useEffect(() => {
    const session = precisionSessionRef.current;
    if (!session || !closedM15Candles.length) return;
    let snap = session.getState();
    for (const candle of closedM15Candles) {
      snap = session.onCandle(900, candle, {}) as typeof snap;
    }
    setPrecisionState(snap as PrecisionSnap);
  }, [closedM15Candles]); // eslint-disable-line react-hooks/exhaustive-deps

  // Feed closed M5 candles
  useEffect(() => {
    const session = precisionSessionRef.current;
    if (!session || !closedM5Candles.length) return;
    let snap = session.getState();
    for (const candle of closedM5Candles) {
      snap = session.onCandle(300, candle, {
        spread: liveQuote && liveQuote.bid !== undefined && liveQuote.ask !== undefined
          ? liveQuote.ask - liveQuote.bid
          : 0,
      }) as typeof snap;
    }
    setPrecisionState(snap as PrecisionSnap);
  }, [closedM5Candles]); // eslint-disable-line react-hooks/exhaustive-deps

  // Feed closed M1 candles
  useEffect(() => {
    const session = precisionSessionRef.current;
    if (!session || !closedM1Candles.length) return;
    let snap = session.getState();
    for (const candle of closedM1Candles) {
      snap = session.onCandle(60, candle, {
        spread: liveQuote && liveQuote.bid !== undefined && liveQuote.ask !== undefined
          ? liveQuote.ask - liveQuote.bid
          : 0,
      }) as typeof snap;
    }
    setPrecisionState(snap as PrecisionSnap);
  }, [closedM1Candles]); // eslint-disable-line react-hooks/exhaustive-deps

  // Feed live tick as synthetic M1 candle
  useEffect(() => {
    const session = precisionSessionRef.current;
    if (!session || !liveQuote) return;
    const bucket = Math.floor(liveQuote.epoch / 60) * 60;
    const syntheticCandle = {
      epoch: bucket,
      open: liveQuote.price,
      high: liveQuote.price,
      low: liveQuote.price,
      close: liveQuote.price,
    };
    const snap = session.onCandle(60, syntheticCandle, {
      spread: liveQuote.bid !== undefined && liveQuote.ask !== undefined
        ? liveQuote.ask - liveQuote.bid
        : 0,
    });
    setPrecisionState(snap as PrecisionSnap);
  }, [liveQuote]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusIsLive = liveQuote && Date.now() - liveQuote.epoch * 1000 < 60_000;
  const quoteAgeText = liveQuote
    ? Date.now() - liveQuote.epoch * 1000 > 0
      ? Math.round((Date.now() - liveQuote.epoch * 1000) / 1000) + "s ago"
      : "just now"
    : "No tick yet";

  return (
    <section className={styles.page} aria-label="Forex AI analyst">
      <header className={styles.pageHeader}>
        <div className={styles.pageTitleBlock}>
          <h1>AI Chart Analyst</h1>
          <p>Live price action, candle recognition and automatically mapped support/resistance.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
          <button type="button" className={styles.positionsToggleBtn}
            onClick={() => setPositionsPanelOpen((v) => !v)}
            aria-label={positionsPanelOpen ? "Hide open positions" : "Show open positions"}>
            {positionsPanelOpen ? "−" : "+"} Positions
          </button>
          <button type="button" className={styles.retryButton} onClick={() => setRetryCount((count) => count + 1)}>
            <span aria-hidden="true">↻</span> Reconnect feed
          </button>
          {positionsPanelOpen && (
            <LivePositionsPanel
              positions={positionLines}
              liveQuote={liveQuote ?? null}
              pipSize={activeInstrument?.pipSize}
              symbol={selectedSymbol}
              deviceId={mt5Device?.id}
              accountType={accountType}
              onClose={() => setPositionsPanelOpen(false)}
              onPositionClosed={() => {
                positionLinesFetchRef.current = Date.now();
              }}
            />
          )}
        </div>
      </header>

      <div className={styles.categoryBar} role="tablist" aria-label="Market categories">
        {CATEGORIES.map((cat) => {
          const count = categoryCounts[cat.id] ?? 0;
          if (cat.id !== "all" && count === 0) return null;
          const isActive = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={isActive ? styles.categoryTabActive : styles.categoryTab}
              onClick={() => handleCategorySelect(cat.id)}
            >
              <span>{cat.icon}</span>
              <span>{cat.label}</span>
              <span className={styles.categoryCount}>{count}</span>
            </button>
          );
        })}
      </div>

      <section className={styles.marketBar} aria-label="Chart controls">
        <label className={styles.pairSelector}>
          <span>INSTRUMENT ({filteredInstruments.length})</span>
          <select value={selectedSymbol} onChange={(event) => setSelectedSymbol(event.target.value)} disabled={!instruments.length}>
            {filteredInstruments.length ? (
              selectedCategory === "all" ? (
                CATEGORIES.filter((c) => c.id !== "all").map((cat) => {
                  const group = instruments.filter((inst) => inst.market === cat.id);
                  if (!group.length) return null;
                  return (
                    <optgroup key={cat.id} label={cat.label}>
                      {group.map((item) => (
                        <option key={item.symbol} value={item.symbol}>
                          {item.name} · {item.symbol}
                        </option>
                      ))}
                    </optgroup>
                  );
                })
              ) : (
                filteredInstruments.map((item) => (
                  <option key={item.symbol} value={item.symbol}>
                    {item.name} · {item.symbol}
                  </option>
                ))
              )
            ) : (
              <option value={selectedSymbol}>Discovering available markets…</option>
            )}
          </select>
        </label>
        <div className={styles.timeframeGroup} role="group" aria-label="Chart timeframe">
          <span>TIMEFRAME</span>
          <div className={styles.timeframeButtons}>
            {TIMEFRAMES.map((item) => (
              <button
                key={item.seconds}
                type="button"
                className={timeframe === item.seconds ? styles.timeframeActive : styles.timeframeButton}
                aria-pressed={timeframe === item.seconds}
                onClick={() => setTimeframe(item.seconds)}
              >{item.label}</button>
            ))}
          </div>
        </div>
        <div className={styles.quoteBox}>
          <span>LAST PRICE</span>
          <strong>{liveQuote ? formatPrice(liveQuote.price, selectedSymbol, activeInstrument?.pipSize) : "—"}</strong>
          <small className={statusIsLive ? styles.liveText : styles.mutedText}>{liveQuote ? quoteAgeText : feedReady ? "Waiting for ticks" : feedStatus}</small>
        </div>
      </section>

      <div className={styles.connectionLine} data-live={Boolean(statusIsLive)}>
        <span className={styles.statusDot} />
        <span>{feedStatus}</span>
        <span className={styles.connectionRight}>{activePair?.name ?? "Forex symbols"} · {timeframe === 60 ? "1 minute" : timeframe === 300 ? "5 minutes" : timeframe === 900 ? "15 minutes" : "1 hour"}</span>
      </div>

      <section className={styles.marketQuotePanel} aria-label="Market quote and spread">
        <div className={styles.marketQuoteHeader}>
          <div>
            <span className={styles.sectionEyebrow}>LIVE MARKET QUOTE</span>
            <h2>Bid / Ask / Spread</h2>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className={liveQuote && calculateQuoteSpread(liveQuote.bid, liveQuote.ask) !== undefined ? styles.quoteFresh : styles.quoteUnavailable}>
              {liveQuote
                ? calculateQuoteSpread(liveQuote.bid, liveQuote.ask) !== undefined
                  ? "Live Bid / Ask available"
                  : "Tick received · Bid / Ask unavailable"
                : "Waiting for quote"}
            </span>
            <button
              type="button"
              onClick={() => setQuotePanelOpen((v) => !v)}
              aria-expanded={quotePanelOpen}
              aria-label={quotePanelOpen ? "Hide quote details" : "Show quote details"}
              className={styles.quotePanelToggle}
            >
              {quotePanelOpen ? "−" : "+"}
            </button>
          </div>
        </div>
        {quotePanelOpen && (
          <>
            <div className={styles.marketQuoteGrid}>
              <div className={styles.marketQuoteCell}>
                <span>Last quote</span>
                <strong>{liveQuote ? formatPrice(liveQuote.price, selectedSymbol, activeInstrument?.pipSize) : "—"}</strong>
                <small>{liveQuote ? "Provider tick · " + formatTime(liveQuote.epoch) : "No live tick received"}</small>
              </div>
              <div className={styles.marketQuoteCell}>
                <span>Bid · Sell price</span>
                <strong className={liveQuote?.bid !== undefined ? styles.bidValue : styles.quoteUnavailableValue}>
                  {liveQuote?.bid !== undefined ? formatPrice(liveQuote.bid, selectedSymbol, activeInstrument?.pipSize) : "Unavailable"}
                </strong>
                <small>{liveQuote?.bid !== undefined ? "Provider-supplied Bid" : "Not present in this tick"}</small>
              </div>
              <div className={styles.marketQuoteCell}>
                <span>Ask · Buy price</span>
                <strong className={liveQuote?.ask !== undefined ? styles.askValue : styles.quoteUnavailableValue}>
                  {liveQuote?.ask !== undefined ? formatPrice(liveQuote.ask, selectedSymbol, activeInstrument?.pipSize) : "Unavailable"}
                </strong>
                <small>{liveQuote?.ask !== undefined ? "Provider-supplied Ask" : "Not present in this tick"}</small>
              </div>
              <div className={styles.marketQuoteCell}>
                <span>Spread</span>
                <strong className={liveQuote && calculateQuoteSpread(liveQuote.bid, liveQuote.ask) !== undefined ? styles.spreadValue : styles.quoteUnavailableValue}>
                  {liveQuote && calculateQuoteSpread(liveQuote.bid, liveQuote.ask) !== undefined
                    ? formatPrice(calculateQuoteSpread(liveQuote.bid, liveQuote.ask)!, selectedSymbol, activeInstrument?.pipSize)
                    : "Unavailable"}
                </strong>
                <small>{liveQuote && calculateQuoteSpread(liveQuote.bid, liveQuote.ask) !== undefined
                  ? "Ask − Bid · price units"
                  : "Requires valid Bid and Ask"}</small>
              </div>
            </div>
            <p className={styles.quoteDisclosure}>
              Bid, Ask and spread are shown only when supplied by the provider in the same tick and the prices are valid. Spread is displayed in price units; it is not converted to pips because the feed&apos;s pip-size semantics have not yet been independently verified. Buy/Sell order execution is not provided by this panel.
            </p>
          </>
        )}
      </section>

      <div className={styles.analysisLayout}>
        <div className={styles.analysisMain}>
      <section className={styles.chartPanel} aria-label="Annotated candlestick chart">
        <div className={styles.chartHeading}>
          <div>
            <span className={styles.sectionEyebrow}>PRICE STRUCTURE</span>
            <h2>{activePair?.name ?? "Forex chart"} <small>{selectedSymbol}</small></h2>
          </div>
          <div className={styles.legend}>
            <span><i className={styles.bullSwatch} /> Bullish</span>
            <span><i className={styles.bearSwatch} /> Bearish</span>
            <span><i className={styles.supportSwatch} /> Support</span>
            <span><i className={styles.resistSwatch} /> Resistance</span>
          </div>
        </div>

        {hasUsableHistory && visibleCandles.length > 1 ? (
          <>
          <div className={styles.chartInteractionBar}>
            <span>Scroll to zoom · drag to pan · live ticks continue in the background</span>
            <div className={styles.chartInteractionActions}>
              <span>{safeViewOffset > 0 ? "Historical view" : "Live edge"} · {visibleCandles.length} bars</span>
              {safeViewOffset > 0 && <button type="button" className={styles.returnLiveButton} onClick={() => setChartViewOffset(0)}>Return to live ↗</button>}
            </div>
          </div>
          <div className={styles.chartViewport}>
            <svg
              viewBox={"0 0 " + chart.width + " " + chart.height}
              role="img"
              aria-label={activePair?.name + " candlestick chart with automatic analysis. Use mouse wheel to zoom and drag to pan."}
              className={isChartDragging ? styles.chartDragging : styles.chartInteractive}
              onWheel={(event) => {
                event.preventDefault();
                if (candles.length < 2 || event.deltaY === 0) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                if (!bounds.width) return;
                const svgX = ((event.clientX - bounds.left) / bounds.width) * chart.width;
                const cursorRatio = Math.max(0, Math.min(1, (svgX - chart.left) / chart.plotWidth));
                const next = zoomChartViewport({
                  candlesLength: candles.length,
                  viewCount: safeViewCount,
                  viewOffset: safeViewOffset,
                  cursorRatio,
                  deltaY: event.deltaY,
                });
                setChartViewCount(next.viewCount);
                setChartViewOffset(next.viewOffset);
              }}
              onPointerDown={(event) => {
                if (event.button !== 0 || candles.length <= safeViewCount) return;
                chartDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startOffset: safeViewOffset };
                setIsChartDragging(true);
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const drag = chartDragRef.current;
                if (!drag || drag.pointerId !== event.pointerId) return;
                const deltaBars = Math.round(((event.clientX - drag.startX) / Math.max(1, event.currentTarget.getBoundingClientRect().width)) * chart.width * safeViewCount / chart.plotWidth);
                const next = panChartViewport({
                  candlesLength: candles.length,
                  viewCount: safeViewCount,
                  viewOffset: drag.startOffset,
                  deltaBars,
                });
                setChartViewOffset(next.viewOffset);
              }}
              onPointerUp={(event) => {
                if (chartDragRef.current?.pointerId === event.pointerId) {
                  chartDragRef.current = null;
                  setIsChartDragging(false);
                }
              }}
              onPointerCancel={() => { chartDragRef.current = null; setIsChartDragging(false); }}
            >
              {[0, 1, 2, 3, 4].map((step) => {
                const y = chart.top + step * (chart.plotHeight / 4);
                const price = chart.max - step * ((chart.max - chart.min) / 4);
                return <g key={step}>
                  <line x1={chart.left} y1={y} x2={chart.width - chart.right} y2={y} className={styles.gridLine} />
                  <text x={chart.left - 10} y={y + 4} textAnchor="end" className={styles.axisLabel}>{formatPrice(price, selectedSymbol, activeInstrument?.pipSize)}</text>
                </g>;
              })}

              {/* ── Layer 3: Volume Profile histogram ─────────────────── */}
              {hasUsableHistory && volumeProfile.buckets.length > 0 && (() => {
                const maxWeight = Math.max(...volumeProfile.buckets.map((b) => b.weight), 1);
                const bucketHeight = chart.plotHeight / volumeProfile.buckets.length;
                return (
                  <g key="volume-profile">
                    {volumeProfile.buckets.map((bucket, i) => {
                      const barWidth = Math.max(1, (bucket.weight / maxWeight) * 50);
                      const bucketY = chart.yFor(bucket.price + (chart.max - chart.min) / volumeProfile.buckets.length / 2);
                      const bh = Math.max(1, bucketHeight);
                      const fill = bucket.isPoc
                        ? '#f4bb55'
                        : bucket.isVa
                          ? 'rgba(16,185,129,0.15)'
                          : 'rgba(148,163,184,0.12)';
                      return (
                        <rect
                          key={i}
                          x={chart.left}
                          y={bucketY - bh / 2}
                          width={barWidth}
                          height={bh}
                          fill={fill}
                          className={bucket.isPoc ? styles.vpBarPoc : bucket.isVa ? styles.vpBarVa : styles.vpBar}
                        />
                      );
                    })}
                    {/* POC label on bars */}
                    {(() => {
                      const pocBucket = volumeProfile.buckets.find((b) => b.isPoc);
                      if (!pocBucket) return null;
                      const pocWeight = Math.max(1, (pocBucket.weight / maxWeight) * 50);
                      const pocY = chart.yFor(pocBucket.price);
                      return (
                        <text x={chart.left + pocWeight + 3} y={pocY + 3} className={styles.structureBadge} style={{ fill: '#f4bb55', fontSize: '7px', fontWeight: 900 }}>POC</text>
                      );
                    })()}
                  </g>
                );
              })()}

              {/* ── POC / VAH / VAL horizontal lines ──────────────────── */}
              {hasUsableHistory && volumeProfile.poc > 0 && (() => {
                const pocY = chart.yFor(volumeProfile.poc);
                const vahY = chart.yFor(volumeProfile.vah);
                const valY = chart.yFor(volumeProfile.val);
                const rightX = chart.width - chart.right;
                return (
                  <g key="poc-vah-val">
                    {pocY >= chart.top && pocY <= chart.height - chart.bottom && (
                      <g>
                        <line x1={chart.left} y1={pocY} x2={rightX} y2={pocY} className={styles.pocLine} />
                        <text x={rightX + 3} y={pocY - 2} className={styles.smcZoneLabel} style={{ fill: '#f4bb55', fontSize: '8px' }}>
                          POC {formatPrice(volumeProfile.poc, selectedSymbol, activeInstrument?.pipSize)}
                        </text>
                      </g>
                    )}
                    {vahY >= chart.top && vahY <= chart.height - chart.bottom && (
                      <g>
                        <line x1={chart.left} y1={vahY} x2={rightX} y2={vahY} className={styles.vahLine} />
                        <text x={rightX + 3} y={vahY - 2} className={styles.smcZoneLabel} style={{ fill: '#10b981', fontSize: '8px' }}>VAH</text>
                      </g>
                    )}
                    {valY >= chart.top && valY <= chart.height - chart.bottom && (
                      <g>
                        <line x1={chart.left} y1={valY} x2={rightX} y2={valY} className={styles.valLine} />
                        <text x={rightX + 3} y={valY + 9} className={styles.smcZoneLabel} style={{ fill: '#ff7b87', fontSize: '8px' }}>VAL</text>
                      </g>
                    )}
                  </g>
                );
              })()}

              {analysis.support.map((zone, index) => {
                const top = chart.yFor(zone.price + zoneHalfWidth);
                const bottom = chart.yFor(zone.price - zoneHalfWidth);
                if (bottom < chart.top || top > chart.height - chart.bottom) return null;
                return <g key={"support-" + zone.price}>
                  <rect x={chart.left} y={top} width={chart.plotWidth} height={Math.max(2, bottom - top)} className={styles.supportBand} />
                  <line x1={chart.left} y1={chart.yFor(zone.price)} x2={chart.width - chart.right} y2={chart.yFor(zone.price)} className={styles.supportLine} />
                  <text x={chart.width - chart.right + 7} y={chart.yFor(zone.price) - 3} className={styles.zoneLabel}>S{index + 1}</text>
                </g>;
              })}

              {analysis.resistance.map((zone, index) => {
                const top = chart.yFor(zone.price + zoneHalfWidth);
                const bottom = chart.yFor(zone.price - zoneHalfWidth);
                if (bottom < chart.top || top > chart.height - chart.bottom) return null;
                return <g key={"resistance-" + zone.price}>
                  <rect x={chart.left} y={top} width={chart.plotWidth} height={Math.max(2, bottom - top)} className={styles.resistanceBand} />
                  <line x1={chart.left} y1={chart.yFor(zone.price)} x2={chart.width - chart.right} y2={chart.yFor(zone.price)} className={styles.resistanceLine} />
                  <text x={chart.width - chart.right + 7} y={chart.yFor(zone.price) - 3} className={styles.zoneLabel}>R{index + 1}</text>
                </g>;
              })}

              {(timeframe === 60 || timeframe === 900) && (() => {
                const levels = smcSignal.h1Levels;
                const sweepEpoch = smcSignal.m15SweepEpoch;
                const bosLevel = smcSignal.bosLevel;
                return (
                  <>
                    {/* BSL levels — dotted blue lines */}
                    {levels.bsl.map((price) => {
                      const y = chart.yFor(price);
                      if (y < chart.top || y > chart.height - chart.bottom) return null;
                      return (
                        <g key={'bsl-' + price}>
                          <line x1={chart.left} y1={y} x2={chart.width - chart.right} y2={y} className={styles.bslLine} />
                          <text x={chart.width - chart.right + 3} y={y - 2} className={styles.smcZoneLabel}>BSL</text>
                        </g>
                      );
                    })}
                    {/* SSL levels — dotted orange lines */}
                    {levels.ssl.map((price) => {
                      const y = chart.yFor(price);
                      if (y < chart.top || y > chart.height - chart.bottom) return null;
                      return (
                        <g key={'ssl-' + price}>
                          <line x1={chart.left} y1={y} x2={chart.width - chart.right} y2={y} className={styles.sslLine} />
                          <text x={chart.width - chart.right + 3} y={y - 2} className={styles.smcZoneLabel}>SSL</text>
                        </g>
                      );
                    })}
                    {/* BoS level */}
                    {bosLevel !== null && (() => {
                      const y = chart.yFor(bosLevel);
                      if (y < chart.top || y > chart.height - chart.bottom) return null;
                      const bosLabel = smcSignal.signal === 'BUY' ? 'BoS ↑' : 'BoS ↓';
                      return (
                        <g key='bos-level'>
                          <line x1={chart.left} y1={y} x2={chart.width - chart.right} y2={y} className={styles.bosLine} />
                          <text x={chart.left + 4} y={y - 3} className={styles.smcZoneLabel}>{bosLabel}</text>
                        </g>
                      );
                    })()}
                    {/* Sweep candle marker */}
                    {sweepEpoch !== null && visibleCandles.map((candle, index) => {
                      if (candle.epoch !== sweepEpoch) return null;
                      const x = chart.xForIndex(index);
                      const isBsl = smcSignal.type === 'BSL_SWEEP_BOS';
                      if (isBsl) {
                        const y = chart.yFor(candle.high) - 8;
                        return <polygon key='sweep-marker' points={`${x},${y} ${x - 4},${y - 7} ${x + 4},${y - 7}`} className={styles.sweepMarkerBear} />;
                      } else {
                        const y = chart.yFor(candle.low) + 8;
                        return <polygon key='sweep-marker' points={`${x},${y} ${x - 4},${y + 7} ${x + 4},${y + 7}`} className={styles.sweepMarkerBull} />;
                      }
                    })}
                  </>
                );
              })()}

              {/* ── Layer 1: Trendlines ─────────────────────────────── */}
              {hasUsableHistory && (() => {
                const epochToX = (epoch: number): number | null => {
                  const idx = visibleCandles.findIndex((c) => c.epoch === epoch);
                  if (idx >= 0) return chart.xForIndex(idx);
                  if (!visibleCandles.length) return null;
                  const first = visibleCandles[0];
                  const last = visibleCandles[visibleCandles.length - 1];
                  if (timeframe <= 0) return null;
                  if (epoch < first.epoch) {
                    const barsBack = (first.epoch - epoch) / timeframe;
                    return chart.xForIndex(-barsBack);
                  }
                  const barsAhead = (epoch - last.epoch) / timeframe;
                  return chart.xForIndex(visibleCandles.length - 1 + barsAhead);
                };

                return (
                  <g key="trendlines">
                    {trendlines.uptrend && trendlines.uptrend.length >= 2 && (() => {
                      const pts = trendlines.uptrend!;
                      return pts.slice(0, -1).map((pt, i) => {
                        const x1 = epochToX(pt.epoch);
                        const x2 = epochToX(pts[i + 1].epoch);
                        if (x1 === null || x2 === null) return null;
                        return <line key={'up-' + i} x1={x1} y1={chart.yFor(pt.price)} x2={x2} y2={chart.yFor(pts[i + 1].price)} className={styles.trendlineUp} />;
                      });
                    })()}
                    {trendlines.downtrend && trendlines.downtrend.length >= 2 && (() => {
                      const pts = trendlines.downtrend!;
                      return pts.slice(0, -1).map((pt, i) => {
                        const x1 = epochToX(pt.epoch);
                        const x2 = epochToX(pts[i + 1].epoch);
                        if (x1 === null || x2 === null) return null;
                        return <line key={'dn-' + i} x1={x1} y1={chart.yFor(pt.price)} x2={x2} y2={chart.yFor(pts[i + 1].price)} className={styles.trendlineDown} />;
                      });
                    })()}
                  </g>
                );
              })()}

              {visibleCandles.map((candle, index) => {
                const x = chart.xForIndex(index);
                const openY = chart.yFor(candle.open);
                const closeY = chart.yFor(candle.close);
                const highY = chart.yFor(candle.high);
                const lowY = chart.yFor(candle.low);
                const bullish = candle.close >= candle.open;
                const bodyTop = Math.min(openY, closeY);
                const bodyHeight = Math.max(1.4, Math.abs(closeY - openY));
                const pattern = patternByEpoch.get(candle.epoch);
                const swing = swingLabels.get(candle.epoch);
                const inAnalysis = analysis.candles.some((item) => item.epoch === candle.epoch);
                const label = pattern ? shortPattern(pattern.label) : "";
                return <g key={candle.epoch}>
                  <line x1={x} y1={highY} x2={x} y2={lowY} className={bullish ? styles.bullWick : styles.bearWick} />
                  <rect
                    x={x - chart.barWidth / 2}
                    y={bodyTop}
                    width={chart.barWidth}
                    height={bodyHeight}
                    rx="0.7"
                    className={bullish ? styles.bullBody : styles.bearBody}
                  />
                  {swing && inAnalysis && <text
                    x={x}
                    y={swing === "HH" || swing === "LH" || swing === "EQH" || swing === "SH"
                      ? Math.max(chart.top + 10, highY - 10)
                      : Math.min(chart.height - chart.bottom - 4, lowY + 14)}
                    textAnchor="middle"
                    className={styles.structureLabel}
                  >{swing}</text>}
                  {label && inAnalysis && <text
                    x={x}
                    y={pattern?.bias === "bearish" ? Math.max(chart.top + 12, highY - 25) : Math.min(chart.height - chart.bottom - 8, lowY + 29)}
                    textAnchor="middle"
                    className={pattern?.bias === "bullish" ? styles.bullPattern : pattern?.bias === "bearish" ? styles.bearPattern : styles.neutralPattern}
                  >{label}</text>}
                </g>;
              })}

              <text x={chart.left} y={chart.height - 10} className={styles.axisLabel}>
                {visibleCandles[0] ? formatTime(visibleCandles[0].epoch, true) : ""}
              </text>
              <text x={chart.width - chart.right} y={chart.height - 10} textAnchor="end" className={styles.axisLabel}>
                {visibleCandles.length ? formatTime(visibleCandles[visibleCandles.length - 1].epoch, true) : ""}
              </text>

              {/* ── Structure badge (top-left of plot area) ──────────── */}
              {hasUsableHistory && (() => {
                const label = analysis.structure.bullish ? 'UPTREND' : analysis.structure.bearish ? 'DOWNTREND' : 'RANGE';
                const badgeColor = analysis.structure.bullish ? '#22c985' : analysis.structure.bearish ? '#ff7b87' : '#f59e0b';
                const bgColor = analysis.structure.bullish ? 'rgba(34,201,133,0.15)' : analysis.structure.bearish ? 'rgba(255,123,135,0.15)' : 'rgba(245,158,11,0.15)';
                const badgeX = chart.left + 6;
                const badgeY = chart.top + 6;
                const textWidth = label.length * 5.5 + 10;
                return (
                  <g key="structure-badge">
                    <rect x={badgeX} y={badgeY} width={textWidth} height={14} rx="3" fill={bgColor} />
                    <text x={badgeX + textWidth / 2} y={badgeY + 10} textAnchor="middle" className={styles.structureBadge} style={{ fill: badgeColor, fontSize: '9px', fontWeight: 900 }}>{label}</text>
                  </g>
                );
              })()}

              {/* ── Position entry lines ─────────────────────────────── */}
              {positionLines.map((pos) => {
                const y = chart.yFor(pos.open_price);
                if (y < chart.top || y > chart.height - chart.bottom) return null;
                const isBuy = pos.order_side === "buy";
                const lineClass = isBuy ? styles.positionLineBuy : styles.positionLineSell;
                const tagClass  = isBuy ? styles.positionTagBuy  : styles.positionTagSell;
                const txtClass  = isBuy ? styles.positionTextBuy : styles.positionTextSell;
                const label = formatPrice(pos.open_price, selectedSymbol, activeInstrument?.pipSize);
                const sideLabel = isBuy ? "B" : "S";
                return (
                  <g key={pos.id}>
                    <line x1={chart.left} y1={y} x2={chart.width - chart.right} y2={y} className={lineClass} />
                    <rect x={chart.left - 18} y={y - 9} width={18} height={18} rx="3" className={tagClass} />
                    <text x={chart.left - 9} y={y + 4} textAnchor="middle" className={txtClass}>{sideLabel}</text>
                    <rect x={chart.width - chart.right + 3} y={y - 10} width={chart.right - 9} height="20" rx="4" className={tagClass} />
                    <text x={chart.width - chart.right + (chart.right - 9) / 2 + 3} y={y + 4} textAnchor="middle" className={txtClass}>{label}</text>
                  </g>
                );
              })}

              {liveQuote && safeViewOffset === 0 && <g>
                <line x1={chart.left} y1={chart.yFor(liveQuote.price)} x2={chart.width - chart.right} y2={chart.yFor(liveQuote.price)} className={styles.lastPriceLine} />
                <rect x={chart.width - chart.right + 3} y={chart.yFor(liveQuote.price) - 10} width={chart.right - 9} height="20" rx="4" className={styles.lastPriceTag} />
                <text x={chart.width - chart.right + (chart.right - 9) / 2 + 3} y={chart.yFor(liveQuote.price) + 4} textAnchor="middle" className={styles.lastPriceText}>{formatPrice(liveQuote.price, selectedSymbol, activeInstrument?.pipSize)}</text>
              </g>}            </svg>
          </div>
          </>
        ) : (
          <div className={styles.emptyChart}>
            <span className={styles.emptyIcon}>⌁</span>
            <strong>{!feedReady
              ? "Waiting for market connection"
              : historyLoad?.status === "error"
                ? "Historical candles could not be loaded"
                : historyLoad?.status === "insufficient"
                  ? "Not enough historical candles"
                  : "Loading real candle history"}</strong>
            <p>{historyLoad?.message ?? (historyLoad?.status === "loading"
              ? "Requesting " + CANDLE_LIMIT + " historical OHLC candles for the selected pair and timeframe."
              : feedReady
                ? "Live quotes are separate from OHLC history. The chart will appear after enough real historical candles arrive."
                : feedStatus)}</p>
            {feedReady && historyLoad?.status !== "loading" && <button type="button" className={styles.retryButton} onClick={() => requestCandles(selectedSymbol, timeframe)}>Retry candle history</button>}
          </div>
        )}
        <div className={styles.chartFooter}>
          <span>{visibleCandles.length} candles in view · {closedCandles.length} closed bars used for analysis</span>
          <span>Pattern labels appear only on closed candles</span>
        </div>
      </section>

      {/* ── Layer 2: Sentiment Bar ──────────────────────────────────────── */}
      <SentimentBar sentiment={sentiment} />

      <section className={styles.insightGrid} aria-label="Chart analysis summary">
        <article className={styles.insightCard}>
          <div className={styles.insightCardHeader}><span className={styles.insightIcon}>⌁</span><span>MARKET STRUCTURE</span></div>
          <strong className={analysis.structure.bullish ? styles.bullValue : analysis.structure.bearish ? styles.bearValue : styles.neutralValue}>{analysis.structure.label}</strong>
          <p>{analysis.structure.detail}</p>
          <div className={styles.smallNote}>Based on confirmed swing highs and lows</div>
        </article>
        <article className={styles.insightCard}>
          <div className={styles.insightCardHeader}><span className={styles.insightIcon}>◉</span><span>LATEST CLOSED CANDLE</span></div>
          <strong>{latestPattern?.label ?? "No named pattern"}</strong>
          <p>{latestPattern
            ? (latestPattern.bias === "bullish" ? "Bullish-shaped pattern" : latestPattern.bias === "bearish" ? "Bearish-shaped pattern" : "Neutral candle geometry") + " · " + formatTime(latestPattern.epoch, true)
            : "No tracked formation met the configured rules on the most recent closed candle."}</p>
          <div className={styles.smallNote}>Geometry only; context still matters</div>
        </article>
        <article className={styles.insightCard}>
          <div className={styles.insightCardHeader}><span className={styles.insightIcon}>⌄</span><span>NEAREST SUPPORT</span></div>
          <strong className={styles.bullValue}>{support?.priceText ?? "Not identified"}</strong>
          <p>{support ? support.touches + " nearby confirmed swing " + (support.touches === 1 ? "touch" : "touches") : "More historical swing points are needed."}</p>
          <div className={styles.smallNote}>Price zone · not guaranteed to hold</div>
        </article>
        <article className={styles.insightCard}>
          <div className={styles.insightCardHeader}><span className={styles.insightIcon}>⌃</span><span>NEAREST RESISTANCE</span></div>
          <strong className={styles.bearValue}>{resistance?.priceText ?? "Not identified"}</strong>
          <p>{resistance ? resistance.touches + " nearby confirmed swing " + (resistance.touches === 1 ? "touch" : "touches") : "More historical swing points are needed."}</p>
          <div className={styles.smallNote}>Price zone · not guaranteed to hold</div>
        </article>
      </section>

      <section className={styles.patternPanel}>
        <div className={styles.chartHeading}>
          <div>
            <span className={styles.sectionEyebrow}>PATTERN RECOGNITION</span>
            <h2>Recent candle observations</h2>
          </div>
          <span className={styles.panelCount}>{analysis.patterns.length} patterns in loaded history</span>
        </div>
        {analysis.patterns.length ? (
          <div className={styles.patternList}>
            {analysis.patterns.slice(-8).reverse().map((pattern: CandlePattern) => (
              <div className={styles.patternRow} key={pattern.epoch + pattern.label}>
                <span className={pattern.bias === "bullish" ? styles.patternBullDot : pattern.bias === "bearish" ? styles.patternBearDot : styles.patternNeutralDot} />
                <div className={styles.patternName}><strong>{pattern.label}</strong><small>{formatTime(pattern.epoch, true)}</small></div>
                <span className={pattern.bias === "bullish" ? styles.bullBadge : pattern.bias === "bearish" ? styles.bearBadge : styles.neutralBadge}>
                  {pattern.bias === "neutral" ? "NEUTRAL" : pattern.bias.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.emptyPatterns}><strong>No tracked pattern yet</strong><p>As real OHLC bars arrive, TradeBridge checks a defined set of common patterns. The absence of a label is not a market signal.</p></div>
        )}
      </section>

      <footer className={styles.disclaimer}>
        <strong>Analysis, not a trading signal.</strong> Levels and pattern labels are deterministic interpretations of the received OHLC bars, not predictions. No orders are placed. Verify prices against your Deriv MT5 terminal before using this page for market decisions.
      </footer>
        </div>
        <div className={styles.analysisRight}>
          <SignalCard result={signalResult} symbol={selectedSymbol} pipSize={activeInstrument?.pipSize} />
          <SmcSignalCard result={smcSignal} symbol={selectedSymbol} pipSize={activeInstrument?.pipSize} />
          <TradeSetupCard setup={tradeSetup} symbol={selectedSymbol} pipSize={activeInstrument?.pipSize} />
          <PrecisionSignalCard snap={precisionState} symbol={selectedSymbol} pipSize={activeInstrument?.pipSize} />
          <ForexOrderPanel
            symbol={selectedSymbol}
            instrumentName={activePair?.name ?? selectedSymbol}
            lastPrice={liveQuote?.price}
            bid={liveQuote?.bid}
            ask={liveQuote?.ask}
            quoteEpoch={liveQuote?.epoch}
            pipSize={activeInstrument?.pipSize}
            deviceId={mt5Device?.id}
            accountType={accountType}
          />
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// LivePositionsPanel — real-time open position P&L
// ---------------------------------------------------------------------------
interface LivePositionEntry {
  id: string;
  mt5_ticket: number;
  symbol: string;
  order_side: "buy" | "sell";
  volume: string;
  open_price: number;
  current_price: number;
  floating_pl: number;
  stop_loss?: number | null;
  take_profit?: number | null;
  account_type: string;
  is_open: boolean;
  opened_at: string;
  closed_at?: string | null;
}

function LivePositionsPanel({
  positions, liveQuote, pipSize, symbol, deviceId, accountType, onClose, onPositionClosed,
}: {
  positions: LivePositionEntry[];
  liveQuote: { price: number; bid?: number; ask?: number; epoch: number } | null;
  pipSize?: number;
  symbol: string;
  deviceId?: string;
  accountType?: "demo" | "real";
  onClose: () => void;
  onPositionClosed: () => void;
}) {
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

  const quoteFresh = liveQuote != null && Date.now() - liveQuote.epoch * 1000 < 60_000;

  const brokerSym = symbol.startsWith("frx") || symbol.startsWith("cry")
    ? symbol.slice(3) : symbol.startsWith("OTC_") ? symbol.slice(4) : symbol;

  function fmtP(v: number) {
    const dec = pipSize && pipSize > 0 && pipSize < 1
      ? Math.min(8, String(pipSize).replace(/.*\./, "").length)
      : symbol.startsWith("cry") ? 2 : 5;
    return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: dec }).format(v);
  }

  function fmtDollar(v: number) {
    const abs = Math.abs(v);
    return (v >= 0 ? "+" : "−") + "$" + abs.toFixed(2);
  }

  async function handleClose(pos: LivePositionEntry) {
    if (!deviceId || !pos.mt5_ticket) return;
    if (accountType === "real") {
      if (!window.confirm(`⚠ REAL ACCOUNT — Close #${pos.mt5_ticket} (${pos.order_side} ${pos.volume} lots)?`)) return;
    }
    setClosingId(pos.id);
    setCloseError(null);
    try {
      const res = await fetch(`/api/mt5/devices/${deviceId}/position-commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command_type: "close",
          mt5_position_ticket: pos.mt5_ticket,
          account_type: accountType ?? "demo",
          idempotency_key: `close-${pos.id}-${Date.now()}`,
          expires_in_seconds: 60,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { detail?: string };
        setCloseError(d.detail ?? `HTTP ${res.status}`);
      } else {
        onPositionClosed();
      }
    } catch { setCloseError("Network error"); }
    finally { setClosingId(null); }
  }

  const totalDollars = positions.reduce((sum, p) => sum + p.floating_pl, 0);

  return (
    <div className={styles.positionsOverlay} role="dialog" aria-label="Open positions">
      <div className={styles.positionsOverlayHeader}>
        <span className={styles.sectionEyebrow}>OPEN POSITIONS · {brokerSym}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={quoteFresh ? styles.posLiveDot : styles.posStaleDot}>
            <i /> {quoteFresh ? "LIVE" : "STALE"}
          </span>
          <button type="button" className={styles.posOverlayClose} onClick={onClose} aria-label="Close panel">✕</button>
        </div>
      </div>

      {positions.length === 0
        ? <p className={styles.positionsEmpty}>No open positions for {brokerSym} yet.</p>
        : (
          <div className={styles.positionsList}>
            {positions.map((pos) => {
              const isProfit = pos.floating_pl >= 0;
              return (
                <div key={pos.id} className={styles.positionRow}>
                  <span className={pos.order_side === "buy" ? styles.posBuyBadge : styles.posSellBadge}>
                    {pos.order_side === "buy" ? "▲" : "▼"}
                  </span>
                  <div className={styles.positionMeta}>
                    <strong>{pos.volume} lot{parseFloat(pos.volume) !== 1 ? "s" : ""}</strong>
                    <span className={styles.posEntryPrice}>@ {fmtP(pos.open_price)}</span>
                    {pos.stop_loss != null && pos.stop_loss > 0 && (
                      <span className={styles.posSlTp}>SL: {fmtP(pos.stop_loss)}</span>
                    )}
                    {pos.take_profit != null && pos.take_profit > 0 && (
                      <span className={styles.posSlTp}>TP: {fmtP(pos.take_profit)}</span>
                    )}
                  </div>
                  <div className={styles.positionPnl}>
                    <span className={styles.posCurrentPrice}>{fmtP(pos.current_price)}</span>
                    <span className={isProfit ? styles.posProfit : styles.posLoss}>
                      {isProfit ? "Profit" : "Loss"} {fmtDollar(pos.floating_pl)}
                    </span>
                  </div>
                  <button type="button" className={styles.posCloseBtn}
                    disabled={closingId === pos.id || !deviceId || !pos.mt5_ticket}
                    onClick={() => void handleClose(pos)}
                    title={!pos.mt5_ticket ? "No ticket — close in MT5" : "Close position"}>
                    {closingId === pos.id ? "…" : "✕"}
                  </button>
                </div>
              );
            })}
          </div>
        )}

      {positions.length > 0 && (
        <div className={styles.positionsTotals}>
          <span>Total</span>
          <span className={totalDollars >= 0 ? styles.posProfit : styles.posLoss}>
            {totalDollars >= 0 ? "Profit" : "Loss"} {fmtDollar(totalDollars)}
          </span>
        </div>
      )}

      {closeError && <p className={styles.posCloseError}>{closeError}</p>}
      {!deviceId && <p className={styles.positionsEmpty}>Pair an MT5 EA to close positions from here.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SignalCard — M1 trade signal display
// ---------------------------------------------------------------------------
function SignalCard({
  result,
  symbol: _symbol,
  pipSize,
}: {
  result: SignalResult;
  symbol: string;
  pipSize?: number;
}) {
  const { signal, score, components, suggestedSl, suggestedTp, entryPrice } = result;

  const isBuy = signal === 'STRONG_BUY' || signal === 'BUY';
  const isSell = signal === 'SELL' || signal === 'STRONG_SELL';

  function signalClass() {
    if (signal === 'STRONG_BUY') return styles.signalStrongBuy;
    if (signal === 'BUY') return styles.signalBuy;
    if (signal === 'SELL') return styles.signalSell;
    if (signal === 'STRONG_SELL') return styles.signalStrongSell;
    if (signal === 'NO_SIGNAL') return styles.signalNone;
    return styles.signalWait; // WAIT
  }

  function signalLabel() {
    if (signal === 'STRONG_BUY') return 'STRONG BUY';
    if (signal === 'BUY') return 'BUY';
    if (signal === 'SELL') return 'SELL';
    if (signal === 'STRONG_SELL') return 'STRONG SELL';
    if (signal === 'NO_SIGNAL') return 'NO SIGNAL';
    return 'WAIT';
  }

  const digits = pipSize && pipSize > 0 && pipSize < 1
    ? Math.min(6, String(pipSize).replace(/.*\./, '').length)
    : 5;
  const pipValue = pipSize && pipSize > 0 ? pipSize : 0.0001;

  function fmt(n: number | null) {
    if (n == null) return '—';
    return n.toFixed(digits);
  }

  function pips(dist: number | null) {
    if (dist == null || entryPrice == null || suggestedSl == null) return '—';
    return Math.abs(dist / pipValue).toFixed(1) + ' pips';
  }

  const slDist = entryPrice != null && suggestedSl != null ? Math.abs(entryPrice - suggestedSl) : null;
  const rrText = slDist != null && slDist > 0 ? '1 : 1.5' : '—';

  return (
    <section className={styles.signalCard} aria-label="M1 trade signal">
      <div className={styles.signalCardHeader}>
        <span className={styles.sectionEyebrow}>M1 SIGNAL ENGINE</span>
        <span className={`${styles.signalBadge} ${signalClass()}`}>{signalLabel()}</span>
      </div>
      <div className={styles.signalScore}>
        <span>Confluence score</span>
        <strong>{score > 0 ? '+' : ''}{score} / 6</strong>
      </div>
      <div className={styles.signalComponents}>
        <div className={styles.signalRow}>
          <span className={components.emaScore > 0 ? styles.signalCheck : components.emaScore < 0 ? styles.signalCross : styles.signalNeutral}>
            {components.emaScore > 0 ? '✓' : components.emaScore < 0 ? '✗' : '–'}
          </span>
          <span>EMA 9 vs 21 (M1)</span>
          <span className={styles.signalRowValue}>{components.emaScore > 0 ? '+2 bullish' : components.emaScore < 0 ? '-2 bearish' : '0 flat'}</span>
        </div>
        <div className={styles.signalRow}>
          <span className={components.patternScore > 0 ? styles.signalCheck : components.patternScore < 0 ? styles.signalCross : styles.signalNeutral}>
            {components.patternScore > 0 ? '✓' : components.patternScore < 0 ? '✗' : '–'}
          </span>
          <span>M1 pattern: {components.patternLabel}</span>
          <span className={styles.signalRowValue}>{components.patternScore > 0 ? '+2' : components.patternScore < 0 ? '-2' : '0'}</span>
        </div>
        <div className={styles.signalRow}>
          <span className={components.structureScore > 0 ? styles.signalCheck : components.structureScore < 0 ? styles.signalCross : styles.signalNeutral}>
            {components.structureScore > 0 ? '✓' : components.structureScore < 0 ? '✗' : '–'}
          </span>
          <span>M15 structure</span>
          <span className={styles.signalRowValue}>{components.structureScore > 0 ? '+1 bullish' : components.structureScore < 0 ? '-1 bearish' : '0 neutral'}</span>
        </div>
        <div className={styles.signalRow}>
          <span className={components.atrActive ? styles.signalCheck : styles.signalCross}>
            {components.atrActive ? '✓' : '✗'}
          </span>
          <span>ATR activity filter</span>
          <span className={styles.signalRowValue}>{components.atrActive ? 'active' : 'low — ranging'}</span>
        </div>
      </div>
      {(isBuy || isSell) && entryPrice != null ? (
        <div className={styles.signalLevels}>
          <div className={styles.signalLevelRow}>
            <span>Entry ({isBuy ? 'Ask' : 'Bid'})</span>
            <strong>{fmt(entryPrice)}</strong>
          </div>
          <div className={styles.signalLevelRow}>
            <span>Stop-loss</span>
            <strong className={styles.signalSlValue}>{fmt(suggestedSl)} <small>({pips(slDist)})</small></strong>
          </div>
          <div className={styles.signalLevelRow}>
            <span>Take-profit</span>
            <strong className={styles.signalTpValue}>{fmt(suggestedTp)} <small>R:R {rrText}</small></strong>
          </div>
        </div>
      ) : null}
      <p className={styles.signalDisclaimer}>Computed signal — verify before trading</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// SmcSignalCard — SMC liquidity sweep + BoS signal display
// ---------------------------------------------------------------------------
function SmcSignalCard({
  result,
  symbol: _symbol,
  pipSize,
}: {
  result: SmcSignal;
  symbol: string;
  pipSize?: number;
}) {
  const { signal, type, confidence, sweepLevel, sweepLow, sweepHigh, bosLevel, entry, sl, tp, rrRatio, h1SweepLevel } = result;

  const isBuy = signal === 'BUY';
  const isSell = signal === 'SELL';
  const isActive = isBuy || isSell;

  const digits = pipSize && pipSize > 0 && pipSize < 1
    ? Math.min(6, String(pipSize).replace(/.*\./, '').length)
    : 5;
  const pipValue = pipSize && pipSize > 0 ? pipSize : 0.0001;

  function fmt(n: number | null | undefined) {
    if (n == null || !Number.isFinite(n)) return '—';
    return n.toFixed(digits);
  }

  function pips(a: number | null | undefined, b: number | null | undefined) {
    if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return '—';
    return Math.abs((a - b) / pipValue).toFixed(1) + ' pips';
  }

  const typeLabel = type === 'SSL_SWEEP_BOS' ? 'SSL Swept · BoS ↑' : type === 'BSL_SWEEP_BOS' ? 'BSL Swept · BoS ↓' : 'No active setup';
  const h1LevelLabel = h1SweepLevel != null
    ? (type === 'BSL_SWEEP_BOS' ? `BSL ${fmt(h1SweepLevel)} swept` : `SSL ${fmt(h1SweepLevel)} swept`)
    : (sweepLevel != null ? `Level ${fmt(sweepLevel)} swept` : '—');
  const sweepWickLabel = isBuy && sweepLow != null
    ? `Wick to ${fmt(sweepLow)}, closed above`
    : isSell && sweepHigh != null
    ? `Wick to ${fmt(sweepHigh)}, closed below`
    : '—';
  const bosLabel = bosLevel != null
    ? (isBuy ? `Break above ${fmt(bosLevel)} confirmed` : `Break below ${fmt(bosLevel)} confirmed`)
    : '—';

  const badgeClass = isBuy ? styles.smcBadgeBuy : isSell ? styles.smcBadgeSell : styles.smcBadgeWait;
  const confClass = confidence === 'HIGH' ? styles.smcConfidenceHigh : confidence === 'MEDIUM' ? styles.smcConfidenceMedium : styles.smcBadgeWait;

  return (
    <section className={styles.smcSignalCard} aria-label="SMC signal engine">
      <div className={styles.smcSignalHeader}>
        <div>
          <span className={styles.sectionEyebrow}>SMC SIGNAL ENGINE</span>
          <span className={styles.smcTypeLabel}>{typeLabel}</span>
        </div>
        <div style={{display: 'flex', gap: 6, alignItems: 'center'}}>
          {confidence && <span className={confClass}>{confidence}</span>}
          <span className={badgeClass}>{signal}</span>
        </div>
      </div>

      <div className={styles.smcRow}>
        <span className={styles.smcRowLabel}>H1 level</span>
        <span className={styles.smcRowValue}>{h1LevelLabel}</span>
      </div>
      <div className={styles.smcRow}>
        <span className={styles.smcRowLabel}>Sweep</span>
        <span className={styles.smcRowValue}>{sweepWickLabel}</span>
      </div>
      <div className={styles.smcRow}>
        <span className={styles.smcRowLabel}>BoS</span>
        <span className={styles.smcRowValue}>{bosLabel}</span>
      </div>

      {isActive && (
        <div className={styles.smcEntryGrid}>
          <div>
            <span className={styles.smcRowLabel}>Entry</span>
            <strong>{fmt(entry)}</strong>
          </div>
          <div>
            <span className={styles.smcRowLabel}>SL</span>
            <strong>{fmt(sl)}</strong>
            <small>{pips(entry, sl)}</small>
          </div>
          <div>
            <span className={styles.smcRowLabel}>TP</span>
            <strong>{fmt(tp)}</strong>
            <small>{pips(entry, tp)}</small>
          </div>
        </div>
      )}

      {isActive && (
        <div className={styles.smcRow}>
          <span className={styles.smcRowLabel}>R:R</span>
          <span className={styles.smcRowValue}>{rrRatio != null ? '1 : ' + rrRatio.toFixed(2) : '—'}</span>
        </div>
      )}

      <p className={styles.smcDisclaimer}>
        SMC setup based on liquidity sweep + BoS. Not financial advice. Verify in your terminal.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// SentimentBar — compact horizontal sentiment strip
// ---------------------------------------------------------------------------
function SentimentBar({ sentiment }: { sentiment: SentimentResult }) {
  const { label, bullish, bearish, candleRatio, aboveMidpoint } = sentiment;

  const icon = bullish ? '🟢' : bearish ? '🔴' : '⚪';
  const barClass = bullish ? styles.sentimentBullish : bearish ? styles.sentimentBearish : styles.sentimentNeutral;

  const details: string[] = [];
  if (bullish) details.push('Structure: Bullish');
  else if (bearish) details.push('Structure: Bearish');
  else details.push('Structure: Mixed');

  const pct = Math.round(candleRatio * 100);
  if (candleRatio > 0.6) details.push(`Candles: ${pct}% bullish`);
  else if (candleRatio < 0.4) details.push(`Candles: ${pct}% bearish`);
  else details.push(`Candles: ${pct}% (neutral)`);

  details.push(aboveMidpoint ? 'Price above midpoint' : 'Price below midpoint');

  return (
    <div className={styles.sentimentBar} aria-label="Market sentiment">
      <span className={styles.sentimentLabel}>SENTIMENT</span>
      <span className={`${styles.sentimentLabel} ${barClass}`}>{icon} {label}</span>
      <span className={styles.sentimentDetail}>{details.join(' · ')}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TradeSetupCard — Layer 4 entry alert panel
// ---------------------------------------------------------------------------
function TradeSetupCard({
  setup,
  symbol,
  pipSize,
}: {
  setup: TradeSetupResult;
  symbol: string;
  pipSize?: number;
}) {
  const { confluence, maxConfluence, structureAligned, sentimentAligned, nearPoc, action, poc, sl, tp, rrRatio, description } = setup;

  const isBuy = action.includes('BUY');
  const isSell = action.includes('SELL');
  const isWait = action === 'WAIT';

  const badgeClass = isWait
    ? styles.setupBadgeWait
    : isBuy
      ? styles.setupBadgeBuy
      : styles.setupBadgeSell;

  const digits = pipSize && pipSize > 0 && pipSize < 1
    ? Math.min(6, String(pipSize).replace(/.*\./, '').length)
    : 5;

  function fmt(n: number | null) {
    if (n === null || !Number.isFinite(n) || n === 0) return '—';
    return n.toFixed(digits);
  }

  const tfLabel = symbol.startsWith('frx') ? symbol.slice(3) : symbol;
  const actionIcon = isBuy ? '🟢' : isSell ? '🔴' : '⏸';

  return (
    <section className={styles.tradeSetupCard} aria-label="Trade setup">
      <div className={styles.tradeSetupHeader}>
        <span className={styles.sectionEyebrow}>TRADE SETUP</span>
        <span style={{ color: 'var(--fx-muted)', fontSize: '9px' }}>{tfLabel} · M1</span>
      </div>
      <div className={styles.setupRow}>
        <span>{structureAligned ? '✓' : '✗'}</span>
        <span>Structure: {setup.direction === 'BUY' ? 'UPTREND (HH + HL)' : setup.direction === 'SELL' ? 'DOWNTREND (LH + LL)' : 'Mixed'}</span>
      </div>
      <div className={styles.setupRow}>
        <span>{sentimentAligned ? '✓' : '✗'}</span>
        <span>Sentiment: {sentimentAligned ? (isBuy ? 'Buyers in control' : 'Sellers in control') : 'Not aligned'}</span>
      </div>
      <div className={styles.setupRow}>
        <span>{nearPoc ? '✓' : '✗'}</span>
        <span>POC: {nearPoc ? 'Price approaching POC' : 'Price not near POC'}</span>
      </div>
      <div className={styles.setupConfluence}>
        Confluence: <strong>{confluence}/{maxConfluence}</strong>
      </div>
      <div className={`${styles.tradeSetupHeader} ${badgeClass}`} style={{ marginTop: 4 }}>
        {actionIcon} {action}
      </div>
      <p style={{ margin: '6px 0 0', color: 'var(--fx-muted)', fontSize: '10px', lineHeight: 1.55 }}>{description}</p>
      {!isWait && poc > 0 && (
        <div className={styles.setupLevels}>
          <div className={styles.setupRow}>
            <span style={{ color: 'var(--fx-muted)' }}>POC</span>
            <span style={{ color: '#f4bb55', fontVariantNumeric: 'tabular-nums' }}>{fmt(poc)}</span>
          </div>
          <div className={styles.setupRow}>
            <span style={{ color: 'var(--fx-muted)' }}>SL</span>
            <span style={{ color: '#ff7b87', fontVariantNumeric: 'tabular-nums' }}>{fmt(sl)}</span>
          </div>
          <div className={styles.setupRow}>
            <span style={{ color: 'var(--fx-muted)' }}>TP</span>
            <span style={{ color: '#22c985', fontVariantNumeric: 'tabular-nums' }}>
              {fmt(tp)}{rrRatio !== null ? ` (1:${rrRatio.toFixed(1)})` : ''}
            </span>
          </div>
        </div>
      )}
      <p style={{ margin: '6px 0 0', paddingTop: 6, borderTop: '1px solid var(--fx-line)', color: 'var(--fx-muted)', fontSize: '9px', lineHeight: 1.5 }}>
        Levels are computed from swing points. Not financial advice.
      </p>
    </section>
  );
}

function mergeTickIntoCandles(candles: ForexCandle[], quote: LiveQuote, seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 1) return candles;
  const bucket = Math.floor(quote.epoch / seconds) * seconds;
  const existing = candles[candles.length - 1];

  if (existing && existing.epoch === bucket) {
    const updated = {
      ...existing,
      high: Math.max(existing.high, quote.price),
      low: Math.min(existing.low, quote.price),
      close: quote.price,
    };
    if (updated.high === existing.high && updated.low === existing.low && updated.close === existing.close) return candles;
    return [...candles.slice(0, -1), updated];
  }
  if (existing && existing.epoch > bucket) return candles;
  const next: ForexCandle = {
    epoch: bucket,
    open: quote.price,
    high: quote.price,
    low: quote.price,
    close: quote.price,
  };
  return [...candles, next].slice(-CANDLE_LIMIT);
}

// ---------------------------------------------------------------------------
// PrecisionSignalCard — M15 / M5 / M1 cascade lifecycle display
// ---------------------------------------------------------------------------

type PrecisionSnap = {
  state: string;
  direction: string | null;
  pendingStep: string;
  entryZone: { low: number; high: number } | null;
  suggestedSl: number | null;
  suggestedTp: number | null;
  positionSize: number | null;
  rrRatio: number | null;
  sweepLevel: number | null;
  displacementLevel: number | null;
  invalidationReason: string | null;
  actionable: boolean;
  ageMs: number;
};

function PrecisionSignalCard({
  snap,
  symbol: _symbol,
  pipSize,
}: {
  snap: PrecisionSnap | null;
  symbol: string;
  pipSize?: number;
}) {
  if (!snap) return null;

  const { state, direction, pendingStep, entryZone, suggestedSl, suggestedTp, positionSize, rrRatio, sweepLevel, displacementLevel, invalidationReason, actionable, ageMs } = snap;

  const digits = pipSize && pipSize > 0 && pipSize < 1
    ? Math.min(6, String(pipSize).replace(/.*\./, "").length)
    : 5;

  function fmt(n: number | null | undefined) {
    if (n == null || !Number.isFinite(n)) return "—";
    return n.toFixed(digits);
  }

  function age(ms: number) {
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
    return `${Math.round(ms / 3_600_000)}h`;
  }

  const isBuy     = state === "BUY";
  const isSell    = state === "SELL";
  const isExpired = state === "EXPIRED" || state === "INVALIDATED";
  const isActive  = actionable;

  const stateColor = isBuy    ? "#35d6a0"
    : isSell   ? "#f06f79"
    : isExpired ? "#6b7280"
    : state === "WAITING" ? "#6b7280"
    : "#f4b740";

  const stateBg = isBuy    ? "color-mix(in srgb, #35d6a0 10%, var(--surface-2, #1a2235))"
    : isSell   ? "color-mix(in srgb, #f06f79 10%, var(--surface-2, #1a2235))"
    : isExpired ? "var(--surface-2, #1a2235)"
    : "var(--surface-2, #1a2235)";

  const stateLabel = isBuy ? "BUY" : isSell ? "SELL" : isExpired ? (state === "INVALIDATED" ? "INVALIDATED" : "EXPIRED") : state.replace(/_/g, " ");

  const steps = [
    { key: "M15_STRUCTURE", label: "M15 Structure", done: state !== "WAITING" && !isExpired },
    { key: "SWEEP",         label: "Liquidity Sweep", done: ["M5_CONFIRMED","M1_CONFIRMED","RISK_VALIDATED","BUY","SELL"].includes(state) },
    { key: "M5_BOS",        label: "M5 Displacement + BoS", done: ["M1_CONFIRMED","RISK_VALIDATED","BUY","SELL"].includes(state) },
    { key: "M1_ENTRY",      label: "M1 Entry Zone + Rejection", done: ["RISK_VALIDATED","BUY","SELL"].includes(state) },
    { key: "RISK",          label: "Risk Validated", done: ["BUY","SELL"].includes(state) },
  ];

  return (
    <section
      aria-label="Precision signal lifecycle"
      style={{
        marginTop: 16,
        padding: "14px 16px",
        borderRadius: 14,
        border: `1px solid ${stateColor}55`,
        background: stateBg,
        opacity: isExpired ? 0.7 : 1,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ display: "grid", gap: 4 }}>
          <span style={{ color: "var(--muted)", fontSize: 10, fontWeight: 850, letterSpacing: ".14em", textTransform: "uppercase" }}>
            Precision Analyst · M15 / M5 / M1
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              padding: "3px 10px",
              borderRadius: 999,
              background: `${stateColor}22`,
              color: stateColor,
              fontSize: 11,
              fontWeight: 850,
              letterSpacing: ".08em",
            }}>
              {stateLabel}
            </span>
            {direction && !isExpired && (
              <span style={{ color: direction === "BUY" ? "#35d6a0" : "#f06f79", fontSize: 11, fontWeight: 750 }}>
                {direction === "BUY" ? "↑" : "↓"} {direction}
              </span>
            )}
          </div>
        </div>
        {ageMs > 0 && (
          <span style={{ color: "var(--muted)", fontSize: 10 }}>
            {isExpired ? "Signal age: " : "State age: "}{age(ageMs)}
          </span>
        )}
      </div>

      {/* Sequence progress */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${steps.length}, 1fr)`, gap: 6, marginBottom: 12 }}>
        {steps.map((step) => {
          const color = step.done ? "#35d6a0" : "var(--line)";
          return (
            <div key={step.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ height: 4, borderRadius: 99, background: color }} />
              <span style={{ color: step.done ? "#35d6a0" : "var(--muted)", fontSize: 8, fontWeight: 750, textAlign: "center" }}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Pending step */}
      {!isExpired && pendingStep && (
        <p style={{ margin: "0 0 10px", color: "var(--ink)", fontSize: 11, lineHeight: 1.5 }}>
          <span style={{ color: stateColor }}>→</span> {pendingStep}
        </p>
      )}

      {/* Price levels */}
      {(entryZone || suggestedSl || suggestedTp || sweepLevel) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 10 }}>
          {sweepLevel != null && (
            <div style={{ padding: "8px 10px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface)" }}>
              <span style={{ display: "block", color: "var(--muted)", fontSize: 9 }}>Swept level</span>
              <strong style={{ color: "var(--ink)", fontSize: 13 }}>{fmt(sweepLevel)}</strong>
            </div>
          )}
          {displacementLevel != null && (
            <div style={{ padding: "8px 10px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface)" }}>
              <span style={{ display: "block", color: "var(--muted)", fontSize: 9 }}>Displacement / BoS</span>
              <strong style={{ color: "var(--ink)", fontSize: 13 }}>{fmt(displacementLevel)}</strong>
            </div>
          )}
          {entryZone && (
            <div style={{ padding: "8px 10px", borderRadius: 9, border: `1px solid ${stateColor}55`, background: `${stateColor}0a` }}>
              <span style={{ display: "block", color: "var(--muted)", fontSize: 9 }}>Entry zone</span>
              <strong style={{ color: stateColor, fontSize: 12 }}>{fmt(entryZone.low)} – {fmt(entryZone.high)}</strong>
            </div>
          )}
          {suggestedSl != null && (
            <div style={{ padding: "8px 10px", borderRadius: 9, border: "1px solid #f06f7955", background: "#f06f790a" }}>
              <span style={{ display: "block", color: "var(--muted)", fontSize: 9 }}>Stop-loss</span>
              <strong style={{ color: "#f06f79", fontSize: 13 }}>{fmt(suggestedSl)}</strong>
            </div>
          )}
          {suggestedTp != null && (
            <div style={{ padding: "8px 10px", borderRadius: 9, border: "1px solid #35d6a055", background: "#35d6a00a" }}>
              <span style={{ display: "block", color: "var(--muted)", fontSize: 9 }}>Take-profit</span>
              <strong style={{ color: "#35d6a0", fontSize: 13 }}>{fmt(suggestedTp)}</strong>
            </div>
          )}
        </div>
      )}

      {/* R:R and position size */}
      {(rrRatio != null || positionSize != null) && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          {rrRatio != null && (
            <span style={{ padding: "5px 10px", borderRadius: 8, background: "var(--surface)", border: "1px solid var(--line)", color: rrRatio >= 1.5 ? "#35d6a0" : "#f4b740", fontSize: 11, fontWeight: 800 }}>
              R:R {rrRatio.toFixed(2)}
            </span>
          )}
          {positionSize != null && (
            <span style={{ padding: "5px 10px", borderRadius: 8, background: "var(--surface)", border: "1px solid var(--line)", color: "var(--ink)", fontSize: 11, fontWeight: 800 }}>
              {positionSize} lots
            </span>
          )}
        </div>
      )}

      {/* Active signal highlight */}
      {isActive && (
        <div style={{ padding: "10px 12px", borderRadius: 10, background: `${stateColor}18`, border: `1px solid ${stateColor}`, textAlign: "center" }}>
          <strong style={{ color: stateColor, fontSize: 15, letterSpacing: ".1em" }}>
            {isBuy ? "▲ BUY" : "▼ SELL"} — Signal active
          </strong>
          <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 10 }}>
            Monitor stop-loss. Signal expires in {age(1_800_000 - ageMs > 0 ? 1_800_000 - ageMs : 0)}.
          </p>
        </div>
      )}

      {/* Expiry / invalidation reason */}
      {isExpired && invalidationReason && (
        <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 8, background: "#6b728018", border: "1px solid #6b728055" }}>
          <span style={{ color: "#6b7280", fontSize: 10 }}>{invalidationReason}</span>
        </div>
      )}

      {/* Disclaimer */}
      <p style={{ margin: "10px 0 0", color: "var(--muted)", fontSize: 9, lineHeight: 1.5 }}>
        Precision signals require all 5 steps. This is not financial advice.
      </p>
    </section>
  );
}
