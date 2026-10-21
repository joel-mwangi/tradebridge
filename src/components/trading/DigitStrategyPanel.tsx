"use client";

import { useEffect, useRef, useState } from "react";

const MARKET_SOCKET = process.env.NEXT_PUBLIC_TRADEBRIDGE_BACKEND_MARKET_WS_URL?.trim() ?? "";

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
  window_seconds?: number;
  qualification?: {
    decision?: string;
    reason?: string;
    under_qualifies?: boolean;
    over_qualifies?: boolean;
    under_threshold_passes?: boolean;
    under_stability_passes?: boolean;
    over_threshold_passes?: boolean;
    over_stability_passes?: boolean;
  } | null;
  execution_enabled?: boolean;
};

const STATE_LABELS: Record<string, string> = {
  idle: "Idle",
  observing: "Observing initial 10-second window",
  selected: "Group selected · waiting for pattern",
  waiting_for_more_data: "Waiting for more percentage data",
  blocked: "Blocked · feed or data integrity failure",
  stopped: "Stopped",
};

export default function DigitStrategyPanel({ symbol }: { symbol: string }) {
  const socketRef = useRef<WebSocket | null>(null);
  const [transport, setTransport] = useState("Connecting strategy feed…");
  const [status, setStatus] = useState<StrategyStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!MARKET_SOCKET) {
      setTransport("Strategy feed URL is not configured");
      return;
    }

    let alive = true;
    let socket: WebSocket;
    try {
      socket = new WebSocket(MARKET_SOCKET);
      socketRef.current = socket;
    } catch {
      setTransport("Could not open strategy feed");
      return;
    }

    socket.onopen = () => {
      if (!alive) return;
      setTransport("Connected · strategy stopped");
      socket.send(JSON.stringify({ strategy: { action: "status" } }));
    };
    socket.onmessage = (event) => {
      if (!alive) return;
      try {
        const message = JSON.parse(String(event.data)) as StrategyStatus;
        if (message.type === "strategy_status") {
          setStatus(message);
          setBusy(false);
          setTransport("Strategy WebSocket connected");
        } else if (message.error?.message) {
          setBusy(false);
          setTransport(message.error.message);
        }
      } catch {
        // The same WebSocket also forwards ordinary market messages.
      }
    };
    socket.onerror = () => {
      if (alive) {
        setBusy(false);
        setTransport("Strategy feed connection failed");
      }
    };
    socket.onclose = () => {
      if (alive) {
        setBusy(false);
        setTransport("Strategy feed disconnected");
      }
    };

    return () => {
      alive = false;
      if (socketRef.current === socket) socketRef.current = null;
      socket.close();
    };
  }, []);

  function send(action: "start" | "stop" | "status") {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setTransport("Strategy feed is not connected; reconnect the page and retry");
      return;
    }
    if (action === "start" && !symbol) {
      setTransport("Select a market before starting the strategy");
      return;
    }
    setBusy(true);
    socket.send(JSON.stringify({
      strategy: action === "start" ? { action, symbol } : { action },
    }));
    if (action === "start") setTransport("Start requested · waiting for backend status");
    if (action === "stop") setTransport("Stop requested · waiting for backend status");
  }

  const state = status?.state ?? "idle";
  const isActive = Boolean(status && ["observing", "waiting_for_more_data", "selected"].includes(state));
  const canStart = Boolean(symbol) && !busy && !isActive && state !== "blocked";

  return (
    <section aria-label="Digit strategy session" style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 16, background: "var(--surface)", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: "0 0 4px", color: "var(--muted)", fontSize: 10, fontWeight: 800, letterSpacing: ".12em" }}>OBSERVATION ONLY</p>
          <h2 style={{ margin: 0, color: "var(--ink)", fontSize: 16, fontWeight: 850 }}>Digit strategy</h2>
          <p style={{ margin: "5px 0 0", color: "var(--muted)", fontSize: 11 }}>Market: {symbol || "Select a market"} · Source: TradeBridge observed-tick frequencies (1000-tick window)</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => send("start")} disabled={!canStart} style={{ minHeight: 36, padding: "0 13px", border: 0, borderRadius: 8, background: canStart ? "var(--teal)" : "var(--line)", color: canStart ? "#fff" : "var(--muted)", fontWeight: 800, cursor: canStart ? "pointer" : "not-allowed" }}>Start</button>
          <button type="button" onClick={() => send("stop")} disabled={busy || !isActive} style={{ minHeight: 36, padding: "0 13px", border: "1px solid var(--line)", borderRadius: 8, background: "transparent", color: "var(--ink)", fontWeight: 750, cursor: busy || !isActive ? "not-allowed" : "pointer" }}>Stop</button>
          <button type="button" onClick={() => send("status")} disabled={busy} style={{ minHeight: 36, padding: "0 10px", border: "1px solid var(--line)", borderRadius: 8, background: "transparent", color: "var(--ink)", fontWeight: 700 }}>Refresh</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 9, marginTop: 14 }}>
        <Metric label="Session state" value={STATE_LABELS[state] ?? state} />
        <Metric label="Feed health" value={status?.feed_state ?? "Waiting for backend"} />
        <Metric label="Selected group" value={status?.selected_group?.toUpperCase() ?? "—"} />
        <Metric label="Trigger digit" value={status?.trigger_digit ?? "—"} />
        <Metric label="Real observations" value={status?.observation_count ?? 0} />
        <Metric label="Execution" value={status?.execution_enabled === false ? "Disabled" : "Not confirmed"} />
      </div>
      <p role="status" style={{ margin: "12px 0 0", color: "var(--muted)", fontSize: 11, lineHeight: 1.5 }}>{status?.reason ?? transport}</p>
      {status?.qualification && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginTop: 10 }}>
          <Qualification label="Under (0–4)" qualifies={status.qualification.under_qualifies} threshold={status.qualification.under_threshold_passes} stability={status.qualification.under_stability_passes} />
          <Qualification label="Over (5–9)" qualifies={status.qualification.over_qualifies} threshold={status.qualification.over_threshold_passes} stability={status.qualification.over_stability_passes} />
        </div>
      )}
      <p style={{ margin: "10px 0 0", color: "var(--muted)", fontSize: 10, lineHeight: 1.5 }}>Percentages are calculated from observed market ticks. They are not official Deriv Digit Analytics percentages or predictions. This panel never places trades.</p>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div style={{ minWidth: 0, padding: 10, borderRadius: 9, background: "var(--surface-2, var(--sidebar-bg))", border: "1px solid var(--line)" }}>
    <div style={{ color: "var(--muted)", fontSize: 10, marginBottom: 5 }}>{label}</div>
    <strong style={{ display: "block", color: "var(--ink)", fontSize: 12, overflowWrap: "anywhere" }}>{value}</strong>
  </div>;
}

function Qualification({ label, qualifies, threshold, stability }: { label: string; qualifies?: boolean; threshold?: boolean; stability?: boolean }) {
  const yesNo = (value?: boolean) => value === undefined ? "Not evaluated" : value ? "Pass" : "Fail";
  return <div style={{ padding: 10, border: "1px solid var(--line)", borderRadius: 9, color: "var(--ink)", fontSize: 11 }}>
    <strong>{label}: {qualifies === undefined ? "Pending" : qualifies ? "Qualifies" : "Does not qualify"}</strong>
    <div style={{ display: "flex", gap: 12, marginTop: 6, color: "var(--muted)" }}>
      <span>Threshold: {yesNo(threshold)}</span><span>Stability: {yesNo(stability)}</span>
    </div>
  </div>;
}
