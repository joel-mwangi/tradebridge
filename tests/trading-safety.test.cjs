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

test("automated bot requests Deriv proposals with the required symbol field and buys at the quoted price", () => {
  const botRunner = read("src/components/bots/useBotRunner.ts");
  const proposalRequest = botRunner.match(/ws\.send\(JSON\.stringify\(\{\s*proposal: 1,[\s\S]*?\}\)\);/)?.[0];
  assert.ok(proposalRequest, "bot proposal request must exist");
  assert.match(proposalRequest, /underlying_symbol: cfg\.symbol/);
  assert.doesNotMatch(proposalRequest, /^\s*symbol:/m);
  assert.match(botRunner, /ask_price\?: number \| string/);
  assert.match(botRunner, /price: askPrice/);
});

test("automated bot treats Deriv-cancelled contracts as settled without counting a loss", () => {
  const botRunner = read("src/components/bots/useBotRunner.ts");
  assert.match(botRunner, /contractStatus === 'cancelled'/);
  assert.match(botRunner, /const isLoss = !isWin && !isCancelled/);
  assert.match(botRunner, /Trade \$\{isCancelled \? 'CANCELLED'/);
});

test("quick bot creation validates and includes digit-contract barriers", () => {
  const dashboard = read("src/components/bots/BotDashboard.tsx");
  assert.match(dashboard, /const requiresBarrier = \['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'\]/);
  assert.match(dashboard, /Digit Over barriers must be from 0 to 8/);
  assert.match(dashboard, /Digit Under barriers must be from 1 to 9/);
  assert.match(dashboard, /const stake = Number\(fields\.stake\)/);
  assert.match(dashboard, /Number\.isFinite\(stake\)/);
  assert.match(dashboard, /\.\.\.\(requiresBarrier \? \{ barrier \} : \{\}\)/);
});

test("bot dashboard can search and filter run history and explain saved errors", () => {
  const dashboard = read("src/components/bots/BotDashboard.tsx");
  assert.match(dashboard, /runFilter === 'all' \|\| run\.status === runFilter/);
  assert.match(dashboard, /run\.botName\.toLowerCase\(\)\.includes/);
  assert.match(dashboard, /run\.error \|\| 'No error details were saved/);
  assert.match(dashboard, /onClick=\{\(\) => botsListRef\.current\?\.scrollIntoView/);
});

test("bot run history updates the dashboard immediately and can be cleared", () => {
  const storage = read("src/components/bots/bot-storage.ts");
  const workspace = read("src/components/bots/BotsWorkspace.tsx");
  assert.match(storage, /window\.dispatchEvent\(new Event\(BOT_RUNS_UPDATED_EVENT\)\)/);
  assert.match(storage, /export function clearBotRuns\(\): boolean/);
  assert.match(workspace, /window\.addEventListener\(BOT_RUNS_UPDATED_EVENT, syncRuns\)/);
  assert.match(workspace, /onClearRuns=\{handleClearRuns\}/);
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
