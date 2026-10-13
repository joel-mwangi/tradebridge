const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const consentMigration = read("supabase/migrations/20261009140000_add_real_trading_consent.sql");
const consentRoute = read("src/app/api/auth/deriv/live-consent/route.ts");
const tradeSessionRoute = read("src/app/api/auth/deriv/trade-session/route.ts");
const tradingHook = read("src/components/trading/useDemoTrading.ts");



test("authenticated clients cannot forge live-trading consent through PostgREST", () => {
  assert.match(consentMigration, /revoke all on table public\.deriv_live_trading_consents from public, anon, authenticated/i);
  assert.match(consentMigration, /grant select on table public\.deriv_live_trading_consents to authenticated/i);
  assert.doesNotMatch(consentMigration, /grant\s+(?:insert|update|all)\s+on table public\.deriv_live_trading_consents to authenticated/i);
});

test("Real-account consent cannot be enabled without a server execution gateway", () => {
  assert.match(consentRoute, /if\s*\(body\.enabled\)\s*\{[\s\S]*?real_execution_gateway_unavailable/);
  assert.match(consentRoute, /\.update\(\{ enabled: false \}\)/);
});

test("trading sessions are limited to Deriv Demo Options accounts", () => {
  assert.match(tradeSessionRoute, /if\s*\(accountType === "real"\)/);
  assert.match(tradeSessionRoute, /real_execution_gateway_unavailable/);
  assert.match(tradeSessionRoute, /socketUrl\.pathname !== "\/trading\/v1\/options\/ws\/demo"/);
  assert.doesNotMatch(tradeSessionRoute, /socketUrl\.pathname !== "\/trading\/v1\/options\/ws\/real"/);
});

test("unresolved order state is shared across tabs, rather than isolated to sessionStorage", () => {
  assert.match(tradingHook, /window\.localStorage\.getItem\(key\)/);
  assert.match(tradingHook, /window\.localStorage\.setItem\(key, value\)/);
  assert.match(tradingHook, /window\.addEventListener\("storage", syncResolutionState\)/);
  assert.doesNotMatch(tradingHook, /window\.sessionStorage/);
});

test("buy and early-sale timeouts persist an unresolved-order lock", () => {
  assert.match(tradingHook, /writeOrderResolution\(orderResolutionKey, "unknown"\)[\s\S]{0,500}Deriv did not confirm the order in time/);
  assert.match(tradingHook, /writeOrderResolution\(orderResolutionKey, "unknown"\)[\s\S]{0,250}Deriv did not confirm the sale in time/);
  assert.match(tradingHook, /if \(buyRequestRef\.current !== null \|\| sellRequestRef\.current !== null\)/);
});

test("an uncorrelated early-sale response pauses order actions for manual reconciliation", () => {
  assert.match(tradingHook, /returnedContractId !== soldContractId/);
  assert.match(tradingHook, /Order actions are paused; reconcile the contract and statement directly in Deriv/);
});


test("Deriv account session subscribes to authoritative balance and transaction streams", () => {
  assert.match(tradingHook, /send\(\{ balance: 1, subscribe: 1, req_id: nextId\(\) \}\)/);
  assert.match(tradingHook, /send\(\{ transaction: 1, subscribe: 1, req_id: nextId\(\) \}\)/);
  assert.match(tradingHook, /message\.msg_type === "transaction" && message\.transaction/);
  assert.match(tradingHook, /message\.msg_type === "balance" && message\.balance/);
});

test("transaction notifications cannot overwrite balance snapshots or trigger a request storm", () => {
  const transactionHandler = tradingHook.match(/if \(message\.msg_type === "transaction" && message\.transaction\) \{([\s\S]*?)\r?\n\s*\}\s*if \(message\.msg_type === "portfolio"/)?.[1];
  assert.ok(transactionHandler, "transaction event handler must exist");
  assert.doesNotMatch(transactionHandler, /setBalance\(/);
  assert.doesNotMatch(transactionHandler, /refreshAccount\(/);
  assert.match(transactionHandler, /\.slice\(0, 500\)/);
});

test("real-account OTP sessions stay disabled until execution is enforced server-side", () => {
  assert.match(tradeSessionRoute, /if \(accountType === "real"\)[\s\S]{0,250}real_execution_gateway_unavailable/);
  assert.match(tradeSessionRoute, /socketUrl\.pathname !== "\/trading\/v1\/options\/ws\/demo"/);
  assert.doesNotMatch(tradeSessionRoute, /socketUrl\.pathname !== "\/trading\/v1\/options\/ws\/real"/);
});


test("automated bot observes the shared WebSocket without replacing the trading session handler", () => {
  const botRunner = read("src/components/bots/useBotRunner.ts");
  assert.match(botRunner, /addEventListener\('message', eventHandler\)/);
  assert.match(botRunner, /removeEventListener\('message',/);
  assert.doesNotMatch(botRunner, /ws\.onmessage\s*=/);
});

test("automated bot only accepts its own correlated requests and exact contract settlement", () => {
  const botRunner = read("src/components/bots/useBotRunner.ts");
  assert.match(botRunner, /reqId === null \|\| !botReqIds\.has\(reqId\) \|\| requestStage\.get\(reqId\) !== 'proposal'/);
  assert.match(botRunner, /requestStage\.get\(reqId\) !== 'buy'/);
  assert.match(botRunner, /String\(poc\.contract_id\) !== inFlightContractIdRef\.current/);
});

test("automated bot is Demo-only and does not clear unresolved order markers on reload", () => {
  const botRunner = read("src/components/bots/useBotRunner.ts");
  assert.match(botRunner, /sessionStateRef\.current === 'Demo trading connected'/);
  assert.match(botRunner, /account\.account_type \?\? ''\)\.toLowerCase\(\) !== 'demo'/);
  assert.match(botRunner, /Unresolved order marker found/);
  assert.match(botRunner, /localStorage\.getItem\(key\) !== null/);
  assert.doesNotMatch(botRunner, /if \(stale\) localStorage\.removeItem\(key\)/);
});

test("bot request timeouts stop execution and retain ambiguous purchase state for reconciliation", () => {
  const botRunner = read("src/components/bots/useBotRunner.ts");
  assert.match(botRunner, /Timed out waiting for Deriv proposal response/);
  assert.match(botRunner, /Timed out waiting for Deriv purchase acknowledgement/);
  assert.match(botRunner, /orderOutcomeUnknownRef\.current = true/);
  assert.match(botRunner, /Reconcile the Deriv account before restarting/);
});


test("ambiguous bot orders require an explicit Deriv reconciliation acknowledgement", () => {
  const botRunner = read("src/components/bots/useBotRunner.ts");
  const runPanel = read("src/components/bots/RunPanel.tsx");
  assert.match(botRunner, /acknowledgeOrderReconciled/);
  assert.match(botRunner, /window\.confirm/);
  assert.match(runPanel, /orderRecoveryRequired/);
  assert.match(runPanel, /I checked Deriv — clear recovery lock/);
});


test("bot runner persists a UTC-day trade count and blocks starting after the configured cap", () => {
  const botRunner = read("src/components/bots/useBotRunner.ts");
  assert.match(botRunner, /tradebridge:bot-daily-trades/);
  assert.match(botRunner, /dailyTrades >= config\.maxTradesPerDay/);
  assert.match(botRunner, /writeDailyTradeCount\(acc\.account_id, cfg\.id, dailyTradeDate, nextDailyTrades\)/);
  assert.match(botRunner, /Daily trade cap reached/);
});

test("bot runner distinguishes break-even contracts from losses", () => {
  const botRunner = read("src/components/bots/useBotRunner.ts");
  assert.match(botRunner, /const isLoss = poc\.status === 'lost' \|\| profit < 0/);
  assert.match(botRunner, /losses: prior\.losses \+ \(isLoss \? 1 : 0\)/);
  assert.match(botRunner, /'break-even'/);
});

test("bot runner does not detach response timeouts on ordinary connection-state renders", () => {
  const botRunner = read("src/components/bots/useBotRunner.ts");
  assert.match(botRunner, /detach the listener and clear timers only when this hook is unmounted/);
  assert.match(botRunner, /Deriv session disconnected while the bot was active/);
});


test("disconnect after purchase submission cannot clear the unresolved-order lock", () => {
  const botRunner = read("src/components/bots/useBotRunner.ts");
  assert.match(botRunner, /purchaseAttemptedRef\.current = true/);
  assert.match(botRunner, /!purchaseAttemptedRef\.current && !inFlightContractIdRef\.current/);
  assert.match(botRunner, /purchaseAttemptedRef\.current = false/);
});


test("settlement parsing rejects null and blank profit values instead of recording zero profit", () => {
  const botRunner = read("src/components/bots/useBotRunner.ts");
  assert.match(botRunner, /function parseFiniteNumber\(value: unknown\): number \| null/);
  assert.match(botRunner, /if \(typeof value !== 'string' \|\| value\.trim\(\) === ''\) return null/);
  assert.match(botRunner, /const profit = parseFiniteNumber\(poc\.profit\)/);
  assert.match(botRunner, /if \(profit === null\)/);
});

test("bot validates legacy or malformed configuration and recalculated stake before sending another order", () => {
  const botRunner = read("src/components/bots/useBotRunner.ts");
  assert.match(botRunner, /!Array\.isArray\(config\.stopConditions\)/);
  assert.match(botRunner, /Invalid bot configuration/);
  assert.match(botRunner, /Invalid next stake calculated by the selected staking strategy/);
});


test("bot configuration cannot be switched, edited, or deleted while a run is active", () => {
  const workspace = read("src/components/bots/BotsWorkspace.tsx");
  assert.match(workspace, /Stop the active bot before editing its configuration/);
  assert.match(workspace, /Stop the active bot before deleting its configuration/);
  assert.match(workspace, /Stop the active bot before switching to another bot/);
});

test("bot run is stopped if the selected Deriv account changes", () => {
  const botRunner = read("src/components/bots/useBotRunner.ts");
  assert.match(botRunner, /runAccountIdRef\.current = account\.account_id/);
  assert.match(botRunner, /Selected Deriv account changed while the bot was active/);
});


test("unresolved order lock remains attached to its original account and bot when selections change", () => {
  const botRunner = read("src/components/bots/useBotRunner.ts");
  assert.match(botRunner, /const recoveryKeyRef = useRef<string \| null>\(null\)/);
  assert.match(botRunner, /Another account or bot has an unresolved order/);
  assert.match(botRunner, /const key = recoveryKeyRef\.current/);
  assert.match(botRunner, /const cfg = runConfigRef\.current \?\? configRef\.current/);
});

test("settlement status watchdog is refreshed by every matching contract update", () => {
  const botRunner = read("src/components/bots/useBotRunner.ts");
  assert.match(botRunner, /Every matching update refreshes the inactivity watchdog/);
  assert.match(botRunner, /contractStatusSeenRef\.current = true/);
});


test("stopping one bot run is idempotent and cannot persist duplicate run summaries", () => {
  const botRunner = read("src/components/bots/useBotRunner.ts");
  assert.match(botRunner, /const stopHandledRef = useRef\(false\)/);
  assert.match(botRunner, /if \(stopHandledRef\.current\) return/);
  assert.match(botRunner, /stopHandledRef\.current = false/);
});


test("bot releases its own Deriv contract-status subscription on settlement, stop, and unmount", () => {
  const botRunner = read("src/components/bots/useBotRunner.ts");
  assert.match(botRunner, /contractSubscriptionIdRef/);
  assert.match(botRunner, /forget: subscriptionId/);
  assert.match(botRunner, /forgetContractSubscription\(\)/);
});
