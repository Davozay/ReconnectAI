-- 0007: Messaging RLS, secure helpers, conversation RPC, rate limiting.
--
-- Enforcement model (no security by frontend):
-- * Conversations/participants can ONLY be written by the
--   get_or_create_conversation() RPC: accepted reconnection required, blocks
--   checked both ways, duplicates returned instead of recreated.
-- * Messages: participants read; senders send as themselves only; blocked
--   pairs cannot send; senders edit/delete (soft) only their own rows.
-- * Helpers are SECURITY DEFINER with fixed search_path and execute granted
--   to authenticated only, so policies never recurse.

-- ------------------------------------------------- participant + block helpers
create or replace function public.is_conversation_participant(conv_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_participants p
    where p.conversation_id = conv_id and p.user_id = auth.uid()
  );
$$;

revoke all on function public.is_conversation_participant(uuid) from public, anon;
grant execute on function public.is_conversation_participant(uuid) to authenticated;

-- True when the caller and any other participant of the conversation have a
-- block between them in either direction. Reads blocks as the owner because
-- user_blocks RLS hides "blocked BY someone" rows from the blocked user.
create or replace function public.conversation_blocked(conv_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.conversation_participants me
    join public.conversation_participants peer
      on peer.conversation_id = me.conversation_id
     and peer.user_id <> me.user_id
    join public.user_blocks b
      on (b.blocker_id = me.user_id and b.blocked_id = peer.user_id)
      or (b.blocker_id = peer.user_id and b.blocked_id = me.user_id)
    where me.conversation_id = conv_id
      and me.user_id = auth.uid()
  );
$$;

revoke all on function public.conversation_blocked(uuid) from public, anon;
grant execute on function public.conversation_blocked(uuid) to authenticated;

-- ------------------------------------------------------------ conversations
alter table public.conversations enable row level security;

drop policy if exists "conversations_participant_read" on public.conversations;
create policy "conversations_participant_read" on public.conversations
  for select to authenticated
  using (public.is_conversation_participant(id));

-- No insert/update/delete policies: only the RPC (and its triggers) write.

-- ------------------------------------------------- conversation_participants
alter table public.conversation_participants enable row level security;

drop policy if exists "participants_self_read" on public.conversation_participants;
create policy "participants_self_read" on public.conversation_participants
  for select to authenticated
  using (public.is_conversation_participant(conversation_id));

-- No write policies: membership changes only through the RPC.

-- ----------------------------------------------------------------- messages
alter table public.messages enable row level security;

drop policy if exists "messages_participant_read" on public.messages;
create policy "messages_participant_read" on public.messages
  for select to authenticated
  using (public.is_conversation_participant(conversation_id));

drop policy if exists "messages_sender_insert" on public.messages;
create policy "messages_sender_insert" on public.messages
  for insert to authenticated
  with check (
    auth.uid() = sender_id
    and public.is_conversation_participant(conversation_id)
    and not public.conversation_blocked(conversation_id)
  );

-- Senders edit or soft-delete only their own messages.
drop policy if exists "messages_sender_update" on public.messages;
create policy "messages_sender_update" on public.messages
  for update to authenticated
  using (
    auth.uid() = sender_id
    and public.is_conversation_participant(conversation_id)
  )
  with check (
    auth.uid() = sender_id
    and public.is_conversation_participant(conversation_id)
  );

-- No delete policy: hard deletes are denied; deletion is soft (deleted_at).

-- -------------------------------------------------------- message_reactions
alter table public.message_reactions enable row level security;

drop policy if exists "reactions_participant_read" on public.message_reactions;
create policy "reactions_participant_read" on public.message_reactions
  for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_reactions.message_id
        and public.is_conversation_participant(m.conversation_id)
    )
  );

drop policy if exists "reactions_sender_insert" on public.message_reactions;
create policy "reactions_sender_insert" on public.message_reactions
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.messages m
      where m.id = message_reactions.message_id
        and public.is_conversation_participant(m.conversation_id)
        and not public.conversation_blocked(m.conversation_id)
    )
  );

drop policy if exists "reactions_owner_delete" on public.message_reactions;
create policy "reactions_owner_delete" on public.message_reactions
  for delete to authenticated
  using (auth.uid() = user_id);

-- ------------------------------------------------------------ message_reads
alter table public.message_reads enable row level security;

-- Participants see each other's read state (read receipts).
drop policy if exists "reads_participant_read" on public.message_reads;
create policy "reads_participant_read" on public.message_reads
  for select to authenticated
  using (public.is_conversation_participant(conversation_id));

drop policy if exists "reads_owner_insert" on public.message_reads;
create policy "reads_owner_insert" on public.message_reads
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and public.is_conversation_participant(conversation_id)
  );

drop policy if exists "reads_owner_update" on public.message_reads;
create policy "reads_owner_update" on public.message_reads
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and public.is_conversation_participant(conversation_id)
  );

-- ------------------------------------------- conversation creation (RPC only)
create or replace function public.get_or_create_conversation(peer_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  conv_id uuid;
  lo text;
  hi text;
begin
  if peer_id is null or peer_id = auth.uid() then
    raise exception 'Conversation unavailable.';
  end if;
  -- Serialize per pair so two simultaneous calls cannot create duplicates.
  lo := least(auth.uid()::text, peer_id::text);
  hi := greatest(auth.uid()::text, peer_id::text);
  perform pg_advisory_xact_lock(hashtext(lo), hashtext(hi));

  -- Conversations must originate from an accepted reconnection request.
  if not exists (
    select 1 from public.reconnection_requests r
    where r.status = 'accepted'
      and ((r.from_id = auth.uid() and r.to_id = peer_id)
        or (r.from_id = peer_id and r.to_id = auth.uid()))
  ) then
    raise exception 'Conversation unavailable.';
  end if;

  -- Blocks cut contact in both directions (generic message: no existence leak).
  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = auth.uid() and b.blocked_id = peer_id)
       or (b.blocker_id = peer_id and b.blocked_id = auth.uid())
  ) then
    raise exception 'Conversation unavailable.';
  end if;

  -- Return the existing 1:1 conversation instead of duplicating it.
  select c.id into conv_id
  from public.conversations c
  where exists (
      select 1 from public.conversation_participants p
      where p.conversation_id = c.id and p.user_id = auth.uid()
    )
    and exists (
      select 1 from public.conversation_participants p
      where p.conversation_id = c.id and p.user_id = peer_id
    )
    and not exists (
      select 1 from public.conversation_participants p
      where p.conversation_id = c.id and p.user_id not in (auth.uid(), peer_id)
    )
  limit 1;
  if conv_id is not null then
    return conv_id;
  end if;

  insert into public.conversations default values returning id into conv_id;
  insert into public.conversation_participants (conversation_id, user_id)
  values (conv_id, auth.uid()), (conv_id, peer_id);
  return conv_id;
end;
$$;

revoke all on function public.get_or_create_conversation(uuid) from public, anon;
grant execute on function public.get_or_create_conversation(uuid) to authenticated;

-- -------------------------------------------------- message triggers (trusted)
-- Keep the conversation preview timestamp fresh (definer: writers cannot
-- update conversations directly by policy).
create or replace function public.touch_conversation_on_message()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.conversations
  set last_message_at = new.created_at, updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation_on_message();

-- Abuse guard: 30 messages per sender per rolling minute (adjustable).
create or replace function public.enforce_message_rate()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
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

drop trigger if exists messages_rate_limit on public.messages;
create trigger messages_rate_limit
  before insert on public.messages
  for each row execute function public.enforce_message_rate();
