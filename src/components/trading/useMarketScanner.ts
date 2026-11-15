"use client";

import { useEffect, useRef, useState } from "react";
import type { ScannerResult } from "./types";

const SCANNER_SYMBOLS = [
  "1HZ100V", "1HZ75V", "1HZ50V", "1HZ25V", "1HZ10V",
  "R_100", "R_75", "R_50", "R_25", "R_10",
];

const STORAGE_SCANNER_ENABLED = "tradebridge_scanner_enabled";
const STORAGE_AUTO_EXECUTE_ENABLED = "tradebridge_auto_execute_enabled";

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
  socket: WebSocket | null;
  sessionConnected: boolean;
  isDemoAccount: boolean;
  onMessage?: (event: MessageEvent) => void;
}): {
  scannerResults: ScannerResult[];
  autoScanEnabled: boolean;
  setAutoScanEnabled: (enabled: boolean) => void;
  autoExecuteEnabled: boolean;
  setAutoExecuteEnabled: (enabled: boolean) => void;
  symbolsToSubscribe: string[];
} {
  const { socket } = options;

  const [scannerResults, setScannerResults] = useState<ScannerResult[]>([]);
  const [autoScanEnabled, setAutoScanEnabledState] = useState<boolean>(() =>
    readBool(STORAGE_SCANNER_ENABLED, false),
  );
  const [autoExecuteEnabled, setAutoExecuteEnabledState] = useState<boolean>(() =>
    readBool(STORAGE_AUTO_EXECUTE_ENABLED, false),
  );

  const setAutoScanEnabled = (enabled: boolean) => {
    writeBool(STORAGE_SCANNER_ENABLED, enabled);
    setAutoScanEnabledState(enabled);
    if (!enabled) setScannerResults([]);
  };

  const setAutoExecuteEnabled = (enabled: boolean) => {
    writeBool(STORAGE_AUTO_EXECUTE_ENABLED, enabled);
    setAutoExecuteEnabledState(enabled);
  };

  // Track which symbols were subscribed by the scanner so we can reason about
  // what to subscribe when autoScanEnabled becomes true.
  const subscribedRef = useRef(new Set<string>());

  // Listen for scanner_update messages on the shared market socket.
  useEffect(() => {
    if (!socket) return;

    const handleMessage = (event: MessageEvent) => {
      // Forward to parent caller if provided.
      options.onMessage?.(event);

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
  }, [socket, autoScanEnabled, options]);

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
