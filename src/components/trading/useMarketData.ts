"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MarketCandle, MarketInstrument, MarketSnapshot, PricePoint } from "./types";

const PUBLIC_SOCKET = "wss://api.derivws.com/trading/v1/options/ws/public";
const PREFERRED_SYMBOLS = ["1HZ100V", "1HZ75V", "1HZ50V", "R_100", "R_50", "frxEURUSD", "frxGBPUSD", "frxXAUUSD"];
const MAX_POINTS = 1000;

type PublicMessage = {
  msg_type?: string;
  ping?: string;
  req_id?: number;
  error?: { message?: string };
  active_symbols?: Array<{
    underlying_symbol?: string;
    symbol?: string;
    underlying_symbol_name?: string;
    display_name?: string;
    market?: string;
    is_trading_suspended?: number;
  }>;
  tick?: {
    underlying_symbol?: string;
    symbol?: string;
    quote?: number | string;
    epoch?: number;
    pip_size?: number;
  };
  history?: { prices?: Array<number | string>; times?: number[] };
  pip_size?: number;
  candles?: Array<{
    epoch?: number | string;
    open?: number | string;
    high?: number | string;
    low?: number | string;
    close?: number | string;
  }>;
};

function extractLastDigit(quote: number | string, pipSize?: number): number | undefined {
  const value = Number(quote);
  if (!Number.isFinite(value)) return undefined;

  // Deriv pip_size is the number of decimal places, not a decimal increment.
  // If precision is missing, only infer it from a string that preserves decimals;
  // a numeric quote may already have lost trailing zeros, so do not guess.
  const raw = String(quote);
  const hasPrecision = Number.isInteger(pipSize) && pipSize! >= 0 && pipSize! <= 12;
  const inferredPrecision = typeof quote === "string" && raw.includes(".")
    ? raw.split(".")[1]?.length
    : undefined;
  const precision = hasPrecision ? pipSize! : inferredPrecision;
  if (precision === undefined || precision < 0 || precision > 12) return undefined;

  const formatted = value.toFixed(precision);
  const fraction = formatted.split(".")[1] ?? "";
  const character = precision > 0 ? fraction.charAt(precision - 1) : formatted.slice(-1);
  const digit = Number(character);
  return Number.isInteger(digit) && digit >= 0 && digit <= 9 ? digit : undefined;
}

