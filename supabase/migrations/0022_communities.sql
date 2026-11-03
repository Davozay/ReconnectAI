-- 0022: Public childhood communities with open membership.
--
-- Distinct from group chats (0017/0018), which are private creator-managed
-- conversations: communities are a public directory anyone signed in can
-- browse and join. The rail's "Childhood communities" card reads these rows.
-- * communities: public listing (name, description, art seed). Any
--   authenticated user may create one; only the creator may edit/delete it.
-- * community_memberships: open join/leave. The composite primary key
--   rejects duplicate memberships at the database level.
-- * Membership privacy: rows are visible only to the member themselves and
--   to fellow members of the same community. Outsiders learn nothing about
--   who joined — they get counts only, via community_member_counts().
-- * The creator is auto-enrolled by trigger so a new community never starts
--   in a creator-less state.

-- ---------------------------------------------------------------- communities
create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  image_seed text not null default '' check (char_length(image_seed) <= 64),
  created_by uuid null references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists communities_set_updated_at on public.communities;
create trigger communities_set_updated_at
  before update on public.communities
  for each row execute function public.set_updated_at();

create index if not exists communities_created_idx
  on public.communities (created_at desc);
create index if not exists communities_name_idx
  on public.communities (name);

-- ------------------------------------------------------- community_memberships
create table if not exists public.community_memberships (
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

create index if not exists community_memberships_user_idx
  on public.community_memberships (user_id);
create index if not exists community_memberships_community_idx
  on public.community_memberships (community_id);

-- Auto-enroll the creator (their own row always passes the RLS check below,
-- because the insert policy forces created_by = auth.uid()).
create or replace function public.enroll_community_creator()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is not null then
    insert into public.community_memberships (community_id, user_id)
    values (new.id, new.created_by)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists communities_enroll_creator on public.communities;
create trigger communities_enroll_creator
  after insert on public.communities
  for each row execute function public.enroll_community_creator();

-- ------------------------------------------------------------------ RLS: rows
alter table public.communities enable row level security;
alter table public.community_memberships enable row level security;

-- Public directory: every signed-in user can browse communities.
drop policy if exists "communities_public_read" on public.communities;
create policy "communities_public_read" on public.communities
  for select to authenticated
  using (true);

drop policy if exists "communities_creator_insert" on public.communities;
create policy "communities_creator_insert" on public.communities
  for insert to authenticated
  with check (auth.uid() = created_by);

drop policy if exists "communities_creator_update" on public.communities;
create policy "communities_creator_update" on public.communities
  for update to authenticated
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

drop policy if exists "communities_creator_delete" on public.communities;
create policy "communities_creator_delete" on public.communities
  for delete to authenticated
  using (auth.uid() = created_by);

-- Membership rows: your own rows, plus fellow members of communities you
-- belong to. (The EXISTS subquery only ever matches the caller's own row,
-- which the first branch already exposes, so this is not recursive.)
drop policy if exists "memberships_member_read" on public.community_memberships;
create policy "memberships_member_read" on public.community_memberships
  for select to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.community_memberships mine
      where mine.community_id = community_memberships.community_id
        and mine.user_id = auth.uid()
    )
  );

-- Open join: any signed-in user may insert their own row (the PK rejects
-- duplicates); any member may delete their own row to leave.
drop policy if exists "memberships_self_insert" on public.community_memberships;
create policy "memberships_self_insert" on public.community_memberships
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "memberships_self_delete" on public.community_memberships;
create policy "memberships_self_delete" on public.community_memberships
  for delete to authenticated
  using (auth.uid() = user_id);

-- ------------------------------------------------- RLS: counts without identity
-- Accurate member counts for outsiders (the directory and rail show these)
-- without revealing WHO joined. Members already see rows via the policy above.
create or replace function public.community_member_counts(ids uuid[])
returns table (community_id uuid, member_count bigint)
language sql stable security definer set search_path = public as $$
  select m.community_id, count(*)::bigint
  from public.community_memberships m
  where m.community_id = any (coalesce(ids, '{}'))
  group by m.community_id;
$$;

revoke all on function public.community_member_counts(uuid[]) from public, anon;
grant execute on function public.community_member_counts(uuid[]) to authenticated;
