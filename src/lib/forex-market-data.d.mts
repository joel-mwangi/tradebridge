export type ForexCandleHistoryRequest = {
  ticks_history: string;
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
  count?: number,
): ForexCandleHistoryRequest;

export declare function isForexMarket(
  market?: string,
  marketDisplayName?: string,
): boolean;
