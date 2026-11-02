import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import {
  subscribeNotifications,
  unreadNotificationCount,
} from '../lib/notifications';

/** Live unread-notification count for badges and the bell dot. */
export function useUnreadNotifications(): number {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true;
    unreadNotificationCount()
      .then((c) => {
        if (active) setUnread(c);
      })
      .catch(() => {});
    const off = subscribeNotifications(() => {
      unreadNotificationCount()
        .then((c) => setUnread(c))
        .catch(() => {});
    });
    return () => {
      active = false;
      off();
    };
  }, [user]);

  return unread;
}
