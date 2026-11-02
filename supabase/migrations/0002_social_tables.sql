-- 0002: Social tables (memory_photos, reconnection_requests, blocks, reports).
--
-- RLS policies land in 0003. Table names use the user_blocks / user_reports
-- convention so they cannot collide with the legacy supabase/rls.sql draft
-- (blocks / reports), which is superseded by these migrations.

-- ------------------------------------------------------------- memory_photos
-- Metadata for objects in the private `memory-photos` storage bucket.
-- storage_path is the full object name: "<owner-uuid>/<file>".
create table if not exists public.memory_photos (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memories (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null check (char_length(storage_path) between 1 and 512),
  content_type text not null default '' check (char_length(content_type) <= 100),
  bytes integer not null default 0 check (bytes >= 0),
  width integer null check (width is null or width > 0),
  height integer null check (height is null or height > 0),
  created_at timestamptz not null default now()
);

create index if not exists memory_photos_memory_idx
  on public.memory_photos (memory_id);
create index if not exists memory_photos_owner_idx
  on public.memory_photos (owner_id);
create unique index if not exists memory_photos_path_uidx
  on public.memory_photos (storage_path);

-- ---------------------------------------------------- reconnection_requests
create table if not exists public.reconnection_requests (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references auth.users (id) on delete cascade,
  to_id uuid not null references auth.users (id) on delete cascade,
  message text not null default '' check (char_length(message) <= 500),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_id <> to_id)
);

drop trigger if exists reconnection_requests_set_updated_at
  on public.reconnection_requests;
create trigger reconnection_requests_set_updated_at
  before update on public.reconnection_requests
  for each row execute function public.set_updated_at();

create index if not exists reconnection_requests_from_idx
  on public.reconnection_requests (from_id);
create index if not exists reconnection_requests_to_idx
  on public.reconnection_requests (to_id);
-- One pending request per pair in either direction (enforced at the DB).
create unique index if not exists reconnection_requests_pending_uidx
  on public.reconnection_requests
  ((least(from_id, to_id)), (greatest(from_id, to_id)))
  where status = 'pending';

-- ---------------------------------------------------------------- user_blocks
create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists user_blocks_blocked_idx
  on public.user_blocks (blocked_id);

-- --------------------------------------------------------------- user_reports
create table if not exists public.user_reports (
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists user_reports_set_updated_at on public.user_reports;
create trigger user_reports_set_updated_at
  before update on public.user_reports
  for each row execute function public.set_updated_at();

create index if not exists user_reports_reporter_idx
  on public.user_reports (reporter_id);
create index if not exists user_reports_status_idx
  on public.user_reports (status, created_at desc);
