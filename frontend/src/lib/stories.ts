/* Stories/status services for ReConnect AI (Supabase + Realtime).
   Stories are 24h photo updates visible to accepted connections and the
   author. Expiry is enforced by filtering expires_at in queries. */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { requireSupabase } from './supabase';
import { DbError } from './db';

export interface Story {
  id: string;
  author_id: string;
  media_path: string;
  caption: string;
  created_at: string;
  expires_at: string;
}

export interface StoryView {
  story_id: string;
  viewer_id: string;
  created_at: string;
}

export interface StoryLike {
  story_id: string;
  user_id: string;
  created_at: string;
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

function uniqueTopic(base: string): string {
  return `${base}:${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Live (unexpired) stories visible to the caller, newest first. */
export async function listLiveStories(): Promise<Story[]> {
  await currentUserId();
  const { data, error } = await requireSupabase()
    .from('stories')
    .select('*')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) throw toError(error, 'Could not load stories.');
  return (data as Story[]) ?? [];
}

export async function postStory(mediaPath: string, caption = ''): Promise<Story> {
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('stories')
    .insert({
      author_id: uid,
      media_path: mediaPath,
      caption: caption.trim().slice(0, 200),
    })
    .select()
    .single();
  if (error) throw toError(error, 'Could not share that story.');
  return data as Story;
}

/** Deletes a story row; returns it so the caller can remove the media too. */
export async function deleteStory(id: string): Promise<Story | null> {
  await currentUserId();
  const { data, error } = await requireSupabase()
    .from('stories')
    .delete()
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) throw toError(error, 'Could not delete that story.');
  return (data as Story | null) ?? null;
}

export async function markStoryViewed(storyId: string): Promise<void> {
  const uid = await currentUserId();
  const { error } = await requireSupabase()
    .from('story_views')
    .upsert({ story_id: storyId, viewer_id: uid }, { onConflict: 'story_id,viewer_id' });
  if (error) throw toError(error, 'Could not record that view.');
}

export async function listMyViewedIds(): Promise<Set<string>> {
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('story_views')
    .select('story_id')
    .eq('viewer_id', uid);
  if (error) throw toError(error, 'Could not load story views.');
  return new Set(((data as { story_id: string }[]) ?? []).map((r) => r.story_id));
}

/** Who viewed one story (story author only, enforced by RLS). */
export async function listStoryViews(storyId: string): Promise<StoryView[]> {
  await currentUserId();
  const { data, error } = await requireSupabase()
    .from('story_views')
    .select('*')
    .eq('story_id', storyId)
    .order('created_at', { ascending: true });
  if (error) throw toError(error, 'Could not load story views.');
  return (data as StoryView[]) ?? [];
}

export async function getStoryLikeCounts(storyIds: string[]): Promise<Record<string, number>> {
  if (storyIds.length === 0) return {};
  await currentUserId();
  const { data, error } = await requireSupabase()
    .from('story_likes')
    .select('story_id')
    .in('story_id', storyIds);
  if (error) throw toError(error, 'Could not load likes.');
  const counts: Record<string, number> = {};
  for (const row of ((data as { story_id: string }[]) ?? [])) {
    counts[row.story_id] = (counts[row.story_id] ?? 0) + 1;
  }
  return counts;
}

export async function getMyStoryLikedIds(storyIds: string[]): Promise<Set<string>> {
  if (storyIds.length === 0) return new Set();
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('story_likes')
    .select('story_id')
    .in('story_id', storyIds)
    .eq('user_id', uid);
  if (error) throw toError(error, 'Could not load likes.');
  return new Set(((data as { story_id: string }[]) ?? []).map((r) => r.story_id));
}

/** Who liked one story (anyone who can see the story, enforced by RLS). */
export async function listStoryLikes(storyId: string): Promise<StoryLike[]> {
  await currentUserId();
  const { data, error } = await requireSupabase()
    .from('story_likes')
    .select('*')
    .eq('story_id', storyId)
    .order('created_at', { ascending: true });
  if (error) throw toError(error, 'Could not load likes.');
  return (data as StoryLike[]) ?? [];
}

export async function toggleStoryLike(storyId: string): Promise<'liked' | 'unliked'> {
  const uid = await currentUserId();
  const db = requireSupabase();
  const { data: existing, error: readErr } = await db
    .from('story_likes')
    .select('story_id')
    .eq('story_id', storyId)
    .eq('user_id', uid)
    .maybeSingle();
  if (readErr) throw toError(readErr, 'Could not update that like.');
  if (existing) {
    const { error } = await db
      .from('story_likes')
      .delete()
      .eq('story_id', storyId)
      .eq('user_id', uid);
    if (error) throw toError(error, 'Could not update that like.');
    return 'unliked';
  }
  const { error } = await db
    .from('story_likes')
    .insert({ story_id: storyId, user_id: uid });
  if (error) throw toError(error, 'Could not update that like.');
  return 'liked';
}

/** Live story + view + like changes (RLS-scoped). Returns unsubscribe fn. */
export function subscribeToStories(onEvent: () => void): () => void {
  const channel: RealtimeChannel = requireSupabase().channel(uniqueTopic('stories'));
  channel
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'stories' },
      () => onEvent(),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'story_views' },
      () => onEvent(),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'story_likes' },
      () => onEvent(),
    )
    .subscribe();
  return () => {
    void requireSupabase().removeChannel(channel);
  };
}
