/* Private messaging services for ReConnect AI (Supabase + Realtime).
   Security lives in the database (0007/0008): conversations exist only via
   the get_or_create_conversation() RPC (accepted reconnection required),
   senders are bound to auth.uid(), and blocked pairs cannot send. */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { requireSupabase } from './supabase';
import { DbError, getProfilesByIds } from './db';
import type { Profile } from './db';
import { cursorFilter } from './paging';
import type { PageCursor } from './paging';

/** Chat history batch size (newest page first, older pages scroll upward). */
export const MESSAGES_PAGE_SIZE = 30;

/* ---------- types ---------- */

export interface Conversation {
  id: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  kind: 'direct' | 'group';
  affiliation_type: 'school' | 'place' | null;
  affiliation_name: string | null;
  title: string;
  created_by: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  message_type: 'text' | 'image' | 'system';
  attachment_path: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

export interface Reaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface ConversationPreview {
  conversation: Conversation;
  /** Direct chats only; '' for groups. */
  peerId: string;
  peerProfile: Profile | null;
  lastMessage: Message | null;
  unreadCount: number;
  /** All participant ids (ordered arbitrarily; includes self). */
  memberIds: string[];
}

export type RealtimeStatus =
  | 'SUBSCRIBED'
  | 'TIMED_OUT'
  | 'CLOSED'
  | 'CHANNEL_ERROR';

function toError(err: unknown, fallback: string): DbError {
  if (err && typeof err === 'object' && 'message' in err) {
    const e = err as { message: string; code?: string };
    if (/rate limit/i.test(e.message)) {
      return new DbError('Slow down — too many messages. Try again shortly.', e.code);
    }
    if (/conversation unavailable/i.test(e.message)) {
      return new DbError('You need an accepted connection to message this person.', e.code);
    }
    return new DbError(e.message || fallback, e.code);
  }
  return new DbError(fallback);
}

async function currentUserId(): Promise<string> {
  const { data, error } = await requireSupabase().auth.getUser();
  if (error || !data.user) throw new DbError('You must be signed in.');
  return data.user.id;
}

/* ---------- conversations ---------- */

export async function getOrCreateConversation(peerId: string): Promise<string> {
  await currentUserId();
  const { data, error } = await requireSupabase().rpc(
    'get_or_create_conversation',
    { peer_id: peerId },
  );
  if (error) throw toError(error, 'Could not open that conversation.');
  return data as string;
}

/* ---------- school groups ---------- */

export interface GroupCandidate {
  user_id: string;
  display_name: string;
  avatar_storage_path: string | null;
}

export type AffiliationKind = 'school' | 'place';

/** Mutual school/place matches for an affiliation the caller lists (blocks excluded). */
export async function listAffiliationMates(
  kind: AffiliationKind,
  name: string,
): Promise<GroupCandidate[]> {
  await currentUserId();
  const { data, error } = await requireSupabase().rpc('affiliation_mates', {
    kind,
    name,
  });
  if (error) throw toError(error, 'Could not load people for that group.');
  return (data as GroupCandidate[]) ?? [];
}

export async function createGroup(
  affiliation: { kind: AffiliationKind; name: string } | null,
  title?: string,
): Promise<string> {
  await currentUserId();
  const { data, error } = await requireSupabase().rpc('create_group', {
    affiliation_type: affiliation?.kind ?? null,
    affiliation_name: affiliation?.name ?? null,
    title: title?.trim() || null,
  });
  if (error) throw toError(error, 'Could not create that group.');
  return data as string;
}

export async function addGroupMember(conversationId: string, userId: string): Promise<void> {
  await currentUserId();
  const { error } = await requireSupabase().rpc('add_group_member', {
    conv_id: conversationId,
    target_id: userId,
  });
  if (error) throw toError(error, 'Could not add them to the group.');
}

export async function removeGroupMember(conversationId: string, userId: string): Promise<void> {
  await currentUserId();
  const { error } = await requireSupabase().rpc('remove_group_member', {
    conv_id: conversationId,
    target_id: userId,
  });
  if (error) throw toError(error, 'Could not remove them from the group.');
}

export async function leaveGroup(conversationId: string): Promise<void> {
  await currentUserId();
  const { error } = await requireSupabase().rpc('leave_group', { conv_id: conversationId });
  if (error) throw toError(error, 'Could not leave that group.');
}

export async function renameGroup(conversationId: string, title: string): Promise<void> {
  await currentUserId();
  const { error } = await requireSupabase().rpc('rename_group', {
    conv_id: conversationId,
    title,
  });
  if (error) throw toError(error, 'Could not rename that group.');
}

export async function deleteGroup(conversationId: string): Promise<void> {
  await currentUserId();
  const { error } = await requireSupabase().rpc('delete_group', { conv_id: conversationId });
  if (error) throw toError(error, 'Could not delete that group.');
}

/** Participant ids ordered by join time (oldest first). */
export async function listGroupMembers(conversationId: string): Promise<string[]> {
  await currentUserId();
  const { data, error } = await requireSupabase()
    .from('conversation_participants')
    .select('user_id')
    .eq('conversation_id', conversationId)
    .order('joined_at', { ascending: true });
  if (error) throw toError(error, 'Could not load group members.');
  return ((data as { user_id: string }[]) ?? []).map((r) => r.user_id);
}

export async function listConversations(): Promise<ConversationPreview[]> {
  const uid = await currentUserId();
  const db = requireSupabase();

  const { data: mine, error: mineErr } = await db
    .from('conversation_participants')
    .select('conversation_id')
    .eq('user_id', uid);
  if (mineErr) throw toError(mineErr, 'Could not load conversations.');
  const convIds = ((mine as { conversation_id: string }[]) ?? []).map(
    (r) => r.conversation_id,
  );
  if (convIds.length === 0) return [];

  const [{ data: convos }, { data: parts }, { data: reads }] = await Promise.all([
    db.from('conversations').select('*').in('id', convIds),
    db
      .from('conversation_participants')
      .select('conversation_id, user_id')
      .in('conversation_id', convIds),
    db.from('message_reads').select('*').in('conversation_id', convIds).eq('user_id', uid),
  ]);
  const conversationRows = (convos as Conversation[]) ?? [];
  const participantRows = (parts as { conversation_id: string; user_id: string }[]) ?? [];
  const readRows = (reads as { conversation_id: string; last_read_at: string }[]) ?? [];

  const peerByConv = new Map<string, string>();
  const membersByConv = new Map<string, string[]>();
  for (const c of conversationRows) {
    const members = participantRows
      .filter((p) => p.conversation_id === c.id)
      .map((p) => p.user_id);
    membersByConv.set(c.id, members);
    if (c.kind !== 'group') {
      const peer = members.find((id) => id !== uid);
      if (peer) peerByConv.set(c.id, peer);
    }
  }
  const peerIds = [...new Set(peerByConv.values())];
  const profiles = await getProfilesByIds(peerIds).catch(() => [] as Profile[]);
  const profileById = new Map(profiles.map((p) => [p.user_id, p]));

  const readByConv = new Map(readRows.map((r) => [r.conversation_id, r.last_read_at]));

  const previews = await Promise.all(
    conversationRows.map(async (c) => {
      const peerId = peerByConv.get(c.id) ?? '';
      const lastRead = readByConv.get(c.id) ?? '1970-01-01T00:00:00Z';
      const lastQ = db
        .from('messages')
        .select('*')
        .eq('conversation_id', c.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const unreadQ = db
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', c.id)
        .neq('sender_id', uid)
        .is('deleted_at', null)
        .gt('created_at', lastRead);
      const [{ data: last }, { count }] = await Promise.all([lastQ, unreadQ]);
      return {
        conversation: c,
        peerId,
        peerProfile: profileById.get(peerId) ?? null,
        lastMessage: (last as Message | null) ?? null,
        unreadCount: count ?? 0,
        memberIds: membersByConv.get(c.id) ?? [],
      } satisfies ConversationPreview;
    }),
  );
  previews.sort((a, b) => {
    const ta = a.lastMessage?.created_at ?? a.conversation.created_at;
    const tb = b.lastMessage?.created_at ?? b.conversation.created_at;
    return tb.localeCompare(ta);
  });
  return previews;
}

/* ---------- messages ---------- */

export async function listMessages(
  conversationId: string,
  opts: { limit?: number; before?: string; beforeId?: string } = {},
): Promise<{ messages: Message[]; hasMore: boolean }> {
  await currentUserId();
  const limit = opts.limit ?? MESSAGES_PAGE_SIZE;
  let q = requireSupabase()
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (opts.before) {
    // (created_at, id) cursor: same-instant messages can no longer slip
    // between pages. beforeId-less callers keep the legacy behavior.
    const cursor: PageCursor | null = opts.beforeId
      ? { created_at: opts.before, id: opts.beforeId }
      : null;
    q = cursor ? q.or(cursorFilter(cursor)) : q.lt('created_at', opts.before);
  }
  const { data, error } = await q;
  if (error) throw toError(error, 'Could not load messages.');
  const rows = (data as Message[]) ?? [];
  const hasMore = rows.length > limit;
  return { messages: rows.slice(0, limit).reverse(), hasMore };
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Case-insensitive content search inside one conversation (RLS-scoped to
    participants, newest first, deleted messages excluded). */
export async function searchMessages(
  conversationId: string,
  query: string,
  limit = 20,
): Promise<Message[]> {
  const q = query.trim();
  if (!q) return [];
  await currentUserId();
  const { data, error } = await requireSupabase()
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .ilike('content', `%${escapeLike(q)}%`)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw toError(error, 'Could not search messages.');
  return (data as Message[]) ?? [];
}

export async function sendMessage(input: {
  conversation_id: string;
  content?: string;
  attachment_path?: string;
  message_type?: Message['message_type'];
}): Promise<Message> {
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('messages')
    .insert({
      conversation_id: input.conversation_id,
      sender_id: uid,
      content: input.content?.trim() ?? '',
      attachment_path: input.attachment_path ?? '',
      message_type: input.message_type ?? (input.attachment_path ? 'image' : 'text'),
    })
    .select()
    .single();
  if (error) throw toError(error, 'Could not send that message.');
  return data as Message;
}

export async function getMessagesByIds(ids: string[]): Promise<Message[]> {
  if (ids.length === 0) return [];
  await currentUserId();
  const { data, error } = await requireSupabase()
    .from('messages')
    .select('*')
    .in('id', ids);
  if (error) throw toError(error, 'Could not load messages.');
  return (data as Message[]) ?? [];
}

export async function editMessage(id: string, content: string): Promise<Message> {
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('messages')
    .update({ content: content.trim(), edited_at: new Date().toISOString() })
    .eq('id', id)
    .eq('sender_id', uid)
    .select()
    .single();
  if (error) throw toError(error, 'Could not edit that message.');
  return data as Message;
}

export async function deleteMessage(id: string): Promise<void> {
  const uid = await currentUserId();
  const { error } = await requireSupabase()
    .from('messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('sender_id', uid);
  if (error) throw toError(error, 'Could not delete that message.');
}

/* ---------- reactions ---------- */

export async function listReactions(messageIds: string[]): Promise<Reaction[]> {
  if (messageIds.length === 0) return [];
  await currentUserId();
  const { data, error } = await requireSupabase()
    .from('message_reactions')
    .select('*')
    .in('message_id', messageIds);
  if (error) throw toError(error, 'Could not load reactions.');
  return (data as Reaction[]) ?? [];
}

export async function toggleReaction(messageId: string, emoji: string): Promise<'added' | 'removed'> {
  const uid = await currentUserId();
  const db = requireSupabase();
  const { data: existing, error: readErr } = await db
    .from('message_reactions')
    .select('id')
    .eq('message_id', messageId)
    .eq('user_id', uid)
    .eq('emoji', emoji)
    .maybeSingle();
  if (readErr) throw toError(readErr, 'Could not update that reaction.');
  if (existing) {
    const { error } = await db
      .from('message_reactions')
      .delete()
      .eq('id', (existing as { id: string }).id);
    if (error) throw toError(error, 'Could not update that reaction.');
    return 'removed';
  }
  const { error } = await db
    .from('message_reactions')
    .insert({ message_id: messageId, user_id: uid, emoji });
  if (error) throw toError(error, 'Could not update that reaction.');
  return 'added';
}

/* ---------- read receipts ---------- */

export async function markRead(conversationId: string): Promise<void> {
  const uid = await currentUserId();
  const { error } = await requireSupabase().from('message_reads').upsert(
    {
      conversation_id: conversationId,
      user_id: uid,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: 'conversation_id,user_id' },
  );
  if (error) throw toError(error, 'Could not mark conversation as read.');
}

export async function getReads(
  conversationId: string,
): Promise<{ user_id: string; last_read_at: string }[]> {
  await currentUserId();
  const { data, error } = await requireSupabase()
    .from('message_reads')
    .select('user_id, last_read_at')
    .eq('conversation_id', conversationId);
  if (error) throw toError(error, 'Could not load read receipts.');
  return (data as { user_id: string; last_read_at: string }[]) ?? [];
}

/* ---------- realtime ---------- */

export interface ConversationHandlers {
  onInsert?: (message: Message) => void;
  onUpdate?: (message: Message) => void;
  onDelete?: (id: string) => void;
  onReactions?: () => void;
  onReads?: () => void;
  onStatus?: (status: RealtimeStatus) => void;
}

/** Unique channel topic per call: reusing a topic across subscribers (or a
    StrictMode remount) throws "cannot add postgres_changes callbacks ...
    after subscribe()". Filters + RLS still scope the events. */
function uniqueTopic(base: string): string {
  return `${base}:${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Live subscription for one open conversation. Returns an unsubscribe fn. */
export function subscribeToConversation(
  conversationId: string,
  handlers: ConversationHandlers,
): () => void {
  const channel: RealtimeChannel = requireSupabase().channel(
    uniqueTopic(`conversation-${conversationId}`),
  );
  channel
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => handlers.onInsert?.(payload.new as Message),
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => handlers.onUpdate?.(payload.new as Message),
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) =>
        handlers.onDelete?.((payload.old as { id?: string }).id ?? ''),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'message_reactions' },
      () => handlers.onReactions?.(),
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'message_reads',
        filter: `conversation_id=eq.${conversationId}`,
      },
      () => handlers.onReads?.(),
    )
    .subscribe((status) => handlers.onStatus?.(status as RealtimeStatus));
  return () => {
    void requireSupabase().removeChannel(channel);
  };
}

/** Inbox-wide subscription: new messages + preview touches (RLS-scoped). */
export function subscribeToInbox(onEvent: () => void, onStatus?: (s: RealtimeStatus) => void): () => void {
  const channel: RealtimeChannel = requireSupabase().channel(uniqueTopic('inbox'));
  channel
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      () => onEvent(),
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'conversations' },
      () => onEvent(),
    )
    .subscribe((status) => onStatus?.(status as RealtimeStatus));
  return () => {
    void requireSupabase().removeChannel(channel);
  };
}
