-- 0001: Core user-data tables (profiles, schools, locations, memories).
--
-- Apply in order with `supabase db push` (or paste into the SQL editor).
-- All ownership references auth.users(id); RLS policies land in 0003.

-- Shared updated_at trigger.
create or replace function public.set_updated_at()
returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- profiles
-- One row per auth user. discoverable=false by default (opt-in discovery).
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  bio text not null default '' check (char_length(bio) <= 500),
  hometown text not null default '' check (char_length(hometown) <= 120),
  nickname text not null default '' check (char_length(nickname) <= 80),
  avatar_storage_path text not null default '' check (char_length(avatar_storage_path) <= 512),
  discoverable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create index if not exists profiles_discoverable_idx
  on public.profiles (discoverable) where discoverable = true;

-- ------------------------------------------------------- childhood_schools
create table if not exists public.childhood_schools (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  school_name text not null check (char_length(school_name) between 1 and 160),
  years_label text not null default '' check (char_length(years_label) <= 40),
  start_year smallint null check (start_year is null or (start_year between 1900 and 2100)),
  end_year smallint null check (end_year is null or (end_year between 1900 and 2100)),
  created_at timestamptz not null default now(),
  check (start_year is null or end_year is null or start_year <= end_year)
);

create index if not exists childhood_schools_user_idx
  on public.childhood_schools (user_id);
create index if not exists childhood_schools_name_idx
  on public.childhood_schools (school_name);

-- ----------------------------------------------------- childhood_locations
create table if not exists public.childhood_locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  place_name text not null check (char_length(place_name) between 1 and 160),
  years_label text not null default '' check (char_length(years_label) <= 40),
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists childhood_locations_user_idx
  on public.childhood_locations (user_id);

-- ---------------------------------------------------------------- memories
-- Private by default (shared=false). analysis holds an optional confirmed
-- Memory Detective result snapshot; photos live in memory_photos + storage.
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '' check (char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 5000),
  shared boolean not null default false,
  analysis jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists memories_set_updated_at on public.memories;
create trigger memories_set_updated_at
  before update on public.memories
  for each row execute function public.set_updated_at();

create index if not exists memories_author_idx on public.memories (author_id);
create index if not exists memories_shared_idx
  on public.memories (shared, created_at desc) where shared = true;
