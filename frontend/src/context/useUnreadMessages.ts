import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { listConversations, subscribeToInbox } from '../lib/messages';

/** Total unread messages across all conversations (live via Realtime). */
export function useUnreadMessages(): number {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const refresh = () => {
      listConversations()
        .then((previews) => {
          if (!active) return;
          setUnread(previews.reduce((sum, p) => sum + p.unreadCount, 0));
        })
        .catch(() => {});
    };
    refresh();
    const off = subscribeToInbox(refresh);
    return () => {
      active = false;
      off();
    };
  }, [user]);

  return unread;
}
