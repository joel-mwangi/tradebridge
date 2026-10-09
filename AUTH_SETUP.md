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
- Add `https://swigtrade.vercel.app/auth/callback` to the allowed redirect URLs.
- Add the equivalent Preview deployment callback URL(s) if you test authentication on Vercel previews.
- For local development, allow `http://localhost:3000/auth/callback`.

Enable email/password authentication. If email confirmation is enabled, configure the confirmation email to redirect through the callback URL above. The password-reset flow uses the same callback with `?next=/reset-password`.

## 3. User flows

- `/register`: create a TradeBridge account.
- `/login`: sign in to the platform.
- `/forgot-password`: request a password reset email.
- `/reset-password`: set a new password after following the emailed link.
- `/auth/signout`: POST endpoint used by the dashboard sign-out button.

The middleware verifies sessions server-side and protects dashboard pages and API routes. Unauthenticated API requests receive HTTP 401. Deriv OAuth remains a separate connection.

## 4. Verify after deployment

1. Open the site in a private/incognito window. The dashboard should redirect to `/login`.
2. Register a test user and verify the email if confirmation is enabled.
3. Sign in and confirm the dashboard loads.
4. Sign out; confirm the dashboard is protected again.
5. While signed out, request `/api/auth/deriv/accounts`; it should return HTTP 401.
6. Test password recovery and reconnect Deriv while signed in.

A successful code commit does not itself confirm that Supabase project settings or Vercel environment variables are configured.
