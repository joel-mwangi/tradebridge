# TradeBridge

TradeBridge is a Next.js workspace for Deriv Options. In the FastAPI-owned session mode, Next.js handles the browser redirect and app-account linking while FastAPI exchanges the Deriv OAuth code, owns Deriv credentials, retrieves linked accounts, proxies market data, and executes explicitly confirmed Demo orders.

Real accounts can be linked and inspected, but **real-money order entry is deliberately disabled**. TradeBridge currently opens Deriv trading WebSockets directly in the browser; browser-only stake caps and loss stops can be bypassed. Real trading must stay disabled until a server-side execution gateway validates every order and can enforce limits and revocation. The app does not promise profit or prevent an account owner from trading independently on Deriv.

## Supported workflow

- **Markets:** Discover active symbols eligible for digit contracts and stream live ticks. The Trade workspace uses tick history for last-digit analysis rather than a price chart.
- **Accounts:** List only Deriv accounts linked to the authenticated TradeBridge user; label account type clearly and show the selected account's balance.
- **Demo orders:** Request a Deriv proposal for Digit Over/Under (DIGITOVER/DIGITUNDER), Even/Odd (DIGITEVEN/DIGITODD), or Matches/Differs (DIGITMATCH/DIGITDIFF) Options contracts and confirm the order separately. The selected digit contract controls its analysis, inputs, quote, and confirmation flow.
- **Real accounts:** Display linked Real account details in read-only mode. Real order sessions are blocked until enforceable server-side risk controls are implemented.
- **Positions:** Stream open-contract updates, including current profit/loss and contract status, and request an early market sale after a second confirmation.
- **Account activity:** Load and page through Deriv statement transactions, view the daily profit table, refresh account panels, and export the currently loaded statement rows to CSV.
- **Session safety:** Server-side account ownership/type checks, Demo-only trading WebSocket issuance, server-only writes to risk-consent records, consent revocation, and token cookies that are HttpOnly in production.


The manual Trade workspace focuses on Deriv **digit Options**: Over/Under, Even/Odd, and Matches/Differs. Its digit-analysis selector is shared with the quote-and-confirm ticket; the trade workflow does not present Higher/Lower price-direction entry or a price-history chart. It is not a general CFD, forex margin, copy-trading, or multi-asset terminal.

## Stack

- Next.js App Router, React, TypeScript
- Deriv OAuth 2.0 Authorization Code flow with PKCE
- Deriv Options REST and WebSocket APIs
- Supabase Auth and PostgreSQL for user profiles, account ownership, and live-trading consent

## Requirements

- Node.js 20.9+ (Node.js 22 LTS recommended)
- npm
- Supabase project configured for TradeBridge Auth

## Local development

The example environment file includes `APP_URL` and `NODE_ENV`; set `APP_URL` to the exact origin used by your registered Deriv OAuth callback.

```bash
npm install
cp .env.example .env.local
npm run dev
```

On Windows PowerShell use `Copy-Item .env.example .env.local`. Open http://localhost:3000.

## Container deployment

Docker Compose builds and runs the production Next.js app. Supabase and Deriv remain provider services; configure a Supabase project reachable from both the browser and container, and set the Deriv OAuth client ID before starting:

```bash
cp .env.example .env
# Fill in the Supabase URL and publishable key, Supabase service-role key, and Deriv client ID.
docker compose up --build
```

The app is available at http://localhost:3000. Compose checks `/api/health` and restarts the app if its process exits. Do not commit `.env` or pass service-role credentials as `NEXT_PUBLIC_*` variables.


## AI Lab market analysis

The Bots workspace includes an AI Lab Market Analysis view. The browser calls the authenticated TradeBridge route `/api/ai-lab/market-analysis`; that route verifies the current Supabase user and proxies to the Python research API using a server-only bearer token. The Python service queries the server-side `public.market_ticks` table and returns descriptive last-digit statistics. The browser never receives `TRADEBRIDGE_API_TOKEN` or the Supabase service-role key.

Configure these variables in the **TradeBridge** deployment:
- `TRADEBRIDGE_AI_URL`: base URL of the deployed Python research API (for example, `https://ai-tradingbridge.vercel.app`).
- `TRADEBRIDGE_API_TOKEN`: a strong random token matching `TRADEBRIDGE_API_TOKEN` in the Python service deployment. Keep it server-only; do not use a `NEXT_PUBLIC_*` name.

Configure these server-only variables in the **Python AI service** deployment:
- `TRADEBRIDGE_API_TOKEN`: the same high-entropy shared token as the TradeBridge deployment.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: the TradeBridge Supabase project that stores ticks. The service-role key must never be exposed to the browser.

Before expecting results, apply `supabase/migrations/20261016100000_market_ticks.sql` to the intended TradeBridge Supabase project and confirm the trusted tick collector is writing rows for the selected symbol. The UI reports missing history or configuration as an error instead of inventing data. If the migration or collector has not been deployed, no real history will be available.

