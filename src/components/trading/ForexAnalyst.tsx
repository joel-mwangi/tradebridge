"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./ForexAnalyst.module.css";
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
const PAIR_PRIORITY = [
  "frxEURUSD", "frxGBPUSD", "frxUSDJPY", "frxAUDUSD", "frxUSDCAD",
  "frxUSDCHF", "frxNZDUSD", "frxEURGBP", "frxEURJPY", "frxGBPJPY",
];
const TIMEFRAMES = [
  { label: "M1", seconds: 60 },
  { label: "M5", seconds: 300 },
  { label: "M15", seconds: 900 },
  { label: "H1", seconds: 3600 },
] as const;
const CANDLE_LIMIT = 180;
const VIEW_LIMIT = 100;

type ForexPair = { symbol: string; name: string; pipSize?: number };
type LiveQuote = { price: number; epoch: number; pipSize?: number };
type PendingHistory = { key: string; symbol: string; seconds: number };
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
    epoch?: number | string;
    pip_size?: number;
  };
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

function formatPrice(price: number, symbol: string) {
  const digits = symbol.includes("JPY") ? 3 : 5;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: symbol.startsWith("frx") ? digits : 2,
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

function nearestZone(zones: PriceZone[], symbol: string) {
  const zone = zones[0];
  return zone ? { ...zone, priceText: formatPrice(zone.price, symbol) } : null;
}

export default function ForexAnalyst() {
  const [pairs, setPairs] = useState<ForexPair[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState(DEFAULT_SYMBOL);
  const [timeframe, setTimeframe] = useState<number>(900);
  const [candlesByKey, setCandlesByKey] = useState<Record<string, ForexCandle[]>>({});
  const [quotesBySymbol, setQuotesBySymbol] = useState<Record<string, LiveQuote>>({});
  const [feedStatus, setFeedStatus] = useState("Connecting to TradeBridge market gateway");
  const [feedReady, setFeedReady] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const requestSequenceRef = useRef(70_000);
  const pendingHistoryRef = useRef(new Map<number, PendingHistory>());
  const subscribedSymbolsRef = useRef(new Set<string>());
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
    setFeedStatus("Loading " + symbol + " candle history");
    socket.send(JSON.stringify({
      ticks_history: symbol,
      end: "latest",
      count: CANDLE_LIMIT,
      style: "candles",
      granularity: seconds,
      subscribe: 0,
      req_id: reqId,
    }));
  }, []);

  useEffect(() => {
    let alive = true;
    let socket: WebSocket | null = null;
    let connectionOpened = false;

    pendingHistoryRef.current.clear();
    subscribedSymbolsRef.current.clear();
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
        if (message.req_id !== undefined) pendingHistoryRef.current.delete(message.req_id);
        if (message.req_id === 1) {
          setFeedReady(false);
          setFeedStatus("Forex symbol discovery failed: " + (message.error.message ?? "provider error"));
        } else if (pending) {
          setFeedStatus("Candle history unavailable for " + pending.symbol + ": " +
            (message.error.message ?? "provider error"));
        }
        return;
      }

      if (message.msg_type === "active_symbols" && message.active_symbols) {
        const symbols = message.active_symbols
          .map((item) => {
            const symbol = item.underlying_symbol ?? item.symbol ?? "";
            return {
              symbol,
              name: item.underlying_symbol_name ?? item.display_name ?? symbol,
              market: (item.market ?? "").toLowerCase(),
              isTradingSuspended: item.is_trading_suspended === 1,
            };
          })
          .filter((item) =>
            item.symbol &&
            !item.isTradingSuspended &&
            (item.market === "forex" || item.symbol.toLowerCase().startsWith("frx"))
          );

        const bySymbol = new Map<string, ForexPair>();
        symbols.forEach((item) => bySymbol.set(item.symbol, { symbol: item.symbol, name: item.name }));
        const available = [...bySymbol.values()].sort((a, b) => {
          const aRank = PAIR_PRIORITY.indexOf(a.symbol);
          const bRank = PAIR_PRIORITY.indexOf(b.symbol);
          const ar = aRank < 0 ? Number.MAX_SAFE_INTEGER : aRank;
          const br = bRank < 0 ? Number.MAX_SAFE_INTEGER : bRank;
          return ar - br || a.name.localeCompare(b.name);
        });

        setPairs(available);
        if (!available.length) {
          setFeedReady(false);
          setFeedStatus("The feed did not return eligible forex pairs");
          return;
        }
        setSelectedSymbol((current) =>
          available.some((pair) => pair.symbol === current)
            ? current
            : available.find((pair) => pair.symbol === DEFAULT_SYMBOL)?.symbol ?? available[0].symbol
        );
        setFeedReady(true);
        setFeedStatus("Forex symbols loaded · waiting for live quotes");
        return;
      }

      if ((message.msg_type === "candles" || message.msg_type === "history") && message.candles) {
        const request = message.req_id === undefined
          ? undefined
          : pendingHistoryRef.current.get(message.req_id);
        if (!request) return;
        pendingHistoryRef.current.delete(message.req_id as number);
        const history = normalizeFeedCandles(message.candles);
        if (!history.length) {
          setFeedStatus("Provider returned no valid OHLC candles for " + request.symbol);
          return;
        }

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
      setFeedStatus(connectionOpened ? "Market-data connection disconnected" : "Could not connect to market data");
    };

    return () => {
      alive = false;
      if (socketRef.current === socket) socketRef.current = null;
      pendingHistoryRef.current.clear();
      subscribedSymbolsRef.current.clear();
      socket?.close();
    };
  }, [retryCount]);

  useEffect(() => {
    if (!feedReady || !selectedSymbol || !socketRef.current ||
        socketRef.current.readyState !== WebSocket.OPEN) return;
    const socket = socketRef.current;

    if (!subscribedSymbolsRef.current.has(selectedSymbol)) {
      socket.send(JSON.stringify({ ticks: selectedSymbol, subscribe: 1 }));
      subscribedSymbolsRef.current.add(selectedSymbol);
    }
    requestCandles(selectedSymbol, timeframe);
  }, [feedReady, selectedSymbol, timeframe, requestCandles]);

  const activePair = pairs.find((pair) => pair.symbol === selectedSymbol) ?? null;
  const liveQuote = quotesBySymbol[selectedSymbol] ?? null;
  const candles = candlesByKey[keyFor(selectedSymbol, timeframe)] ?? [];
  const currentBucket = Math.floor(Date.now() / 1000 / timeframe) * timeframe;
  const closedCandles = useMemo(
    () => candles.filter((candle) => candle.epoch + timeframe <= currentBucket),
    [candles, timeframe, currentBucket],
  );
  const analysis = useMemo(() => analyzeForexCandles(closedCandles), [closedCandles]);
  const visibleCandles = candles.slice(-VIEW_LIMIT);
  const support = nearestZone(analysis.support, selectedSymbol);
  const resistance = nearestZone(analysis.resistance, selectedSymbol);
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
          <div className={styles.kicker}><span className={styles.kickerDot} /> FOREX INTELLIGENCE <span className={styles.modeBadge}>RULE-BASED V1</span></div>
          <h1>AI Chart Analyst</h1>
          <p>Live price action, candle recognition and automatically mapped support/resistance.</p>
        </div>
        <button type="button" className={styles.retryButton} onClick={() => setRetryCount((count) => count + 1)}>
          <span aria-hidden="true">↻</span> Reconnect feed
        </button>
      </header>

      <div className={styles.sourceNotice} role="note">
        <span className={styles.sourceIcon}>i</span>
        <p>
          <strong>Data source transparency.</strong> This first web version uses Deriv public market data through the existing TradeBridge backend.
          It is not connected to the quote stream inside your MT5 web session, and price equivalence has not been verified.
        </p>
        <p className={styles.engineScope}><strong>Analysis engine v1:</strong> transparent rule-based calculations first. AI-generated explanations come after the feed and calculations are validated.</p>
      </div>

      <section className={styles.marketBar} aria-label="Forex chart controls">
        <label className={styles.pairSelector}>
          <span>FOREX PAIR</span>
          <select value={selectedSymbol} onChange={(event) => setSelectedSymbol(event.target.value)} disabled={!pairs.length}>
            {pairs.length
              ? pairs.map((pair) => <option key={pair.symbol} value={pair.symbol}>{pair.name} · {pair.symbol}</option>)
              : <option value={selectedSymbol}>Discovering available pairs…</option>}
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
          <strong>{liveQuote ? formatPrice(liveQuote.price, selectedSymbol) : "—"}</strong>
          <small className={statusIsLive ? styles.liveText : styles.mutedText}>{liveQuote ? quoteAgeText : feedReady ? "Waiting for ticks" : feedStatus}</small>
        </div>
      </section>

      <div className={styles.connectionLine} data-live={Boolean(statusIsLive)}>
        <span className={styles.statusDot} />
        <span>{feedStatus}</span>
        <span className={styles.connectionRight}>{activePair?.name ?? "Forex symbols"} · {timeframe === 60 ? "1 minute" : timeframe === 300 ? "5 minutes" : timeframe === 900 ? "15 minutes" : "1 hour"}</span>
      </div>

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

        {visibleCandles.length ? (
          <div className={styles.chartViewport}>
            <svg viewBox={"0 0 " + chart.width + " " + chart.height} role="img" aria-label={activePair?.name + " candlestick chart with automatic analysis"}>
              {[0, 1, 2, 3, 4].map((step) => {
                const y = chart.top + step * (chart.plotHeight / 4);
                const price = chart.max - step * ((chart.max - chart.min) / 4);
                return <g key={step}>
                  <line x1={chart.left} y1={y} x2={chart.width - chart.right} y2={y} className={styles.gridLine} />
                  <text x={chart.left - 10} y={y + 4} textAnchor="end" className={styles.axisLabel}>{formatPrice(price, selectedSymbol)}</text>
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
              {liveQuote && <g>
                <line x1={chart.left} y1={chart.yFor(liveQuote.price)} x2={chart.width - chart.right} y2={chart.yFor(liveQuote.price)} className={styles.lastPriceLine} />
                <rect x={chart.width - chart.right + 3} y={chart.yFor(liveQuote.price) - 10} width={chart.right - 9} height="20" rx="4" className={styles.lastPriceTag} />
                <text x={chart.width - chart.right + (chart.right - 9) / 2 + 3} y={chart.yFor(liveQuote.price) + 4} textAnchor="middle" className={styles.lastPriceText}>{formatPrice(liveQuote.price, selectedSymbol)}</text>
              </g>}
            </svg>
          </div>
        ) : (
          <div className={styles.emptyChart}>
            <span className={styles.emptyIcon}>⌁</span>
            <strong>{feedReady ? "Loading real candle history" : "Waiting for market connection"}</strong>
            <p>{feedReady ? "The chart will appear when the selected forex pair returns valid OHLC candles." : feedStatus}</p>
            {feedReady && <button type="button" className={styles.retryButton} onClick={() => requestCandles(selectedSymbol, timeframe)}>Retry candle history</button>}
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
