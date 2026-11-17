"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { MaziwaMarketResult } from "./types";

export function useMaziwaScanner(
  socketRef: RefObject<WebSocket | null>,
  retryCount: number,
) {
  const [results, setResults] = useState<MaziwaMarketResult[]>([]);
  const [scanning, setScanning] = useState(false);
  const scanRequestedRef = useRef(false);

  const scanMarkets = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    scanRequestedRef.current = true;
    setScanning(true);
    socket.send(JSON.stringify({
      maziwa_scan: {
        action: "start",
        symbols: ["1HZ100V", "1HZ75V", "1HZ50V", "1HZ25V", "1HZ10V", "R_100", "R_75", "R_50", "R_25", "R_10"],
      },
    }));
    return true;
  }, [socketRef]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const onMessage = (event: MessageEvent) => {
      try {
        const message = JSON.parse(String(event.data)) as {
          type?: string;
          results?: MaziwaMarketResult[];
        };
        if (message.type === "maziwa_market_recommendations" && Array.isArray(message.results)) {
          setResults(message.results);
          setScanning(false);
        }
      } catch {
        // Ignore unrelated market frames.
      }
    };
    socket.addEventListener("message", onMessage);
    if (scanRequestedRef.current) scanMarkets();
    return () => socket.removeEventListener("message", onMessage);
  }, [retryCount, scanMarkets, socketRef]);

  return { results, scanning, scanMarkets };
}
