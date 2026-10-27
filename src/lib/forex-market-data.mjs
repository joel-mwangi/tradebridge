/**
 * Build a one-shot OHLC history request compatible with the legacy market
 * WebSocket validator. Use count + end to request the latest bars; do not
 * combine count with start or include subscribe=0 on this endpoint.
 */
export function buildForexCandleHistoryRequest(
  symbol,
  seconds,
  requestId,
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
  if (!Number.isSafeInteger(count) || count < 1 || count > 5000) {
    throw new TypeError("Candle count must be between 1 and 5000.");
  }

  return {
    ticks_history: symbol,
    end: "latest",
    count,
    style: "candles",
    granularity: seconds,
    req_id: requestId,
  };
}

/**
 * Match Forex using the provider's market metadata, not symbol prefixes.
 * Some Deriv non-FX instruments also use symbols beginning with "frx".
 */
export function isForexMarket(market, marketDisplayName) {
  const normalizedMarket = typeof market === "string" ? market.trim().toLowerCase() : "";
  const normalizedDisplay = typeof marketDisplayName === "string"
    ? marketDisplayName.trim().toLowerCase()
    : "";
  return normalizedMarket === "forex" || normalizedDisplay === "forex";
}


/**
 * Normalize an optional provider Bid/Ask without coercing null, empty strings,
 * booleans, zero, or negative prices into valid numbers.
 */
export function normalizeOptionalQuotePrice(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : undefined;
}

/** Return the spread in price units only when both prices are valid and ordered. */
export function calculateQuoteSpread(bid, ask) {
  if (
    typeof bid !== "number" || !Number.isFinite(bid) || bid <= 0 ||
    typeof ask !== "number" || !Number.isFinite(ask) || ask <= 0 ||
    ask < bid
  ) return undefined;
  return ask - bid;
}

