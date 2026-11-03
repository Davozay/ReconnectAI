/* Supabase database services for ReConnect AI.
   Every function derives ownership from the current auth session — callers
   never pass user IDs, and RLS enforces the same rules server-side. */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { requireSupabase } from './supabase';

/* ---------- types ---------- */

export interface Profile {
  user_id: string;
  display_name: string;
  bio: string;
  hometown: string;
  nickname: string;
  avatar_storage_path: string;
  cover_storage_path: string;
  discoverable: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChildhoodSchool {
  id: string;
  user_id: string;
  school_name: string;
  years_label: string;
  start_year: number | null;
  end_year: number | null;
  created_at: string;
}

export interface ChildhoodLocation {
  id: string;
  user_id: string;
  place_name: string;
  years_label: string;
  note: string;
  created_at: string;
}

export interface Memory {
  id: string;
  author_id: string;
  title: string;
  body: string;
  shared: boolean;
  analysis: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryPhoto {
  id: string;
  memory_id: string;
  owner_id: string;
  storage_path: string;
  content_type: string;
  bytes: number;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface MemoryComment {
  id: string;
  memory_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

export interface ReconnectionRequest {
  id: string;
  from_id: string;
  to_id: string;
  message: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  created_at: string;
  updated_at: string;
}

export interface UserReport {
  id: string;
  reporter_id: string;
  target_type: 'user' | 'message' | 'photo' | 'post';
  target_id: string;
  category:
    | 'impersonation'
    | 'scam'
    | 'harassment'
    | 'suspicious_message'
    | 'unauthorized_photo';
  details: string;
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed';
  created_at: string;
  updated_at: string;
}

export class DbError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
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

/* ---------- profiles ---------- */

export async function getMyProfile(): Promise<Profile | null> {
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('profiles')
    .select('*')
    .eq('user_id', uid)
    .maybeSingle();
  if (error) throw toError(error, 'Could not load your profile.');
  return (data as Profile | null) ?? null;
}

export async function upsertMyProfile(patch: {
  display_name: string;
  bio?: string;
  hometown?: string;
  nickname?: string;
  avatar_storage_path?: string;
  cover_storage_path?: string;
  discoverable?: boolean;
}): Promise<Profile> {
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('profiles')
    .upsert({ user_id: uid, ...patch }, { onConflict: 'user_id' })
    .select()
    .single();
  if (error) throw toError(error, 'Could not save your profile.');
  return data as Profile;
}

/** Profiles by id (RLS decides visibility: discoverable, connected, or a pending/declined request counterparty). */
export async function getProfilesByIds(ids: string[]): Promise<Profile[]> {
  if (ids.length === 0) return [];
  await currentUserId();
  const { data, error } = await requireSupabase()
    .from('profiles')
    .select('*')
    .in('user_id', ids);
  if (error) throw toError(error, 'Could not load profiles.');
  return (data as Profile[]) ?? [];
}

/** True when the error means a table is missing (migrations not applied). */
export function isMissingTable(err: unknown): boolean {
  return (
    err instanceof DbError &&
    (err.code === '42P01' || /does not exist|relation/i.test(err.message))
  );
}

export async function getDiscoverableProfiles(limit = 30): Promise<Profile[]> {
  await currentUserId();
  const { data, error } = await requireSupabase()
    .from('profiles')
    .select('*')
    .eq('discoverable', true)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw toError(error, 'Could not load discovery results.');
  return (data as Profile[]) ?? [];
}

/* ---------- childhood schools ---------- */

export async function listMySchools(): Promise<ChildhoodSchool[]> {
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('childhood_schools')
    .select('*')
    .eq('user_id', uid)
    .order('created_at', { ascending: true });
  if (error) throw toError(error, 'Could not load your schools.');
  return (data as ChildhoodSchool[]) ?? [];
}

export async function addSchool(input: {
  school_name: string;
  years_label?: string;
  start_year?: number | null;
  end_year?: number | null;
}): Promise<ChildhoodSchool> {
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('childhood_schools')
    .insert({
      user_id: uid,
      school_name: input.school_name.trim(),
      years_label: input.years_label?.trim() ?? '',
      start_year: input.start_year ?? null,
      end_year: input.end_year ?? null,
    })
    .select()
    .single();
  if (error) throw toError(error, 'Could not add that school.');
  return data as ChildhoodSchool;
}

export async function deleteSchool(id: string): Promise<void> {
  const uid = await currentUserId();
  const { error } = await requireSupabase()
    .from('childhood_schools')
    .delete()
    .eq('id', id)
    .eq('user_id', uid);
  if (error) throw toError(error, 'Could not delete that school.');
}

/* ---------- childhood locations ---------- */

export async function listMyLocations(): Promise<ChildhoodLocation[]> {
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('childhood_locations')
    .select('*')
    .eq('user_id', uid)
    .order('created_at', { ascending: true });
  if (error) throw toError(error, 'Could not load your places.');
  return (data as ChildhoodLocation[]) ?? [];
}

export async function addLocation(input: {
  place_name: string;
  years_label?: string;
  note?: string;
}): Promise<ChildhoodLocation> {
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('childhood_locations')
    .insert({
      user_id: uid,
      place_name: input.place_name.trim(),
      years_label: input.years_label?.trim() ?? '',
      note: input.note?.trim() ?? '',
    })
    .select()
    .single();
  if (error) throw toError(error, 'Could not add that place.');
  return data as ChildhoodLocation;
}

export async function deleteLocation(id: string): Promise<void> {
  const uid = await currentUserId();
  const { error } = await requireSupabase()
    .from('childhood_locations')
    .delete()
    .eq('id', id)
    .eq('user_id', uid);
  if (error) throw toError(error, 'Could not delete that place.');
}

/* ---------- memories ---------- */

export async function listMyMemories(): Promise<Memory[]> {
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('memories')
    .select('*')
    .eq('author_id', uid)
    .order('created_at', { ascending: false });
  if (error) throw toError(error, 'Could not load your memories.');
  return (data as Memory[]) ?? [];
}

/** Community feed: memories other users explicitly shared. */
export async function listSharedMemories(limit = 30): Promise<Memory[]> {
  await currentUserId();
  const { data, error } = await requireSupabase()
    .from('memories')
    .select('*')
    .eq('shared', true)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw toError(error, 'Could not load the community feed.');
  return (data as Memory[]) ?? [];
}

export async function createMemory(input: {
  title?: string;
  body: string;
  shared?: boolean;
  analysis?: Record<string, unknown> | null;
}): Promise<Memory> {
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('memories')
    .insert({
      author_id: uid,
      title: input.title?.trim() ?? '',
      body: input.body.trim(),
      shared: input.shared ?? false,
      analysis: input.analysis ?? null,
    })
    .select()
    .single();
  if (error) throw toError(error, 'Could not save that memory.');
  return data as Memory;
}

export async function updateMemory(
  id: string,
  patch: { title?: string; body?: string; shared?: boolean },
): Promise<Memory> {
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('memories')
    .update(patch)
    .eq('id', id)
    .eq('author_id', uid)
    .select()
    .single();
  if (error) throw toError(error, 'Could not update that memory.');
  return data as Memory;
}

export async function deleteMemory(id: string): Promise<void> {
  const uid = await currentUserId();
  const { error } = await requireSupabase()
    .from('memories')
    .delete()
    .eq('id', id)
    .eq('author_id', uid);
  if (error) throw toError(error, 'Could not delete that memory.');
}

/* ---------- memory photos (metadata rows) ---------- */

export async function listMemoryPhotos(memoryId: string): Promise<MemoryPhoto[]> {
  await currentUserId();
  const { data, error } = await requireSupabase()
    .from('memory_photos')
    .select('*')
    .eq('memory_id', memoryId)
    .order('created_at', { ascending: true });
  if (error) throw toError(error, 'Could not load memory photos.');
  return (data as MemoryPhoto[]) ?? [];
}

export async function addMemoryPhoto(input: {
  memory_id: string;
  storage_path: string;
  content_type: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
}): Promise<MemoryPhoto> {
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('memory_photos')
    .insert({ owner_id: uid, ...input })
    .select()
    .single();
  if (error) throw toError(error, 'Could not attach that photo.');
  return data as MemoryPhoto;
}

export async function deleteMemoryPhoto(id: string): Promise<MemoryPhoto | null> {
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('memory_photos')
    .delete()
    .eq('id', id)
    .eq('owner_id', uid)
    .select()
    .maybeSingle();
  if (error) throw toError(error, 'Could not delete that photo.');
  return (data as MemoryPhoto | null) ?? null;
}

/* ---------- reconnection requests ---------- */

export async function listMyRequests(): Promise<{
  incoming: ReconnectionRequest[];
  outgoing: ReconnectionRequest[];
  connected: ReconnectionRequest[];
  declined: ReconnectionRequest[];
}> {
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('reconnection_requests')
    .select('*')
    .or(`from_id.eq.${uid},to_id.eq.${uid}`)
    .order('created_at', { ascending: false });
  if (error) throw toError(error, 'Could not load connection requests.');
  const rows = (data as ReconnectionRequest[]) ?? [];
  return {
    incoming: rows.filter((r) => r.to_id === uid && r.status === 'pending'),
    outgoing: rows.filter((r) => r.from_id === uid),
    connected: rows.filter((r) => r.status === 'accepted'),
    declined: rows.filter((r) => r.status === 'declined'),
  };
}

/** The accepted reconnection with a peer, if any (either direction). */
export async function getConnectionWith(peerId: string): Promise<ReconnectionRequest | null> {
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('reconnection_requests')
    .select('*')
    .eq('status', 'accepted')
    .or(`and(from_id.eq.${uid},to_id.eq.${peerId}),and(from_id.eq.${peerId},to_id.eq.${uid})`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw toError(error, 'Could not load connection info.');
  return (data as ReconnectionRequest | null) ?? null;
}

export async function sendRequest(toId: string, message = ''): Promise<ReconnectionRequest> {
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('reconnection_requests')
    .insert({ from_id: uid, to_id: toId, message: message.trim() })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') {
      throw new DbError('A request is already pending.', error.code);
    }
    throw toError(error, 'Could not send that request.');
  }
  return data as ReconnectionRequest;
}

async function setRequestStatus(
  id: string,
  status: ReconnectionRequest['status'],
): Promise<ReconnectionRequest> {
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('reconnection_requests')
    .update({ status })
    .eq('id', id)
    .or(`from_id.eq.${uid},to_id.eq.${uid}`)
    .select()
    .single();
  if (error) throw toError(error, 'Could not update that request.');
  return data as ReconnectionRequest;
}

export const acceptRequest = (id: string) => setRequestStatus(id, 'accepted');
export const declineRequest = (id: string) => setRequestStatus(id, 'declined');
export const cancelRequest = (id: string) => setRequestStatus(id, 'cancelled');

/* ---------- blocks ---------- */

export async function listMyBlocks(): Promise<string[]> {
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('user_blocks')
    .select('blocked_id')
    .eq('blocker_id', uid);
  if (error) throw toError(error, 'Could not load your block list.');
  return ((data as { blocked_id: string }[]) ?? []).map((r) => r.blocked_id);
}

export async function blockUser(targetId: string): Promise<void> {
  const uid = await currentUserId();
  const { error } = await requireSupabase()
    .from('user_blocks')
    .upsert({ blocker_id: uid, blocked_id: targetId }, { onConflict: 'blocker_id,blocked_id' });
  if (error) throw toError(error, 'Could not block that user.');
  // Cancel any pending request between the pair.
  await requireSupabase()
    .from('reconnection_requests')
    .update({ status: 'cancelled' })
    .eq('status', 'pending')
    .or(
      `and(from_id.eq.${uid},to_id.eq.${targetId}),and(from_id.eq.${targetId},to_id.eq.${uid})`,
    );
}

export async function unblockUser(targetId: string): Promise<void> {
  const uid = await currentUserId();
  const { error } = await requireSupabase()
    .from('user_blocks')
    .delete()
    .eq('blocker_id', uid)
    .eq('blocked_id', targetId);
  if (error) throw toError(error, 'Could not unblock that user.');
}

/* ---------- reports ---------- */

export async function createReport(input: {
  target_type: UserReport['target_type'];
  target_id: string;
  category: UserReport['category'];
  details?: string;
}): Promise<UserReport> {
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('user_reports')
    .insert({
      reporter_id: uid,
      target_type: input.target_type,
      target_id: input.target_id,
      category: input.category,
      details: input.details?.trim() ?? '',
    })
    .select()
    .single();
  if (error) throw toError(error, 'Could not file that report.');
  return data as UserReport;
}

export async function listMyReports(): Promise<UserReport[]> {
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('user_reports')
    .select('*')
    .eq('reporter_id', uid)
    .order('created_at', { ascending: false });
  if (error) throw toError(error, 'Could not load your reports.');
  return (data as UserReport[]) ?? [];
}

/* ---------- moderation ---------- */

export async function isModerator(): Promise<boolean> {
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('moderators')
    .select('user_id')
    .eq('user_id', uid)
    .maybeSingle();
  if (error) throw toError(error, 'Could not verify moderator status.');
  return data != null;
}

export async function listAllReports(
  status?: UserReport['status'] | 'all',
): Promise<UserReport[]> {
  await currentUserId();
  let q = requireSupabase()
    .from('user_reports')
    .select('*')
    .order('created_at', { ascending: false });
  if (status && status !== 'all') q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw toError(error, 'Could not load reports.');
  return (data as UserReport[]) ?? [];
}

export async function updateReportStatus(
  id: string,
  status: UserReport['status'],
): Promise<void> {
  await currentUserId();
  const { error } = await requireSupabase()
    .from('user_reports')
    .update({ status })
    .eq('id', id);
  if (error) throw toError(error, 'Could not update that report.');
}

/* ---------- memory likes ---------- */

export async function getLikeCounts(memoryIds: string[]): Promise<Record<string, number>> {
  if (memoryIds.length === 0) return {};
  await currentUserId();
  const { data, error } = await requireSupabase()
    .from('memory_likes')
    .select('memory_id')
    .in('memory_id', memoryIds);
  if (error) throw toError(error, 'Could not load likes.');
  const counts: Record<string, number> = {};
  for (const row of ((data as { memory_id: string }[]) ?? [])) {
    counts[row.memory_id] = (counts[row.memory_id] ?? 0) + 1;
  }
  return counts;
}

export async function getMyLikedIds(memoryIds: string[]): Promise<Set<string>> {
  if (memoryIds.length === 0) return new Set();
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('memory_likes')
    .select('memory_id')
    .in('memory_id', memoryIds)
    .eq('user_id', uid);
  if (error) throw toError(error, 'Could not load likes.');
  return new Set(((data as { memory_id: string }[]) ?? []).map((r) => r.memory_id));
}

export async function toggleMemoryLike(memoryId: string): Promise<'liked' | 'unliked'> {
  const uid = await currentUserId();
  const db = requireSupabase();
  const { data: existing, error: readErr } = await db
    .from('memory_likes')
    .select('memory_id')
    .eq('memory_id', memoryId)
    .eq('user_id', uid)
    .maybeSingle();
  if (readErr) throw toError(readErr, 'Could not update that like.');
  if (existing) {
    const { error } = await db
      .from('memory_likes')
      .delete()
      .eq('memory_id', memoryId)
      .eq('user_id', uid);
    if (error) throw toError(error, 'Could not update that like.');
    return 'unliked';
  }
  const { error } = await db
    .from('memory_likes')
    .insert({ memory_id: memoryId, user_id: uid });
  if (error) throw toError(error, 'Could not update that like.');
  return 'liked';
}

/* ---------- memory comments ---------- */

export async function listComments(memoryId: string): Promise<MemoryComment[]> {
  await currentUserId();
  const { data, error } = await requireSupabase()
    .from('memory_comments')
    .select('*')
    .eq('memory_id', memoryId)
    .order('created_at', { ascending: true });
  if (error) throw toError(error, 'Could not load comments.');
  return (data as MemoryComment[]) ?? [];
}

export async function addComment(memoryId: string, body: string): Promise<MemoryComment> {
  const uid = await currentUserId();
  const text = body.trim();
  if (!text) throw new DbError('Write something first.');
  if (text.length > 1000) throw new DbError('Comments are limited to 1000 characters.');
  const { data, error } = await requireSupabase()
    .from('memory_comments')
    .insert({ memory_id: memoryId, user_id: uid, body: text })
    .select()
    .single();
  if (error) throw toError(error, 'Could not post that comment.');
  return data as MemoryComment;
}

export async function deleteComment(id: string): Promise<void> {
  await currentUserId();
  const { error } = await requireSupabase().from('memory_comments').delete().eq('id', id);
  if (error) throw toError(error, 'Could not delete that comment.');
}

export async function getCommentCounts(
  memoryIds: string[],
): Promise<Record<string, number>> {
  if (memoryIds.length === 0) return {};
  await currentUserId();
  const { data, error } = await requireSupabase()
    .from('memory_comments')
    .select('memory_id')
    .in('memory_id', memoryIds);
  if (error) throw toError(error, 'Could not load comment counts.');
  const counts: Record<string, number> = {};
  for (const row of ((data as { memory_id: string }[]) ?? [])) {
    counts[row.memory_id] = (counts[row.memory_id] ?? 0) + 1;
  }
  return counts;
}

/* ---------- memory saves ---------- */

export async function toggleMemorySave(memoryId: string): Promise<'saved' | 'unsaved'> {
  const uid = await currentUserId();
  const db = requireSupabase();
  const { data: existing, error: readErr } = await db
    .from('memory_saves')
    .select('memory_id')
    .eq('memory_id', memoryId)
    .eq('user_id', uid)
    .maybeSingle();
  if (readErr) throw toError(readErr, 'Could not update that save.');
  if (existing) {
    const { error } = await db
      .from('memory_saves')
      .delete()
      .eq('memory_id', memoryId)
      .eq('user_id', uid);
    if (error) throw toError(error, 'Could not update that save.');
    return 'unsaved';
  }
  const { error } = await db
    .from('memory_saves')
    .insert({ memory_id: memoryId, user_id: uid });
  if (error) throw toError(error, 'Could not update that save.');
  return 'saved';
}

export async function getMySavedIds(memoryIds: string[]): Promise<Set<string>> {
  if (memoryIds.length === 0) return new Set();
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('memory_saves')
    .select('memory_id')
    .in('memory_id', memoryIds)
    .eq('user_id', uid);
  if (error) throw toError(error, 'Could not load saves.');
  return new Set(((data as { memory_id: string }[]) ?? []).map((r) => r.memory_id));
}

/* ---------- realtime subscriptions ---------- */

/** Unique channel topic per call: reusing a topic across subscribers (or a
    StrictMode remount) throws "cannot add postgres_changes callbacks ...
    after subscribe()". Filters + RLS still scope the events. */
function uniqueTopic(base: string): string {
  return `${base}:${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Live reconnection-request changes (RLS-scoped). Returns unsubscribe fn. */
export function subscribeToRequests(onEvent: () => void): () => void {
  const channel: RealtimeChannel = requireSupabase().channel(uniqueTopic('reconnection-requests'));
  channel
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'reconnection_requests' },
      () => onEvent(),
    )
    .subscribe();
  return () => {
    void requireSupabase().removeChannel(channel);
  };
}

/** Live like changes (RLS-scoped). Returns unsubscribe fn. */
export function subscribeToMemoryLikes(onEvent: () => void): () => void {
  const channel: RealtimeChannel = requireSupabase().channel(uniqueTopic('memory-likes'));
  channel
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'memory_likes' },
      () => onEvent(),
    )
    .subscribe();
  return () => {
    void requireSupabase().removeChannel(channel);
  };
}

/** Live comment changes (RLS-scoped). Returns unsubscribe fn. */
export function subscribeToMemoryComments(onEvent: () => void): () => void {
  const channel: RealtimeChannel = requireSupabase().channel(uniqueTopic('memory-comments'));
  channel
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'memory_comments' },
      () => onEvent(),
    )
    .subscribe();
  return () => {
    void requireSupabase().removeChannel(channel);
  };
}

/** Live save changes (RLS-scoped to the saver's own rows). Returns unsubscribe fn. */
export function subscribeToMemorySaves(onEvent: () => void): () => void {
  const channel: RealtimeChannel = requireSupabase().channel(uniqueTopic('memory-saves'));
  channel
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'memory_saves' },
      () => onEvent(),
    )
    .subscribe();
  return () => {
    void requireSupabase().removeChannel(channel);
  };
}
