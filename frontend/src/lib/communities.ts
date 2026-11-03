/* Public childhood-community services for ReConnect AI (migration 0022).
   Communities are an open directory: anyone signed in can browse, join, and
   leave. Membership rows stay private — outsiders see counts only, via the
   community_member_counts() RPC — while members see fellow members. */

import { requireSupabase } from './supabase';
import { DbError } from './db';
import type { Memory } from './db';

export interface Community {
  id: string;
  name: string;
  description: string;
  image_seed: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommunityMembership {
  community_id: string;
  user_id: string;
  joined_at: string;
}

function toError(err: unknown, fallback: string): DbError {
  if (err && typeof err === 'object' && 'message' in err) {
    const e = err as { message: string; code?: string };
    return new DbError(e.message || fallback, e.code);
  }
  return new DbError(fallback);
}

async function currentUserId(): Promise<string> {
  const { data, error } = await requireSupabase().auth.getUser();
  if (error || !data.user) throw new DbError('You must be signed in.');
  return data.user.id;
}

/** All communities, newest first. */
export async function listCommunities(limit = 50): Promise<Community[]> {
  await currentUserId();
  const { data, error } = await requireSupabase()
    .from('communities')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw toError(error, 'Could not load communities.');
  return (data as Community[]) ?? [];
}

export async function getCommunity(id: string): Promise<Community | null> {
  await currentUserId();
  const { data, error } = await requireSupabase()
    .from('communities')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw toError(error, 'Could not load that community.');
  return (data as Community | null) ?? null;
}

export async function createCommunity(input: {
  name: string;
  description?: string;
}): Promise<Community> {
  const uid = await currentUserId();
  const name = input.name.trim();
  if (!name) throw new DbError('Give your community a name.');
  if (name.length > 80) throw new DbError('Names are limited to 80 characters.');
  const description = (input.description ?? '').trim().slice(0, 500);
  const { data, error } = await requireSupabase()
    .from('communities')
    .insert({
      name,
      description,
      image_seed: name.toLowerCase().slice(0, 64),
      created_by: uid,
    })
    .select()
    .single();
  if (error) throw toError(error, 'Could not create that community.');
  return data as Community;
}

/** Idempotent join — re-joining an existing membership is a no-op. */
export async function joinCommunity(communityId: string): Promise<void> {
  const uid = await currentUserId();
  const { error } = await requireSupabase().from('community_memberships').upsert(
    { community_id: communityId, user_id: uid },
    { onConflict: 'community_id,user_id', ignoreDuplicates: true },
  );
  if (error) throw toError(error, 'Could not join that community.');
}

export async function leaveCommunity(communityId: string): Promise<void> {
  const uid = await currentUserId();
  const { error } = await requireSupabase()
    .from('community_memberships')
    .delete()
    .eq('community_id', communityId)
    .eq('user_id', uid);
  if (error) throw toError(error, 'Could not leave that community.');
}

/** IDs of the communities the caller belongs to. */
export async function listMyCommunityIds(communityIds: string[]): Promise<Set<string>> {
  if (communityIds.length === 0) return new Set();
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('community_memberships')
    .select('community_id')
    .in('community_id', communityIds)
    .eq('user_id', uid);
  if (error) throw toError(error, 'Could not load your memberships.');
  return new Set(((data as { community_id: string }[]) ?? []).map((r) => r.community_id));
}

/** Accurate member counts without exposing who joined (RLS-safe for outsiders). */
export async function getMemberCounts(
  communityIds: string[],
): Promise<Record<string, number>> {
  if (communityIds.length === 0) return {};
  await currentUserId();
  const { data, error } = await requireSupabase().rpc('community_member_counts', {
    ids: communityIds,
  });
  if (error) throw toError(error, 'Could not load member counts.');
  const counts: Record<string, number> = {};
  for (const row of ((data as { community_id: string; member_count: number }[]) ?? [])) {
    counts[row.community_id] = row.member_count;
  }
  return counts;
}

/** Membership rows for one community — visible only to its members. */
export async function listCommunityMembers(
  communityId: string,
): Promise<CommunityMembership[]> {
  await currentUserId();
  const { data, error } = await requireSupabase()
    .from('community_memberships')
    .select('*')
    .eq('community_id', communityId)
    .order('joined_at', { ascending: true });
  if (error) throw toError(error, 'Could not load community members.');
  return (data as CommunityMembership[]) ?? [];
}

/** Shared memories authored by the given users, newest first (RLS-filtered). */
export async function listMemberMemories(
  authorIds: string[],
  limit = 10,
): Promise<Memory[]> {
  if (authorIds.length === 0) return [];
  await currentUserId();
  const { data, error } = await requireSupabase()
    .from('memories')
    .select('*')
    .eq('shared', true)
    .in('author_id', authorIds)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw toError(error, 'Could not load community memories.');
  return (data as Memory[]) ?? [];
}

export function formatMemberCount(count: number): string {
  return count === 1 ? '1 member' : `${count.toLocaleString()} members`;
}
