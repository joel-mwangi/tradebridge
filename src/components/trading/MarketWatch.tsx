"use client";

import { useMemo, useState } from "react";
import styles from "./TradingWorkspace.module.css";
import type { MarketCandle, MarketInstrument, MarketSnapshot } from "./types";
import PriceChart from "./PriceChart";

type Props = {
  markets: MarketInstrument[];
  snapshots: Record<string, MarketSnapshot>;
  selectedMarket: MarketInstrument | null;
  selectedSymbol: string;
  connection: string;
  onSelect: (symbol: string) => void;
  candlesByKey: Record<string, MarketCandle[]>;
  onLoadCandles: (symbol: string, granularity: number) => void;
  listOnly?: boolean;
};

function displayPrice(value: number, symbol: string) {
  const digits = symbol.startsWith("frx") ? 5 : value >= 100 ? 2 : 4;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

function categoryLabel(category: string) {
  if (category === "all") return "All markets";
  return category.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function MarketWatch({
  markets, snapshots, selectedMarket, selectedSymbol, connection, onSelect,
  candlesByKey, onLoadCandles, listOnly = false,
}: Props) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  const categories = useMemo(() => [
    "all",
    ...Array.from(new Set(markets.map((market) => market.market || "other"))).sort(),
  ], [markets]);

  const visibleMarkets = useMemo(() => {
    const query = search.trim().toLowerCase();
    return markets.filter((market) => {
      const matchesCategory = category === "all" || (market.market || "other") === category;
      const matchesQuery = !query
        || market.name.toLowerCase().includes(query)
        || market.symbol.toLowerCase().includes(query);
      return matchesCategory && matchesQuery;
    });
  }, [markets, search, category]);

  return <div className={styles.marketColumn}>
    <section className={styles.marketPanel} id="markets">
      <div className={styles.panelHeading}>
        <div>
          <p className={styles.eyebrow}>MARKETS</p>
          <h2>{listOnly ? "Browse available markets" : "Market watch"}</h2>
          <p className={styles.panelSubtext}>
            {listOnly
              ? "Choose an instrument to open its live digit analysis and trade ticket."
              : "Choose an instrument to inspect its live market data."}
          </p>
        </div>
        <span className={connection === "Live prices" ? styles.liveStatus : styles.connectionStatus}><i />{connection}</span>
      </div>

      {listOnly && markets.length > 0 && (
        <div className={styles.marketDirectoryTools}>
          <label className={styles.marketSearchWrap}>
            <span aria-hidden="true">⌕</span>
            <input
              className={styles.marketSearch}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by market name or symbol"
              aria-label="Search available markets"
            />
          </label>
          <div className={styles.marketCategoryList} aria-label="Filter markets by category">
            {categories.map((item) => (
              <button
                key={item}
                type="button"
                className={category === item ? styles.rangeActive : styles.rangeButton}
                aria-pressed={category === item}
                onClick={() => setCategory(item)}
              >
                {categoryLabel(item)}
              </button>
            ))}
          </div>
          <p className={styles.marketResultCount}>
            Showing {visibleMarkets.length} of {markets.length} available markets
          </p>
        </div>
      )}

      {markets.length ? visibleMarkets.length ? <div className={styles.marketList}>
        {visibleMarkets.map((market) => {
          const snapshot = snapshots[market.symbol];
          const points = snapshot?.points ?? [];
          const first = points[0]?.price;
          const latest = snapshot?.quote;
          const change = first && latest ? ((latest - first) / first) * 100 : null;
          const isFresh = Boolean(snapshot && Date.now() - snapshot.updatedAt < 15_000);
          return <button
            key={market.symbol}
            type="button"
            className={selectedSymbol === market.symbol ? styles.marketItemActive : styles.marketItem}
            onClick={() => onSelect(market.symbol)}
            aria-label={listOnly ? "Open digit analysis and trade ticket for " + market.name : "Select " + market.name}
          >
            <span className={styles.marketIcon}>{market.market === "forex" ? "FX" : market.market === "commodities" ? "Au" : "↗"}</span>
            <span className={styles.marketInfo}><strong>{market.name}</strong><small>{market.symbol}</small></span>
            <span className={styles.marketPrice}>
              <strong>{snapshot && latest ? displayPrice(latest, market.symbol) : "—"}</strong>
              <small className={change === null ? styles.marketMuted : change >= 0 ? styles.positive : styles.negative}>
                {change === null ? isFresh ? "Live tick received" : snapshot ? "Waiting for tick" : "Select to load live price" : (change >= 0 ? "+" : "") + change.toFixed(2) + "%"}
              </small>
            </span>
          </button>;
        })}
      </div> : <div className={styles.marketEmpty}>
        <strong>No matching markets</strong>
        <p>Try a different name, symbol or market category.</p>
      </div> : <div className={styles.marketEmpty}>
        <strong>Loading available markets</strong>
        <p>TradeBridge asks Deriv for instruments available for digit contracts. Market data comes from Deriv and is never invented for display.</p>
      </div>}
    </section>
    {!listOnly && (
      <PriceChart
        market={selectedMarket}
        snapshot={selectedMarket ? snapshots[selectedMarket.symbol] : undefined}
        candlesByKey={candlesByKey}
        onLoadCandles={onLoadCandles}
      />
    )}
  </div>;
}
