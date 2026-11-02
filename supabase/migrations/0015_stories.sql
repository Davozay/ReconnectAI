-- 0015: Stories/status (24h photo updates for connections).
--
-- Stories are visible to accepted connections and the author only.
-- Expiry is enforced by app queries (expires_at > now()); there is no
-- cron — expired rows are simply never returned (see the optional
-- cleanup note in SUPABASE_SETUP.md). Views let authors see who watched
-- and let trays show unviewed rings.

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users (id) on delete cascade,
  media_path text not null check (char_length(media_path) <= 512),
  caption text not null default '' check (char_length(caption) <= 200),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);

create index if not exists stories_author_idx
  on public.stories (author_id, created_at desc);
create index if not exists stories_expires_idx
  on public.stories (expires_at);

alter table public.stories enable row level security;

drop policy if exists "stories_self_read" on public.stories;
create policy "stories_self_read" on public.stories
  for select to authenticated
  using (auth.uid() = author_id);

drop policy if exists "stories_connections_read" on public.stories;
create policy "stories_connections_read" on public.stories
  for select to authenticated
  using (
    exists (
      select 1 from public.reconnection_requests r
      where r.status = 'accepted'
        and ((r.from_id = auth.uid() and r.to_id = stories.author_id)
          or (r.from_id = stories.author_id and r.to_id = auth.uid()))
    )
  );

drop policy if exists "stories_owner_insert" on public.stories;
create policy "stories_owner_insert" on public.stories
  for insert to authenticated
  with check (auth.uid() = author_id);

drop policy if exists "stories_owner_delete" on public.stories;
create policy "stories_owner_delete" on public.stories
  for delete to authenticated
  using (auth.uid() = author_id);

create table if not exists public.story_views (
  story_id uuid not null references public.stories (id) on delete cascade,
  viewer_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

create index if not exists story_views_story_idx
  on public.story_views (story_id);

alter table public.story_views enable row level security;

drop policy if exists "story_views_self_read" on public.story_views;
create policy "story_views_self_read" on public.story_views
  for select to authenticated
  using (auth.uid() = viewer_id);

drop policy if exists "story_views_author_read" on public.story_views;
create policy "story_views_author_read" on public.story_views
  for select to authenticated
  using (
    exists (
      select 1 from public.stories s
      where s.id = story_views.story_id
        and s.author_id = auth.uid()
    )
  );

drop policy if exists "story_views_viewer_insert" on public.story_views;
create policy "story_views_viewer_insert" on public.story_views
  for insert to authenticated
  with check (
    auth.uid() = viewer_id
    and exists (
      select 1 from public.stories s
      where s.id = story_views.story_id
        and (
          s.author_id = auth.uid()
          or exists (
            select 1 from public.reconnection_requests r
            where r.status = 'accepted'
              and ((r.from_id = auth.uid() and r.to_id = s.author_id)
                or (r.from_id = s.author_id and r.to_id = auth.uid()))
          )
        )
    )
  );

-- ------------------------------------------------- story-media (private)
insert into storage.buckets (id, name, public)
values ('story-media', 'story-media', false)
on conflict (id) do update set public = false;

drop policy if exists "story_media_owner_insert" on storage.objects;
create policy "story_media_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'story-media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "story_media_owner_read" on storage.objects;
create policy "story_media_owner_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'story-media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "story_media_owner_delete" on storage.objects;
create policy "story_media_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'story-media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "story_media_connections_read" on storage.objects;
create policy "story_media_connections_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'story-media'
    and exists (
      select 1 from public.reconnection_requests r
      where r.status = 'accepted'
        and (
          (r.from_id = auth.uid() and r.to_id::text = (storage.foldername(name))[1])
          or (r.from_id::text = (storage.foldername(name))[1] and r.to_id = auth.uid())
        )
    )
  );

-- ------------------------------------------- realtime publication membership
do $$
declare
  t text;
begin
  foreach t in array array['stories', 'story_views']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
