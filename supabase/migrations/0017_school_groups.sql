-- 0017: School-based group chats.
--
-- Groups reuse the conversation/message/reaction/read/notification
-- infrastructure (all of it is already N-participant capable):
-- * conversations gain kind/school_name/title/created_by. Direct chats
--   keep working untouched (defaults describe them exactly).
-- * Groups form around ONE shared childhood school: the creator picks a
--   school from their own profile, and every member must list that same
--   school (case/whitespace-insensitive match). No school on your
--   profile, no seat — add it and the creator can add you.
-- * schoolmates() reveals ONLY mutual schoolmates (caller must list the
--   school too) and hides blocked pairs. It is the only way to find
--   candidates; childhood_schools rows stay private otherwise.
-- * Creator manages: add/remove/rename/delete. Leaving transfers the
--   creator role to the earliest-joined remaining member; the last one
--   out deletes the group. Membership changes post system messages
--   (which never trigger notifications, per 0008's filter).
-- * Writes go through these RPCs only (no new table policies needed —
--   conversations/participants were already RPC-only, and reads are
--   participant-based, which groups inherit).
-- * Blocks: the creator cannot add someone they are blocked with.
--   Blocking a fellow member later silences YOUR sends (0007's
--   conversation_blocked is per-pair) but does not hide their past
--   messages — remove them from the group instead.

-- ------------------------------------------------------- school-name matching
create or replace function public.norm_school(name text)
returns text
language sql immutable set search_path = public as $$
  select lower(regexp_replace(trim(coalesce(name, '')), '\s+', ' ', 'g'));
$$;

create index if not exists childhood_schools_norm_idx
  on public.childhood_schools ((public.norm_school(school_name)));

-- ------------------------------------------------- conversation group columns
alter table public.conversations
  add column if not exists kind text not null default 'direct',
  add column if not exists school_name text null,
  add column if not exists title text not null default '',
  add column if not exists created_by uuid null references auth.users (id) on delete set null;

alter table public.conversations drop constraint if exists conversations_kind_check;
alter table public.conversations add constraint conversations_kind_check
  check (kind in ('direct', 'group'));

alter table public.conversations drop constraint if exists conversations_group_shape_check;
alter table public.conversations add constraint conversations_group_shape_check
  check (
    (kind = 'direct' and school_name is null and created_by is null)
    or (kind = 'group' and school_name is not null and created_by is not null)
  );

alter table public.conversations drop constraint if exists conversations_title_len_check;
alter table public.conversations add constraint conversations_title_len_check
  check (char_length(title) <= 80);

alter table public.conversations drop constraint if exists conversations_school_len_check;
alter table public.conversations add constraint conversations_school_len_check
  check (school_name is null or char_length(school_name) <= 160);

-- ------------------------------------------------- mutual-schoolmate lookup
create or replace function public.schoolmates(school text)
returns table (user_id uuid, display_name text, avatar_storage_path text)
language plpgsql stable security definer set search_path = public as $$
begin
  if school is null or trim(school) = '' then
    raise exception 'School unavailable.';
  end if;
  if not exists (
    select 1 from public.childhood_schools s
    where s.user_id = auth.uid()
      and public.norm_school(s.school_name) = public.norm_school(school)
  ) then
    raise exception 'School unavailable.';
  end if;
  return query
  select p.user_id, p.display_name, p.avatar_storage_path
  from public.profiles p
  where p.user_id <> auth.uid()
    and not public.blocked_with(p.user_id)
    and exists (
      select 1 from public.childhood_schools s
      where s.user_id = p.user_id
        and public.norm_school(s.school_name) = public.norm_school(school)
    )
  order by p.display_name;
end;
$$;

revoke all on function public.schoolmates(text) from public, anon;
grant execute on function public.schoolmates(text) to authenticated;

-- ------------------------------------------------------- group management
create or replace function public.create_school_group(school text, title text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  conv_id uuid;
  school_display text;
  group_title text;
  who text;
begin
  if school is null or trim(school) = '' then
    raise exception 'School unavailable.';
  end if;
  if not exists (
    select 1 from public.childhood_schools s
    where s.user_id = auth.uid()
      and public.norm_school(s.school_name) = public.norm_school(school)
  ) then
    raise exception 'Add % to your profile first.', trim(school);
  end if;
  school_display := substring(trim(school) from 1 for 160);
  group_title := coalesce(nullif(trim(title), ''), school_display);
  group_title := substring(group_title from 1 for 80);

  insert into public.conversations (kind, school_name, title, created_by)
  values ('group', school_display, group_title, auth.uid())
  returning id into conv_id;
  insert into public.conversation_participants (conversation_id, user_id)
  values (conv_id, auth.uid());

  select coalesce(p.display_name, 'Someone') into who
  from public.profiles p where p.user_id = auth.uid();
  insert into public.messages (conversation_id, sender_id, content, message_type)
  values (conv_id, auth.uid(), who || ' created this group', 'system');
  return conv_id;
end;
$$;

revoke all on function public.create_school_group(text, text) from public, anon;
grant execute on function public.create_school_group(text, text) to authenticated;

create or replace function public.add_group_member(conv_id uuid, target_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  conv public.conversations%rowtype;
  adder text;
  added text;
begin
  perform pg_advisory_xact_lock(hashtext(conv_id::text));
  select * into conv from public.conversations c where c.id = conv_id and c.kind = 'group';
  if conv.id is null then
    raise exception 'Conversation unavailable.';
  end if;
  if conv.created_by <> auth.uid() then
    raise exception 'Only the group creator can add members.';
  end if;
  if target_id is null or target_id = auth.uid() then
    raise exception 'Conversation unavailable.';
  end if;
  if exists (
    select 1 from public.conversation_participants p
    where p.conversation_id = conv_id and p.user_id = target_id
  ) then
    raise exception 'They are already in this group.';
  end if;
  if (select count(*) from public.conversation_participants p where p.conversation_id = conv_id) >= 50 then
    raise exception 'This group is full.';
  end if;
  if not exists (
    select 1 from public.childhood_schools s
    where s.user_id = target_id
      and public.norm_school(s.school_name) = public.norm_school(conv.school_name)
  ) then
    raise exception 'They have not listed % on their profile yet.', conv.school_name;
  end if;
  if public.blocked_with(target_id) then
    raise exception 'You cannot add them to a group.';
  end if;

  insert into public.conversation_participants (conversation_id, user_id)
  values (conv_id, target_id);
  select coalesce(p.display_name, 'Someone') into adder
  from public.profiles p where p.user_id = auth.uid();
  select coalesce(p.display_name, 'Someone') into added
  from public.profiles p where p.user_id = target_id;
  insert into public.messages (conversation_id, sender_id, content, message_type)
  values (conv_id, auth.uid(), adder || ' added ' || added, 'system');
end;
$$;

revoke all on function public.add_group_member(uuid, uuid) from public, anon;
grant execute on function public.add_group_member(uuid, uuid) to authenticated;

create or replace function public.remove_group_member(conv_id uuid, target_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  conv public.conversations%rowtype;
  remover text;
  removed text;
begin
  perform pg_advisory_xact_lock(hashtext(conv_id::text));
  select * into conv from public.conversations c where c.id = conv_id and c.kind = 'group';
  if conv.id is null then
    raise exception 'Conversation unavailable.';
  end if;
  if conv.created_by <> auth.uid() then
    raise exception 'Only the group creator can remove members.';
  end if;
  if target_id is null or target_id = auth.uid() then
    raise exception 'The creator cannot be removed. Leave the group instead.';
  end if;
  if not exists (
    select 1 from public.conversation_participants p
    where p.conversation_id = conv_id and p.user_id = target_id
  ) then
    raise exception 'They are not in this group.';
  end if;

  delete from public.conversation_participants p
  where p.conversation_id = conv_id and p.user_id = target_id;
  delete from public.message_reads r
  where r.conversation_id = conv_id and r.user_id = target_id;

  select coalesce(p.display_name, 'Someone') into remover
  from public.profiles p where p.user_id = auth.uid();
  select coalesce(p.display_name, 'Someone') into removed
  from public.profiles p where p.user_id = target_id;
  insert into public.messages (conversation_id, sender_id, content, message_type)
  values (conv_id, auth.uid(), remover || ' removed ' || removed, 'system');
end;
$$;

revoke all on function public.remove_group_member(uuid, uuid) from public, anon;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;

create or replace function public.leave_group(conv_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  conv public.conversations%rowtype;
  leaver text;
  successor uuid;
  successor_name text;
begin
  perform pg_advisory_xact_lock(hashtext(conv_id::text));
  select * into conv from public.conversations c where c.id = conv_id and c.kind = 'group';
  if conv.id is null then
    raise exception 'Conversation unavailable.';
  end if;
  if not exists (
    select 1 from public.conversation_participants p
    where p.conversation_id = conv_id and p.user_id = auth.uid()
  ) then
    raise exception 'You are not in this group.';
  end if;

  select coalesce(p.display_name, 'Someone') into leaver
  from public.profiles p where p.user_id = auth.uid();

  delete from public.conversation_participants p
  where p.conversation_id = conv_id and p.user_id = auth.uid();
  delete from public.message_reads r
  where r.conversation_id = conv_id and r.user_id = auth.uid();

  if not exists (
    select 1 from public.conversation_participants p where p.conversation_id = conv_id
  ) then
    delete from public.conversations c where c.id = conv_id;
    return;
  end if;

  if conv.created_by = auth.uid() then
    select p.user_id into successor
    from public.conversation_participants p
    where p.conversation_id = conv_id
    order by p.joined_at asc, p.user_id asc
    limit 1;
    update public.conversations c set created_by = successor where c.id = conv_id;
    select coalesce(p.display_name, 'Someone') into successor_name
    from public.profiles p where p.user_id = successor;
    insert into public.messages (conversation_id, sender_id, content, message_type)
    values (conv_id, auth.uid(), leaver || ' left — ' || successor_name || ' now manages this group', 'system');
  else
    insert into public.messages (conversation_id, sender_id, content, message_type)
    values (conv_id, auth.uid(), leaver || ' left the group', 'system');
  end if;
end;
$$;

revoke all on function public.leave_group(uuid) from public, anon;
grant execute on function public.leave_group(uuid) to authenticated;

create or replace function public.rename_group(conv_id uuid, title text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  conv public.conversations%rowtype;
  who text;
  new_title text;
begin
  perform pg_advisory_xact_lock(hashtext(conv_id::text));
  select * into conv from public.conversations c where c.id = conv_id and c.kind = 'group';
  if conv.id is null then
    raise exception 'Conversation unavailable.';
  end if;
  if conv.created_by <> auth.uid() then
    raise exception 'Only the group creator can rename it.';
  end if;
  if title is null or trim(title) = '' then
    raise exception 'Group name is required.';
  end if;
  new_title := substring(trim(title) from 1 for 80);
  update public.conversations c set title = new_title where c.id = conv_id;

  select coalesce(p.display_name, 'Someone') into who
  from public.profiles p where p.user_id = auth.uid();
  insert into public.messages (conversation_id, sender_id, content, message_type)
  values (conv_id, auth.uid(), who || ' renamed the group to “' || new_title || '”', 'system');
end;
$$;

revoke all on function public.rename_group(uuid, text) from public, anon;
grant execute on function public.rename_group(uuid, text) to authenticated;

create or replace function public.delete_group(conv_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  conv public.conversations%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext(conv_id::text));
  select * into conv from public.conversations c where c.id = conv_id and c.kind = 'group';
  if conv.id is null then
    raise exception 'Conversation unavailable.';
  end if;
  if conv.created_by <> auth.uid() then
    raise exception 'Only the group creator can delete it.';
  end if;
  delete from public.conversations c where c.id = conv_id;
end;
$$;

revoke all on function public.delete_group(uuid) from public, anon;
grant execute on function public.delete_group(uuid) to authenticated;

-- Only RPCs may write system messages (group events); clients are
-- restricted to text/image so the type cannot be forged.
drop policy if exists "messages_sender_insert" on public.messages;
create policy "messages_sender_insert" on public.messages
  for insert to authenticated
  with check (
    auth.uid() = sender_id
    and public.is_conversation_participant(conversation_id)
    and not public.conversation_blocked(conversation_id)
    and message_type in ('text', 'image')
  );

-- System messages are trusted RPC output (group events), not user sends:
-- exempt them from the 30/min abuse guard so bulk member adds never trip it.
create or replace function public.enforce_message_rate()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.message_type = 'system' then
    return new;
  end if;
  if (
    select count(*) from public.messages
    where sender_id = new.sender_id
      and created_at > now() - interval '1 minute'
  ) >= 30 then
    raise exception 'Message rate limit exceeded. Please slow down.';
  end if;
  return new;
end;
$$;
