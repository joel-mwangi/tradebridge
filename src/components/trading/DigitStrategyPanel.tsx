"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { StrategyContractUpdate, StrategyExecutionStatus } from "./types";

const MARKET_SOCKET = process.env.NEXT_PUBLIC_TRADEBRIDGE_BACKEND_MARKET_WS_URL?.trim() ?? "";
const DIGITS = Array.from({ length: 10 }, (_, digit) => digit);
const MAX_TAPE = 24;

type StrategyStatus = {
  type?: string;
  error?: { message?: string };
  symbol?: string | null;
  barrier?: number;
  state?: string;
  reason?: string;
  selected_group?: string | null;
  requested_direction?: string | null;
  signal_generated?: boolean;
  trigger_digit?: number | null;
  feed_state?: string;
  observation_count?: number;
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

export default function DigitStrategyPanel({ symbol, windowSize, barrier, direction, onDirectionChange, frequency, executionStatus, contractUpdate }: { symbol: string; windowSize: number; barrier: number; direction: "OVER" | "UNDER"; onDirectionChange: (direction: "OVER" | "UNDER") => void; frequency?: import("./types").BackendDigitFrequency; executionStatus?: StrategyExecutionStatus | null; contractUpdate?: StrategyContractUpdate | null }) {
  const socketRef = useRef<WebSocket | null>(null);
  const seenTicksRef = useRef(new Set<string>());
  const [transport, setTransport] = useState<"connecting" | "connected" | "stale" | "disconnected" | "unconfigured">("connecting");
  const [status, setStatus] = useState<StrategyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [tape, setTape] = useState<TapeDigit[]>([]);
  const [lastTickAt, setLastTickAt] = useState<number | null>(null);
  const [selectedDigit, setSelectedDigit] = useState<number | null>(null);
  const [events, setEvents] = useState<Array<{ key: string; kind: "tick" | "status" | "warning"; time: number; digit?: number }>>([]);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundVolume, setSoundVolume] = useState(0.35);
  const audioContextRef = useRef<AudioContext | null>(null);
  const previousTransportRef = useRef<typeof transport | null>(null);
  const previousStrategyStateRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      setSoundEnabled(localStorage.getItem("tradebridge_strategy_sounds") === "on");
      const savedVolume = Number(localStorage.getItem("tradebridge_strategy_sound_volume"));
      if (Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1) setSoundVolume(savedVolume);
    } catch {
      // Audio preferences remain session-only when storage is unavailable.
    }
  }, []);

  const playCue = useCallback((kind: "start" | "connected" | "disconnected" | "stop" | "error" | "test") => {
    if (!soundEnabled && kind !== "test") return;
    try {
      const AudioContextClass = window.AudioContext;
      if (!AudioContextClass) return;
      const context = audioContextRef.current ?? new AudioContextClass();
      audioContextRef.current = context;
      if (context.state === "suspended") void context.resume();
      const patterns: Record<typeof kind, number[]> = {
        start: [660], connected: [660, 880], disconnected: [330],
        stop: [523, 392], error: [330, 330], test: [660, 880],
      };
      const notes = patterns[kind];
      const now = context.currentTime;
      notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const startAt = now + index * 0.13;
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, startAt);
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, soundVolume * 0.12), startAt + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.11);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(startAt);
        oscillator.stop(startAt + 0.12);
      });
    } catch {
      // Audio is optional and must never interrupt market observation.
    }
  }, [soundEnabled, soundVolume]);

  function toggleSounds() {
    const next = !soundEnabled;
    setSoundEnabled(next);
    try { localStorage.setItem("tradebridge_strategy_sounds", next ? "on" : "off"); } catch { /* ignore */ }
    if (next) playCue("test");
  }

  function changeSoundVolume(value: number) {
    setSoundVolume(value);
    try { localStorage.setItem("tradebridge_strategy_sound_volume", String(value)); } catch { /* ignore */ }
  }

  useEffect(() => {
    const previous = previousTransportRef.current;
    if (previous !== null && previous !== transport) {
      if (transport === "connected") playCue("connected");
      else if (transport === "disconnected" || transport === "stale" || transport === "unconfigured") playCue("disconnected");
    }
    previousTransportRef.current = transport;
  }, [transport, playCue]);

  useEffect(() => {
    const nextState = status?.state ?? null;
    const previous = previousStrategyStateRef.current;
    if (nextState && previous !== null && nextState !== previous) {
      if (["observing", "waiting_for_more_data", "selected"].includes(nextState)
        && !["observing", "waiting_for_more_data", "selected"].includes(previous)) playCue("start");
      else if (["idle", "stopped", "paused"].includes(nextState)
        && !["idle", "stopped", "paused"].includes(previous)) playCue("stop");
      else if (nextState === "blocked" || nextState === "error") playCue("error");
    }
    previousStrategyStateRef.current = nextState;

  }, [status, playCue]);

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
        setEvents((current) => [{ key, kind: "tick" as const, time, digit }, ...current].slice(0, 12));
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
    const active = ["observing", "waiting_for_more_data", "selected"].includes(status?.state ?? "");
    if (!active || !symbol || !Number.isInteger(windowSize)) return;
    if (status?.symbol === symbol && status?.digit_window_size === windowSize && status?.barrier === barrier && status?.requested_direction === direction.toLowerCase()) return;
    // Configuration changes invalidate the active run. Never silently start a replacement session.
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    setBusy(true);
    socket.send(JSON.stringify({ strategy: { action: "stop" } }));
  }, [symbol, windowSize, barrier, direction, status?.state, status?.symbol, status?.digit_window_size, status?.barrier, status?.requested_direction]);

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
    if (action === "start") {
      setStatus(null);
    }
    setBusy(true);
    socket.send(JSON.stringify({ strategy: action === "start" ? { action, symbol, window_size: windowSize, barrier, direction: direction.toLowerCase() } : { action } }));
  }

  const state = status?.state ?? "idle";
  const active = Boolean(status && ["observing", "waiting_for_more_data", "selected"].includes(state));
  const healthColor = transport === "connected" ? "#35d6a0" : transport === "stale" ? "#f4b740" : "#f06f79";
  const tickAge = lastTickAt ? Math.max(0, Math.floor((Date.now() - lastTickAt) / 1000)) : null;
  const frequencyWindow = frequency?.symbol === symbol ? frequency.windows?.[String(windowSize)] : undefined;
  const counts = DIGITS.map((digit) => frequencyWindow?.counts?.[String(digit)] ?? 0);
  const total = frequencyWindow?.sample_size ?? 0;
  const hasFrequency = Boolean(frequencyWindow && total > 0);
  const percentage = (count: number) => total > 0 ? `${(count / total * 100).toFixed(1)}%` : "—";
  const maxCount = Math.max(1, ...counts);
  const ranked = [...DIGITS].sort((a, b) => counts[b] - counts[a] || a - b);
  const rank = (digit: number) => hasFrequency ? ranked.indexOf(digit) + 1 : 0;
  const rankColor = (digit: number) => !hasFrequency ? "var(--muted)" : rank(digit) === 1 ? "#4ade80" : rank(digit) === 2 ? "#60a5fa" : rank(digit) === 10 ? "#f87171" : rank(digit) === 9 ? "#fbbf24" : "var(--ink)";
  const rankBackground = (digit: number) => !hasFrequency ? "var(--surface)" : rank(digit) === 1 ? "#142d25" : rank(digit) === 2 ? "#17283d" : rank(digit) === 10 ? "#351e23" : rank(digit) === 9 ? "#332b19" : "var(--surface)";
  const latest = tape[tape.length - 1];
  const executionState = executionStatus?.state ?? "";
  const reportedBuyCount = executionStatus?.buy_count ?? 0;
  const reportedMaxBuys = executionStatus?.max_buys ?? 3;
  const maxBuys = Number.isInteger(reportedMaxBuys) && reportedMaxBuys > 0 && reportedMaxBuys <= 10 ? reportedMaxBuys : 3;
  const buyCount = Number.isInteger(reportedBuyCount) ? Math.min(maxBuys, Math.max(0, reportedBuyCount)) : 0;
  const completedBuys = executionState === "waiting_settlement" ? Math.max(0, buyCount - 1) : buyCount;
  const consecutiveLosses = Math.max(0, executionStatus?.consecutive_losses ?? 0);
  const activeContractId = executionStatus?.active_contract_id == null
    ? null
    : String(executionStatus.active_contract_id);
  const isExecutionActive = ["waiting_proposal", "waiting_buy", "waiting_settlement"].includes(executionState);
  const isStoppedForLosses = executionState === "stopped" && consecutiveLosses >= 2;
  const executionColor = executionState === "completed" ? "#35d6a0"
    : executionState === "stopped" ? "#f06f79"
      : isExecutionActive ? "#60a5fa" : "#f4b740";
  let executionTitle = "";
  let executionDetail = executionStatus?.reason ?? "";
  if (executionState === "waiting_proposal") {
    if (buyCount === 0) executionTitle = "Signal confirmed";
    else {
      const lastContractOutcome = contractUpdate?.outcome;
      const outcomeLabel = lastContractOutcome === "won" ? "won"
        : lastContractOutcome === "lost" ? "lost"
          : lastContractOutcome === "breakeven" ? "settled at breakeven"
            : consecutiveLosses > 0 ? "lost" : "settled";
      executionTitle = `Buy ${buyCount} ${outcomeLabel}`;
    }
    executionDetail = `Preparing Buy ${Math.min(buyCount + 1, maxBuys)} of ${maxBuys}`;
  } else if (executionState === "waiting_buy") {
    executionTitle = `Buy ${Math.min(buyCount + 1, maxBuys)} of ${maxBuys}`;
    executionDetail = "Submitting contract...";
  } else if (executionState === "waiting_settlement") {
    executionTitle = `Buy ${buyCount} accepted`;
    executionDetail = "Waiting for settlement...";
  } else if (executionState === "stopped") {
    executionTitle = "Strategy stopped";
    executionDetail = isStoppedForLosses ? "Two consecutive losses" : executionStatus?.reason ?? "Execution stopped";
  } else if (executionState === "completed") {
    executionTitle = "Strategy completed";
    executionDetail = `${buyCount} of ${maxBuys} buys finished`;
  }
  const showExecutionCard = Boolean(executionStatus || (status?.state === "selected" && status.signal_generated));
  const matchingContractUpdate = contractUpdate
    && (!activeContractId || contractUpdate.contractId === activeContractId)
    ? contractUpdate
    : null;
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
              <span>Barrier {barrier}</span>
              <span>·</span>
              <Icon name="shield" size={12} />
              <span aria-label="Execution status received from authenticated trading session">Execution</span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 7 }}>
          <button type="button" onClick={() => send("start")} disabled={!symbol || busy || active} aria-label="Start observation" title="Start" style={{ width: 38, height: 36, display: "grid", placeItems: "center", border: 0, borderRadius: 10, background: active ? "var(--line)" : "var(--teal)", color: "#fff", opacity: !symbol || busy || active ? .5 : 1, cursor: "pointer" }}><Icon name="play" /></button>
          <button type="button" onClick={() => send("stop")} disabled={busy || !active} aria-label="Stop observation" title="Stop" style={{ width: 38, height: 36, display: "grid", placeItems: "center", border: "1px solid var(--line)", borderRadius: 10, background: "transparent", color: "var(--ink)", opacity: busy || !active ? .4 : 1, cursor: "pointer" }}><Icon name="stop" /></button>
          <button type="button" onClick={() => send("status")} disabled={busy} aria-label="Refresh status" title="Refresh" style={{ width: 38, height: 36, display: "grid", placeItems: "center", border: "1px solid var(--line)", borderRadius: 10, background: "transparent", color: "var(--ink)", opacity: busy ? .5 : 1, cursor: "pointer" }}><Icon name="refresh" /></button>
        </div>
      </div>

      <div aria-label="Strategy contract type" style={{ display: "grid", gap: 8, marginTop: 14, padding: 12, border: "1px solid var(--line)", borderRadius: 12, background: "var(--surface-2, var(--sidebar-bg))" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 3 }}>
            <strong style={{ color: "var(--ink)", fontSize: 12 }}>Contract type</strong>
            <span style={{ color: "var(--muted)", fontSize: 10 }}>Choose the contract the Strategy run should qualify</span>
          </div>
          <span style={{ color: "var(--muted)", fontSize: 10 }}>Selected: <strong style={{ color: "var(--ink)" }}>{direction}</strong></span>
        </div>
        <div role="group" aria-label="Select Over or Under contract" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
          {(["OVER", "UNDER"] as const).map((option) => {
            const selected = direction === option;
            const accent = option === "OVER" ? "#35d6a0" : "#60a5fa";
            return <button key={option} type="button" aria-pressed={selected} onClick={() => { if (option !== direction) onDirectionChange(option); }} style={{ minHeight: 42, border: `1px solid ${selected ? accent : "var(--line)"}`, borderRadius: 9, padding: "9px 12px", background: selected ? `color-mix(in srgb, ${accent} 14%, transparent)` : "transparent", color: selected ? accent : "var(--ink)", fontSize: 12, fontWeight: 850, letterSpacing: ".06em", cursor: "pointer", transition: "background .15s ease, border-color .15s ease" }}>
              {option === "OVER" ? "↑ OVER" : "↓ UNDER"}
            </button>;
          })}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginTop: 12, padding: "9px 10px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--surface-2, var(--sidebar-bg))" }}>
        <div style={{ display: "grid", gap: 3 }}>
          <span style={{ color: "var(--ink)", fontSize: 11, fontWeight: 800 }}>Audio cues</span>
          <span style={{ color: "var(--muted)", fontSize: 10 }}>Important events only · no sound per tick</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--muted)", fontSize: 10 }}>
            Volume
            <input aria-label="Strategy sound volume" type="range" min="0" max="100" step="5" value={Math.round(soundVolume * 100)} onChange={(event) => changeSoundVolume(Number(event.target.value) / 100)} style={{ width: 74, accentColor: "var(--teal)" }} />
          </label>
          <button type="button" onClick={toggleSounds} aria-pressed={soundEnabled} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "7px 10px", background: soundEnabled ? "var(--teal)" : "transparent", color: soundEnabled ? "#fff" : "var(--ink)", fontSize: 10, fontWeight: 800, cursor: "pointer" }}>{soundEnabled ? "Sounds on" : "Enable sounds"}</button>
          <button type="button" onClick={() => playCue("test")} aria-label="Test strategy sound" title="Test sound" style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "7px 9px", background: "transparent", color: "var(--ink)", fontSize: 10, cursor: "pointer" }}>Test</button>
        </div>
      </div>

      {showExecutionCard && (
        <div aria-live="polite" aria-label="Strategy execution progress" style={{ marginTop: 14, padding: 14, borderRadius: 14, border: `1px solid ${executionColor}55`, background: `color-mix(in srgb, ${executionColor} 7%, var(--surface-2, var(--sidebar-bg)))` }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 5 }}>
              <span style={{ color: executionColor, fontSize: 10, fontWeight: 850, letterSpacing: ".12em", textTransform: "uppercase" }}>
                {executionTitle || "Signal confirmed"}
              </span>
              <strong style={{ color: "var(--ink)", fontSize: 17 }}>
                {executionDetail || "Waiting for authenticated execution update..."}
              </strong>
            </div>
            {executionStatus && (
              <span style={{ padding: "5px 8px", borderRadius: 999, background: `${executionColor}18`, color: executionColor, fontSize: 10, fontWeight: 800 }}>
                {executionState.replaceAll("_", " ") || "execution update"}
              </span>
            )}
          </div>

          {executionStatus && (
            <>
              <div aria-label={`${buyCount} of ${maxBuys} buys completed`} style={{ display: "grid", gridTemplateColumns: `repeat(${maxBuys}, minmax(0, 1fr))`, gap: 6, marginTop: 14 }}>
                {Array.from({ length: maxBuys }, (_, index) => {
                  const number = index + 1;
                  const done = number <= completedBuys;
                  const activeBuy = executionState === "waiting_settlement" ? buyCount : buyCount + 1;
                  const current = isExecutionActive && number === activeBuy;
                  const skipped = isStoppedForLosses && number > buyCount;
                  const color = done ? "#35d6a0" : skipped ? "#f06f79" : current ? "#60a5fa" : "var(--line)";
                  return <div key={number} style={{ display: "grid", gap: 5 }}>
                    <div style={{ height: 5, borderRadius: 99, background: color, opacity: done || current || skipped ? 1 : .45 }} />
                    <span style={{ color: done || current || skipped ? color : "var(--muted)", fontSize: 9, fontWeight: 750 }}>
                      {skipped ? `Buy ${number} skipped` : done ? `Buy ${number} done` : current ? `Buy ${number} ${executionState === "waiting_settlement" ? "settling" : "next"}` : `Buy ${number}`}
                    </span>
                  </div>;
                })}
              </div>
              {consecutiveLosses > 0 && executionState !== "stopped" && (
                <div style={{ marginTop: 10, color: "#f4b740", fontSize: 11, fontWeight: 750 }}>
                  Loss streak: {consecutiveLosses}
                </div>
              )}
              {isStoppedForLosses && (
                <div style={{ marginTop: 10, color: "#f06f79", fontSize: 11, fontWeight: 750 }}>
                  Buy {Math.min(buyCount + 1, maxBuys)} was not executed
                </div>
              )}
              {activeContractId && (
                <div style={{ marginTop: 10, paddingTop: 9, borderTop: "1px solid var(--line)", color: "var(--muted)", fontSize: 10 }}>
                  Active contract <strong style={{ color: "var(--ink)" }}>{activeContractId}</strong>
                </div>
              )}
              {matchingContractUpdate && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8, color: "var(--muted)", fontSize: 10 }}>
                  <span>Contract: <strong style={{ color: "var(--ink)" }}>{matchingContractUpdate.providerStatus || matchingContractUpdate.outcome}</strong></span>
                  {matchingContractUpdate.profit !== null && (
                    <span>Profit: <strong style={{ color: matchingContractUpdate.profit >= 0 ? "#35d6a0" : "#f06f79" }}>
                      {matchingContractUpdate.profit > 0 ? "+" : ""}{matchingContractUpdate.profit.toFixed(2)} {matchingContractUpdate.currency}
                    </strong></span>
                  )}
                </div>
              )}
              {executionStatus.reason && (
                <p style={{ margin: "9px 0 0", color: "var(--muted)", fontSize: 10, lineHeight: 1.5 }}>
                  {executionStatus.reason}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {status && (
        <div aria-label="Backend strategy status" style={{ marginTop: 14, padding: 14, borderRadius: 14, border: "1px solid var(--line)", background: "var(--surface-2, var(--sidebar-bg))" }}>
          <strong style={{ display: "block", color: "var(--ink)", fontSize: 12, marginBottom: 9 }}>Backend strategy status</strong>
          <pre style={{ margin: 0, maxHeight: 260, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "var(--muted)", fontSize: 10, lineHeight: 1.55 }}>
            {JSON.stringify(status, null, 2)}
          </pre>
        </div>
      )}

      <div style={{ marginTop: 16, border: "1px solid var(--line)", borderRadius: 14, padding: 12, background: "var(--surface-2, var(--sidebar-bg))" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--muted)" }}><Icon name="pulse" size={14} /><span style={{ fontSize: 10, letterSpacing: ".14em" }}>◉ LIVE TAPE</span></div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }} aria-label={tickAge === null ? "Waiting for first tick" : `Last tick ${tickAge} seconds ago`}>
            {Array.from({ length: 12 }, (_, index) => <span key={index} style={{ width: 3, height: 8 + ((index * 7 + tape.length * 3) % 10), borderRadius: 5, background: transport === "connected" && tape.length ? healthColor : "var(--line)", opacity: .35 + (index / 20) }} />)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 5, alignItems: "stretch" }}>
          {tape.length ? tape.slice(-12).map((item) => <button key={item.key} type="button" onClick={() => setSelectedDigit(item.digit)} aria-label={`Inspect digit ${item.digit}`} className="tb-digit-in" style={{ ...tile, borderColor: selectedDigit === item.digit ? "var(--teal)" : rankColor(item.digit), boxShadow: selectedDigit === item.digit ? "inset 0 0 0 1px var(--teal)" : item.key === latest?.key ? "0 0 0 2px #22d3ee" : "none", background: rankBackground(item.digit), color: rankColor(item.digit), minHeight: 44 }}>{item.digit}</button>) : Array.from({ length: 12 }, (_, index) => <div key={index} style={{ ...tile, minHeight: 44, opacity: .25 + (index % 4) * .12 }}><span className={transport === "connected" ? "tb-pulse" : ""} style={{ width: 5, height: 5, borderRadius: 9, background: "var(--muted)" }} /></div>)}
        </div>
        <div style={{ height: 2, overflow: "hidden", borderRadius: 5, marginTop: 11, background: "var(--line)" }}>
          <div style={{ width: transport === "connected" ? "35%" : "12%", height: "100%", background: healthColor, animation: transport === "connected" ? "tb-sweep 2.5s linear infinite" : "none" }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(10, minmax(0, 1fr))", gap: 5, marginTop: 12 }}>
        {DIGITS.map((digit) => {
          const count = counts[digit];
          const height = Math.max(3, (count / maxCount) * 35);
          const chosen = selectedDigit === digit;
          const color = rankColor(digit);
          return <button key={digit} type="button" onClick={() => setSelectedDigit(chosen ? null : digit)} aria-label={`Digit ${digit}: ${count} backend-observed ticks`} style={{ border: `1px solid ${chosen ? "var(--teal)" : hasFrequency ? color : "var(--line)"}`, borderRadius: 9, padding: "7px 2px 5px", background: chosen ? "color-mix(in srgb, var(--teal) 8%, transparent)" : rankBackground(digit), color, minWidth: 0, cursor: "pointer" }}>
            <span style={{ display: "block", fontSize: 11, fontWeight: 800 }}>{digit}</span>
            <span style={{ height: 38, display: "flex", alignItems: "end", justifyContent: "center", margin: "4px 0" }}><span style={{ width: "58%", maxWidth: 16, height: hasFrequency ? height : 3, borderRadius: 4, background: hasFrequency ? color : "var(--line)", transition: "height .18s ease" }} /></span>
            <span style={{ display: "block", fontSize: 9 }}>{hasFrequency ? percentage(count) : "—"}</span>
            <span style={{ display: "block", fontSize: 8, color: "var(--muted)" }}>{hasFrequency ? count.toLocaleString() : "—"}</span>
          </button>;
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 9, marginTop: 8, color: "var(--muted)", fontSize: 9 }}>
        <span>{hasFrequency ? `${total.toLocaleString()} / ${windowSize.toLocaleString()} ticks` : "Waiting for backend frequency snapshot"}</span>
        <span style={{ color: "#4ade80" }}>● Highest</span><span style={{ color: "#60a5fa" }}>● 2nd highest</span><span style={{ color: "#f87171" }}>● Lowest</span><span style={{ color: "#fbbf24" }}>● 2nd lowest</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 13 }}>
        <div style={{ display: "flex", gap: 7, alignItems: "center", minWidth: 0 }}>
          <span style={{ width: 8, height: 8, flexShrink: 0, borderRadius: 99, background: state === "blocked" || transport === "disconnected" || transport === "stale" ? "#f4b740" : active ? "#35d6a0" : "var(--muted)" }} />
          <span style={{ color: "var(--muted)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={status?.reason ?? status?.state ?? transport}>{status?.signal_generated ? "Entry signal confirmed" : status?.state?.replaceAll("_", " ") ?? transport}</span>
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
