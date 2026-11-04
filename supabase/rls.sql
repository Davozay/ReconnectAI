-- ReConnect Shield: Supabase Row Level Security.
--
-- Apply with: supabase db execute -f supabase/rls.sql  (or paste into the
-- Supabase SQL editor). Tables mirror the backend's in-memory Shield store
-- so the FastAPI service layer can move to Postgres without route changes.
--
-- Design notes:
-- * All identity comes from auth.uid(). Clients can never read or write
--   another user's private rows, even with the anon key.
-- * Discovery is opt-in: only rows with discoverable = true are visible,
--   and blocked users are excluded in both directions.
-- * Messages require an accepted reconnection request; blocks cut access.
-- * Reports are write-only for reporters (they see their own); the full
--   queue is visible only to service_role (backend admin endpoints).
-- * Photos live in a private storage bucket; signed access is granted by
--   the backend after the same owner/admin checks.

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  discoverable boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Owners manage their own profile.
create policy "profiles_owner_all" on public.profiles
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Anyone signed in may see opt-in discoverable profiles, except people
-- they blocked or are blocked by (block check lives in app logic too,
-- so a policy gap can never leak: defense in depth).
create policy "profiles_discoverable_read" on public.profiles
  for select to authenticated
  using (
    discoverable = true
    and user_id <> auth.uid()
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = profiles.user_id)
         or (b.blocker_id = profiles.user_id and b.blocked_id = auth.uid())
    )
  );

-- ---------------------------------------------------- reconnection requests
create table if not exists public.reconnection_requests (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references auth.users (id) on delete cascade,
  to_id uuid not null references auth.users (id) on delete cascade,
  message text not null default '' check (char_length(message) <= 500),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  check (from_id <> to_id)
);

alter table public.reconnection_requests enable row level security;

-- Participants see their own requests; nobody else does.
create policy "requests_participant_read" on public.reconnection_requests
  for select to authenticated
  using (auth.uid() = from_id or auth.uid() = to_id);

-- Senders create pending requests addressed from themselves only.
create policy "requests_sender_insert" on public.reconnection_requests
  for insert to authenticated
  with check (auth.uid() = from_id and status = 'pending');

-- Recipients accept/decline; senders cancel. No other transitions.
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

-- ------------------------------------------------------------------ blocks
create table if not exists public.blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.blocks enable row level security;

create policy "blocks_owner_all" on public.blocks
  for all to authenticated
  using (auth.uid() = blocker_id)
  with check (auth.uid() = blocker_id);

-- ----------------------------------------------------------------- reports
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null check (target_type in ('user', 'message', 'photo', 'post')),
  target_id text not null check (char_length(target_id) between 1 and 128),
  category text not null check (category in (
    'impersonation', 'scam', 'harassment', 'suspicious_message', 'unauthorized_photo'
  )),
  details text not null default '' check (char_length(details) <= 2000),
  status text not null default 'open'
    check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;

-- Reporters file reports as themselves and read back only their own.
-- The moderation queue is served by backend admin endpoints (service_role),
-- never by direct client reads.
create policy "reports_reporter_insert" on public.reports
  for insert to authenticated
  with check (auth.uid() = reporter_id and status = 'open');

create policy "reports_reporter_read" on public.reports
  for select to authenticated
  using (auth.uid() = reporter_id);

-- ---------------------------------------------------------------- messages
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references auth.users (id) on delete cascade,
  to_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  check (from_id <> to_id)
);

alter table public.messages enable row level security;

-- Helper: accepted connection with no block either way.
create or replace function public.shield_can_message(a uuid, b uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.reconnection_requests r
    where r.status = 'accepted'
      and ((r.from_id = a and r.to_id = b) or (r.from_id = b and r.to_id = a))
  )
  and not exists (
    select 1 from public.blocks k
    where (k.blocker_id = a and k.blocked_id = b)
       or (k.blocker_id = b and k.blocked_id = a)
  );
$$;

-- Participants read threads only while connected and unblocked.
create policy "messages_participant_read" on public.messages
  for select to authenticated
  using (
    (auth.uid() = from_id or auth.uid() = to_id)
    and public.shield_can_message(from_id, to_id)
  );

-- Send from yourself, only to connected, unblocked peers.
create policy "messages_sender_insert" on public.messages
  for insert to authenticated
  with check (
    auth.uid() = from_id
    and public.shield_can_message(from_id, to_id)
  );

-- ------------------------------------------------------------------ photos
-- Private bucket: no public reads. The backend mints short-lived signed
-- URLs after owner/admin checks (mirrors GET /api/shield/photos/{id}).

insert into storage.buckets (id, name, public)
values ('shield-photos', 'shield-photos', false)
on conflict (id) do update set public = false;

create policy "shield_photos_owner_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'shield-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "shield_photos_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'shield-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "shield_photos_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'shield-photos' and auth.uid()::text = (storage.foldername(name))[1]);

-- ---------------------------------------------------------------- memories
-- Community memory posts: authors own their rows; only posts explicitly
-- shared are readable by others.
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '' check (char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 5000),
  shared boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.memories enable row level security;

create policy "memories_owner_all" on public.memories
  for all to authenticated
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

create policy "memories_shared_read" on public.memories
  for select to authenticated
  using (shared = true and author_id <> auth.uid());
