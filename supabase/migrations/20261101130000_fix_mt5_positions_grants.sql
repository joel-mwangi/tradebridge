-- Fix mt5_positions: add explicit service_role grants and fix user_id type.
-- The initial migration (20261101120000) was missing GRANT statements
-- and used `text` for user_id instead of uuid.

-- 1. Drop existing policies first (they reference user_id column)
drop policy if exists "owner can read positions" on public.mt5_positions;
drop policy if exists "service role full access" on public.mt5_positions;

-- 2. Fix user_id from text → uuid
alter table public.mt5_positions
  add column if not exists user_id_uuid uuid;

update public.mt5_positions
  set user_id_uuid = user_id::uuid
  where user_id_uuid is null;

alter table public.mt5_positions
  drop column user_id;

alter table public.mt5_positions
  rename column user_id_uuid to user_id;

alter table public.mt5_positions
  alter column user_id set not null;

-- 3. Recreate correct RLS policies
create policy "owner can read positions" on public.mt5_positions
  for select using (user_id = auth.uid());

create policy "service role full access" on public.mt5_positions
  for all to service_role using (true) with check (true);

-- 4. Grant service_role full table access
grant all on table public.mt5_positions to service_role;
