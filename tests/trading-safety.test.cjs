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






test("automated bot UI is removed while core trading workspace remains", () => {
  assert.doesNotMatch(workspace, /BotsWorkspace|Automated Bots|label: "Bots"|page === "bots"/);
  assert.doesNotMatch(workspace, /\/bots\/run|tradebridge:bots:/);
});

const derivCallbackRoute = read("src/app/api/auth/deriv/callback/route.ts");
const tickIngestionRoute = read("src/app/api/internal/market-ticks/route.ts");
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


