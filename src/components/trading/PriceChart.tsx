"use client";

import { useEffect, useId, useMemo, useState } from "react";
import styles from "./TradingWorkspace.module.css";
import type { MarketCandle, MarketInstrument, MarketSnapshot, PricePoint } from "./types";

type Props = {
  market: MarketInstrument | null;
  snapshot?: MarketSnapshot;
  candlesByKey: Record<string, MarketCandle[]>;
  onLoadCandles: (symbol: string, granularity: number) => void;
};

const WINDOWS = [
  { label: "5M", seconds: 300 },
  { label: "15M", seconds: 900 },
  { label: "1H", seconds: 3600 },
  { label: "1D", seconds: 86400 },
  { label: "ALL", seconds: 0 },
];

const CANDLE_INTERVALS = [
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
  { label: "15m", seconds: 900 },
  { label: "1h", seconds: 3600 },
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

export default function PriceChart({ market, snapshot, candlesByKey, onLoadCandles }: Props) {
  const [range, setRange] = useState(3600);
  const [view, setView] = useState<"line" | "candles">("line");
  const [granularity, setGranularity] = useState(300);
  const gradientId = useId().replace(/:/g, "");
  const allPoints = snapshot?.points ?? [];
  const allCandles = market ? candlesByKey[`${market.symbol}:${granularity}`] ?? [] : [];

  useEffect(() => {
    if (view === "candles" && market) onLoadCandles(market.symbol, granularity);
  }, [view, market?.symbol, granularity, onLoadCandles]);

  const filteredPoints = useMemo(() => {
    if (range === 0 || allPoints.length < 2) return allPoints;
    const latest = allPoints[allPoints.length - 1]?.time ?? Math.floor(Date.now() / 1000);
    const filtered = allPoints.filter((point) => point.time >= latest - range);
    return filtered.length > 1 ? filtered : allPoints;
  }, [allPoints, range]);

  const filteredCandles = useMemo(() => {
    if (range === 0 || allCandles.length < 2) return allCandles;
    const latest = allCandles[allCandles.length - 1]?.epoch ?? Math.floor(Date.now() / 1000);
    const filtered = allCandles.filter((candle) => candle.epoch >= latest - range);
    return filtered.length > 0 ? filtered : allCandles;
  }, [allCandles, range]);

  const firstValue = view === "candles" ? filteredCandles[0]?.open : filteredPoints[0]?.price;
  const latestValue = view === "candles"
    ? filteredCandles[filteredCandles.length - 1]?.close
    : filteredPoints[filteredPoints.length - 1]?.price;
  const movement = firstValue !== undefined && latestValue !== undefined && firstValue !== 0
    ? ((latestValue - firstValue) / firstValue) * 100
    : null;
  const isUp = movement === null || movement >= 0;

  const prices = view === "candles"
    ? filteredCandles.flatMap((candle) => [candle.high, candle.low])
    : filteredPoints.map((point: PricePoint) => point.price);
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
  const yForPrice = (price: number) => top + ((max - price) / (max - min)) * plotHeight;

  const coords = filteredPoints.map((point, index) => ({
    x: left + (filteredPoints.length < 2 ? 0 : index / (filteredPoints.length - 1)) * plotWidth,
    y: yForPrice(point.price),
    point,
  }));
  const linePath = coords.map((point, index) => (index === 0 ? "M" : "L") + point.x.toFixed(2) + "," + point.y.toFixed(2)).join(" ");
  const last = coords[coords.length - 1];
  const areaPath = last && coords.length
    ? linePath + " L" + last.x.toFixed(2) + "," + (height - bottom) + " L" + coords[0].x.toFixed(2) + "," + (height - bottom) + " Z"
    : "";
  const visibleLength = view === "candles" ? filteredCandles.length : filteredPoints.length;
  const xLabelIndexes = [...new Set([0, Math.floor((visibleLength - 1) / 2), visibleLength - 1])]
    .filter((index) => index >= 0 && index < visibleLength);
  const hasChartData = view === "candles" ? filteredCandles.length > 0 : coords.length > 1;

  if (!market) {
    return <section className={styles.chartPanel} aria-label="Price chart">
      <div className={styles.panelHeading}><div><p className={styles.eyebrow}>PRICE ACTION</p><h2>Market chart</h2></div></div>
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

    <div className={styles.chartTools} aria-label="Chart type">
      <span>CHART TYPE</span>
      <div>
        <button type="button" aria-pressed={view === "line"} className={view === "line" ? styles.rangeActive : styles.rangeButton} onClick={() => setView("line")}>Line</button>
        <button type="button" aria-pressed={view === "candles"} className={view === "candles" ? styles.rangeActive : styles.rangeButton} onClick={() => setView("candles")}>Candles</button>
      </div>
    </div>

    {view === "candles" && <div className={styles.chartTools} aria-label="Candle interval">
      <span>INTERVAL</span>
      <div>{CANDLE_INTERVALS.map((item) => <button key={item.seconds} type="button" aria-pressed={granularity === item.seconds} className={granularity === item.seconds ? styles.rangeActive : styles.rangeButton} onClick={() => setGranularity(item.seconds)}>{item.label}</button>)}</div>
    </div>}

    <div className={styles.chartTools} aria-label="Chart time range">
      <span>TIME RANGE</span>
      <div>{WINDOWS.map((item) => <button key={item.label} type="button" aria-pressed={range === item.seconds} className={range === item.seconds ? styles.rangeActive : styles.rangeButton} onClick={() => setRange(item.seconds)}>{item.label}</button>)}</div>
    </div>

    {hasChartData ? <div className={styles.svgChart}>
      <svg viewBox={"0 0 " + width + " " + height} role="img" aria-label={market.name + (view === "candles" ? " OHLC candlestick history" : " tick-price history")}>
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

        {view === "line" && <>
          <path d={areaPath} fill={"url(#" + gradientId + ")"} />
          <path d={linePath} fill="none" stroke={isUp ? "#159a7d" : "#dc6470"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {last && <g>
            <circle cx={last.x} cy={last.y} r="6" fill={isUp ? "#159a7d" : "#dc6470"} stroke="#fff" strokeWidth="3" />
            <line x1={last.x} y1={last.y} x2={width - right} y2={last.y} stroke={isUp ? "#159a7d" : "#dc6470"} strokeDasharray="4 4" opacity=".5" />
          </g>}
        </>}

        {view === "candles" && filteredCandles.map((candle, index) => {
          const x = left + ((index + 0.5) / filteredCandles.length) * plotWidth;
          const candleWidth = Math.max(2, Math.min(9, (plotWidth / filteredCandles.length) * 0.58));
          const openY = yForPrice(candle.open);
          const closeY = yForPrice(candle.close);
          const highY = yForPrice(candle.high);
          const lowY = yForPrice(candle.low);
          const rising = candle.close >= candle.open;
          const color = rising ? "#159a7d" : "#dc6470";
          return <g key={candle.epoch}>
            <line x1={x} y1={highY} x2={x} y2={lowY} stroke={color} strokeWidth="1.4" />
            <rect
              x={x - candleWidth / 2}
              y={Math.min(openY, closeY)}
              width={candleWidth}
              height={Math.max(1, Math.abs(closeY - openY))}
              fill={rising ? "#159a7d" : "#dc6470"}
              stroke={color}
              strokeWidth="1"
              rx=".5"
            />
          </g>;
        })}

        {xLabelIndexes.map((index) => {
          const item = view === "candles" ? filteredCandles[index] : coords[index]?.point;
          if (!item) return null;
          const x = view === "candles"
            ? left + ((index + 0.5) / filteredCandles.length) * plotWidth
            : coords[index].x;
          const time = view === "candles" ? (item as MarketCandle).epoch : (item as PricePoint).time;
          return <text key={index} x={x} y={height - 9} textAnchor={index === 0 ? "start" : index === visibleLength - 1 ? "end" : "middle"} fill="#8593a3" fontSize="12">{formatTime(time, range)}</text>;
        })}
      </svg>
    </div> : <div className={styles.chartEmpty}>
      <span className={styles.loadingMark}>{view === "candles" ? "▥" : "⌁"}</span>
      <strong>{view === "candles"
        ? allCandles.length === 0 ? "Loading OHLC candle history" : "Waiting for more candles"
        : allPoints.length === 0 ? "Waiting for real tick history" : "Collecting live prices"}</strong>
      <p>{view === "candles"
        ? "Candles are OHLC bars returned by Deriv for the selected interval. If they do not load, switch chart type and try again."
        : allPoints.length === 0 ? "The chart appears when Deriv returns historical or live ticks. No sample prices are drawn." : "At least two real price points are needed to draw a line chart."}</p>
      {view === "candles" && <button type="button" className={styles.panelActionButton} onClick={() => onLoadCandles(market.symbol, granularity)}>Retry candle history</button>}
    </div>}
    <p className={styles.chartFootnote}>{view === "candles"
      ? "Candlesticks show open, high, low, and close prices returned by Deriv. The quote above is the separate live tick feed."
      : "Chart values are sourced from Deriv tick history and live ticks. They are not simulated or predictive."}</p>
  </section>;
}
