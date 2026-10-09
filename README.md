# TradeBridge

A Next.js trading workspace with a Deriv OAuth 2.0 Authorization Code + PKCE flow and server-side retrieval of authenticated Options account details. Account balances are fetched from Deriv when a valid session is present. Live tick prices are streamed from Deriv's public WebSocket. Account-specific positions/P&L and historical charting are not implemented. The trade ticket supports fresh proposal quotes and explicitly confirmed demo-only orders; real-money trading remains disabled.

## Stack
- Next.js App Router, React, and TypeScript
- Deriv OAuth 2.0 Authorization Code flow with PKCE
- Server-side token exchange and HttpOnly session cookie

## Requirements
- Node.js 20.9+ (Node.js 22 LTS recommended)
- npm

## Local development
```bash
npm install
cp .env.example .env.local
npm run dev
```

On Windows PowerShell, use `Copy-Item .env.example .env.local` instead of `cp`. Open http://localhost:3000.

## Configure Deriv OAuth
1. Register an OAuth 2.0 application in Deriv.
2. Set `DERIV_OAUTH_CLIENT_ID` in `.env.local` to the registered OAuth client ID.
3. Set `APP_URL=http://localhost:3000` for local development.
4. Register this exact callback URL in the Deriv app: `http://localhost:3000/api/auth/deriv/callback`.
5. Restart the development server and test with a Deriv demo account first.

For deployment, set `APP_URL` to your HTTPS origin and register the matching `https://your-domain/api/auth/deriv/callback` callback with Deriv. The redirect URI must match exactly.

## OAuth endpoints
- `GET /api/auth/deriv/start` — generates fresh PKCE/state values and redirects to Deriv.
- `GET /api/auth/deriv/start?mode=signup` — requests Deriv's registration prompt.
- `GET /api/auth/deriv/callback` — validates state and exchanges the authorization code server-side.
- `GET /api/auth/deriv/status` — validates the saved token by requesting the authenticated account endpoint.
- `GET /api/auth/deriv/accounts` — securely fetches account IDs, account types, currencies, balances, and status from Deriv; tokens remain server-side.
- `POST /api/auth/deriv/disconnect` — clears the local session cookie.

The PKCE verifier and OAuth state are stored in short-lived HttpOnly cookies. The access token is stored in an HttpOnly cookie and is never sent to client-side JavaScript. Production cookies use the Secure flag.

## Current status
- [x] Responsive trading dashboard
- [x] Deriv OAuth 2.0 authorization redirect with PKCE
- [x] Callback state verification and server-side token exchange
- [x] Basic local disconnect and session-status endpoints
- [x] Verify token/session against Deriv's authenticated account endpoint
- [x] Retrieve account details and balances from Deriv; clear the local token cookie when Deriv returns 401
- [x] Live public tick streaming for the dashboard's selected markets
- [ ] Account-specific positions/P&L and transaction history
- [x] Generate a short-lived WebSocket OTP URL only after server-side verification that the chosen account is a demo account
- [x] Request fresh proposal quotes and require a separate confirmation before placing a demo order
- [ ] Account-specific positions/P&L, transaction history, and historical charting
- [ ] Automated tests and production security review

## Important limitations
- OAuth is not fully verified until configured with a real Deriv OAuth client and tested against Deriv.
- Session verification calls Deriv's authenticated Options accounts endpoint; transient upstream failures are reported as unavailable rather than treated as a valid session.
- Account balances and market tick prices are live API responses when available. Historical charts, open positions, and P/L remain unavailable placeholders, never fabricated as live data.
- Test with a Deriv demo account before considering real-money workflows.
- Verify Deriv API and partnership/markup terms before charging users or enabling a markup.
- The trade ticket is intentionally demo-only; the server rejects OTP requests for real accounts. Do not enable real-money trading without server-side risk limits, robust quote/order validation, idempotency, audit logging, and a reviewed confirmation workflow.
