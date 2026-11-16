"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ScannerResult } from "./types";

const SCANNER_SYMBOLS = [
  "1HZ100V", "1HZ75V", "1HZ50V", "1HZ25V", "1HZ10V",
  "R_100", "R_75", "R_50", "R_25", "R_10",
];

const STORAGE_SCANNER_ENABLED = "tradebridge_scanner_enabled";

function readBool(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    // localStorage unavailable — use fallback
  }
  return fallback;
}

function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // ignore
  }
}

type ScannerMessage = {
  type?: string;
  results?: ScannerResult[];
};

export function useMarketScanner(options: {
  socketRef: RefObject<WebSocket | null>;
  sessionConnected: boolean;
  isDemoAccount: boolean;
  retryCount?: number;
  onMessage?: (event: MessageEvent) => void;
}): {
  scannerResults: ScannerResult[];
  autoScanEnabled: boolean;
  setAutoScanEnabled: (enabled: boolean) => void;
  autoExecuteEnabled: boolean;
  setAutoExecuteEnabled: (enabled: boolean) => void;
  symbolsToSubscribe: string[];
} {
  const { socketRef, onMessage, retryCount = 0 } = options;

  const [scannerResults, setScannerResults] = useState<ScannerResult[]>([]);
  const [autoScanEnabled, setAutoScanEnabledState] = useState<boolean>(() =>
    readBool(STORAGE_SCANNER_ENABLED, false),
  );
  // Auto-execute is always opt-in per session — do not persist across sessions
  // so it cannot silently re-arm on a different account.
  const [autoExecuteEnabled, setAutoExecuteEnabledState] = useState<boolean>(false);

  const setAutoScanEnabled = (enabled: boolean) => {
    writeBool(STORAGE_SCANNER_ENABLED, enabled);
    setAutoScanEnabledState(enabled);
    if (!enabled) setScannerResults([]);
  };

  const setAutoExecuteEnabled = (enabled: boolean) => {
    setAutoExecuteEnabledState(enabled);
  };

  // Stable ref for onMessage callback so it doesn't appear as an effect dep.
  const onMessageRef = useRef(onMessage);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);

  // Listen for scanner_update messages on the shared market socket.
  // Depend on socketRef (stable) and autoScanEnabled. Reading socketRef.current
  // inside the effect captures the live WebSocket after mount.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const handleMessage = (event: MessageEvent) => {
      // Forward to parent caller if provided.
      onMessageRef.current?.(event);

      if (!autoScanEnabled) return;
      try {
        const message = JSON.parse(String(event.data)) as ScannerMessage;
        if (message.type === "scanner_update" && Array.isArray(message.results)) {
          // Keep top 3 results only.
          setScannerResults(message.results.slice(0, 3));
        }
      } catch {
        // Ignore malformed frames.
      }
    };

    socket.addEventListener("message", handleMessage);
    return () => {
      socket.removeEventListener("message", handleMessage);
    };
  // retryCount is included so the listener is re-registered after every
  // reconnect — the socket effect increments it on close, creating a new
  // WebSocket; socketRef.current is re-read at effect-run time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScanEnabled, retryCount]);

  // Determine which symbols the caller needs to subscribe to on the market socket.
  // The caller (DigitStrategyPanel) is responsible for the actual send.
  const symbolsToSubscribe = autoScanEnabled ? SCANNER_SYMBOLS : [];

  return {
    scannerResults,
    autoScanEnabled,
    setAutoScanEnabled,
    autoExecuteEnabled,
    setAutoExecuteEnabled,
    symbolsToSubscribe,
  };
}
