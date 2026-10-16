"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { MarketInstrument, MarketSnapshot } from "./types";

const MOST_TRADED_SYMBOLS = ["1HZ100V", "1HZ10V", "1HZ75V", "1HZ50V", "1HZ25V"];

function getSymbolLabel(symbol: string): string {
  const labels: Record<string, string> = {
    "1HZ100V": "100",
    "1HZ10V": "10",
    "1HZ75V": "75",
    "1HZ50V": "50",
    "1HZ25V": "25",
  };
  return labels[symbol] ?? symbol.replace(/[^0-9]/g, "");
}

function useSortedByActivity(
  snapshots: Record<string, MarketSnapshot>,
  intervalMs = 10_000,
): string[] {
  const baselineRef = useRef<Record<string, number>>({});
  const [sorted, setSorted] = useState<string[]>(MOST_TRADED_SYMBOLS);

  useEffect(() => {
    const init: Record<string, number> = {};
    for (const sym of MOST_TRADED_SYMBOLS) {
      init[sym] = snapshots[sym]?.points.length ?? 0;
    }
    baselineRef.current = init;

    const id = setInterval(() => {
      const ticksSince: Record<string, number> = {};
      for (const sym of MOST_TRADED_SYMBOLS) {
        const current = snapshots[sym]?.points.length ?? 0;
        const baseline = baselineRef.current[sym] ?? current;
        ticksSince[sym] = current - baseline;
        baselineRef.current[sym] = current;
      }
      setSorted((prev) => {
        const next = [...MOST_TRADED_SYMBOLS].sort(
          (a, b) => (ticksSince[b] ?? 0) - (ticksSince[a] ?? 0),
        );
        return next.join(",") === prev.join(",") ? prev : next;
      });
    }, intervalMs);

    return () => clearInterval(id);
  }, [intervalMs, snapshots]);

  return sorted;
}

function MiniSparkline({ points, isUp }: { points: { price: number }[]; isUp: boolean }) {
  if (points.length < 2) {
    return (
      <svg viewBox="0 0 120 40" width="120" height="40" aria-hidden="true">
        <line x1="0" y1="20" x2="120" y2="20" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
      </svg>
    );
  }
  const prices = points.map((p) => p.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = maxP - minP || 1;
  const w = 120;
  const h = 40;
  const pad = 4;
  const plotH = h - pad * 2;
  const plotW = w;
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * plotW;
    const y = pad + ((maxP - p.price) / range) * plotH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = coords.map((c, i) => (i === 0 ? "M" : "L") + c).join(" ");
  const color = isUp ? "#10b981" : "#ef4444";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true" style={{ display: "block" }}>
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MostTradedMarkets({
  markets,
  snapshots,
  onSelect,
}: {
  markets: MarketInstrument[];
  snapshots: Record<string, MarketSnapshot>;
  onSelect: (symbol: string) => void;
}) {
  const sortedSymbols = useSortedByActivity(snapshots);

  const shown = sortedSymbols.flatMap((sym) => {
    const market = markets.find((item) => item.symbol === sym);
    return market ? [market] : [];
  });

  if (shown.length === 0) return null;

  return (
    <section aria-label="Most traded markets">
      <h2 style={{ margin: "0 0 16px", fontSize: "16px", fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.3px" }}>
        Most traded markets
      </h2>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        gap: "12px",
      }}>
        {shown.map((market) => {
          const snapshot = snapshots[market.symbol];
          const points = snapshot?.points ?? [];
          const recent = points.slice(-60);
          const first = recent[0]?.price;
          const last = recent[recent.length - 1]?.price ?? snapshot?.quote;
          const change = first && last && first !== 0 ? ((last - first) / first) * 100 : null;
          const isUp = change === null || change >= 0;
          const label = getSymbolLabel(market.symbol);
          const quote = snapshot?.quote;
          const formatQuote = (value: number) => {
            const digits = market.symbol.startsWith("frx") ? 5 : value >= 100 ? 2 : 2;
            return new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
          };

          return (
            <button
              key={market.symbol}
              type="button"
              onClick={() => onSelect(market.symbol)}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                padding: "16px",
                border: "1px solid var(--line)",
                borderRadius: "12px",
                background: "var(--panel)",
                color: "var(--ink)",
                textAlign: "left",
                cursor: "pointer",
                transition: "border-color .15s, background .15s",
                boxShadow: "var(--card-shadow)",
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.borderColor = "var(--teal)";
                event.currentTarget.style.background = "var(--surface)";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.borderColor = "var(--line)";
                event.currentTarget.style.background = "var(--panel)";
              }}
              aria-label={`Open ${market.name} trading workspace`}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: "28px", height: "18px", borderRadius: "4px",
                  background: "var(--surface)", border: "1px solid var(--border)",
                  color: "var(--ink)", fontSize: "10px", fontWeight: 800,
                }}>{label}</span>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: "4px",
                  padding: "2px 6px", borderRadius: "99px",
                  background: "var(--teal-soft)", color: "var(--teal)",
                  fontSize: "9px", fontWeight: 700,
                }}>
                  <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "var(--teal)", display: "inline-block" }} />
                  1s
                </span>
              </div>

              <p style={{ margin: 0, fontSize: "12px", fontWeight: 600, color: "var(--muted)", lineHeight: 1.3 }}>
                {market.name}
              </p>

              <strong style={{ fontSize: "20px", fontWeight: 800, letterSpacing: "-0.5px", fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>
                {quote !== undefined ? formatQuote(quote) : "—"}
              </strong>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                <div style={{ color: isUp ? "var(--teal)" : "var(--red)", flexShrink: 0 }}>
                  <MiniSparkline points={recent} isUp={isUp} />
                </div>
                <span style={{
                  fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap",
                  color: isUp ? "var(--teal)" : "var(--red)",
                }}>
                  {change !== null
                    ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}% (5m)`
                    : "—"}
                </span>
              </div>
            </button>
          );
        })}

        <Link
          href="/markets"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            padding: "16px",
            border: "1px solid var(--line)",
            borderRadius: "12px",
            background: "var(--panel)",
            color: "var(--muted)",
            textDecoration: "none",
            cursor: "pointer",
            transition: "border-color .15s, background .15s",
            boxShadow: "var(--card-shadow)",
            minHeight: "160px",
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.borderColor = "var(--teal)";
            event.currentTarget.style.background = "var(--surface)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.borderColor = "var(--line)";
            event.currentTarget.style.background = "var(--panel)";
          }}
        >
          <span style={{ fontSize: "24px", color: "var(--ink)" }}>→</span>
          <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)" }}>View all</span>
        </Link>
      </div>
    </section>
  );
}