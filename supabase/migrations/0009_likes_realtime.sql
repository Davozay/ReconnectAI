-- 0009: Memory likes + Realtime membership for requests and likes.
--
-- Likes are visible to anyone who can see the memory (owner + shared);
-- users can only like/unlike as themselves. Adding reconnection_requests
-- and memory_likes to the Realtime publication powers live updates on the
-- Connections page and like counts (server-side RLS still scopes events).

-- ------------------------------------------------------------- memory_likes
create table if not exists public.memory_likes (
  memory_id uuid not null references public.memories (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (memory_id, user_id)
);

create index if not exists memory_likes_memory_idx
  on public.memory_likes (memory_id);

alter table public.memory_likes enable row level security;

drop policy if exists "likes_visible_read" on public.memory_likes;
create policy "likes_visible_read" on public.memory_likes
  for select to authenticated
  using (
    exists (
      select 1 from public.memories m
      where m.id = memory_likes.memory_id
        and (m.author_id = auth.uid() or m.shared = true)
    )
  );

drop policy if exists "likes_owner_insert" on public.memory_likes;
create policy "likes_owner_insert" on public.memory_likes
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.memories m
      where m.id = memory_likes.memory_id
        and (m.author_id = auth.uid() or m.shared = true)
    )
  );

drop policy if exists "likes_owner_delete" on public.memory_likes;
create policy "likes_owner_delete" on public.memory_likes
  for delete to authenticated
  using (auth.uid() = user_id);

-- ------------------------------------------- realtime publication membership
do $$
declare
  t text;
begin
  foreach t in array array['reconnection_requests', 'memory_likes']
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
