"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

const MARKET_SOCKET = process.env.NEXT_PUBLIC_TRADEBRIDGE_BACKEND_MARKET_WS_URL?.trim() ?? "";
const DIGITS = Array.from({ length: 10 }, (_, digit) => digit);
const MAX_TAPE = 24;

type StrategyStatus = {
  type?: string;
  error?: { message?: string };
  symbol?: string | null;
  state?: string;
  reason?: string;
  selected_group?: string | null;
  trigger_digit?: number | null;
  feed_state?: string;
  observation_count?: number;
  qualification?: {
    decision?: string;
    under_qualifies?: boolean;
    over_qualifies?: boolean;
    under_threshold_passes?: boolean;
    under_stability_passes?: boolean;
    over_threshold_passes?: boolean;
    over_stability_passes?: boolean;
  } | null;
  execution_enabled?: boolean;
  digit_window_size?: number;
};

type TickMessage = {
  msg_type?: string;
  tick?: {
    underlying_symbol?: string;
    symbol?: string;
    quote?: string | number;
    epoch?: number;
    pip_size?: number;
  };
  error?: { message?: string };
};

type TapeDigit = { digit: number; key: string; time: number };

function lastDigit(quote: number | string, pipSize?: number): number | null {
  const value = Number(quote);
  if (!Number.isFinite(value)) return null;
  const raw = String(quote);
  const precision = Number.isInteger(pipSize) && pipSize! >= 0 && pipSize! <= 12
    ? pipSize
    : typeof quote === "string" && raw.includes(".") ? raw.split(".")[1]?.length : undefined;
  if (precision === undefined || precision < 0 || precision > 12) return null;
  const formatted = value.toFixed(precision);
  const fraction = formatted.split(".")[1] ?? "";
  const character = precision > 0 ? fraction.charAt(precision - 1) : formatted.slice(-1);
  const digit = Number(character);
  return Number.isInteger(digit) && digit >= 0 && digit <= 9 ? digit : null;
}