The analysis is descriptive only. Digit frequency and chi-square statistics do not establish a predictive edge or constitute a trading signal.

## Configure Deriv OAuth

1. Register an OAuth 2.0 application in Deriv.
2. Set `DERIV_OAUTH_CLIENT_ID` in `.env.local` to the registered OAuth client ID.
3. Set `APP_URL=http://localhost:3000` for local development.
4. Register the exact callback URL `http://localhost:3000/api/auth/deriv/callback` in the Deriv app.
5. Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` with values from your Supabase project.
6. Set `SUPABASE_SERVICE_ROLE_KEY` in the server-only environment. It is required for consent revocation after authenticated client write access is removed. Never expose it using a `NEXT_PUBLIC_*` variable, and never commit its value.
7. Apply all committed Supabase migrations to the verified TradeBridge project.
8. Start with a Deriv Demo account. Verify account listing, quotes, order confirmation, positions, early sale, and statement refresh. Real-money order sessions are intentionally blocked pending a server-side execution gateway.

For deployment, set `APP_URL` to your HTTPS origin and register the matching `https://your-domain/api/auth/deriv/callback` callback with Deriv. The redirect URI must match exactly.

Apply migrations using your configured Supabase migration workflow; for the Supabase CLI, link the intended project and run:

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

Review the migration list and target project before running database changes. Do not run this against a production database until you have verified the project reference and taken any backup required by your deployment process.

## Operational endpoint

- `GET /api/health` — lightweight process health response for deployment probes. It confirms the Next.js process is responding; it does not claim Supabase or Deriv are reachable.

## OAuth and trading endpoints

- `GET /api/auth/deriv/start` — creates PKCE/state values and redirects to Deriv.
- `GET /api/auth/deriv/callback` — validates state, exchanges the code server-side, verifies returned accounts, and links account IDs to the authenticated user.
- `GET /api/auth/deriv/accounts` — returns Deriv account details only after server-side ownership checks.
- `GET /api/auth/deriv/status` — verifies the saved authorization against Deriv.
- `GET /api/auth/deriv/live-consent?account_id=...` — reads the signed-in user's consent and configured app limits for a linked account.
- `POST /api/auth/deriv/live-consent` — revokes consent for an owned Real account. Enabling new live consent is denied while server-side order enforcement is unavailable.
- `POST /api/auth/deriv/trade-session` — issues a short-lived account-scoped WebSocket URL for verified Demo accounts only. Real accounts receive `503 real_execution_gateway_unavailable` until live orders are mediated by server-side enforcement.
- `POST /api/auth/deriv/disconnect` — clears local Deriv cookies and attempts to revoke persisted live-trading consent.

The OAuth access token stays in a server-only HttpOnly cookie and is never exposed to client-side JavaScript. The WebSocket one-time URL is opened directly by the browser to use Deriv's streaming Options trading API.

## Risk controls — important limitations

- Real-account order entry is hard-disabled in the current build; acknowledging risk or writing a consent row cannot open a Real trading socket.
- The former stake cap and daily realized-loss stop were browser-enforced controls only. A server-side gateway must validate every order and maintain authoritative per-account risk state before real-money entry can be safely considered.
- Every TradeBridge entry still needs a fresh quote, expires after 30 seconds in the UI, and requires a separate confirm action. Early sales also require a separate confirmation.
- Real-money entry is disabled in the current build. Existing saved consent can be revoked, but it cannot enable a Real trading socket.
- Disconnect attempts to revoke stored consent and clears local authorization cookies. Persistent revocation requires the server-only `SUPABASE_SERVICE_ROLE_KEY`; if Supabase is unavailable, cookie clearing still proceeds but the server cannot confirm the database update.
- An ambiguous Demo buy or early-sale timeout/connection loss pauses TradeBridge order actions for that account across tabs in the same browser profile. The lock is a client-side safety interlock, not broker-side idempotency and not a guarantee across devices or cleared browser storage. Before unlocking, reconcile open contracts and statement activity directly in Deriv; do not assume a missing UI confirmation means the order failed.
- No live order has been placed as part of development or CI verification. Real trading must not be enabled until a server-side execution gateway exists and the complete provider integration is smoke-tested.
- Deriv may change its API schemas, permitted contracts, account statuses, or authorization requirements; verify the current provider documentation before extending supported contract types.

## Verification

Run the same checks used in GitHub Actions before opening a pull request:

```bash
npm ci
npm run lint
npm test
npm run coverage
npx tsc --noEmit
npm run build
```

