"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./ForexAnalyst.module.css";
import ForexOrderPanel from "./ForexOrderPanel";
import { buildForexCandleHistoryRequest } from "../../lib/forex-market-data.mjs";
import { panChartViewport, zoomChartViewport } from "../../lib/forex-chart-viewport.mjs";
import {
  analyzeForexCandles,
  findSwingPoints,
  type CandlePattern,
  type ForexCandle,
  type PriceZone,
  type SwingPoint,
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

export default function ForexAnalyst() {
  const [instruments, setInstruments] = useState<AnalystInstrument[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<MarketCategory>("all");
  const [selectedSymbol, setSelectedSymbol] = useState(DEFAULT_SYMBOL);
  const [timeframe, setTimeframe] = useState<number>(900);
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
        <button type="button" className={styles.retryButton} onClick={() => setRetryCount((count) => count + 1)}>
          <span aria-hidden="true">↻</span> Reconnect feed
        </button>
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
          <span className={liveQuote && calculateQuoteSpread(liveQuote.bid, liveQuote.ask) !== undefined ? styles.quoteFresh : styles.quoteUnavailable}>
            {liveQuote
              ? calculateQuoteSpread(liveQuote.bid, liveQuote.ask) !== undefined
                ? "Live Bid / Ask available"
                : "Tick received · Bid / Ask unavailable"
              : "Waiting for quote"}
          </span>
        </div>
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
              {liveQuote && safeViewOffset === 0 && <g>
                <line x1={chart.left} y1={chart.yFor(liveQuote.price)} x2={chart.width - chart.right} y2={chart.yFor(liveQuote.price)} className={styles.lastPriceLine} />
                <rect x={chart.width - chart.right + 3} y={chart.yFor(liveQuote.price) - 10} width={chart.right - 9} height="20" rx="4" className={styles.lastPriceTag} />
                <text x={chart.width - chart.right + (chart.right - 9) / 2 + 3} y={chart.yFor(liveQuote.price) + 4} textAnchor="middle" className={styles.lastPriceText}>{formatPrice(liveQuote.price, selectedSymbol, activeInstrument?.pipSize)}</text>
              </g>}
            </svg>
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
        <ForexOrderPanel
          symbol={selectedSymbol}
          instrumentName={activePair?.name ?? selectedSymbol}
          lastPrice={liveQuote?.price}
          bid={liveQuote?.bid}
          ask={liveQuote?.ask}
          quoteEpoch={liveQuote?.epoch}
          pipSize={activeInstrument?.pipSize}
        />
      </div>
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
