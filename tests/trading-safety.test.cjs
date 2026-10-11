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


const botMigration = read("supabase/migrations/20261011133000_add_demo_bot_runner.sql");
const botToggleRoute = read("src/app/api/bots/toggle/route.ts");
const botRunnerRoute = read("src/app/api/bots/runner/route.ts");
const botCredentials = read("src/lib/bots/credentials.ts");

test("browser clients cannot activate bots directly or arm two bots on one account", () => {
  assert.match(botMigration, /revoke insert \(is_active\) on public\.trading_bots from authenticated/i);
  assert.match(botMigration, /revoke update \(is_active\) on public\.trading_bots from authenticated/i);
  assert.match(botMigration, /trading_bots_one_armed_bot_per_account/i);
  assert.match(botToggleRoute, /getAuthenticatedDerivContext/);
  assert.match(botToggleRoute, /fetchDerivAccounts/);
  assert.match(botToggleRoute, /account_type[\s\S]{0,120}demo/i);
});

test("bot runner requires a secret and strictly validates Deriv Demo socket URLs", () => {
  assert.match(botRunnerRoute, /timingSafeEqual/);
  assert.match(botRunnerRoute, /allowedSecrets\.some/);
  assert.match(botRunnerRoute, /url\.hostname !== "api\.derivws\.com"/);
  assert.match(botRunnerRoute, /url\.pathname !== "\/trading\/v1\/options\/ws\/demo"/);
  assert.match(botRunnerRoute, /real_execution_gateway_unavailable|non_demo_session_rejected/);
});

test("bot credentials use authenticated encryption and never store plaintext", () => {
  assert.match(botCredentials, /const ALGORITHM = "aes-256-gcm"/);
  assert.match(botCredentials, /createCipheriv\(ALGORITHM/);
  assert.match(botCredentials, /createDecipheriv\(ALGORITHM/);
  assert.match(botCredentials, /getAuthTag/);
  assert.match(botMigration, /revoke all on table public\.bot_runner_credentials from public, anon, authenticated/i);
  assert.match(botMigration, /grant all on table public\.bot_runner_credentials to service_role/i);
});

test("risk gates use broker daily account P&L and reject incomplete history", () => {
  assert.match(botRunnerRoute, /profit_table: 1/);
  assert.match(botRunnerRoute, /statement: 1/);
  assert.match(botRunnerRoute, /trade_skipped_incomplete_account_pnl/);
  assert.match(botRunnerRoute, /const dailyPnl = brokerDailyPnl/);
  assert.match(botRunnerRoute, /maxStakeFraction: 0\.01/);
  assert.match(botRunnerRoute, /daily_loss_limit/);
});

test("ambiguous bot orders are not retried automatically", () => {
  assert.match(botRunnerRoute, /status: "unknown"/);
  assert.match(botRunnerRoute, /bot_paused_unknown_order/);
  assert.match(botRunnerRoute, /buy_outcome_ambiguous/);
  assert.match(botRunnerRoute, /do not retry|Do not retry/i);
});


const botReconcileRoute = read("src/app/api/bots/reconcile/route.ts");
const botManager = read("src/components/trading/BotManager.tsx");

test("unknown bot orders can only be reconciled against the verified Demo account", () => {
  assert.match(botReconcileRoute, /getAuthenticatedDerivContext/);
  assert.match(botReconcileRoute, /getOwnedDerivAccountIds/);
  assert.match(botReconcileRoute, /fetchDerivAccounts/);
  assert.match(botReconcileRoute, /account_type[\s\S]{0,120}demo/i);
  assert.match(botReconcileRoute, /url\.pathname !== "\/trading\/v1\/options\/ws\/demo"/);
  assert.match(botReconcileRoute, /eq\("status", "unknown"\)/);
});

test("manual contract reconciliation validates symbol, direction, stake and timing", () => {
  assert.match(botReconcileRoute, /getContractSymbol\(contract\) !== ledger\.symbol/);
  assert.match(botReconcileRoute, /direction !== ledger\.direction/);
  assert.match(botReconcileRoute, /sameNumber\(actualBuy, expectedAsk\)/);
  assert.match(botReconcileRoute, /Math\.abs\(actualStart - expectedStart\)/);
  assert.match(botReconcileRoute, /broker_verified_contract/);
});

test("clearing an ambiguous order requires complete broker checks and an empty portfolio", () => {
  assert.match(botReconcileRoute, /portfolio: 1/);
  assert.match(botReconcileRoute, /statement: 1/);
  assert.match(botReconcileRoute, /profit_table: 1/);
  assert.match(botReconcileRoute, /broker_history_incomplete_or_open_exposure/);
  assert.match(botReconcileRoute, /possible_purchase_found/);
  assert.match(botReconcileRoute, /status: "rejected"/);
});

test("Bot Manager exposes recovery controls for unknown order outcomes", () => {
  assert.match(botManager, /from\("bot_trade_ledger"\)/);
  assert.match(botManager, /reconcileUnknownTrade/);
  assert.match(botManager, /Verify contract/);
  assert.match(botManager, /Verify no order/);
});

test("bot durations stay within candle-aligned values that can meet the holdout sample gate", () => {
  assert.match(botMigration, /duration_seconds in \(60, 120, 300, 600, 900, 1800\)/);
  assert.match(botManager, /const DURATION_OPTIONS/);
  assert.match(botManager, /Choose one of the supported contract durations/);
  assert.match(botManager, /<select[\s\S]{0,100}id="bot-duration"/);
  assert.match(botManager, /DURATION_OPTIONS\.map/);
});
