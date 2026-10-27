export const MIN_CHART_VIEW = 20;
export const MAX_CHART_VIEW = 180;
export const DEFAULT_CHART_VIEW = 100;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function zoomChartViewport({ candlesLength, viewCount, viewOffset, cursorRatio, deltaY }) {
  const available = Math.max(1, Math.floor(candlesLength));
  const currentCount = clamp(Math.floor(viewCount), 1, Math.min(MAX_CHART_VIEW, available));
  const currentOffset = clamp(Math.floor(viewOffset), 0, Math.max(0, available - currentCount));
  const currentEnd = available - currentOffset;
  const currentStart = Math.max(0, currentEnd - currentCount);
  const actualCount = currentEnd - currentStart;
  const ratio = clamp(Number(cursorRatio) || 0, 0, 1);
  const anchorIndex = currentStart + Math.round((actualCount - 1) * ratio);
  const step = Number(deltaY) > 0 ? 10 : -10;
  const minCount = Math.min(MIN_CHART_VIEW, available);
  const nextCount = clamp(currentCount + step, minCount, Math.min(MAX_CHART_VIEW, available));
  const proposedStart = anchorIndex - Math.round((nextCount - 1) * ratio);
  const nextStart = clamp(proposedStart, 0, Math.max(0, available - nextCount));
  return {
    viewCount: nextCount,
    viewOffset: available - (nextStart + nextCount),
  };
}

export function panChartViewport({ candlesLength, viewCount, viewOffset, deltaBars }) {
  const available = Math.max(0, Math.floor(candlesLength));
  const count = clamp(Math.floor(viewCount), 1, Math.max(1, available));
  const offset = clamp(Math.floor(viewOffset), 0, Math.max(0, available - count));
  return {
    viewCount: count,
    viewOffset: clamp(offset + Math.round(Number(deltaBars) || 0), 0, Math.max(0, available - count)),
  };
}
