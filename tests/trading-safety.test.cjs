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
const botsWorkspace = read("src/components/bots/BotsWorkspace.tsx");
const workspace = read("src/components/trading/TradingWorkspace.tsx");
const orderResolution = read("src/components/trading/order-resolution.mjs");
const activityHelpers = read("src/components/trading/activity-helpers.mjs");



test("authenticated clients cannot forge live-trading consent through PostgREST", () => {
  assert.match(consentMigration, /revoke all on table public\.deriv_live_trading_consents from public, anon, authenticated/i);
  assert.match(consentMigration, /grant select on table public\.deriv_live_trading_consents to authenticated/i);
  assert.doesNotMatch(consentMigration, /grant\s+(?:insert|update|all)\s+on table public\.deriv_live_trading_consents to authenticated/i);
});

test("Real-account consent cannot be enabled without a server execution gateway", () => {
  assert.match(consentRoute, /if\s*\(body\.enabled\)\s*\{[\s\S]*?real_execution_gateway_unavailable/);
  assert.match(consentRoute, /\.update\(\{ enabled: false \}\)/);
});

test("legacy Next.js trade-session route is retired in favor of FastAPI", () => {
  assert.match(tradeSessionRoute, /status:\s*410/);
  assert.match(tradeSessionRoute, /legacy_endpoint_retired/);
  assert.doesNotMatch(tradeSessionRoute, /api\.derivws\.com|fetch\s*\(/);
});

test("unresolved order state is shared across tabs, rather than isolated to sessionStorage", () => {
  assert.match(tradingHook, /const browserStorage = \(\) => window\.localStorage/);
  assert.match(orderResolution, /getStorage\(\)\.getItem\(key\)/);
  assert.match(orderResolution, /getStorage\(\)\.setItem\(key, value\)/);
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
  assert.match(activityHelpers, /mergeActivityRows\(current, incoming, maxRows = 500\)/);
  assert.match(activityHelpers, /\.slice\(0, maxRows\)/);
});

test("legacy session route cannot issue a Deriv OTP URL for any account type", () => {
  assert.match(tradeSessionRoute, /status:\s*410/);
  assert.doesNotMatch(tradeSessionRoute, /api\.derivws\.com|fetch\s*\(/);
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
  assert.match(botRunner, /normalized\.contractId !== inFlightContractIdRef\.current/);
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
  const botRunnerHelpers = read("src/components/bots/bot-runner-helpers.mjs");
  assert.match(botRunnerHelpers, /normalizedStatus === "cancelled"/);
  assert.match(botRunnerHelpers, /isLoss: !isWin && !isCancelled/);
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

test("bot run metadata persists in localStorage and reloads conservatively", () => {
  const workspace = read("src/components/bots/BotsWorkspace.tsx");
  assert.match(workspace, /tradebridge:bots:server-history:v1/);
  assert.match(workspace, /window\.localStorage\.setItem\(BOT_RUN_HISTORY_KEY/);
  assert.match(workspace, /loadStoredBotHistory\(\)/);
  assert.match(workspace, /The browser session was reloaded/);
  assert.match(workspace, /outcome_unknown/);
  assert.match(workspace, /Deriv remains the source of truth for contract and account history/);
  assert.doesNotMatch(workspace, /\/api\/bots\/runs/);
});

test("unexpected bot socket close cannot downgrade reconciliation or failure status", () => {
  const botsWorkspace = read("src/components/bots/BotsWorkspace.tsx");
  const closeHandler = botsWorkspace.match(/socket\.onclose = \(event\) => \{([\s\S]*?)\n      \};/)?.[1];
  assert.ok(closeHandler, "bot socket close handler must exist");
  assert.match(closeHandler, /\['reconciliation_required', 'failed'\]\.includes\(run\.status\)/);
  assert.match(closeHandler, /status: 'interrupted'/);
});

test("server bot trade history and recovery mutations are scoped to their run", () => {
  const botsWorkspace = read("src/components/bots/BotsWorkspace.tsx");
  assert.match(botsWorkspace, /serverTrades\.filter\(\(trade\) => trade\.run_id === activeServerRun\.id\)/);
  assert.match(botsWorkspace, /t\.run_id === runId && String\(t\.contract_id\) === id && t\.state === 'open'/);
  assert.match(botsWorkspace, /t\.run_id === runId && t\.state === 'open' \? \{ \.\.\.t, state: 'outcome_unknown'/);
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


test("ambiguous server bot orders cannot be cleared by browser acknowledgement", () => {
  const botsWorkspace = read("src/components/bots/BotsWorkspace.tsx");
  const runPanel = read("src/components/bots/RunPanel.tsx");
  assert.match(botsWorkspace, /reconciliation_required/);
  assert.match(runPanel, /orderRecoveryRequired/);
  assert.match(runPanel, /cannot be cleared by a browser acknowledgement/);
  assert.doesNotMatch(runPanel, /I checked Deriv — clear recovery lock/);
});

test("imported and persisted bot configs are validated before execution", () => {
  const types = read("src/components/bots/bot-types.ts");
  const storage = read("src/components/bots/bot-storage.ts");
  const dashboard = read("src/components/bots/BotDashboard.tsx");
  assert.match(types, /export function isBotConfig\(value: unknown\): value is BotConfig/);
  assert.match(types, /BOT_CONTRACT_TYPES/);
  assert.match(types, /config\.durationUnit !== 't'/);
  assert.match(types, /config\.duration > 10/);
  assert.match(types, /config\.contractType === 'DIGITOVER' && barrier > 8/);
  assert.match(types, /config\.contractType === 'DIGITUNDER' && barrier < 1/);
  assert.match(types, /!isPositiveFinite\(stake\.amount\)/);
  assert.match(storage, /Array\.isArray\(parsed\) \? parsed\.filter\(isBotConfig\) : \[\]/);
  assert.match(dashboard, /if \(!isBotConfig\(parsed\)\)/);
  assert.doesNotMatch(dashboard, /const config = parsed as BotConfig/);
});

test("manual stop cannot clear the bot recovery lock while a buy acknowledgement is pending", () => {
  const botRunner = read("src/components/bots/useBotRunner.ts");
  assert.match(botRunner, /const buyRequestPendingRef = useRef\(false\)/);
  assert.match(botRunner, /!buyRequestPendingRef\.current && !inFlightContractIdRef\.current/);
  assert.match(botRunner, /buyRequestPendingRef\.current = true;[\s\S]{0,200}ws\.send\(JSON\.stringify\(\{ buy:/);
  assert.match(botRunner, /if \(stage === 'buy'\) \{\s*buyRequestPendingRef\.current = false;/);
  assert.match(botRunner, /buyRequestPendingRef\.current = false;\s*const buyResp/);
});


const derivCallbackRoute = read("src/app/api/auth/deriv/callback/route.ts");
const tickIngestionRoute = read("src/app/api/internal/market-ticks/route.ts");
const botRunner = read("src/components/bots/useBotRunner.ts");
const marketHook = read("src/components/trading/useMarketData.ts");


test("backend migration exchanges OAuth code server-to-server and does not set legacy token cookies", () => {
  assert.match(derivCallbackRoute, /\/deriv\/internal\/oauth\/exchange/);
  assert.doesNotMatch(derivCallbackRoute, /TOKEN_ENDPOINT|backendSessionsEnabled|DERIV_OAUTH_CLIENT_ID/);
  assert.match(derivCallbackRoute, /response\.cookies\.delete\("tradebridge_deriv_access_token"\)/);
});

test("all Deriv connections require FastAPI and legacy Next.js routes never call Deriv", () => {
  const accountsRoute = read("src/app/api/auth/deriv/accounts/route.ts");
  const statusRoute = read("src/app/api/auth/deriv/status/route.ts");
  const demoSessionRoute = read("src/app/api/auth/deriv/demo-session/route.ts");
  const backendHelper = read("src/lib/deriv/backend.ts");
  assert.doesNotMatch(tradingHook, /\/api\/auth\/deriv\/(?:trade-session|demo-session)/);
  assert.doesNotMatch(workspace, /\/api\/auth\/deriv\/accounts/);
  assert.doesNotMatch(marketHook, /wss:\/\/api\.derivws\.com/);
  for (const source of [accountsRoute, statusRoute, tradeSessionRoute, demoSessionRoute, backendHelper]) {
    assert.doesNotMatch(source, /api\.derivws\.com|auth\.deriv\.com\/oauth2\/token/);
  }
  assert.match(accountsRoute, /\/deriv\/accounts/);
  assert.match(statusRoute, /\/deriv\/session/);
  assert.match(tradingHook, /NEXT_PUBLIC_TRADEBRIDGE_BACKEND_WS_URL/);
  assert.match(workspace, /NEXT_PUBLIC_TRADEBRIDGE_BACKEND_HTTP_URL/);
  assert.match(marketHook, /NEXT_PUBLIC_TRADEBRIDGE_BACKEND_MARKET_WS_URL/);
  assert.match(marketHook, /if \(!PUBLIC_SOCKET\.trim\(\)\)/);
});

test("OAuth callback requires server-to-server FastAPI exchange and never stores Deriv tokens in cookies", () => {
  assert.match(derivCallbackRoute, /TRADEBRIDGE_BACKEND_URL/);
  assert.match(derivCallbackRoute, /TRADEBRIDGE_SESSION_BRIDGE_TOKEN/);
  assert.match(derivCallbackRoute, /\/deriv\/internal\/oauth\/exchange/);
  assert.doesNotMatch(derivCallbackRoute, /auth\.deriv\.com\/oauth2\/token|response\.cookies\.set\("tradebridge_deriv_access_token"/);
  assert.match(derivCallbackRoute, /response\.cookies\.delete\("tradebridge_deriv_access_token"\)/);
});
test("live market feed can be switched to FastAPI without storing ticks", () => {
  assert.match(marketHook, /NEXT_PUBLIC_TRADEBRIDGE_BACKEND_MARKET_WS_URL/);
  assert.match(tickIngestionRoute, /status:\s*410/);
  assert.match(tickIngestionRoute, /tick_persistence_disabled/);
  assert.doesNotMatch(tickIngestionRoute, /createAdminClient|\.from\("market_ticks"\)/);
});

test("automated bot execution is server-authoritative and absent from chart browser code", () => {
  assert.doesNotMatch(workspace, /useBotRunner\(connected, activeAccount/);
  assert.match(workspace, /Bot Workspace/);
  assert.match(botsWorkspace, /NEXT_PUBLIC_TRADEBRIDGE_BACKEND_WS_URL/);
  assert.match(botsWorkspace, /\/bots\/run/);
  assert.match(botsWorkspace, /deriv\/ws-ticket/);
  assert.match(botsWorkspace, /action: 'stop'/);
  assert.doesNotMatch(botsWorkspace, /\/api\/bots\/runs/);
  assert.match(botsWorkspace, /outcome_unknown/);
  assert.doesNotMatch(botRunner, /NEXT_PUBLIC_TRADEBRIDGE_BACKEND_SESSIONS_ENABLED/);
});
