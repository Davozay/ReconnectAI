-- 0018: Group flavors — school, place, and free crews.
--
-- 0017's school-only model was too narrow: people also gather around
-- estates/neighborhoods, past jobs, and childhood crews. Groups now come
-- in three flavors (requires 0017 first):
-- * school / place ("affiliation" groups): verified membership — every
--   member must list that school or place on their profile, exactly as
--   0017 enforced for schools. The picker shows mutual matches only.
-- * free crews (no affiliation): any circle with a custom name. Members
--   must be the creator's accepted connections (no strangers).
-- schoolmates()/create_school_group() are replaced by the flavor-aware
-- affiliation_mates()/create_group(). remove/leave/rename/delete are
-- flavor-agnostic and unchanged.

alter table public.conversations rename column school_name to affiliation_name;

alter table public.conversations
  add column if not exists affiliation_type text null;

-- Backfill groups created under 0017 (all school groups) before the
-- stricter shape check below, or existing rows would violate it.
update public.conversations
set affiliation_type = 'school'
where kind = 'group'
  and affiliation_type is null
  and affiliation_name is not null;

alter table public.conversations drop constraint if exists conversations_group_shape_check;
alter table public.conversations add constraint conversations_group_shape_check
  check (
    (kind = 'direct' and affiliation_type is null and affiliation_name is null and created_by is null)
    or (kind = 'group' and created_by is not null
      and ((affiliation_type is null) = (affiliation_name is null))
      and (affiliation_type is null or affiliation_type in ('school', 'place')))
  );

alter table public.conversations drop constraint if exists conversations_school_len_check;
alter table public.conversations drop constraint if exists conversations_affiliation_len_check;
alter table public.conversations add constraint conversations_affiliation_len_check
  check (affiliation_name is null or char_length(affiliation_name) <= 160);

alter function public.norm_school(text) rename to norm_affiliation;

create index if not exists childhood_locations_norm_idx
  on public.childhood_locations ((public.norm_affiliation(place_name)));

drop function if exists public.schoolmates(text);

create or replace function public.affiliation_mates(kind text, name text)
returns table (user_id uuid, display_name text, avatar_storage_path text)
language plpgsql stable security definer set search_path = public as $$
begin
  if kind is null or kind not in ('school', 'place') or name is null or trim(name) = '' then
    raise exception 'Group unavailable.';
  end if;
  if kind = 'school' then
    if not exists (
      select 1 from public.childhood_schools s
      where s.user_id = auth.uid()
        and public.norm_affiliation(s.school_name) = public.norm_affiliation(name)
    ) then
      raise exception 'Group unavailable.';
    end if;
    return query
    select p.user_id, p.display_name, p.avatar_storage_path
    from public.profiles p
    where p.user_id <> auth.uid()
      and not public.blocked_with(p.user_id)
      and exists (
        select 1 from public.childhood_schools s
        where s.user_id = p.user_id
          and public.norm_affiliation(s.school_name) = public.norm_affiliation(name)
      )
    order by p.display_name;
  else
    if not exists (
      select 1 from public.childhood_locations l
      where l.user_id = auth.uid()
        and public.norm_affiliation(l.place_name) = public.norm_affiliation(name)
    ) then
      raise exception 'Group unavailable.';
    end if;
    return query
    select p.user_id, p.display_name, p.avatar_storage_path
    from public.profiles p
    where p.user_id <> auth.uid()
      and not public.blocked_with(p.user_id)
      and exists (
        select 1 from public.childhood_locations l
        where l.user_id = p.user_id
          and public.norm_affiliation(l.place_name) = public.norm_affiliation(name)
      )
    order by p.display_name;
  end if;
end;
$$;

revoke all on function public.affiliation_mates(text, text) from public, anon;
grant execute on function public.affiliation_mates(text, text) to authenticated;

drop function if exists public.create_school_group(text, text);

create or replace function public.create_group(
  affiliation_type text,
  affiliation_name text,
  title text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  conv_id uuid;
  display_name text;
  group_title text;
  who text;
begin
  if affiliation_type is null and affiliation_name is null then
    if title is null or trim(title) = '' then
      raise exception 'Give your group a name.';
    end if;
    group_title := substring(trim(title) from 1 for 80);
    insert into public.conversations (kind, title, created_by)
    values ('group', group_title, auth.uid())
    returning id into conv_id;
  else
    if affiliation_type is null or affiliation_type not in ('school', 'place')
      or affiliation_name is null or trim(affiliation_name) = '' then
      raise exception 'Group unavailable.';
    end if;
    if affiliation_type = 'school'
      and not exists (
        select 1 from public.childhood_schools s
        where s.user_id = auth.uid()
          and public.norm_affiliation(s.school_name) = public.norm_affiliation(affiliation_name)
      ) then
      raise exception 'Add % to your profile first.', trim(affiliation_name);
    end if;
    if affiliation_type = 'place'
      and not exists (
        select 1 from public.childhood_locations l
        where l.user_id = auth.uid()
          and public.norm_affiliation(l.place_name) = public.norm_affiliation(affiliation_name)
      ) then
      raise exception 'Add % to your profile first.', trim(affiliation_name);
    end if;
    display_name := substring(trim(affiliation_name) from 1 for 160);
    group_title := substring(coalesce(nullif(trim(title), ''), display_name) from 1 for 80);
    insert into public.conversations (kind, affiliation_type, affiliation_name, title, created_by)
    values ('group', affiliation_type, display_name, group_title, auth.uid())
    returning id into conv_id;
  end if;

  insert into public.conversation_participants (conversation_id, user_id)
  values (conv_id, auth.uid());

  select coalesce(p.display_name, 'Someone') into who
  from public.profiles p where p.user_id = auth.uid();
  insert into public.messages (conversation_id, sender_id, content, message_type)
  values (conv_id, auth.uid(), who || ' created this group', 'system');
  return conv_id;
end;
$$;

revoke all on function public.create_group(text, text, text) from public, anon;
grant execute on function public.create_group(text, text, text) to authenticated;

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
  if conv.affiliation_type is null then
    if not exists (
      select 1 from public.reconnection_requests r
      where r.status = 'accepted'
        and ((r.from_id = auth.uid() and r.to_id = target_id)
          or (r.from_id = target_id and r.to_id = auth.uid()))
    ) then
      raise exception 'Connect with them first — free groups are for your connections.';
    end if;
  elsif conv.affiliation_type = 'school' then
    if not exists (
      select 1 from public.childhood_schools s
      where s.user_id = target_id
        and public.norm_affiliation(s.school_name) = public.norm_affiliation(conv.affiliation_name)
    ) then
      raise exception 'They have not listed % on their profile yet.', conv.affiliation_name;
    end if;
  else
    if not exists (
      select 1 from public.childhood_locations l
      where l.user_id = target_id
        and public.norm_affiliation(l.place_name) = public.norm_affiliation(conv.affiliation_name)
    ) then
      raise exception 'They have not listed % on their profile yet.', conv.affiliation_name;
    end if;
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