function Icon({ name, size = 17 }: { name: "play" | "stop" | "refresh" | "signal" | "shield" | "pulse" | "clock" | "check" | "alert" | "eye"; size?: number }) {
  const paths: Record<string, ReactNode> = {
    play: <path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
    refresh: <><path d="M20 7v5h-5" /><path d="M4.8 10a7.5 7.5 0 0 1 12.7-3L20 12M4 17v-5h5" /><path d="M19.2 14a7.5 7.5 0 0 1-12.7 3L4 12" /></>,
    signal: <><path d="M3 10a15 15 0 0 1 18 0" /><path d="M6 13a10 10 0 0 1 12 0" /><path d="M9 16a5 5 0 0 1 6 0" /><path d="M12 20h.01" /></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z" /><path d="m9 12 2 2 4-4" /></>,
    pulse: <path d="M3 12h4l3-8 4 16 3-8h4" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    alert: <><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3l-7.9-14.1a2 2 0 0 0-3.4 0z" /><path d="M12 9v4m0 4h.01" /></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export default function DigitStrategyPanel({ symbol, windowSize }: { symbol: string; windowSize: number }) {
  const socketRef = useRef<WebSocket | null>(null);
  const seenTicksRef = useRef(new Set<string>());
  const [transport, setTransport] = useState<"connecting" | "connected" | "stale" | "disconnected" | "unconfigured">("connecting");
  const [status, setStatus] = useState<StrategyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [tape, setTape] = useState<TapeDigit[]>([]);
  const [lastTickAt, setLastTickAt] = useState<number | null>(null);
  const [selectedDigit, setSelectedDigit] = useState<number | null>(null);
  const [events, setEvents] = useState<Array<{ key: string; kind: "tick" | "status" | "warning"; time: number; digit?: number }>>([]);

  useEffect(() => {
    if (!MARKET_SOCKET) {
      setTransport("unconfigured");
      return;
    }
    let alive = true;
    let socket: WebSocket;
    try {
      socket = new WebSocket(MARKET_SOCKET);
      socketRef.current = socket;
    } catch {
      setTransport("disconnected");
      return;
    }
    socket.onopen = () => {
      if (!alive) return;
      setTransport("connected");
      socket.send(JSON.stringify({ strategy: { action: "status" } }));
    };
    socket.onmessage = (event) => {
      if (!alive) return;
      try {
        const message = JSON.parse(String(event.data)) as StrategyStatus & TickMessage;
        if (message.type === "strategy_status") {
          setStatus(message);
          setBusy(false);
          setTransport("connected");
          setEvents((current) => [{ key: "status-" + Date.now(), kind: "status" as const, time: Date.now() }, ...current].slice(0, 12));
          return;
        }
        if (message.error?.message) {
          setBusy(false);
          setEvents((current) => [{ key: "warning-" + Date.now(), kind: "warning" as const, time: Date.now() }, ...current].slice(0, 12));
          return;
        }
        const tick = message.tick;
        const tickSymbol = tick?.underlying_symbol ?? tick?.symbol;
        if (!tick || (tickSymbol && symbol && tickSymbol !== symbol)) return;
        const digit = lastDigit(tick.quote ?? "", tick.pip_size);
        if (digit === null) return;
        const epoch = Number(tick.epoch);
        const time = Number.isFinite(epoch) ? epoch * 1000 : Date.now();
        const key = `${tickSymbol ?? symbol}:${epoch}:${String(tick.quote)}`;
        if (seenTicksRef.current.has(key)) return;
        seenTicksRef.current.add(key);
        if (seenTicksRef.current.size > 500) seenTicksRef.current = new Set(Array.from(seenTicksRef.current).slice(-250));
        setTape((current) => [...current, { digit, key, time }].slice(-MAX_TAPE));
        setLastTickAt(time);
        setTransport("connected");
        setEvents((current) => [{ key, kind: "tick", time, digit }, ...current].slice(0, 12));
      } catch {
        // Ignore non-JSON and unrelated frames without inventing a visual tick.
      }
    };
    socket.onerror = () => { if (alive) setTransport("disconnected"); };
    socket.onclose = () => { if (alive) setTransport("disconnected"); };
    return () => {
      alive = false;
      if (socketRef.current === socket) socketRef.current = null;
      socket.close();
    };
  }, [symbol]);

  useEffect(() => {
    const active = Boolean(status && ["observing", "waiting_for_more_data", "selected"].includes(status.state ?? ""));
    if (!active || !symbol || !Number.isInteger(windowSize)) return;
    if (status?.symbol === symbol && status?.digit_window_size === windowSize) return;
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    setBusy(true);
    socket.send(JSON.stringify({ strategy: { action: "start", symbol, window_size: windowSize } }));
  }, [symbol, windowSize, status?.state, status?.symbol, status?.digit_window_size]);

  useEffect(() => {
    if (!lastTickAt) return;
    const timer = window.setInterval(() => {
      if (Date.now() - lastTickAt > 8000) setTransport((current) => current === "connected" ? "stale" : current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lastTickAt]);

  function send(action: "start" | "stop" | "status") {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setTransport("disconnected");
      return;
    }
    if (action === "start" && !symbol) return;
    setBusy(true);
    socket.send(JSON.stringify({ strategy: action === "start" ? { action, symbol, window_size: windowSize } : { action } }));
  }

  const state = status?.state ?? "idle";
  const active = Boolean(status && ["observing", "waiting_for_more_data", "selected"].includes(state));
  const healthColor = transport === "connected" ? "#35d6a0" : transport === "stale" ? "#f4b740" : "#f06f79";
  const tickAge = lastTickAt ? Math.max(0, Math.floor((Date.now() - lastTickAt) / 1000)) : null;
  const counts = DIGITS.map((digit) => tape.filter((tick) => tick.digit === digit).length);
  const maxCount = Math.max(1, ...counts);
  const latest = tape[tape.length - 1];
  const qualification = status?.qualification;
  const groupState = (value?: boolean) => value === true ? "#35d6a0" : value === false ? "#f06f79" : "var(--muted)";
  const panel: CSSProperties = { border: "1px solid var(--line)", borderRadius: 18, padding: 16, background: "var(--surface)", marginBottom: 16, overflow: "hidden" };
  const tile: React.CSSProperties = { minWidth: 0, flex: "1 1 0", display: "grid", placeItems: "center", borderRadius: 10, minHeight: 45, border: "1px solid var(--line)", background: "var(--surface-2, var(--sidebar-bg))", color: "var(--ink)", fontSize: 17, fontWeight: 850, transition: "transform .18s ease, border-color .18s ease" };

  return (
    <section aria-label="Live digit strategy visual monitor" style={panel}>
      <style>{`
        @keyframes tb-pulse { 0%,100% { opacity:.45; transform:scale(.88) } 50% { opacity:1; transform:scale(1) } }
        @keyframes tb-in { from { opacity:.15; transform:translateY(5px) scale(.92) } to { opacity:1; transform:translateY(0) scale(1) } }
        @keyframes tb-sweep { from { transform:translateX(-100%) } to { transform:translateX(300%) } }
        .tb-pulse { animation:tb-pulse 1.5s ease-in-out infinite }
        .tb-digit-in { animation:tb-in .22s ease-out both }
        .tb-no-motion * { animation:none !important; transition:none !important }
      `}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div aria-label={transport} title={transport} style={{ width: 42, height: 42, borderRadius: 13, display: "grid", placeItems: "center", background: `${healthColor}18`, color: healthColor, border: `1px solid ${healthColor}55` }}>
            <span className={transport === "connected" ? "tb-pulse" : ""}><Icon name={transport === "connected" ? "signal" : transport === "stale" ? "clock" : "alert"} size={20} /></span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--ink)", fontWeight: 850, fontSize: 14 }}>
              <span>{symbol || "—"}</span>
              <span style={{ width: 5, height: 5, borderRadius: 99, background: healthColor }} />
              <span style={{ color: healthColor, fontSize: 10, letterSpacing: ".12em" }}>{transport === "connected" ? "●" : transport === "stale" ? "Ⅱ" : "○"}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--muted)", fontSize: 10 }}>
              <Icon name="eye" size={12} />
              <span>{windowSize.toLocaleString()}</span>
              <span>·</span>
              <Icon name="shield" size={12} />
              <span aria-label="Execution disabled">⊘</span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 7 }}>
          <button type="button" onClick={() => send("start")} disabled={!symbol || busy || active} aria-label="Start observation" title="Start" style={{ width: 38, height: 36, display: "grid", placeItems: "center", border: 0, borderRadius: 10, background: active ? "var(--line)" : "var(--teal)", color: "#fff", opacity: !symbol || busy || active ? .5 : 1, cursor: "pointer" }}><Icon name="play" /></button>
          <button type="button" onClick={() => send("stop")} disabled={busy || !active} aria-label="Stop observation" title="Stop" style={{ width: 38, height: 36, display: "grid", placeItems: "center", border: "1px solid var(--line)", borderRadius: 10, background: "transparent", color: "var(--ink)", opacity: busy || !active ? .4 : 1, cursor: "pointer" }}><Icon name="stop" /></button>
          <button type="button" onClick={() => send("status")} disabled={busy} aria-label="Refresh status" title="Refresh" style={{ width: 38, height: 36, display: "grid", placeItems: "center", border: "1px solid var(--line)", borderRadius: 10, background: "transparent", color: "var(--ink)", opacity: busy ? .5 : 1, cursor: "pointer" }}><Icon name="refresh" /></button>
        </div>
      </div>

      <div style={{ marginTop: 16, border: "1px solid var(--line)", borderRadius: 14, padding: 12, background: "var(--surface-2, var(--sidebar-bg))" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--muted)" }}><Icon name="pulse" size={14} /><span style={{ fontSize: 10, letterSpacing: ".14em" }}>◉ LIVE TAPE</span></div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }} aria-label={tickAge === null ? "Waiting for first tick" : `Last tick ${tickAge} seconds ago`}>
            {Array.from({ length: 12 }, (_, index) => <span key={index} style={{ width: 3, height: 8 + ((index * 7 + tape.length * 3) % 10), borderRadius: 5, background: transport === "connected" && tape.length ? healthColor : "var(--line)", opacity: .35 + (index / 20) }} />)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 5, alignItems: "stretch" }}>
          {tape.length ? tape.slice(-12).map((item) => <button key={item.key} type="button" onClick={() => setSelectedDigit(item.digit)} aria-label={`Inspect digit ${item.digit}`} className="tb-digit-in" style={{ ...tile, borderColor: selectedDigit === item.digit ? "var(--teal)" : "var(--line)", boxShadow: selectedDigit === item.digit ? "inset 0 0 0 1px var(--teal)" : "none", background: item.key === latest?.key ? "var(--teal)" : "var(--surface)", color: item.key === latest?.key ? "#fff" : "var(--ink)", minHeight: 44 }}>{item.digit}</button>) : Array.from({ length: 12 }, (_, index) => <div key={index} style={{ ...tile, minHeight: 44, opacity: .25 + (index % 4) * .12 }}><span className={transport === "connected" ? "tb-pulse" : ""} style={{ width: 5, height: 5, borderRadius: 9, background: "var(--muted)" }} /></div>)}
        </div>
        <div style={{ height: 2, overflow: "hidden", borderRadius: 5, marginTop: 11, background: "var(--line)" }}>
          <div style={{ width: transport === "connected" ? "35%" : "12%", height: "100%", background: healthColor, animation: transport === "connected" ? "tb-sweep 2.5s linear infinite" : "none" }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(10, minmax(0, 1fr))", gap: 5, marginTop: 12 }}>
        {DIGITS.map((digit) => {
          const count = counts[digit];
          const height = Math.max(5, (count / maxCount) * 35);
          const chosen = selectedDigit === digit;
          return <button key={digit} type="button" onClick={() => setSelectedDigit(chosen ? null : digit)} aria-label={`Select digit ${digit}, observed ${count} times in the visible tape`} style={{ border: `1px solid ${chosen ? "var(--teal)" : "var(--line)"}`, borderRadius: 9, padding: "7px 2px 5px", background: chosen ? "color-mix(in srgb, var(--teal) 8%, transparent)" : "transparent", color: "var(--ink)", minWidth: 0, cursor: "pointer" }}>
            <span style={{ display: "block", fontSize: 11, fontWeight: 800 }}>{digit}</span>
            <span style={{ height: 38, display: "flex", alignItems: "end", justifyContent: "center", margin: "4px 0" }}><span style={{ width: "58%", maxWidth: 16, height, borderRadius: 4, background: chosen ? "var(--teal)" : count ? "color-mix(in srgb, var(--teal) 60%, transparent)" : "var(--line)", transition: "height .18s ease" }} /></span>
            <span style={{ display: "block", fontSize: 9, color: "var(--muted)" }}>{count}</span>
          </button>;
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 9, marginTop: 12 }}>
        {[
          { id: "under", icon: "↓", color: groupState(qualification?.under_qualifies), qualifies: qualification?.under_qualifies, threshold: qualification?.under_threshold_passes, stability: qualification?.under_stability_passes },
          { id: "over", icon: "↑", color: groupState(qualification?.over_qualifies), qualifies: qualification?.over_qualifies, threshold: qualification?.over_threshold_passes, stability: qualification?.over_stability_passes },
        ].map((group) => (
          <div key={group.id} style={{ border: `1px solid ${group.color}55`, borderRadius: 12, padding: 11, background: `color-mix(in srgb, ${group.color} 5%, transparent)` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 17, color: group.color }}>{group.icon}</span>
              <span style={{ display: "flex", gap: 4, alignItems: "center" }} aria-label={group.qualifies === true ? "Qualified" : group.qualifies === false ? "Not qualified" : "Pending"}>
                {[group.threshold, group.stability, group.qualifies].map((passed, index) => <span key={index} style={{ width: 8, height: 8, borderRadius: 99, background: passed === true ? "#35d6a0" : passed === false ? "#f06f79" : "var(--line)" }} />)}
              </span>
            </div>
            <div style={{ display: "flex", gap: 5, marginTop: 12 }}>
              {[group.threshold, group.stability, group.qualifies].map((passed, index) => <span key={index} style={{ flex: 1, height: 5, borderRadius: 4, background: passed === true ? "#35d6a0" : passed === false ? "#f06f79" : "var(--line)" }} />)}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 13 }}>
        <div style={{ display: "flex", gap: 7, alignItems: "center", minWidth: 0 }}>
          <span style={{ width: 8, height: 8, flexShrink: 0, borderRadius: 99, background: state === "blocked" || transport === "disconnected" || transport === "stale" ? "#f4b740" : active ? "#35d6a0" : "var(--muted)" }} />
          <span style={{ color: "var(--muted)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={status?.reason ?? status?.state ?? transport}>{status?.reason ?? status?.state ?? transport}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--muted)", fontSize: 10, flexShrink: 0 }}>
          <Icon name="clock" size={12} /><span>{tickAge === null ? "—" : `${tickAge}s`}</span>
          <span>·</span><span>{status?.observation_count ?? 0}</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 5, overflow: "hidden", marginTop: 13, paddingTop: 10, borderTop: "1px solid var(--line)" }} aria-label="Recent system events">
        {events.slice(0, 12).reverse().map((event) => <span key={event.key} title={event.kind} style={{ height: 18, minWidth: 8, flex: 1, maxWidth: 34, borderRadius: 4, display: "grid", placeItems: "center", background: event.kind === "warning" ? "#f06f7933" : event.kind === "tick" ? "#35d6a033" : "var(--line)", color: event.kind === "warning" ? "#f06f79" : event.kind === "tick" ? "#35d6a0" : "var(--muted)", fontSize: 9 }}>{event.kind === "tick" ? event.digit : event.kind === "warning" ? "!" : "•"}</span>)}
        {!events.length && Array.from({ length: 8 }, (_, index) => <span key={index} style={{ height: 18, flex: 1, borderRadius: 4, background: "var(--line)", opacity: .5 }} />)}
      </div>
    </section>
  );
}
