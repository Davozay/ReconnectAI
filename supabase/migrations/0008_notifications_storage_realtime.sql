-- 0008: Notifications (trigger-created), chat attachments bucket, connected
-- profile visibility, and Realtime publication membership.
--
-- Notifications are written ONLY by trusted triggers (request/message/
-- reaction events), never by direct client inserts — so no client can forge
-- or spam another user's inbox. Message contents never enter notifications.

-- ------------------------------------------------------------- notifications
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users (id) on delete cascade,
  actor_id uuid not null references auth.users (id) on delete cascade,
  notification_type text not null check (notification_type in (
    'reconnection_request', 'reconnection_accepted', 'new_message', 'message_reaction'
  )),
  related_entity_id text not null default '' check (char_length(related_entity_id) <= 128),
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  check (recipient_id <> actor_id)
);

create index if not exists notifications_recipient_idx
  on public.notifications (recipient_id, is_read, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications_recipient_read" on public.notifications;
create policy "notifications_recipient_read" on public.notifications
  for select to authenticated
  using (auth.uid() = recipient_id);

drop policy if exists "notifications_recipient_update" on public.notifications;
create policy "notifications_recipient_update" on public.notifications
  for update to authenticated
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

drop policy if exists "notifications_recipient_delete" on public.notifications;
create policy "notifications_recipient_delete" on public.notifications
  for delete to authenticated
  using (auth.uid() = recipient_id);

-- No insert policy: rows are created by SECURITY DEFINER triggers below.

create or replace function public.notify_reconnection_request()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (recipient_id, actor_id, notification_type, related_entity_id)
  values (new.to_id, new.from_id, 'reconnection_request', new.id::text);
  return new;
end;
$$;

drop trigger if exists reconnection_requests_notify on public.reconnection_requests;
create trigger reconnection_requests_notify
  after insert on public.reconnection_requests
  for each row
  when (new.status = 'pending')
  execute function public.notify_reconnection_request();

create or replace function public.notify_reconnection_accepted()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (recipient_id, actor_id, notification_type, related_entity_id)
  values (new.from_id, new.to_id, 'reconnection_accepted', new.id::text);
  return new;
end;
$$;

drop trigger if exists reconnection_requests_notify_accepted on public.reconnection_requests;
create trigger reconnection_requests_notify_accepted
  after update on public.reconnection_requests
  for each row
  when (old.status is distinct from 'accepted' and new.status = 'accepted')
  execute function public.notify_reconnection_accepted();

-- New-message notices reference the conversation only, never the content.
create or replace function public.notify_new_message()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (recipient_id, actor_id, notification_type, related_entity_id)
  select p.user_id, new.sender_id, 'new_message', new.conversation_id::text
  from public.conversation_participants p
  where p.conversation_id = new.conversation_id
    and p.user_id <> new.sender_id;
  return new;
end;
$$;

drop trigger if exists messages_notify on public.messages;
create trigger messages_notify
  after insert on public.messages
  for each row
  when (new.message_type <> 'system')
  execute function public.notify_new_message();

create or replace function public.notify_message_reaction()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (recipient_id, actor_id, notification_type, related_entity_id)
  select m.sender_id, new.user_id, 'message_reaction', new.message_id::text
  from public.messages m
  where m.id = new.message_id
    and m.sender_id <> new.user_id;
  return new;
end;
$$;

drop trigger if exists message_reactions_notify on public.message_reactions;
create trigger message_reactions_notify
  after insert on public.message_reactions
  for each row
  execute function public.notify_message_reaction();

-- ------------------------------------------------- chat-attachments (private)
insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', false)
on conflict (id) do update set public = false;

-- Owners upload into their own "<uid>/" folder only.
drop policy if exists "chat_attachments_owner_insert" on storage.objects;
create policy "chat_attachments_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "chat_attachments_owner_read" on storage.objects;
create policy "chat_attachments_owner_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "chat_attachments_owner_delete" on storage.objects;
create policy "chat_attachments_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-attachments'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Conversation participants can view attachments referenced by messages in
-- conversations they belong to. Stray uploads stay owner-only.
drop policy if exists "chat_attachments_participant_read" on storage.objects;
create policy "chat_attachments_participant_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and exists (
      select 1 from public.messages m
      where m.attachment_path = storage.objects.name
        and public.is_conversation_participant(m.conversation_id)
    )
  );

-- --------------------------------- connected-profile visibility (messaging)
-- Mutually accepted connections can see each other's basic profile so a
-- conversation can show a name and photo. Acceptance is consent to share
-- basics; schools/locations/memories keep their own stricter rules.
drop policy if exists "profiles_connected_read" on public.profiles;
create policy "profiles_connected_read" on public.profiles
  for select to authenticated
  using (
    user_id <> auth.uid()
    and exists (
      select 1 from public.reconnection_requests r
      where r.status = 'accepted'
        and ((r.from_id = auth.uid() and r.to_id = profiles.user_id)
          or (r.from_id = profiles.user_id and r.to_id = auth.uid()))
    )
  );

-- ------------------------------------------- realtime publication membership
-- Live delivery for messages, reactions, read receipts, conversation
-- previews, and notifications (idempotent: skips tables already added).
do $$
declare
  t text;
begin
  foreach t in array array[
    'messages', 'conversations', 'message_reactions',
    'message_reads', 'notifications'
  ]
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
