-- 0013: Notifications for memory likes and comments.
--
-- Liking or commenting on someone else's memory notifies the memory
-- author ("X liked your memory" / "X commented on your memory"). Authors
-- never get notified for their own likes/comments. Rows are written ONLY
-- by the trusted triggers below — clients still cannot insert into
-- notifications directly, and comment contents never enter notifications
-- (related_entity_id carries the memory id only).

alter table public.notifications drop constraint if exists notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check
  check (notification_type in (
    'reconnection_request', 'reconnection_accepted', 'new_message',
    'message_reaction', 'memory_like', 'memory_comment'
  ));

create or replace function public.notify_memory_like()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (recipient_id, actor_id, notification_type, related_entity_id)
  select m.author_id, new.user_id, 'memory_like', new.memory_id::text
  from public.memories m
  where m.id = new.memory_id
    and m.author_id <> new.user_id;
  return new;
end;
$$;

drop trigger if exists memory_likes_notify on public.memory_likes;
create trigger memory_likes_notify
  after insert on public.memory_likes
  for each row
  execute function public.notify_memory_like();

create or replace function public.notify_memory_comment()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (recipient_id, actor_id, notification_type, related_entity_id)
  select m.author_id, new.user_id, 'memory_comment', new.memory_id::text
  from public.memories m
  where m.id = new.memory_id
    and m.author_id <> new.user_id;
  return new;
end;
$$;

drop trigger if exists memory_comments_notify on public.memory_comments;
create trigger memory_comments_notify
  after insert on public.memory_comments
  for each row
  execute function public.notify_memory_comment();
