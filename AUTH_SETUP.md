# TradeBridge authentication setup

TradeBridge has its own Supabase Auth identity layer. A user must sign in to TradeBridge before the dashboard and its Deriv endpoints are accessible. Connecting Deriv is a separate authorization step; it does not create or replace a TradeBridge account.

## 1. Configure Vercel environment variables

In the Vercel project for `swigtrade.vercel.app`, add these variables for Production, Preview, and Development as appropriate:

- `NEXT_PUBLIC_SUPABASE_URL` — your Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — the project's publishable key. Do not use a service-role or secret key in a `NEXT_PUBLIC_*` variable.

Redeploy after saving the variables. Do not commit actual credentials to GitHub.

## 2. Configure Supabase Auth URLs

In Supabase Dashboard → Authentication → URL Configuration:

- Set the Site URL to `https://swigtrade.vercel.app`.
- Add `https://swigtrade.vercel.app/auth/callback` and `https://swigtrade.vercel.app/auth/callback?next=/reset-password` to the allowed redirect URLs. Google OAuth returns through this callback; keep the exact deployed origin on the allow list.
- Add the equivalent Preview deployment callback URL(s) if you test authentication on Vercel previews.
- For local development, allow `http://localhost:3000/auth/callback` and `http://localhost:3000/auth/callback?next=/reset-password`.

Enable email/password authentication. Under Authentication → Sign In / Providers, enable Google and save the Google OAuth client ID and client secret there (not in Vercel or GitHub). In Google Cloud Console, add Supabase's displayed callback URL as an authorized redirect URI. In Supabase's URL Configuration, allow the TradeBridge callback URL above. If email confirmation is enabled, configure the confirmation email to redirect through the callback URL above. The password-reset flow uses the same callback with `?next=/reset-password`.

## 3. User flows

- `/register`: create a TradeBridge account with email/password or Google.
- `/login`: sign in with email/password or Google.
- `/auth/google`: server-side route that initiates Google OAuth without logging provider responses or tokens.
- `/login`: sign in to the platform.
- `/forgot-password`: request a password reset email.
- `/reset-password`: set a new password after following the emailed link.
- `/auth/signout`: POST endpoint used by the dashboard sign-out button.

The middleware verifies sessions server-side and protects dashboard pages and API routes. Unauthenticated API requests receive HTTP 401. Deriv OAuth remains a separate connection.

## 4. Identity consistency and Deriv account linking

- The Supabase Auth user UUID is the canonical TradeBridge identity. A Google or email/password login must resolve to that same Supabase user; do not merge users by comparing email strings in application code.
- Supabase Auth manages provider identity linking. Keep provider email verification enabled. If a user signs in with a different Google identity/email, require that user to authenticate and link identities through the supported Supabase flow rather than silently merging accounts.
- TradeBridge requires a verified platform email before starting Deriv authorization. The Deriv email does not need to match the platform email: Deriv's stable `account_id` is the external account identifier, and Deriv's email is not treated as proof of TradeBridge ownership.
- The callback associates every returned Deriv account ID with the authenticated Supabase user UUID. A Deriv account ID is unique in `public.deriv_account_links`; an account already linked to another TradeBridge user cannot be silently reassigned.
- Deriv access tokens remain in HttpOnly cookies and are additionally bound to the current TradeBridge user UUID. Account and demo-session APIs re-check the authenticated user and persisted account ownership server-side. Do not move Deriv tokens into localStorage, client state, or logs.

## 5. Apply the database migrations

The migration files are committed to the repository but are **not automatically applied** to your remote Supabase project. Apply them to the correct project in order before testing account linking:

1. `supabase/migrations/20261009100000_create_tradebridge_profiles.sql`
2. `supabase/migrations/20261009103000_link_deriv_accounts_to_users.sql`

Use the Supabase CLI linked to project ref `ujelblflzfqgccldxaom` and apply the migrations through your normal migration workflow, or run the SQL in the Supabase SQL Editor in the same order. Do not reset the database. If your project's Data API settings require per-table exposure, expose `public.deriv_account_links` to the Data API after applying the migration; its SQL grants and RLS policies still restrict access to each user's own rows.

## 6. Verify after deployment

1. Open the site in a private/incognito window. The dashboard should redirect to `/login`.
2. Register a test user and verify the email if confirmation is enabled.
3. Sign in and confirm the dashboard loads.
4. Sign out; confirm the dashboard is protected again.
5. While signed out, request `/api/auth/deriv/accounts`; it should return HTTP 401.
6. Test password recovery and reconnect Deriv while signed in.

A successful code commit does not itself confirm that Supabase project settings or Vercel environment variables are configured. Browser redirects and OAuth network requests are inherently visible in developer tools; this implementation avoids logging tokens/secrets and uses only the public Supabase publishable key in app code. Never put the Google client secret, Supabase secret key, or service-role key in `NEXT_PUBLIC_*` variables or client components.
