"use client";

import styles from "./TradingWorkspace.module.css";
import type { MarketInstrument, MarketSnapshot } from "./types";
import PriceChart from "./PriceChart";

type Props = {
  markets: MarketInstrument[];
  snapshots: Record<string, MarketSnapshot>;
  selectedMarket: MarketInstrument | null;
  selectedSymbol: string;
  connection: string;
  onSelect: (symbol: string) => void;
};

function displayPrice(value: number, symbol: string) {
  const digits = symbol.startsWith("frx") ? 5 : value >= 100 ? 2 : 4;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

export default function MarketWatch({ markets, snapshots, selectedMarket, selectedSymbol, connection, onSelect }: Props) {
  return <div className={styles.marketColumn}>
    <section className={styles.marketPanel} id="markets">
      <div className={styles.panelHeading}>
        <div><p className={styles.eyebrow}>MARKETS</p><h2>Market watch</h2><p className={styles.panelSubtext}>Choose an instrument to view its live price chart.</p></div>
        <span className={connection === "Live prices" ? styles.liveStatus : styles.connectionStatus}><i />{connection}</span>
      </div>
      {markets.length ? <div className={styles.marketList}>
        {markets.map((market) => {
          const snapshot = snapshots[market.symbol];
          const points = snapshot?.points ?? [];
          const first = points[0]?.price;
          const latest = snapshot?.quote;
          const change = first && latest ? ((latest - first) / first) * 100 : null;
          const isFresh = Boolean(snapshot && Date.now() - snapshot.updatedAt < 15_000);
          return <button key={market.symbol} type="button" className={selectedSymbol === market.symbol ? styles.marketItemActive : styles.marketItem} onClick={() => onSelect(market.symbol)}>
            <span className={styles.marketIcon}>{market.market === "forex" ? "FX" : market.market === "commodities" ? "Au" : "↗"}</span>
            <span className={styles.marketInfo}><strong>{market.name}</strong><small>{market.symbol}</small></span>
            <span className={styles.marketPrice}>
              <strong>{snapshot && latest ? displayPrice(latest, market.symbol) : "—"}</strong>
              <small className={change === null ? styles.marketMuted : change >= 0 ? styles.positive : styles.negative}>{change === null ? isFresh ? "Live tick received" : "Waiting for tick" : (change >= 0 ? "+" : "") + change.toFixed(2) + "%"}</small>
            </span>
          </button>;
        })}
      </div> : <div className={styles.marketEmpty}>
        <strong>Loading active markets</strong>
        <p>TradeBridge asks Deriv for the instruments currently available for CALL/PUT contracts. No market prices are invented while that request is pending.</p>
      </div>}
    </section>
    <PriceChart market={selectedMarket} snapshot={selectedMarket ? snapshots[selectedMarket.symbol] : undefined} />
  </div>;
}
