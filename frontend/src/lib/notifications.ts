/* In-app notifications for ReConnect AI.
   Rows are written by trusted database triggers (requests, messages,
   reactions, memory likes, memory comments, story likes) — clients only
   read and mark their own as read. */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { requireSupabase } from './supabase';
import { DbError } from './db';
import type { RealtimeStatus } from './messages';

export interface Notification {
  id: string;
  recipient_id: string;
  actor_id: string;
  notification_type:
    | 'reconnection_request'
    | 'reconnection_accepted'
    | 'new_message'
    | 'message_reaction'
    | 'memory_like'
    | 'memory_comment'
    | 'story_like';
  related_entity_id: string;
  is_read: boolean;
  created_at: string;
}

async function currentUserId(): Promise<string> {
  const { data, error } = await requireSupabase().auth.getUser();
  if (error || !data.user) throw new DbError('You must be signed in.');
  return data.user.id;
}

export async function listNotifications(limit = 30): Promise<Notification[]> {
  const uid = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('notifications')
    .select('*')
    .eq('recipient_id', uid)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new DbError(error.message || 'Could not load notifications.');
  return (data as Notification[]) ?? [];
}

export async function unreadNotificationCount(): Promise<number> {
  const uid = await currentUserId();
  const { count, error } = await requireSupabase()
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('recipient_id', uid)
    .eq('is_read', false);
  if (error) throw new DbError(error.message || 'Could not load notifications.');
  return count ?? 0;
}

export async function markNotificationRead(id: string): Promise<void> {
  const uid = await currentUserId();
  const { error } = await requireSupabase()
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id)
    .eq('recipient_id', uid);
  if (error) throw new DbError(error.message || 'Could not update that notification.');
}

export async function markAllNotificationsRead(): Promise<void> {
  const uid = await currentUserId();
  const { error } = await requireSupabase()
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_id', uid)
    .eq('is_read', false);
  if (error) throw new DbError(error.message || 'Could not update notifications.');
}

/** Live subscription for incoming notifications. Returns unsubscribe fn. */
export function subscribeNotifications(
  onInsert: (notification: Notification) => void,
  onStatus?: (status: RealtimeStatus) => void,
): () => void {
  const db = requireSupabase();
  // Unique topic per call: several hooks can subscribe at once (layout bell,
  // drawer badge, notifications page), and sharing one channel object throws
  // when a second caller adds callbacks after the first subscribed.
  const channel: RealtimeChannel = db.channel(
    `notifications:${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`,
  );
  let active = true;
  void db.auth.getUser().then(({ data }) => {
    const uid = data.user?.id;
    if (!uid || !active) return;
    channel
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${uid}`,
        },
        (payload) => onInsert(payload.new as Notification),
      )
      .subscribe((status) => onStatus?.(status as RealtimeStatus));
  });
  return () => {
    active = false;
    void db.removeChannel(channel);
  };
}
