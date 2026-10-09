"use client";

import { useEffect, useMemo, useState } from "react";
import type { MarketInstrument, MarketSnapshot, PricePoint } from "./types";

const PUBLIC_SOCKET = "wss://api.derivws.com/trading/v1/options/ws/public";
const PREFERRED_SYMBOLS = ["1HZ100V", "1HZ75V", "1HZ50V", "R_100", "R_50", "frxEURUSD", "frxGBPUSD", "frxXAUUSD"];
const MAX_POINTS = 180;

type PublicMessage = {
  msg_type?: string;
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
  };
  history?: { prices?: Array<number | string>; times?: number[] };
  candles?: Array<{ epoch?: number; close?: number | string }>;
};

export function useMarketData() {
  const [markets, setMarkets] = useState<MarketInstrument[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, MarketSnapshot>>({});
  const [connection, setConnection] = useState("Connecting to Deriv market data");
  const [selectedSymbol, setSelectedSymbol] = useState("");

  useEffect(() => {
    let alive = true;
    let nextRequestId = 100;
    const requestSymbols = new Map<number, string>();
    let socket: WebSocket;

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

      const bySymbol = new Map(candidates.map((item) => [item.symbol, item]));
      const preferred = PREFERRED_SYMBOLS.map((symbol) => bySymbol.get(symbol)).filter(
        (item): item is NonNullable<typeof item> => Boolean(item),
      );
      const rest = candidates
        .filter((item) => !PREFERRED_SYMBOLS.includes(item.symbol))
        .sort((a, b) => {
          const rank = (market: string | undefined) => market === "synthetic_index" ? 0 : market === "forex" ? 1 : 2;
          return rank(a.market) - rank(b.market) || a.name.localeCompare(b.name);
        });
      const chosen = [...preferred, ...rest].slice(0, 8);
      if (!alive) return;
      setMarkets(chosen);
      setSelectedSymbol((current) => chosen.some((item) => item.symbol === current) ? current : chosen[0]?.symbol ?? "");
      if (chosen.length === 0) {
        setConnection("Deriv returned no eligible markets");
        return;
      }

      chosen.forEach((market) => {
        const historyReqId = nextRequestId++;
        requestSymbols.set(historyReqId, market.symbol);
        socket.send(JSON.stringify({
          ticks_history: market.symbol,
          end: "latest",
          count: 120,
          style: "ticks",
          req_id: historyReqId,
        }));
        socket.send(JSON.stringify({
          ticks: market.symbol,
          subscribe: 1,
          req_id: nextRequestId++,
        }));
      });
      setConnection("Live market stream connected");
    };

    try {
      socket = new WebSocket(PUBLIC_SOCKET);
    } catch {
      setConnection("Market data unavailable");
      return;
    }

    socket.onopen = () => {
      if (!alive) return;
      setConnection("Loading available markets");
      socket.send(JSON.stringify({
        active_symbols: "brief",
        contract_type: ["CALL", "PUT"],
        req_id: 1,
      }));
    };

    socket.onmessage = (event) => {
      if (!alive) return;
      try {
        const message = JSON.parse(event.data) as PublicMessage;
        if (message.error) {
          if (message.req_id === 1) setConnection("Could not load eligible markets");
          return;
        }

        if (message.msg_type === "active_symbols" && message.active_symbols) {
          subscribeMarkets(message.active_symbols);
          return;
        }

        if (message.msg_type === "history" && message.history) {
          const symbol = message.req_id ? requestSymbols.get(message.req_id) : undefined;
          if (!symbol) return;
          const prices = message.history.prices ?? [];
          const times = message.history.times ?? [];
          const points = prices.flatMap((price, index) => {
            const value = Number(price);
            const time = Number(times[index]);
            return Number.isFinite(value) && Number.isFinite(time) ? [{ price: value, time }] : [];
          });
          mergePoints(symbol, points);
          return;
        }

        if (message.msg_type === "tick" && message.tick) {
          const symbol = message.tick.underlying_symbol ?? message.tick.symbol ?? "";
          const price = Number(message.tick.quote);
          const time = Number(message.tick.epoch) || Math.floor(Date.now() / 1000);
          if (!symbol || !Number.isFinite(price)) return;
          mergePoints(symbol, [{ price, time }]);
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
      if (alive) setConnection("Market stream disconnected");
    };

    return () => {
      alive = false;
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
    selectMarket: setSelectedSymbol,
  };
}
