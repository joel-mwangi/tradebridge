const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const lab = read("src/components/trading/EvenOddLab.tsx");
const panels = read("src/components/trading/EvenOddResearchPanels.tsx");
const css = read("src/components/trading/EvenOddLab.module.css");

test("Even/Odd Lab exposes the agreed independent research workspaces", () => {
  for (const label of ["Overview", "ML Predictions", "Entry Intelligence", "Backtesting", "Performance", "Sessions & risk"]) {
    assert.ok(lab.includes(label), `missing workspace: ${label}`);
  }
  assert.match(lab, /EvenOddResearchPanels/);
});

test("overview exposes digit-frequency and parity-sequence analysis without claiming prediction", () => {
  assert.match(lab, /Digit frequency & sequence behaviour/);
  assert.match(lab, /Latest 12 digits/);
  assert.match(lab, /Current parity streak/);
  assert.match(lab, /Momentum shift/);
  assert.match(lab, /Transition/);
  assert.match(lab, /not evidence of a predictive edge/);
});

test("entry intelligence is backend-gated and defaults to WAIT without prerequisites", () => {
  assert.match(panels, /"WAIT"/);
  assert.match(panels, /selected\?\.status === "validated"/);
  assert.match(panels, /three fresh, consecutive persisted ticks/);
  assert.match(panels, /backend independently recomputes probabilities/i);
  assert.match(panels, /onEvaluateEntry/);
  assert.match(panels, /onPlanSequence/);
});

test("backtesting and performance read persisted evaluation reports and disclose missing payout replay", () => {
  assert.match(panels, /aggregate_model_metrics/);
  assert.match(panels, /aggregate_constant_baseline_metrics/);
  assert.match(panels, /aggregate_rolling_frequency_baseline_metrics/);
  assert.match(panels, /walk-forward folds/);
  assert.match(panels, /does not run a full historical payout replay/i);
  assert.match(panels, /PAYOUT-ADJUSTED EV/);
  assert.match(panels, /REALIZED DRAWDOWN/);
  assert.match(panels, /ENTRY COVERAGE/);
  assert.match(panels, /promotion requirements/i);
});

test("Even/Odd Lab preserves the non-execution boundary", () => {
  assert.match(lab, /order_execution_enabled/);
  assert.match(lab, /do not place, buy or close Deriv contracts/i);
  assert.match(panels, /BROKER EXECUTION[\s\S]*Disabled/);
  assert.match(panels, /does not execute a contract/i);
});

test("research workspace layouts remain responsive", () => {
  assert.match(css, /\.digitGrid/);
  assert.match(css, /@media\(max-width:640px\)/);
  assert.match(css, /\.gateGrid/);
});
