-- Persisted strategy drafts for the Bot Builder/import workflow.
-- Drafts are deliberately not wired to execution. Only the trusted runner may
-- execute strategies after a separate, explicit interpreter and risk-gate rollout.

create table if not exists public.bot_strategy_definitions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  source_format text not null check (source_format in ('native', 'json', 'xml')),
  source_file_name text,
  source_content text,
  strategy_definition jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'validated', 'ready', 'running', 'paused', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_content is null or octet_length(source_content) <= 1048576)
);

create index if not exists bot_strategy_definitions_user_created_idx
  on public.bot_strategy_definitions(user_id, created_at desc);

alter table public.bot_strategy_definitions enable row level security;
revoke all on table public.bot_strategy_definitions from public, anon, authenticated;
grant select, delete on table public.bot_strategy_definitions to authenticated;
grant insert (user_id, name, source_format, source_file_name, source_content, strategy_definition, status)
  on public.bot_strategy_definitions to authenticated;
grant update (name, source_format, source_file_name, source_content, strategy_definition, status)
  on public.bot_strategy_definitions to authenticated;
grant all on public.bot_strategy_definitions to service_role;

drop policy if exists "Users can read own strategy drafts" on public.bot_strategy_definitions;
drop policy if exists "Users can create own strategy drafts" on public.bot_strategy_definitions;
drop policy if exists "Users can update own strategy drafts" on public.bot_strategy_definitions;
drop policy if exists "Users can delete own strategy drafts" on public.bot_strategy_definitions;

create policy "Users can read own strategy drafts"
  on public.bot_strategy_definitions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create own strategy drafts"
  on public.bot_strategy_definitions for insert to authenticated
  with check ((select auth.uid()) = user_id and status = 'draft');
create policy "Users can update own strategy drafts"
  on public.bot_strategy_definitions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and status = 'draft');
create policy "Users can delete own strategy drafts"
  on public.bot_strategy_definitions for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.set_bot_strategy_definitions_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists set_bot_strategy_definitions_updated_at on public.bot_strategy_definitions;
create trigger set_bot_strategy_definitions_updated_at
before update on public.bot_strategy_definitions
for each row execute function public.set_bot_strategy_definitions_updated_at();
