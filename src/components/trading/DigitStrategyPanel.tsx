"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createDemoExecutionSession } from "./strategy-auto-execution.mjs";

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
  signal_generated?: boolean;
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

export default function DigitStrategyPanel({ symbol, windowSize, barrier, direction, frequency, isDemoAccount = false, executeDemoStrategyTrade }: { symbol: string; windowSize: number; barrier: number; direction: "OVER" | "UNDER"; frequency?: import("./types").BackendDigitFrequency; isDemoAccount?: boolean; executeDemoStrategyTrade?: (input: { symbol: string; contractType: "DIGITOVER" | "DIGITUNDER"; stake: number; duration: number; durationUnit: "t"; barrier: string }) => Promise<{ status: "settled"; contractId: string; outcome: "won" | "lost" | "breakeven"; profit: number }> }) {
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
  const [strategyStake, setStrategyStake] = useState("1");
  const [autoArmed, setAutoArmed] = useState(false);
  const [autoState, setAutoState] = useState<{ state: string; submitted: number; consecutiveLosses: number; remaining: number } | null>(null);
  const autoSessionRef = useRef<ReturnType<typeof createDemoExecutionSession> | null>(null);
  const signalConsumedRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const previousTransportRef = useRef<typeof transport | null>(null);
  const previousStrategyStateRef = useRef<string | null>(null);
  const previousUnderQualifiedRef = useRef<boolean | undefined>(undefined);
  const previousOverQualifiedRef = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    try {
      setSoundEnabled(localStorage.getItem("tradebridge_strategy_sounds") === "on");
      const savedVolume = Number(localStorage.getItem("tradebridge_strategy_sound_volume"));
      if (Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1) setSoundVolume(savedVolume);
    } catch {
      // Audio preferences remain session-only when storage is unavailable.
    }
  }, []);

  const playCue = useCallback((kind: "start" | "connected" | "disconnected" | "qualify" | "clear" | "stop" | "error" | "test") => {
    if (!soundEnabled && kind !== "test") return;
    try {
      const AudioContextClass = window.AudioContext;
      if (!AudioContextClass) return;
      const context = audioContextRef.current ?? new AudioContextClass();
      audioContextRef.current = context;
      if (context.state === "suspended") void context.resume();
      const patterns: Record<typeof kind, number[]> = {
        start: [660], connected: [660, 880], disconnected: [330], qualify: [784, 988],
        clear: [523, 392], stop: [523, 392], error: [330, 330], test: [660, 880],
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
    if (!autoArmed || !autoSessionRef.current || !executeDemoStrategyTrade || !isDemoAccount) return;
    if (status?.symbol !== symbol || status?.barrier !== barrier || status?.signal_generated !== true) return;
    if (status.selected_group !== "under" && status.selected_group !== "over") return;
    if (signalConsumedRef.current) return;
    const direction = status.selected_group === "under" ? "UNDER" : "OVER";
    if ((direction === "UNDER" && barrier < 1) || (direction === "OVER" && barrier > 8)) return;
    signalConsumedRef.current = true;
    const session = autoSessionRef.current;
    const stake = Number(strategyStake);
    if (!Number.isFinite(stake) || stake < 1 || stake > 1000) { setAutoState({ state: "blocked_invalid_stake", submitted: 0, consecutiveLosses: 0, remaining: 3 }); setAutoArmed(false); return; }
    const input = { symbol, contractType: direction === "UNDER" ? "DIGITUNDER" as const : "DIGITOVER" as const, stake, duration: 1, durationUnit: "t" as const, barrier: String(barrier) };
    void session.runQualifiedSignal({ qualified: true, symbol, direction, barrier, signalId: symbol + ":" + barrier + ":" + direction + ":" + Date.now() }, input).then((snapshot) => {
      setAutoState(snapshot);
      setAutoArmed(false);
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ strategy: { action: "stop" } }));
    }).catch(() => {
      setAutoState(session.snapshot());
      setAutoArmed(false);
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ strategy: { action: "stop" } }));
    });
  }, [autoArmed, status?.signal_generated, status?.selected_group, status?.symbol, status?.barrier, symbol, barrier, strategyStake, isDemoAccount, executeDemoStrategyTrade]);

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

    const under = status?.qualification?.under_qualifies;
    const over = status?.qualification?.over_qualifies;
    const priorUnder = previousUnderQualifiedRef.current;
    const priorOver = previousOverQualifiedRef.current;
    if ((under === true && priorUnder !== true) || (over === true && priorOver !== true)) playCue("qualify");
    else if ((priorUnder === true && under === false) || (priorOver === true && over === false)) playCue("clear");
    previousUnderQualifiedRef.current = under;
    previousOverQualifiedRef.current = over;
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
    const active = Boolean(status && ["observing", "waiting_for_more_data", "selected"].includes(status.state ?? ""));
    if (!active || !symbol || !Number.isInteger(windowSize)) return;
    if (status?.symbol === symbol && status?.digit_window_size === windowSize && status?.barrier === barrier) return;
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    setBusy(true);
    socket.send(JSON.stringify({ strategy: { action: "start", symbol, window_size: windowSize, barrier, direction: direction.toLowerCase() } }));
  }, [symbol, windowSize, barrier, direction, status?.state, status?.symbol, status?.digit_window_size, status?.barrier]);

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
      signalConsumedRef.current = false;
      setAutoState(null);
      if (isDemoAccount && executeDemoStrategyTrade) {
        try {
          autoSessionRef.current = createDemoExecutionSession({ sessionId: symbol + "-" + Date.now(), isDemoAccount, executeAndReconcile: executeDemoStrategyTrade });
          setAutoState(autoSessionRef.current.snapshot());
          setAutoArmed(true);
        } catch {
          setAutoArmed(false);
          setAutoState({ state: "blocked_demo_only", submitted: 0, consecutiveLosses: 0, remaining: 3 });
        }
      } else {
        setAutoArmed(false);
      }
    } else if (action === "stop") {
      autoSessionRef.current?.stop();
      setAutoArmed(false);
      setAutoState(autoSessionRef.current?.snapshot() ?? null);
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
  const maxCount = Math.max(1, ...counts);
  const ranked = [...DIGITS].sort((a, b) => counts[b] - counts[a] || a - b);
  const rank = (digit: number) => hasFrequency ? ranked.indexOf(digit) + 1 : 0;
  const rankColor = (digit: number) => !hasFrequency ? "var(--muted)" : rank(digit) === 1 ? "#4ade80" : rank(digit) === 2 ? "#60a5fa" : rank(digit) === 10 ? "#f87171" : rank(digit) === 9 ? "#fbbf24" : "var(--ink)";
  const rankBackground = (digit: number) => !hasFrequency ? "var(--surface)" : rank(digit) === 1 ? "#142d25" : rank(digit) === 2 ? "#17283d" : rank(digit) === 10 ? "#351e23" : rank(digit) === 9 ? "#332b19" : "var(--surface)";
  // Barrier-relative display classes are mutually exclusive: lower, exact barrier, upper.
  // Keep these separate from the strategy qualification groups (Under 0–4 / Over 5–9).
  const lowerDigits = DIGITS.filter((digit) => digit < barrier);
  const upperDigits = DIGITS.filter((digit) => digit > barrier);
  const lowerCount = lowerDigits.reduce((sum, digit) => sum + counts[digit], 0);
  const upperCount = upperDigits.reduce((sum, digit) => sum + counts[digit], 0);
  const barrierCount = counts[barrier] ?? 0;
  const percentage = (count: number) => total > 0 ? `${(count / total * 100).toFixed(1)}%` : "—";
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
              <span>Barrier {barrier}</span>
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 9, marginTop: 10 }}>
        {[
          { label: "LOWER CLASS", digits: lowerDigits, count: lowerCount, color: "#60a5fa", operator: "<", key: "lower" },
          { label: "BARRIER CLASS", digits: [barrier], count: barrierCount, color: "#22d3ee", operator: "=", key: "barrier" },
          { label: "UPPER CLASS", digits: upperDigits, count: upperCount, color: "#4ade80", operator: ">", key: "upper" },
        ].map((group) => <div key={group.key} style={{ border: `1px solid ${group.color}55`, borderRadius: 12, padding: 10, background: `color-mix(in srgb, ${group.color} 5%, transparent)`, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}>
            <strong style={{ color: group.color, fontSize: 9, letterSpacing: ".08em" }}>{group.label}</strong>
            <strong style={{ color: "var(--ink)", fontSize: 12 }}>{percentage(group.count)}</strong>
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 9, flexWrap: "wrap" }}>
            {group.digits.map((digit) => <span key={digit} title={`Digit ${digit}: ${counts[digit]} ticks`} style={{ flex: "1 1 18px", minWidth: 0, textAlign: "center", border: `1px solid ${rankColor(digit)}55`, borderRadius: 6, padding: "6px 0", color: rankColor(digit), background: rankBackground(digit), fontWeight: 800, fontSize: 12 }}>{digit}</span>)}
          </div>
          <div style={{ color: "var(--muted)", fontSize: 9, marginTop: 7 }}>{group.operator} {barrier} · {hasFrequency ? `${group.count.toLocaleString()} ticks` : "Awaiting frequency data"}</div>
        </div>)}
      </div>
      <div style={{ marginTop: 8, fontSize: 9, color: "var(--muted)" }}>
        Barrier-relative classes: lower digits lose on Under/ win on Over only according to the selected contract rules; the exact barrier digit loses on both Over and Under. Frequency colors show rank, not contract outcome.
      </div>

      <div style={{ marginTop: 14, padding: 12, border: "1px solid var(--line)", borderRadius: 12, background: "var(--surface-2, var(--sidebar-bg))", display: "grid", gap: 9 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div><div style={{ color: "var(--ink)", fontSize: 12, fontWeight: 850 }}>Demo auto-execution</div><div style={{ color: "var(--muted)", fontSize: 10, marginTop: 3 }}>1-tick Over/Under · max 3 settled buys · stop at 2 consecutive losses</div></div>
          <label style={{ color: "var(--muted)", fontSize: 10, display: "flex", alignItems: "center", gap: 6 }}>Stake
            <input aria-label="Demo strategy stake" type="number" min="1" max="1000" step="1" value={strategyStake} disabled={autoArmed || autoState?.state === "executing"} onChange={(event) => setStrategyStake(event.target.value)} style={{ width: 76, padding: "7px 8px", border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface)", color: "var(--ink)" }} />
          </label>
        </div>
        <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 11px", color: autoArmed ? "#35d6a0" : "var(--muted)", fontSize: 10, fontWeight: 850 }}>{autoArmed ? "Run active · execution armed" : "Execution disarmed"}</span>
          <button type="button" disabled={!autoArmed && autoState?.state !== "executing"} onClick={() => { autoSessionRef.current?.stop(); setAutoArmed(false); setAutoState(autoSessionRef.current?.snapshot() ?? null); }} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 11px", background: "transparent", color: "var(--ink)", fontSize: 10, fontWeight: 800, cursor: "pointer" }}>Stop new buys</button>
          <span style={{ color: "var(--muted)", fontSize: 10 }}>{!isDemoAccount ? "Select a Demo account to enable" : autoArmed ? "Armed · waiting for a qualified signal" : autoState ? autoState.state + " · " + autoState.submitted + "/3 settled · " + autoState.consecutiveLosses + " consecutive losses" : "Disarmed · no orders will be placed"}</span>
        </div>
        {autoState?.state === "reconciliation_required" && <div role="alert" style={{ color: "#f4b740", fontSize: 10 }}>Order outcome is unresolved. Automatic execution is paused. Reconcile the contract and statement directly in Deriv before any retry.</div>}
        <div style={{ color: "var(--muted)", fontSize: 9 }}>Real-account execution is disabled. Clicking Run arms demo execution; no buy occurs until the backend reports a completed entry signal after all filters and the tick sequence pass. Each buy waits for authoritative Deriv settlement. The session stops after the sequence and requires a fresh Run.</div>
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
