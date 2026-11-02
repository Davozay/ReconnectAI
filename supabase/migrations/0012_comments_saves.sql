-- 0012: Memory comments + saves.
--
-- Comments are visible to anyone who can see the memory (owner + shared
-- memories), mirroring the likes visibility in 0009. Comment owners can
-- edit or delete their own; memory authors can delete comments on their
-- own memories. Saves are private bookmarks: each user reads only their
-- own. Both tables join the Realtime publication for live counts/icons.

-- ---------------------------------------------------------- memory_comments
create table if not exists public.memory_comments (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memories (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) >= 1 and char_length(body) <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists memory_comments_memory_idx
  on public.memory_comments (memory_id, created_at);

alter table public.memory_comments enable row level security;

drop policy if exists "comments_visible_read" on public.memory_comments;
create policy "comments_visible_read" on public.memory_comments
  for select to authenticated
  using (
    exists (
      select 1 from public.memories m
      where m.id = memory_comments.memory_id
        and (m.author_id = auth.uid() or m.shared = true)
    )
  );

drop policy if exists "comments_owner_insert" on public.memory_comments;
create policy "comments_owner_insert" on public.memory_comments
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.memories m
      where m.id = memory_comments.memory_id
        and (m.author_id = auth.uid() or m.shared = true)
    )
  );

drop policy if exists "comments_owner_update" on public.memory_comments;
create policy "comments_owner_update" on public.memory_comments
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "comments_owner_or_author_delete" on public.memory_comments;
create policy "comments_owner_or_author_delete" on public.memory_comments
  for delete to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.memories m
      where m.id = memory_comments.memory_id
        and m.author_id = auth.uid()
    )
  );

-- ------------------------------------------------------------- memory_saves
create table if not exists public.memory_saves (
  memory_id uuid not null references public.memories (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (memory_id, user_id)
);

create index if not exists memory_saves_memory_idx
  on public.memory_saves (memory_id);

alter table public.memory_saves enable row level security;

drop policy if exists "saves_self_read" on public.memory_saves;
create policy "saves_self_read" on public.memory_saves
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "saves_owner_insert" on public.memory_saves;
create policy "saves_owner_insert" on public.memory_saves
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.memories m
      where m.id = memory_saves.memory_id
        and (m.author_id = auth.uid() or m.shared = true)
    )
  );

drop policy if exists "saves_owner_delete" on public.memory_saves;
create policy "saves_owner_delete" on public.memory_saves
  for delete to authenticated
  using (auth.uid() = user_id);

-- ------------------------------------------- realtime publication membership
do $$
declare
  t text;
begin
  foreach t in array array['memory_comments', 'memory_saves']
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