The test command uses Node.js test auto-discovery, so every `*.test.cjs` suite is included. The coverage command enforces at least 50% line coverage across the strategy engine, order-resolution storage, and statement/position parsers. Dependency updates are proposed weekly by Dependabot. CI runs the dependency audit through the repository's scoped audit checker so the single documented upstream `braces` advisory does not mask or suppress unrelated high/critical findings.

Build success does not replace live-provider verification. Test Demo ownership, quotes, order confirmation, order-timeout reconciliation, live P/L updates, early sale, statement refresh, and disconnection. Test Real accounts in read-only mode; do not add a Real order socket until server-side policy enforcement is deployed.


## Dependency security policy

- The lockfile overrides the vulnerable Next.js transitive PostCSS dependency with PostCSS 8.5.23.
- CI fails for unresolved high/critical npm advisories, except the narrowly identified upstream `braces` advisory GHSA-vfj7-8cjw-p6xm. As of October 2026, the advisory has no published patched `braces` release; the check allows only that exact advisory and its development-tool dependency chain (`braces` → `micromatch` → `fast-glob` → `@next/eslint-plugin-next` → `eslint-config-next`). `eslint-config-next` is a direct devDependency, but its exception is limited to that exact inherited advisory path; runtime dependencies and any other advisory remain blocking. All findings remain visible in the audit output; unrelated advisories still fail CI.
- Recheck the exception by 2026-11-16 and remove it immediately when upstream publishes a fix. Do not suppress unrelated `braces` advisories or new high/critical vulnerabilities.


## FastAPI-owned Deriv session migration

The migration is feature-flagged for a controlled rollout. Do not enable it until the FastAPI service is deployed on an always-on ASGI host, the same bridge secret is configured on both services, and the backend checks pass.

### Next.js environment

- `TRADEBRIDGE_BACKEND_DERIV_SESSIONS_ENABLED=true` — route the OAuth code exchange to FastAPI and stop setting the legacy Deriv token cookies.
- `TRADEBRIDGE_BACKEND_URL=https://<backend-host>` — server-only FastAPI base URL.
- `TRADEBRIDGE_SESSION_BRIDGE_TOKEN=<long-random-secret>` — shared server-only secret for the internal OAuth exchange/revocation endpoint.
- `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_SESSIONS_ENABLED=true` — load account state from FastAPI.
- `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_HTTP_URL=https://<backend-host>` — FastAPI HTTP origin.
- `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_WS_ENABLED=true` and `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_WS_URL=wss://<backend-host>/deriv/ws` — route Demo trading WebSocket messages through FastAPI.
- `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_MARKET_WS_ENABLED=true` and `NEXT_PUBLIC_TRADEBRIDGE_BACKEND_MARKET_WS_URL=wss://<backend-host>/deriv/live/market` — route public market-data subscriptions through FastAPI.

### FastAPI environment

- `DERIV_OAUTH_CLIENT_ID` — same Deriv OAuth client ID registered for this app.
- `DERIV_OAUTH_REDIRECT_URI` — exact callback URL, for example `https://<frontend-host>/api/auth/deriv/callback`; it must match the OAuth request.
- `TRADEBRIDGE_SESSION_BRIDGE_TOKEN` — same server-only shared secret as Next.js.
- `TRADEBRIDGE_ALLOWED_ORIGINS` — comma-separated exact origins, for example `https://swigtrade.vercel.app,http://localhost:3000`.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — validate the signed-in app session.
- `SUPABASE_SERVICE_ROLE_KEY` — server-only account-link ownership checks and encrypted credential storage; never expose this key to the browser.
- `TRADEBRIDGE_CREDENTIAL_ENCRYPTION_KEY` — a locally generated Fernet key stored only in FastAPI's secret environment, separate from Supabase. Generate with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`.
- Apply `supabase/migrations/20261017010000_deriv_backend_credentials.sql` to the TradeBridge Supabase project before enabling the migration. This table stores only encrypted OAuth credentials, not market ticks.
- `TRADEBRIDGE_DEMO_MAX_STAKE=1000` — server-side Demo stake ceiling; choose a lower value if appropriate.

### Important operating limits

- Real-account execution stays disabled. The backend permits Demo accounts only.
- OAuth credentials are encrypted at rest in `public.deriv_backend_credentials`; active WebSocket connections still close on process restart and clients must reconnect. The migration must be applied before enabling the feature flags.
- Live ticks/history are forwarded ephemerally and are not persisted. The legacy `POST /api/internal/market-ticks` endpoint returns HTTP 410. Disable any old external collector that targets it.
- The WebSocket ticket is short-lived and single-use. Do not log it or put it in a URL.
- Do not switch flags on in production until end-to-end testing verifies OAuth callback, linked-account listing, live tick/history streaming, proposals, explicit buy confirmation, early sell, settlement/statement reconciliation, reconnect behavior, and sign-out/disconnect revocation.
- Keep the legacy routes available only as a temporary rollback path during validation; remove them after a verified cutover, not before.
