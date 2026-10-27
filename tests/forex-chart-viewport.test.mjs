import test from "node:test";
import assert from "node:assert/strict";
import { panChartViewport, zoomChartViewport } from "../src/lib/forex-chart-viewport.mjs";

test("wheel zooms in around the cursor instead of anchoring at the newest candle", () => {
  const next = zoomChartViewport({
    candlesLength: 180, viewCount: 100, viewOffset: 0, cursorRatio: 0.25, deltaY: -100,
  });
  assert.equal(next.viewCount, 90);
  assert.ok(next.viewOffset > 0);
  const oldAnchor = 180 - 100 + Math.round(99 * 0.25);
  const newAnchor = 180 - next.viewOffset - next.viewCount + Math.round((next.viewCount - 1) * 0.25);
  assert.ok(Math.abs(oldAnchor - newAnchor) <= 1);
});

test("wheel zooming out increases the visible candle count within loaded history", () => {
  const next = zoomChartViewport({
    candlesLength: 180, viewCount: 100, viewOffset: 20, cursorRatio: 0.5, deltaY: 100,
  });
  assert.equal(next.viewCount, 110);
  assert.ok(next.viewOffset >= 0);
  assert.ok(next.viewOffset <= 70);
});

test("zoom cannot exceed loaded history or fall below its lower bound", () => {
  const zoomIn = zoomChartViewport({
    candlesLength: 30, viewCount: 20, viewOffset: 0, cursorRatio: 0.5, deltaY: -1,
  });
  assert.equal(zoomIn.viewCount, 20);
  const zoomOut = zoomChartViewport({
    candlesLength: 30, viewCount: 30, viewOffset: 0, cursorRatio: 0.5, deltaY: 100,
  });
  assert.equal(zoomOut.viewCount, 30);
  assert.equal(zoomOut.viewOffset, 0);
});

test("drag panning clamps to oldest and newest loaded candles", () => {
  assert.deepEqual(
    panChartViewport({ candlesLength: 180, viewCount: 100, viewOffset: 0, deltaBars: 25 }),
    { viewCount: 100, viewOffset: 25 },
  );
  assert.equal(
    panChartViewport({ candlesLength: 180, viewCount: 100, viewOffset: 80, deltaBars: 50 }).viewOffset,
    80,
  );
  assert.equal(
    panChartViewport({ candlesLength: 180, viewCount: 100, viewOffset: 10, deltaBars: -50 }).viewOffset,
    0,
  );
});
