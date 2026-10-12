alter table public.bot_strategy_definitions
  add column if not exists runner_claimed_at timestamptz,
  add column if not exists runner_last_result text;

create index if not exists bot_strategy_definitions_runner_claim_idx
  on public.bot_strategy_definitions(status, runner_claimed_at);
