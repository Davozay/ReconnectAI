-- 0010: Make blocking mean something across shared content.
--
-- Before this migration, blocks stopped messages/requests/discovery but a
-- blocked user could still read your shared memories. Now:
-- * Shared memories (and their photos/likes, which inherit via RLS) are
--   hidden in BOTH directions for a blocked pair.
-- * A connected profile is hidden only from the user THE OWNER blocked
--   (directional), so the blocker's own thread view keeps working while
--   the blocked user sees nothing.
-- * Messaging keeps history readable but unsendable (enforced in 0007).

create or replace function public.blocked_with(other_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = auth.uid() and b.blocked_id = other_id)
       or (b.blocker_id = other_id and b.blocked_id = auth.uid())
  );
$$;

revoke all on function public.blocked_with(uuid) from public, anon;
grant execute on function public.blocked_with(uuid) to authenticated;

create or replace function public.blocked_by(other_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_blocks b
    where b.blocker_id = other_id and b.blocked_id = auth.uid()
  );
$$;

revoke all on function public.blocked_by(uuid) from public, anon;
grant execute on function public.blocked_by(uuid) to authenticated;

-- Shared memories: invisible between blocked pairs (either direction).
drop policy if exists "memories_shared_read" on public.memories;
create policy "memories_shared_read" on public.memories
  for select to authenticated
  using (
    shared = true
    and author_id <> auth.uid()
    and not public.blocked_with(author_id)
  );

-- Connected profiles: hidden from users the owner blocked. The discoverable
-- policy (0003) already excludes blocks in both directions.
drop policy if exists "profiles_connected_read" on public.profiles;
create policy "profiles_connected_read" on public.profiles
  for select to authenticated
  using (
    user_id <> auth.uid()
    and not public.blocked_by(profiles.user_id)
    and exists (
      select 1 from public.reconnection_requests r
      where r.status = 'accepted'
        and ((r.from_id = auth.uid() and r.to_id = profiles.user_id)
          or (r.from_id = profiles.user_id and r.to_id = auth.uid()))
    )
  );
