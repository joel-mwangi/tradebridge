const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const start = read("src/app/api/auth/ctrader/start/route.ts");
const callback = read("src/app/api/auth/ctrader/callback/route.ts");
const panel = read("src/components/trading/CTraderTradePanel.tsx");
const analyst = read("src/components/trading/ForexAnalyst.tsx");
const migration = read("supabase/migrations/20261022120000_add_ctrader_gateway.sql");
const setupDocs = read("docs/ctrader-setup.md");

test("cTrader linking uses state-checked OAuth and trading consent", () => {
  assert.match(start, /scope", "trading"/);
  assert.match(start, /product", "web"/);
  assert.match(start, /tradebridge_ctrader_oauth_state/);
  assert.match(callback, /returnedState !== expectedState/);
  assert.match(callback, /\/ctrader\/internal\/oauth\/exchange/);
  assert.doesNotMatch(callback, /cookies\.set\([^\n]*(?:access_token|refresh_token)/i);
});

test("cTrader credentials are exchanged by FastAPI rather than returned to the browser", () => {
  assert.match(callback, /TRADEBRIDGE_BACKEND_URL/);
  assert.match(callback, /TRADEBRIDGE_SESSION_BRIDGE_TOKEN/);
  assert.match(callback, /user_id: user\.id, code, redirect_uri/);
  assert.doesNotMatch(callback, /CTRADER_OPENAPI_CLIENT_SECRET|accessToken|refreshToken/);
});

test("Forex Analyst includes a distinct cTrader demo ticket", () => {
  assert.match(analyst, /<CTraderTradePanel currentSymbol=\{selectedSymbol\} \/>/);
  assert.match(panel, /\/ctrader\/session/);
  assert.match(panel, /\/ctrader\/symbols/);
  assert.match(panel, /\/ctrader\/orders/);
  assert.match(panel, /confirmed: true/);
  assert.match(panel, /\/ctrader\/quote/);
  assert.match(panel, /quote\.quote_age_seconds/);
  assert.match(panel, /setSide\("BUY"\); setConfirmed\(false\)/);
  assert.match(panel, /setSide\("SELL"\); setConfirmed\(false\)/);
  assert.match(panel, /setVolume\(event\.target\.value\); setConfirmed\(false\)/);
  assert.match(panel, /Real-money orders are disabled/);
});

test("cTrader ticket does not reuse Deriv option contracts or chart quotes for orders", () => {
  assert.doesNotMatch(panel, /DIGITOVER|DIGITUNDER|contract_type|proposal_id|quoteBox/);
  assert.match(panel, /chart price may differ; spread and slippage apply/i);
});

test("cTrader server-storage migration revokes direct access from browser roles", () => {
  for (const table of ["ctrader_backend_credentials", "ctrader_account_links", "ctrader_order_requests"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, "i"));
    assert.match(migration, new RegExp(`grant all on table public\\.${table} to service_role`, "i"));
  }
  assert.match(migration, /primary key \(user_id, idempotency_key\)/i);
});

test("rollout instructions keep demo execution disabled until validation", () => {
  assert.match(setupDocs, /CTRADER_DEMO_ORDERS_ENABLED.*false/);
  assert.match(setupDocs, /Real-money order execution remains blocked/i);
  assert.match(setupDocs, /Do not add the cTrader client secret/i);
});