export function useMarketData() {
  const [markets, setMarkets] = useState<MarketInstrument[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, MarketSnapshot>>({});
  const [candlesByKey, setCandlesByKey] = useState<Record<string, MarketCandle[]>>({});
  const [connection, setConnection] = useState("Connecting to Deriv market data");
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const marketSequenceRef = useRef(100);
  const historyRequestsRef = useRef(new Map<number, string>());
  const pipSizeBySymbolRef = useRef(new Map<string, number>());
  const subscribedSymbolsRef = useRef(new Set<string>());
  const candleSequenceRef = useRef(50_000);
  const candleRequestsRef = useRef(new Map<number, { key: string; symbol: string; granularity: number }>());
  const requestedCandleKeysRef = useRef(new Set<string>());

  const requestMarket = useCallback((symbol: string) => {
    const activeSocket = socketRef.current;
    if (!symbol || !activeSocket || activeSocket.readyState !== WebSocket.OPEN) return;

    const historyReqId = ++marketSequenceRef.current;
    historyRequestsRef.current.set(historyReqId, symbol);
    activeSocket.send(JSON.stringify({
      ticks_history: symbol,
      end: "latest",
      count: 1000,
      style: "ticks",
      req_id: historyReqId,
    }));

    if (!subscribedSymbolsRef.current.has(symbol)) {
      const subscriptionReqId = ++marketSequenceRef.current;
      activeSocket.send(JSON.stringify({
        ticks: symbol,
        subscribe: 1,
        req_id: subscriptionReqId,
      }));
      subscribedSymbolsRef.current.add(symbol);
    }
  }, []);

  const selectMarket = useCallback((symbol: string) => {
    setSelectedSymbol(symbol);
    requestMarket(symbol);
  }, [requestMarket]);

  const requestCandles = useCallback((symbol: string, granularity: number, force = false) => {
    const activeSocket = socketRef.current;
    if (!symbol || !Number.isInteger(granularity) || granularity < 60
      || !activeSocket || activeSocket.readyState !== WebSocket.OPEN) return;

    const key = `${symbol}:${granularity}`;
    if (requestedCandleKeysRef.current.has(key) && !force) return;

    const reqId = ++candleSequenceRef.current;
    candleRequestsRef.current.set(reqId, { key, symbol, granularity });
    requestedCandleKeysRef.current.add(key);
    activeSocket.send(JSON.stringify({
      ticks_history: symbol,
      end: "latest",
      count: 150,
      style: "candles",
      granularity,
      subscribe: 0,
      req_id: reqId,
    }));
  }, []);

  useEffect(() => {
    let alive = true;
    let socket: WebSocket;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    const startPing = () => {
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ ping: 1 }));
        }
      }, 30_000);
    };

    const mergePoints = (symbol: string, incoming: PricePoint[]) => {
      if (!alive || !symbol || incoming.length === 0) return;
      setSnapshots((current) => {
        const previous = current[symbol];
        const byTime = new Map<number, PricePoint>();
        for (const point of [...(previous?.points ?? []), ...incoming]) {
          if (Number.isFinite(point.price) && Number.isFinite(point.time)) byTime.set(point.time, point);
        }
        const points = [...byTime.values()].sort((a, b) => a.time - b.time).slice(-MAX_POINTS);
        const last = points[points.length - 1];
        return {
          ...current,
          [symbol]: {
            quote: last?.price ?? previous?.quote ?? 0,
            updatedAt: last?.time ? last.time * 1000 : previous?.updatedAt ?? Date.now(),
            points,
          },
        };
      });
    };

    const subscribeMarkets = (available: NonNullable<PublicMessage["active_symbols"]>) => {
      const candidates = available
        .map((item) => ({
          symbol: item.underlying_symbol ?? item.symbol ?? "",
          name: item.underlying_symbol_name ?? item.display_name ?? item.underlying_symbol ?? item.symbol ?? "",
          market: item.market,
          isTradingSuspended: item.is_trading_suspended === 1,
        }))
        .filter((item) => item.symbol && !item.isTradingSuspended);

      const bySymbol = new Map<string, (typeof candidates)[number]>();
      candidates.forEach((item) => bySymbol.set(item.symbol, item));
      const preferred = PREFERRED_SYMBOLS.flatMap((symbol) => {
        const item = bySymbol.get(symbol);
        return item ? [item] : [];
      });
      const uniqueCandidates = [...bySymbol.values()];
      const rest = uniqueCandidates
        .filter((item) => !PREFERRED_SYMBOLS.includes(item.symbol))
        .sort((a, b) => {
          const rank = (market: string | undefined) => market === "synthetic_index" ? 0 : market === "forex" ? 1 : 2;
          return rank(a.market) - rank(b.market) || a.name.localeCompare(b.name);
        });
      const chosen = [...preferred, ...rest];
      if (!alive) return;
      setMarkets(chosen);
      setSelectedSymbol((current) => chosen.some((item) => item.symbol === current) ? current : chosen[0]?.symbol ?? "");
      if (chosen.length === 0) {
        setConnection("Deriv returned no eligible markets");
        return;
      }

      // Keep a small live watchlist streaming; any other market is subscribed
      // on demand when the user selects it from the full directory.
      chosen.slice(0, 8).forEach((market) => requestMarket(market.symbol));
      setConnection("Live market stream connected");
    };

    try {
      socket = new WebSocket(PUBLIC_SOCKET);
      socketRef.current = socket;
    } catch {
      setConnection("Market data unavailable");
      return;
    }

    socket.onopen = () => {
      if (!alive) return;
      startPing();
      setConnection("Loading available markets");
      socket.send(JSON.stringify({
        active_symbols: "brief",
        contract_type: ["DIGITOVER", "DIGITUNDER", "DIGITEVEN", "DIGITODD", "DIGITMATCH", "DIGITDIFF"],
        req_id: 1,
      }));
    };

    socket.onmessage = (event) => {
      if (!alive) return;
      try {
        const message = JSON.parse(event.data) as PublicMessage;
        if (message.msg_type === "ping" || message.ping) return;
        if (message.error) {
          const historyRequest = message.req_id === undefined
            ? undefined
            : historyRequestsRef.current.get(message.req_id);
          if (historyRequest) historyRequestsRef.current.delete(message.req_id as number);
          const candleRequest = message.req_id === undefined
            ? undefined
            : candleRequestsRef.current.get(message.req_id);
          if (candleRequest) {
            candleRequestsRef.current.delete(message.req_id as number);
            requestedCandleKeysRef.current.delete(candleRequest.key);
          }
          if (message.req_id === 1) setConnection("Could not load eligible markets");
          return;
        }

        if ((message.msg_type === "candles" || message.msg_type === "history") && message.candles) {
          const request = message.req_id === undefined
            ? undefined
            : candleRequestsRef.current.get(message.req_id);
          if (!request) return;
          const incoming = message.candles.flatMap((item) => {
            const epoch = Number(item.epoch);
            const open = Number(item.open);
            const high = Number(item.high);
            const low = Number(item.low);
            const close = Number(item.close);
            return Number.isFinite(epoch) && Number.isFinite(open) && Number.isFinite(high)
              && Number.isFinite(low) && Number.isFinite(close)
              ? [{ epoch, open, high, low, close }]
              : [];
          });
          setCandlesByKey((current) => {
            const byTime = new Map<number, MarketCandle>();
            for (const candle of [...(current[request.key] ?? []), ...incoming]) {
              byTime.set(candle.epoch, candle);
            }
            return {
              ...current,
              [request.key]: [...byTime.values()].sort((a, b) => a.epoch - b.epoch).slice(-240),
            };
          });
          candleRequestsRef.current.delete(message.req_id as number);
          return;
        }

        if (message.msg_type === "active_symbols" && message.active_symbols) {
          subscribeMarkets(message.active_symbols);
          return;
        }

        if (message.msg_type === "history" && message.history) {
          const symbol = message.req_id ? historyRequestsRef.current.get(message.req_id) : undefined;
          if (!symbol) return;
          historyRequestsRef.current.delete(message.req_id as number);
          const prices = message.history.prices ?? [];
          const times = message.history.times ?? [];
          const pipSize = message.pip_size;
          if (Number.isInteger(pipSize) && pipSize! >= 0 && pipSize! <= 12) {
            pipSizeBySymbolRef.current.set(symbol, pipSize!);
          }
          const points = prices.flatMap((price, index) => {
            const value = Number(price);
            const time = Number(times[index]);
            return Number.isFinite(value) && Number.isFinite(time)
              ? [{ price: value, time, lastDigit: extractLastDigit(price, pipSize) }]
              : [];
          });
          mergePoints(symbol, points);
          return;
        }

        if (message.msg_type === "tick" && message.tick) {
          const symbol = message.tick.underlying_symbol ?? message.tick.symbol ?? "";
          const price = Number(message.tick.quote);
          const time = Number(message.tick.epoch) || Math.floor(Date.now() / 1000);
          if (!symbol || !Number.isFinite(price)) return;
          const tickPipSize = message.tick.pip_size ?? pipSizeBySymbolRef.current.get(symbol);
          if (Number.isInteger(tickPipSize) && tickPipSize! >= 0 && tickPipSize! <= 12) {
            pipSizeBySymbolRef.current.set(symbol, tickPipSize!);
          }
          mergePoints(symbol, [{
            price,
            time,
            lastDigit: extractLastDigit(message.tick.quote ?? price, tickPipSize),
          }]);
          setConnection("Live prices");
        }
      } catch {
        setConnection("Received an unreadable market response");
      }
    };

    socket.onerror = () => {
      if (alive) setConnection("Market data connection failed");
    };
    socket.onclose = () => {
      if (pingTimer) clearInterval(pingTimer);
      if (alive) setConnection("Market stream disconnected");
    };

    return () => {
      alive = false;
      if (pingTimer) clearInterval(pingTimer);
      if (socketRef.current === socket) socketRef.current = null;
      candleRequestsRef.current.clear();
      requestedCandleKeysRef.current.clear();
      historyRequestsRef.current.clear();
      subscribedSymbolsRef.current.clear();
      socket.close();
    };
  }, []);

  const selectedMarket = useMemo(
    () => markets.find((market) => market.symbol === selectedSymbol) ?? markets[0] ?? null,
    [markets, selectedSymbol],
  );

  return {
    markets,
    snapshots,
    connection,
    selectedMarket,
    selectedSymbol: selectedMarket?.symbol ?? "",
    selectMarket,
    candlesByKey,
    requestCandles,
  };
}
