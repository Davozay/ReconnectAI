-- 0020: Story likes.
--
-- Anyone who can see a story (its author + accepted connections, per
-- 0015) can like it and see its likes; users act only as themselves.
-- Liking someone else's story notifies the author ("X liked your
-- story"). Self-likes notify nobody. Rows are written ONLY by clients
-- into story_likes and by the trusted trigger below into
-- notifications — like rows vanish with their story (on delete
-- cascade), and expired stories simply stop being returned, as in
-- 0015 (requires 0013 and 0015 first).

create table if not exists public.story_likes (
  story_id uuid not null references public.stories (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

create index if not exists story_likes_story_idx
  on public.story_likes (story_id);

alter table public.story_likes enable row level security;

drop policy if exists "story_likes_visible_read" on public.story_likes;
create policy "story_likes_visible_read" on public.story_likes
  for select to authenticated
  using (
    exists (
      select 1 from public.stories s
      where s.id = story_likes.story_id
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

drop policy if exists "story_likes_owner_insert" on public.story_likes;
create policy "story_likes_owner_insert" on public.story_likes
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.stories s
      where s.id = story_likes.story_id
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

drop policy if exists "story_likes_owner_delete" on public.story_likes;
create policy "story_likes_owner_delete" on public.story_likes
  for delete to authenticated
  using (auth.uid() = user_id);

-- ------------------------------------------------- story-like notifications
alter table public.notifications drop constraint if exists notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check
  check (notification_type in (
    'reconnection_request', 'reconnection_accepted', 'new_message',
    'message_reaction', 'memory_like', 'memory_comment', 'story_like'
  ));

create or replace function public.notify_story_like()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (recipient_id, actor_id, notification_type, related_entity_id)
  select s.author_id, new.user_id, 'story_like', new.story_id::text
  from public.stories s
  where s.id = new.story_id
    and s.author_id <> new.user_id;
  return new;
end;
$$;

drop trigger if exists story_likes_notify on public.story_likes;
create trigger story_likes_notify
  after insert on public.story_likes
  for each row
  execute function public.notify_story_like();

-- ------------------------------------------- realtime publication membership
do $$
declare
  t text;
begin
  foreach t in array array['story_likes']
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
