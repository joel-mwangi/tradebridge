"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./Mt5PairingPanel.module.css";

type Device = {
  id: string;
  device_name: string;
  status: string;
  last_seen_at: string | null;
  created_at: string;
};
type ApiError = { detail?: string; error?: string; message?: string };
type PairingCode = { code: string; expires_at: string; one_time: boolean };
type PairedDevice = { device_id: string; device_credential: string; credential_shown_once: boolean };

async function readPayload<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & ApiError;
  if (!response.ok) throw new Error(payload.detail || payload.message || payload.error || `Request failed (${response.status})`);
  return payload;
}

function formatDate(value: string | null) {
  if (!value) return "Never connected";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

export default function Mt5PairingPanel() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pairingCode, setPairingCode] = useState<PairingCode | null>(null);
  const [deviceName, setDeviceName] = useState("My MT5 terminal");
  const [codeInput, setCodeInput] = useState("");
  const [newCredential, setNewCredential] = useState<PairedDevice | null>(null);
  const [copied, setCopied] = useState(false);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/mt5/devices", { cache: "no-store" });
      const data = await readPayload<{ devices?: Device[] }>(response);
      setDevices(Array.isArray(data.devices) ? data.devices : []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load paired MT5 devices.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadDevices(); }, [loadDevices]);

  async function generateCode() {
    setBusy(true); setError(""); setMessage(""); setNewCredential(null); setCopied(false);
    try {
      const response = await fetch("/api/mt5/pairing-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expires_in_seconds: 300 }),
      });
      const data = await readPayload<PairingCode>(response);
      setPairingCode(data);
      setCodeInput(data.code);
      setMessage("Pairing code generated. Use it below to register the MT5 terminal, then copy its device credential into the EA inputs.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not generate a pairing code.");
    } finally { setBusy(false); }
  }

  async function pairDevice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage(""); setNewCredential(null); setCopied(false);
    try {
      const response = await fetch("/api/mt5/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeInput.trim(), device_name: deviceName.trim() }),
      });
      const data = await readPayload<PairedDevice>(response);
      setNewCredential(data);
      setPairingCode(null);
      setCodeInput("");
      setMessage("Device paired. Copy the credential now; it will not be shown again.");
      await loadDevices();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pairing failed. Generate a fresh code and try again.");
    } finally { setBusy(false); }
  }

  async function revokeDevice(device: Device) {
    if (!window.confirm(`Revoke access for "${device.device_name}"? The EA will no longer authenticate.`)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/mt5/devices/${encodeURIComponent(device.id)}`, { method: "DELETE" });
      if (!response.ok) await readPayload<unknown>(response);
      setMessage(`Access revoked for ${device.device_name}.`);
      await loadDevices();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke this device.");
    } finally { setBusy(false); }
  }

  async function copyCredential() {
    if (!newCredential?.device_credential) return;
    try {
      await navigator.clipboard.writeText(newCredential.device_credential);
      setCopied(true);
      setMessage("Device credential copied. Paste it into InpDeviceCredential in MetaEditor.");
    } catch {
      setError("Clipboard access was blocked. Select and copy the credential manually.");
    }
  }

  return (
    <section className={styles.page} aria-labelledby="mt5-title">
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>BROKER CONNECTIVITY</p>
          <h1 id="mt5-title">MT5 Market Bridge</h1>
          <p>Pair your MetaTrader 5 terminal with TradeBridge to select markets remotely. This bridge does not place or manage trades.</p>
        </div>
        <span className={styles.status}><span /> Market selection only</span>
      </div>

      {error && <div className={styles.alertError} role="alert">{error}</div>}
      {message && <div className={styles.alertSuccess} role="status">{message}</div>}

      <div className={styles.grid}>
        <article className={styles.card}>
          <div className={styles.cardHeading}>
            <span className={styles.step}>01</span>
            <div><h2>Generate pairing code</h2><p>Creates a single-use code that expires after five minutes.</p></div>
          </div>
          <button type="button" className={styles.primaryButton} onClick={() => void generateCode()} disabled={busy}>
            {busy ? "Please wait…" : "Generate pairing code"}
          </button>
          {pairingCode && (
            <div className={styles.codeBox}>
              <span>Temporary pairing code</span>
              <code>{pairingCode.code}</code>
              <small>Expires {formatDate(pairingCode.expires_at)} · single use</small>
              <button type="button" className={styles.secondaryButton} onClick={() => { void navigator.clipboard.writeText(pairingCode.code).then(() => setMessage("Pairing code copied.")).catch(() => setError("Clipboard access was blocked.")); }}>Copy code</button>
            </div>
          )}
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeading}>
            <span className={styles.step}>02</span>
            <div><h2>Register this terminal</h2><p>Pair the generated code and receive a device credential for the EA.</p></div>
          </div>
          <form className={styles.form} onSubmit={(event) => void pairDevice(event)}>
            <label>Device name<input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} maxLength={100} required /></label>
            <label>Pairing code<input value={codeInput} onChange={(event) => setCodeInput(event.target.value)} minLength={20} maxLength={128} autoComplete="off" required /></label>
            <button type="submit" className={styles.primaryButton} disabled={busy || !deviceName.trim() || codeInput.trim().length < 20}>
              Pair device
            </button>
          </form>
          {newCredential && (
            <div className={styles.credentialBox}>
              <strong>Device credential — shown once</strong>
              <p>Copy this now and paste it into the EA input <code>InpDeviceCredential</code>. Do not share it or commit it to Git.</p>
              <textarea aria-label="One-time device credential" readOnly value={newCredential.device_credential} rows={4} onFocus={(event) => event.currentTarget.select()} />
              <button type="button" className={styles.primaryButton} onClick={() => void copyCredential()}>{copied ? "Copied" : "Copy device credential"}</button>
              <small>Device ID: {newCredential.device_id}</small>
            </div>
          )}
        </article>
      </div>

      <article className={styles.card}>
        <div className={styles.devicesHeading}>
          <div><h2>Paired devices</h2><p>Credentials are never retrieved from the server after pairing.</p></div>
          <button type="button" className={styles.secondaryButton} onClick={() => void loadDevices()} disabled={loading || busy}>Refresh</button>
        </div>
        {loading ? <p className={styles.muted}>Loading devices…</p> : devices.length === 0 ? (
          <div className={styles.empty}><strong>No paired devices yet</strong><p>Generate a pairing code and register your MT5 terminal to get started.</p></div>
        ) : (
          <div className={styles.deviceList}>
            {devices.map((device) => (
              <div className={styles.device} key={device.id}>
                <div className={styles.deviceInfo}>
                  <strong>{device.device_name}</strong>
                  <span className={device.status === "paired" ? styles.paired : styles.revoked}>{device.status}</span>
                  <small>Last seen: {formatDate(device.last_seen_at)}</small>
                  <small>Added: {formatDate(device.created_at)}</small>
                </div>
                {device.status === "paired" && <button type="button" className={styles.dangerButton} disabled={busy} onClick={() => void revokeDevice(device)}>Revoke access</button>}
              </div>
            ))}
          </div>
        )}
      </article>

      <article className={styles.instructions}>
        <h2>Finish setup in MetaTrader 5</h2>
        <ol>
          <li>Copy the one-time device credential above.</li>
          <li>Open <code>TradeBridgeMarketBridge.mq5</code> in MetaEditor and set <code>InpDeviceCredential</code> to that value.</li>
          <li>Set the provider-to-broker mapping to match your broker's exact symbol, for example <code>frxEURUSD=EURUSD</code>.</li>
          <li>Compile the EA, allow WebRequest to <code>https://ai-tradingbridge.vercel.app</code>, and attach it to an MT5 chart.</li>
        </ol>
        <p>Revoking a device disables its future API access. This EA has no order-placement functions.</p>
      </article>
    </section>
  );
}
