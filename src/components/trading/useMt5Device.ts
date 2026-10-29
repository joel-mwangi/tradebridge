"use client";

import { useEffect, useRef, useState } from "react";

export type Mt5Device = {
  id: string;
  device_name: string;
  status: "paired" | "revoked";
  last_seen_at: string | null;
  created_at: string;
};

type State = {
  /** The first active paired device, or null if none exist. */
  device: Mt5Device | null;
  loading: boolean;
  error: string | null;
};

/**
 * Fetches the user's paired MT5 devices and returns the first active one.
 * Re-fetches when `refreshToken` changes (pass a counter you increment on demand).
 *
 * Keeps the fetch logic identical to Mt5PairingPanel so the two stay in sync.
 */
export function useMt5Device(refreshToken = 0): State {
  const [state, setState] = useState<State>({
    device: null,
    loading: true,
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    fetch("/api/mt5/devices", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const payload = await res.json().catch(() => ({})) as {
          devices?: Mt5Device[];
          detail?: string;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(
            payload.detail ?? payload.error ?? `HTTP ${res.status}`,
          );
        }
        const devices = Array.isArray(payload.devices) ? payload.devices : [];
        const first = devices.find((d) => d.status === "paired") ?? null;
        setState({ device: first, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setState({
          device: null,
          loading: false,
          error:
            err instanceof Error ? err.message : "Could not load MT5 devices.",
        });
      });

    return () => controller.abort();
  }, [refreshToken]);

  return state;
}
