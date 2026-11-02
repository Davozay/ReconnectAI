-- 0019: Tolerant affiliation matching for groups.
--
-- 0017/0018 matched schools and places by exact spelling (case and
-- whitespace only), so everyday variations never matched:
-- "St. Mary's" vs "St Marys", or "Greenwood High" vs
-- "Greenwood High School". Group creators then saw an empty picker even
-- though the other person had "a similar school" on their profile.
--
-- Matching is now tolerant in two narrow ways (requires 0018 first):
-- * punctuation-insensitive: norm_affiliation() strips everything but
--   letters, digits, and spaces ("St. Mary's" -> "st marys").
-- * affix-tolerant: affiliations_match() also accepts containment —
--   either normalized name containing the other — when the shorter
--   side is at least 6 characters, so "Greenwood High" matches
--   "Greenwood High School" but "St" does not match everything.
--
-- The security model is unchanged: the caller must still list a matching
-- affiliation on their own profile, and mates stay hidden from everyone
-- else. Very different spellings ("UNILAG" vs "University of Lagos")
-- still do not match — the app tells users to share the exact name.
--
-- The 0017/0018 expression indexes on norm_affiliation() are dropped:
-- no query calls it directly anymore (matching goes through
-- affiliations_match()), and a replaced immutable function would leave
-- stale index entries.

drop index if exists public.childhood_schools_norm_idx;
drop index if exists public.childhood_locations_norm_idx;

create or replace function public.norm_affiliation(name text)
returns text
language sql immutable set search_path = public as $$
  select regexp_replace(
    regexp_replace(lower(trim(coalesce(name, ''))), '[^[:alnum:] ]+', '', 'g'),
    '\s+', ' ', 'g');
$$;

create or replace function public.affiliations_match(a text, b text)
returns boolean
language plpgsql immutable set search_path = public as $$
declare
  na text := public.norm_affiliation(a);
  nb text := public.norm_affiliation(b);
  shorter text;
  longer text;
begin
  if na = '' or nb = '' then
    return false;
  end if;
  if na = nb then
    return true;
  end if;
  if char_length(na) <= char_length(nb) then
    shorter := na;
    longer := nb;
  else
    shorter := nb;
    longer := na;
  end if;
  if char_length(shorter) < 6 then
    return false;
  end if;
  return position(shorter in longer) > 0;
end;
$$;

-- Same contract as 0018's affiliation_mates(), with tolerant matching.
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
        and public.affiliations_match(s.school_name, name)
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
          and public.affiliations_match(s.school_name, name)
      )
    order by p.display_name;
  else
    if not exists (
      select 1 from public.childhood_locations l
      where l.user_id = auth.uid()
        and public.affiliations_match(l.place_name, name)
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
          and public.affiliations_match(l.place_name, name)
      )
    order by p.display_name;
  end if;
end;
$$;

revoke all on function public.affiliation_mates(text, text) from public, anon;
grant execute on function public.affiliation_mates(text, text) to authenticated;

-- Same contract as 0018's create_group(), with tolerant matching.
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
          and public.affiliations_match(s.school_name, affiliation_name)
      ) then
      raise exception 'Add % to your profile first.', trim(affiliation_name);
    end if;
    if affiliation_type = 'place'
      and not exists (
        select 1 from public.childhood_locations l
        where l.user_id = auth.uid()
          and public.affiliations_match(l.place_name, affiliation_name)
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

-- Same contract as 0018's add_group_member(), with tolerant matching.
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
        and public.affiliations_match(s.school_name, conv.affiliation_name)
    ) then
      raise exception 'They have not listed % on their profile yet.', conv.affiliation_name;
    end if;
  else
    if not exists (
      select 1 from public.childhood_locations l
      where l.user_id = target_id
        and public.affiliations_match(l.place_name, conv.affiliation_name)
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

-- Verify after applying (expected results in comments):
-- select public.affiliations_match('St. Mary''s', 'St Marys'); -- true
-- select public.affiliations_match('Greenwood High', 'Greenwood High School'); -- true
-- select public.affiliations_match('Riverside', 'Riverside Estate'); -- true
-- select public.affiliations_match('Greenwood High', 'Riverside High'); -- false
-- select public.affiliations_match('St', 'St Marys School'); -- false (shorter < 6)
-- select public.affiliations_match('UNILAG', 'University of Lagos'); -- false
