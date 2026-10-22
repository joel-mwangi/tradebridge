export type ForexCandleHistoryRequest = {
  ticks_history: string;
  start: number;
  end: "latest";
  count: number;
  style: "candles";
  granularity: number;
  req_id: number;
};

export declare function buildForexCandleHistoryRequest(
  symbol: string,
  seconds: number,
  requestId: number,
  endEpoch: number,
  count?: number,
): ForexCandleHistoryRequest;
