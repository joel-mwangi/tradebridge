-- Bind every Deriv account to exactly one authenticated TradeBridge user.
-- Deriv does not need to return an email: account ownership is based on the stable
-- account_id returned by Deriv and the verified Supabase Auth user UUID.
create table if not exists public.deriv_account_links (
  deriv_account_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  account_type text,
  currency text,
  linked_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  constraint deriv_account_links_account_id_nonempty
    check (length(trim(deriv_account_id)) between 1 and 128)
);

create index if not exists deriv_account_links_user_id_idx
  on public.deriv_account_links (user_id);

alter table public.deriv_account_links enable row level security;

revoke all on table public.deriv_account_links from anon, authenticated;
grant select, insert, delete on table public.deriv_account_links to authenticated;

drop policy if exists "Users can read their own Deriv links" on public.deriv_account_links;
create policy "Users can read their own Deriv links"
  on public.deriv_account_links
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own Deriv links" on public.deriv_account_links;
create policy "Users can create their own Deriv links"
  on public.deriv_account_links
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can remove their own Deriv links" on public.deriv_account_links;
create policy "Users can remove their own Deriv links"
  on public.deriv_account_links
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
