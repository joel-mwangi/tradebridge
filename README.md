# TradeBridge

TradeBridge is a Next.js workspace for Deriv Options trading. It uses Deriv OAuth 2.0 Authorization Code + PKCE, retrieves account details server-side, streams real market ticks, requests fresh contract quotes, and provides account-scoped balances, positions, profit/loss, and statement history.

The workspace supports both virtual-money Demo accounts and real-money accounts. Real-money order entry is locked until the signed-in user records an account-specific risk acknowledgement. Every entry requires a fresh quote and a separate confirmation. The app does not promise profit or prevent the account owner from trading outside TradeBridge.

## Supported workflow

- **Markets:** Discover eligible active symbols, stream live ticks, and view the actual returned tick history in the chart.
- **Accounts:** List only Deriv accounts linked to the authenticated TradeBridge user; label account type clearly and show the selected account's balance.
- **Demo orders:** Request a Deriv proposal for a Higher/Lower (CALL/PUT) Options contract and confirm the order separately.
- **Live orders:** Enable real-money entry per Real account after acknowledging the risk disclosure and configuring an app-level stake cap and daily realized-loss stop.
- **Positions:** Stream open-contract updates, including current profit/loss and contract status, and request an early market sale after a second confirmation.
- **Account activity:** Load recent statement transactions, view the daily profit table, refresh the account panels, and export the currently loaded statement rows to CSV.
- **Session safety:** Server-side account ownership/type checks, live-consent checks before obtaining a Real account socket, short-lived one-time WebSocket authentication URLs, account-specific consent revocation, and token cookies that are HttpOnly in production.

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
6. Apply all committed Supabase migrations, including the latest live-trading consent migration, before testing live account controls.
7. Start with a Deriv Demo account. Verify account listing, quotes, order confirmation, positions, early sale, and statement refresh before enabling real-money orders.

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
- `POST /api/auth/deriv/live-consent` — saves or revokes risk acknowledgement for an owned Real account.
- `POST /api/auth/deriv/trade-session` — issues a short-lived account-scoped WebSocket URL only after verifying ownership/type; Real accounts additionally require active, versioned risk consent.
- `POST /api/auth/deriv/disconnect` — clears local Deriv cookies and attempts to revoke persisted live-trading consent.

The OAuth access token stays in a server-only HttpOnly cookie and is never exposed to client-side JavaScript. The WebSocket one-time URL is opened directly by the browser to use Deriv's streaming Options trading API.

## Risk controls — important limitations

- Real order entry is **off by default** for each linked Real account. The user must acknowledge that real-money stake can be lost before a Real trading session can open.
- The app defaults to a maximum stake of 10 account-currency units per entry and a daily realized-loss stop of 25. The user can choose lower or higher values within the limits shown in the UI.
- These stake and daily-loss rules are **TradeBridge UI guardrails**, not Deriv-enforced account limits. Because the authenticated Deriv WebSocket is connected in the browser to support live streaming and trade execution, a determined account owner could bypass client-side stake/loss checks by sending provider messages directly. They must not be described as hard broker-side limits.
- Every TradeBridge entry still needs a fresh quote, expires after 30 seconds in the UI, and requires a separate confirm action. Early sales also require a separate confirmation.
- Disconnect revokes the stored TradeBridge consent and clears local authorization cookies. Revoke consent if you no longer want this app to initiate live orders.
- No live order has been placed as part of development or CI verification. Live provider behavior still requires a manual smoke test using your own account after migration and deployment.
- Deriv may change its API schemas, permitted contracts, account statuses, or authorization requirements; verify the current provider documentation before extending supported contract types.

## Verification

GitHub Actions runs `npx tsc --noEmit` and `npm run build` for changes proposed to `main`. Build success does not replace a live-provider test: verify account ownership, actual quote responses, order confirmation, live P/L updates, early sale, daily loss reporting, disconnection, and consent revocation using a Demo account first.
