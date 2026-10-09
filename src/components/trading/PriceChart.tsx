"use client";

import { useId, useMemo, useState } from "react";
import styles from "./TradingWorkspace.module.css";
import type { MarketInstrument, MarketSnapshot, PricePoint } from "./types";

type Props = { market: MarketInstrument | null; snapshot?: MarketSnapshot };

const WINDOWS = [
  { label: "5M", seconds: 300 },
  { label: "15M", seconds: 900 },
  { label: "1H", seconds: 3600 },
  { label: "1D", seconds: 86400 },
  { label: "ALL", seconds: 0 },
];

function formatPrice(price: number, symbol: string) {
  const digits = symbol.startsWith("frx") ? 5 : price >= 100 ? 2 : 4;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: Math.min(2, digits) }).format(price);
}

function formatTime(time: number, rangeSeconds: number) {
  const date = new Date(time * 1000);
  return rangeSeconds >= 86400
    ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function PriceChart({ market, snapshot }: Props) {
  const [range, setRange] = useState(3600);
  const gradientId = useId().replace(/:/g, "");
  const allPoints = snapshot?.points ?? [];
  const filteredPoints = useMemo(() => {
    if (range === 0 || allPoints.length < 2) return allPoints;
    const latest = allPoints[allPoints.length - 1]?.time ?? Math.floor(Date.now() / 1000);
    const filtered = allPoints.filter((point) => point.time >= latest - range);
    return filtered.length > 1 ? filtered : allPoints;
  }, [allPoints, range]);
  const latestPoint = filteredPoints[filteredPoints.length - 1];
  const firstPoint = filteredPoints[0];
  const movement = firstPoint && latestPoint && firstPoint.price !== 0
    ? ((latestPoint.price - firstPoint.price) / firstPoint.price) * 100
    : null;
  const prices = filteredPoints.map((point: PricePoint) => point.price);
  const minRaw = prices.length ? Math.min(...prices) : 0;
  const maxRaw = prices.length ? Math.max(...prices) : 1;
  const padding = maxRaw === minRaw ? Math.max(Math.abs(maxRaw) * 0.0005, 0.00001) : (maxRaw - minRaw) * 0.12;
  const min = minRaw - padding;
  const max = maxRaw + padding;
  const width = 900;
  const height = 295;
  const left = 72;
  const right = 18;
  const top = 18;
  const bottom = 38;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const coords = filteredPoints.map((point, index) => ({
    x: left + (filteredPoints.length < 2 ? 0 : index / (filteredPoints.length - 1)) * plotWidth,
    y: top + ((max - point.price) / (max - min)) * plotHeight,
    point,
  }));
  const linePath = coords.map((point, index) => (index === 0 ? "M" : "L") + point.x.toFixed(2) + "," + point.y.toFixed(2)).join(" ");
  const last = coords[coords.length - 1];
  const areaPath = last && coords.length
    ? linePath + " L" + last.x.toFixed(2) + "," + (height - bottom) + " L" + coords[0].x.toFixed(2) + "," + (height - bottom) + " Z"
    : "";
  const isUp = movement === null || movement >= 0;

  if (!market) {
    return <section className={styles.chartPanel} aria-label="Price chart">
      <div className={styles.panelHeading}><div><p className={styles.eyebrow}>PRICE ACTION</p><h2>Live price chart</h2></div></div>
      <div className={styles.chartEmpty}><span className={styles.loadingMark}>↗</span><strong>No market selected</strong><p>Choose an active market from the watchlist to display its price history.</p></div>
    </section>;
  }

  return <section className={styles.chartPanel} aria-label={market.name + " price chart"}>
    <div className={styles.chartTop}>
      <div>
        <p className={styles.eyebrow}>LIVE MARKET CHART</p>
        <h2>{market.name}</h2>
        <span className={styles.symbolText}>{market.symbol} <span className={styles.liveBadge}><i /> Live feed</span></span>
      </div>
      <div className={styles.chartQuote}>
        <strong>{snapshot && snapshot.quote ? formatPrice(snapshot.quote, market.symbol) : "Waiting for ticks"}</strong>
        {movement !== null && <span className={isUp ? styles.positive : styles.negative}>{movement >= 0 ? "+" : ""}{movement.toFixed(2)}% in view</span>}
      </div>
    </div>
    <div className={styles.chartTools} aria-label="Chart time range">
      <span>PRICE HISTORY</span>
      <div>{WINDOWS.map((item) => <button key={item.label} type="button" className={range === item.seconds ? styles.rangeActive : styles.rangeButton} onClick={() => setRange(item.seconds)}>{item.label}</button>)}</div>
    </div>
    {coords.length > 1 ? <div className={styles.svgChart}>
      <svg viewBox={"0 0 " + width + " " + height} role="img" aria-label={market.name + " actual tick-price history"}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#16a085" stopOpacity=".23" />
            <stop offset="100%" stopColor="#16a085" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((step) => {
          const y = top + step * (plotHeight / 4);
          const value = max - step * ((max - min) / 4);
          return <g key={step}>
            <line x1={left} y1={y} x2={width - right} y2={y} stroke="#e9eef3" strokeDasharray="3 5" />
            <text x={left - 10} y={y + 4} textAnchor="end" fill="#8593a3" fontSize="12">{formatPrice(value, market.symbol)}</text>
          </g>;
        })}
        <path d={areaPath} fill={"url(#" + gradientId + ")"} />
        <path d={linePath} fill="none" stroke={isUp ? "#159a7d" : "#dc6470"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {last && <g>
          <circle cx={last.x} cy={last.y} r="6" fill={isUp ? "#159a7d" : "#dc6470"} stroke="#fff" strokeWidth="3" />
          <line x1={last.x} y1={last.y} x2={width - right} y2={last.y} stroke={isUp ? "#159a7d" : "#dc6470"} strokeDasharray="4 4" opacity=".5" />
        </g>}
        {[0, Math.floor((coords.length - 1) / 2), coords.length - 1].map((index, i) => {
          const item = coords[index];
          return <text key={i} x={item.x} y={height - 9} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} fill="#8593a3" fontSize="12">{formatTime(item.point.time, range)}</text>;
        })}
      </svg>
    </div> : <div className={styles.chartEmpty}>
      <span className={styles.loadingMark}>⌁</span>
      <strong>{allPoints.length === 0 ? "Waiting for real tick history" : "Collecting live prices"}</strong>
      <p>{allPoints.length === 0 ? "The chart appears when Deriv returns historical or live ticks. No sample prices are drawn." : "At least two real price points are needed to draw a chart."}</p>
    </div>}
    <p className={styles.chartFootnote}>Chart values are sourced from Deriv tick history and live ticks. They are not simulated or predictive.</p>
  </section>;
}
