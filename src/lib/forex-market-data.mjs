/**
 * Build a one-shot OHLC history request.
 *
 * Omit "subscribe" entirely: some Deriv API endpoints only accept subscribe=1,
 * so explicitly sending subscribe=0 can fail validation even for a one-shot
 * history request. With subscribe omitted, the request returns history once.
 */
export function buildForexCandleHistoryRequest(
  symbol,
  seconds,
  requestId,
  endEpoch,
  count = 180,
) {
  if (typeof symbol !== "string" || !symbol.trim()) {
    throw new TypeError("A market symbol is required.");
  }
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new TypeError("Candle granularity must be a positive integer.");
  }
  if (!Number.isSafeInteger(requestId) || requestId <= 0) {
    throw new TypeError("Request ID must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(endEpoch) || endEpoch <= 0) {
    throw new TypeError("History end epoch must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(count) || count < 1 || count > 5000) {
    throw new TypeError("Candle count must be between 1 and 5000.");
  }

  return {
    ticks_history: symbol,
    start: endEpoch - seconds * count,
    end: "latest",
    count,
    style: "candles",
    granularity: seconds,
    req_id: requestId,
  };
}
