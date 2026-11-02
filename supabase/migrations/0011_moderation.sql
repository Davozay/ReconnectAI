-- 0011: Moderation access (moderators table + review policies).
--
-- TRUST MODEL (read before adding moderators): moderators can read all
-- reports, any profile's basics, and any message's content — the minimum
-- needed to review user and message reports. They cannot write anything
-- except report statuses. Membership changes ONLY via dashboard SQL
-- (no client insert/update/delete policies exist on moderators).
--
-- Bootstrap (run in the SQL editor, with the owner's auth user id):
--   insert into public.moderators (user_id) values ('PASTE-UUID-HERE');

create table if not exists public.moderators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  note text not null default '' check (char_length(note) <= 200)
);

alter table public.moderators enable row level security;

-- Anyone can check their OWN membership (powers the frontend guard).
-- No write policies: membership is dashboard-SQL-only.
drop policy if exists "moderators_self_read" on public.moderators;
create policy "moderators_self_read" on public.moderators
  for select to authenticated
  using (auth.uid() = user_id);

create or replace function public.is_moderator()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.moderators m where m.user_id = auth.uid()
  );
$$;

revoke all on function public.is_moderator() from public, anon;
grant execute on function public.is_moderator() to authenticated;

-- Reports: moderators read everything and run the status workflow.
drop policy if exists "user_reports_moderator_read" on public.user_reports;
create policy "user_reports_moderator_read" on public.user_reports
  for select to authenticated
  using (public.is_moderator());

drop policy if exists "user_reports_moderator_update" on public.user_reports;
create policy "user_reports_moderator_update" on public.user_reports
  for update to authenticated
  using (public.is_moderator())
  with check (public.is_moderator());

-- Review support: reporter/target names for any profile basics.
drop policy if exists "profiles_moderator_read" on public.profiles;
create policy "profiles_moderator_read" on public.profiles
  for select to authenticated
  using (public.is_moderator());

-- Review support: read reported message contents (SELECT only).
drop policy if exists "messages_moderator_read" on public.messages;
create policy "messages_moderator_read" on public.messages
  for select to authenticated
  using (public.is_moderator());
