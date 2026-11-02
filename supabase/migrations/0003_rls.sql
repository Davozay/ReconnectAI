-- 0003: Row Level Security for all user-data tables.
--
-- Principles:
-- * All identity comes from auth.uid(). Clients can never read or write
--   another user's private rows, even with the publishable key.
-- * Discovery is opt-in: only profiles with discoverable = true are
--   visible to others, and blocked users are excluded in both directions.
-- * Memories and their photos are private by default; only rows explicitly
--   shared are readable by others.
-- * Reports are write-only for reporters (they see their own); the full
--   moderation queue is visible only to service_role (backend admin).

-- ---------------------------------------------------------------- profiles
alter table public.profiles enable row level security;

drop policy if exists "profiles_owner_all" on public.profiles;
create policy "profiles_owner_all" on public.profiles
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "profiles_discoverable_read" on public.profiles;
create policy "profiles_discoverable_read" on public.profiles
  for select to authenticated
  using (
    discoverable = true
    and user_id <> auth.uid()
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = profiles.user_id)
         or (b.blocker_id = profiles.user_id and b.blocked_id = auth.uid())
    )
  );

-- ------------------------------------------------------- childhood_schools
alter table public.childhood_schools enable row level security;

drop policy if exists "schools_owner_all" on public.childhood_schools;
create policy "schools_owner_all" on public.childhood_schools
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ----------------------------------------------------- childhood_locations
alter table public.childhood_locations enable row level security;

drop policy if exists "locations_owner_all" on public.childhood_locations;
create policy "locations_owner_all" on public.childhood_locations
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------- memories
alter table public.memories enable row level security;

drop policy if exists "memories_owner_all" on public.memories;
create policy "memories_owner_all" on public.memories
  for all to authenticated
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

drop policy if exists "memories_shared_read" on public.memories;
create policy "memories_shared_read" on public.memories
  for select to authenticated
  using (shared = true and author_id <> auth.uid());

-- ------------------------------------------------------------- memory_photos
alter table public.memory_photos enable row level security;

drop policy if exists "memory_photos_owner_all" on public.memory_photos;
create policy "memory_photos_owner_all" on public.memory_photos
  for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Photos of explicitly shared memories are visible to signed-in users.
drop policy if exists "memory_photos_shared_read" on public.memory_photos;
create policy "memory_photos_shared_read" on public.memory_photos
  for select to authenticated
  using (
    owner_id <> auth.uid()
    and exists (
      select 1 from public.memories m
      where m.id = memory_photos.memory_id
        and m.shared = true
    )
  );

-- ---------------------------------------------------- reconnection_requests
alter table public.reconnection_requests enable row level security;

drop policy if exists "requests_participant_read" on public.reconnection_requests;
create policy "requests_participant_read" on public.reconnection_requests
  for select to authenticated
  using (auth.uid() = from_id or auth.uid() = to_id);

drop policy if exists "requests_sender_insert" on public.reconnection_requests;
create policy "requests_sender_insert" on public.reconnection_requests
  for insert to authenticated
  with check (auth.uid() = from_id and status = 'pending');

drop policy if exists "requests_participant_update" on public.reconnection_requests;
create policy "requests_participant_update" on public.reconnection_requests
  for update to authenticated
  using (
    (auth.uid() = to_id or auth.uid() = from_id)
    and status = 'pending'
  )
  with check (
    (auth.uid() = to_id and status in ('accepted', 'declined'))
    or (auth.uid() = from_id and status = 'cancelled')
  );

-- ---------------------------------------------------------------- user_blocks
alter table public.user_blocks enable row level security;

drop policy if exists "user_blocks_owner_all" on public.user_blocks;
create policy "user_blocks_owner_all" on public.user_blocks
  for all to authenticated
  using (auth.uid() = blocker_id)
  with check (auth.uid() = blocker_id);

-- --------------------------------------------------------------- user_reports
alter table public.user_reports enable row level security;

drop policy if exists "user_reports_reporter_insert" on public.user_reports;
create policy "user_reports_reporter_insert" on public.user_reports
  for insert to authenticated
  with check (auth.uid() = reporter_id and status = 'open');

drop policy if exists "user_reports_reporter_read" on public.user_reports;
create policy "user_reports_reporter_read" on public.user_reports
  for select to authenticated
  using (auth.uid() = reporter_id);
