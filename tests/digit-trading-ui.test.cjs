const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const ticket = read("src/components/trading/DemoTradeTicket.tsx");
const analysis = read("src/components/trading/DigitAnalysis.tsx");
const workspaceCss = read("src/components/trading/TradingWorkspace.module.css");
const workspace = read("src/components/trading/TradingWorkspace.tsx");
const tradingHook = read("src/components/trading/useDemoTrading.ts");
const strategyPanel = read("src/components/trading/DigitStrategyPanel.tsx");
const marketData = read("src/components/trading/useMarketData.ts");
const marketWatch = read("src/components/trading/MarketWatch.tsx");
const types = read("src/components/trading/types.ts");

test("strategy can be re-armed after a completed sequence or the two-loss stop", () => {
  assert.match(strategyPanel, /const executionTerminal = executionStatus\?\.state === "completed"/);
  assert.match(strategyPanel, /executionStatus\.consecutive_losses \?\? 0\) >= 2/);
  assert.match(strategyPanel, /executionStatus\.active_contract_id == null/);
  assert.match(strategyPanel, /includes\(state\)\)\s*&& !executionTerminal/);
});

test("manual ticket exposes digit prediction modes without Higher/Lower price direction", () => {
  assert.match(ticket, /"over-under": \[\{ label: "Over".*\{ label: "Under"/);
  assert.match(ticket, /"even-odd": \[\{ label: "Even".*\{ label: "Odd"/);
  assert.match(ticket, /"matches-differs": \[\{ label: "Matches".*\{ label: "Differs"/);
  assert.doesNotMatch(ticket, /Higher\s*\/\s*Lower|Price direction|contractMode.*directional|DIGITOVER.*CALL|CALL.*DIGITUNDER/);
  assert.match(types, /DigitContractType = "DIGITOVER" \| "DIGITUNDER" \| "DIGITEVEN" \| "DIGITODD" \| "DIGITMATCH" \| "DIGITDIFF"/);
});

test("one workspace state controls analysis mode, prediction, and ticket", () => {
  assert.match(workspace, /const \[digitMode, setDigitModeState\]/);
  assert.match(workspace, /prediction=\{digitPrediction\}/);
  assert.match(workspace, /mode=\{digitMode\}/);
  assert.match(workspace, /target=\{digitTarget\}/);
  assert.match(workspace, /onModeChange=\{setDigitMode\}/);
  assert.match(workspace, /onPredictionChange=\{setPredictionAndValidateTarget\}/);
  assert.match(analysis, /onChange=\{\(e\) => onModeChange\(e\.target\.value as DigitContractMode\)\}/);
  assert.match(ticket, /onClick=\{\(\) => onPredictionChange\(option\.value\)\}/);
});

test("digit modes map to their Deriv contract types and use tick duration", () => {
  assert.match(ticket, /prediction === "UNDER" \? "DIGITUNDER" : "DIGITOVER"/);
  assert.match(ticket, /prediction === "ODD" \? "DIGITODD" : "DIGITEVEN"/);
  assert.match(ticket, /prediction === "DIFFERS" \? "DIGITDIFF" : "DIGITMATCH"/);
  assert.match(ticket, /durationUnit: "t"/);
  assert.match(tradingHook, /contract_type: input\.contractType/);
  assert.match(tradingHook, /input\.duration > 10 \|\| input\.durationUnit !== "t"/);
});

test("digit quote barrier validation rejects invalid Over/Under and missing match targets", () => {
  assert.match(tradingHook, /hasSingleDigitBarrier/);
  assert.match(tradingHook, /input\.contractType === "DIGITOVER".*barrierValue > 8/s);
  assert.match(tradingHook, /input\.contractType === "DIGITUNDER".*barrierValue < 1/s);
  assert.match(tradingHook, /"DIGITMATCH".*hasSingleDigitBarrier/s);
  assert.match(tradingHook, /"DIGITEVEN".*input\.barrier !== undefined/s);
});

test("market streams reconnect and restore subscriptions after WebSocket close", () => {
  const strategy = read("src/components/trading/DigitStrategyPanel.tsx");
  const forex = read("src/components/trading/ForexAnalyst.tsx");
  assert.match(marketData, /Market stream disconnected; reconnecting/);
  assert.match(marketData, /setRetryCount/);
  assert.match(marketData, /subscribedSymbolsRef\.current\.clear\(\)/);
  assert.match(strategy, /socket\.onclose =/);
  assert.match(strategy, /setRetryCount/);
  assert.match(forex, /Market-data connection disconnected; reconnecting/);
  assert.match(forex, /setRetryCount/);
});

test("market discovery and market labels are aligned with digit trading", () => {
  assert.match(marketData, /contract_type: \["DIGITOVER", "DIGITUNDER", "DIGITEVEN", "DIGITODD", "DIGITMATCH", "DIGITDIFF"\]/);
  assert.doesNotMatch(marketData, /contract_type: \["CALL", "PUT"\]/);
  assert.doesNotMatch(marketWatch, /eligible instruments for CALL\/PUT contracts|chart and trade ticket/);
  assert.doesNotMatch(workspace, /analyse its price action/);
});

test("chart mode keeps Chart left, Buy right, and Open Positions below", () => {
  const chartStart = workspace.indexOf('{tradeView === "charts" && (');
  const chartEnd = workspace.indexOf('{page === "portfolio"', chartStart);
  assert.notEqual(chartStart, -1);
  assert.notEqual(chartEnd, -1);
  const chartView = workspace.slice(chartStart, chartEnd);
  assert.ok(chartView.indexOf("<PriceChart") < chartView.indexOf("<DemoTradeTicket"));
  assert.match(chartView, /<TradingActivity[\s\S]*?positionsOnly/);
  assert.doesNotMatch(chartView, /Automated bot execution|Open Bot Workspace/);
});

test("digit frequency percentages are rendered from backend snapshots, not recalculated in the browser", () => {
  assert.ok(analysis.includes("snapshot?.digitFrequency?.windows?.[String(windowSize)]"));
  assert.ok(analysis.includes("frequency?.percentages[String(digit)]"));
  assert.ok(analysis.includes("frequency?.counts[String(d)]"));
  assert.ok(!analysis.includes("(n / total * 100).toFixed(1)"));
  assert.ok(ticket.includes('snapshot?.digitFrequency?.windows?.["100"]'));
  assert.ok(ticket.includes("recentFrequency?.percentages[String(digit)]"));
  assert.ok(ticket.includes("recentFrequency?.counts[String(digit)]"));
  assert.ok(!ticket.includes("digitFrequencyPercent(count)"));
  assert.ok(!ticket.includes("recentDigits.filter((value) => value === digit).length"));
  assert.ok(workspaceCss.includes(".ticketDigitFrequencyGrid { display: grid; grid-template-columns: repeat(10, minmax(0, 1fr)"));
  assert.ok(workspaceCss.includes(".ticketDigitCircle { display: grid; place-items: center; width: min(100%, 27px); aspect-ratio: 1"));
  assert.ok(!read("src/components/trading/PriceChart.tsx").includes("Digit frequency"));
});;
