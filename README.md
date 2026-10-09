# TradeBridge

TradeBridge is a Next.js workspace for Deriv Options. It uses Deriv OAuth 2.0 Authorization Code + PKCE, retrieves linked account details server-side, streams market ticks, and supports quote-and-confirm orders on Demo accounts.

Real accounts can be linked and inspected, but **real-money order entry is deliberately disabled**. TradeBridge currently opens Deriv trading WebSockets directly in the browser; browser-only stake caps and loss stops can be bypassed. Real trading must stay disabled until a server-side execution gateway validates every order and can enforce limits and revocation. The app does not promise profit or prevent an account owner from trading independently on Deriv.

## Supported workflow

- **Markets:** Discover eligible active symbols, stream live ticks, and switch between line history and OHLC candlesticks with selectable intervals using Deriv-returned market data.
- **Accounts:** List only Deriv accounts linked to the authenticated TradeBridge user; label account type clearly and show the selected account's balance.
- **Demo orders:** Request a Deriv proposal for a Higher/Lower (CALL/PUT) Options contract and confirm the order separately.
- **Real accounts:** Display linked Real account details in read-only mode. Real order sessions are blocked until enforceable server-side risk controls are implemented.
- **Positions:** Stream open-contract updates, including current profit/loss and contract status, and request an early market sale after a second confirmation.
- **Account activity:** Load and page through Deriv statement transactions, view the daily profit table, refresh account panels, and export the currently loaded statement rows to CSV.
- **Session safety:** Server-side account ownership/type checks, Demo-only trading WebSocket issuance, server-only writes to risk-consent records, consent revocation, and token cookies that are HttpOnly in production.

TradeBridge currently implements Deriv **Options** contracts with Higher/Lower (CALL/PUT). It is not a general CFD, forex margin, copy-trading, or multi-asset terminal.

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

```bash
npm install
cp .env.example .env.local
npm run dev
```

On Windows PowerShell use `Copy-Item .env.example .env.local`. Open http://localhost:3000.

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

GitHub Actions runs `npx tsc --noEmit` and `npm run build` for changes proposed to `main`. Build success does not replace live-provider verification. Test Demo ownership, quotes, order confirmation, order-timeout reconciliation, live P/L updates, early sale, statement refresh, and disconnection. Test Real accounts in read-only mode; do not add a Real order socket until server-side policy enforcement is deployed.
