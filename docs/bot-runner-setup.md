# TradeBridge Demo bot runner setup

The bot engine is **Demo-only**. Real-account order sessions remain disabled. A bot is not a profit guarantee; it trades only when the historical holdout gate and all risk controls pass.

## 1. Apply the database migration

Apply migrations to the intended Supabase project, including:

- `supabase/migrations/20261011133000_add_demo_bot_runner.sql`

This migration disables legacy active flags because those rows were only UI configurations, moves activation behind a server API, encrypts credentials in a service-role-only table, and creates an append-only-by-client trade ledger.

Verify the target project before running migrations. The browser can read its own bot trade ledger but cannot write credentials, leases, trade results, or the active flag.

## 2. Configure server secrets

In Vercel Project Settings → Environment Variables, set:

- `SUPABASE_SERVICE_ROLE_KEY` — existing server-only Supabase service-role key.
- `BOT_TOKEN_ENCRYPTION_KEY` — a base64-encoded, random 32-byte key.
- `CRON_SECRET` — a random bearer secret shared with the scheduler.

Generate the encryption key locally with Node.js:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Generate a separate scheduler secret:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Do not commit either value. Do not use the encryption key as the scheduler secret. Keep a secure backup of the encryption key; rotating it invalidates stored encrypted tokens, which causes armed bots to pause.

Redeploy after setting environment variables.

## 3. Configure a scheduler

The endpoint is:

`GET https://<your-production-domain>/api/bots/runner`

It accepts only `Authorization: Bearer <CRON_SECRET>`. It processes at most one bot per invocation to stay within serverless time limits, prioritizes unsettled trades, uses account-level database leases to prevent concurrent execution, and rotates by last-run time so configured bots are not permanently starved.

**The Vercel project currently uses the Hobby plan**, whose Cron Jobs can only run once per day. A per-minute Vercel Cron configuration would fail deployment, so do not add a one-minute Vercel cron to this project unless its plan changes.

Use Supabase Cron instead:

1. In the Supabase Dashboard, enable the `pg_cron`, `pg_net`, and Vault extensions if not already enabled.
2. Store two secrets in Vault:
   - `tradebridge_bot_runner_url`: the production endpoint above.
   - `tradebridge_cron_secret`: exactly the same value as Vercel's `CRON_SECRET`.
3. Run the following SQL in the intended Supabase project's SQL Editor. It schedules a one-minute invocation and reads the URL and bearer secret from Vault, not from the SQL statement.

```sql
select cron.schedule(
  'tradebridge-demo-bot-runner',
  '* * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret
            from vault.decrypted_secrets
            where name = 'tradebridge_bot_runner_url'),
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'tradebridge_cron_secret'
      )
    ),
    timeout_milliseconds := 55000
  );
  $$
);
```

If the job already exists, unschedule it by job name before scheduling a replacement. Review Supabase Cron run history and Vercel function logs to verify that it is executing. An HTTP request being sent is not proof that a trade was placed; inspect the API response and TradeBridge bot activity.

## 4. Arm a Demo bot

1. Sign in to TradeBridge and connect Deriv.
2. Select a verified Demo account.
3. Create a bot with a valid Deriv symbol, stake, contract duration, daily loss limit, and daily trade cap.
4. Arm it. The server validates account ownership/type and stores the OAuth access token encrypted with a short safety expiry.
5. Check recent activity for outcomes such as `no_signal`, `trade_skipped_risk_gate`, `trade_opened`, or `trade_settled`.

The OAuth implementation returns a short-lived access token and currently has no refresh-token flow in TradeBridge. Bot credentials therefore expire after a conservative 45-minute safety window. When a bot pauses for expired credentials, reconnect Deriv and arm it again. Keep the user signed in to TradeBridge during setup, but the scheduled runner itself does not depend on an open browser tab.

## 5. What the runner enforces

The default strategy duration is 60 seconds. Supported durations are 5, 10, 15, 30, 60, 120, 300, 600, 900, and 1,800 seconds. The choices align with the candle history so the holdout has enough possible independent expiry windows for the 40-trade minimum; longer/unaligned durations are intentionally not selectable in the initial runner.

- Verified Demo Options WebSocket only; rejects Real-account WebSocket URLs.
- Four strategy candidates: trend following, mean reversion, breakout, and momentum.
- Historical holdout backtest with a 95% Wilson lower confidence bound; no probability is invented from a signal score.
- At least 40 non-overlapping holdout trades and expected return at the lower confidence bound above the configured margin, using the current payout ratio as an explicit historical assumption.
- Stake cap of 1% of the current Demo balance.
- Account-wide daily loss limit, daily trade limit, maximum three consecutive losses, 60-second cooldown, and no overlapping open contract on the account.
- Database leases, pre-order intent ledger, and pause-on-ambiguous-order behavior. A timeout after submitting a buy is treated as unknown—not as a confirmed failure—and the bot is paused to prevent blind retries. Unknown orders can be recovered only by broker verification: provide the contract ID for a verified open/settled contract, or run a server-side check of portfolio, statement and profit history before closing the intent as not placed.
- Server-side-only token encryption, credentials, leases, settlement writes, and P&L updates.

A signal score is not a probability. Historical backtests using current payout ratios do not replace recording actual quotes over time; the payout assumption may differ from past offers. The gates are conservative controls, not proof of future profitability.

## 6. Operational checks before considering live money

Run the demo runner for at least 2–4 weeks and aim for at least 500 settled Demo trades across multiple market conditions. Review actual payout ratios, win-rate confidence bounds, net P&L, maximum drawdown, rejected/unknown orders, and strategy performance by symbol and regime. Pause the bot if edge disappears or risk thresholds are reached.

Real-money automation remains intentionally disabled. Do not remove the Demo-only check or bypass server-side controls to promote a strategy.
