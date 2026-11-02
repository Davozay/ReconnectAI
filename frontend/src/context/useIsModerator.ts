import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { isModerator } from '../lib/db';

/** Whether the signed-in user is a moderator (plus loading state). */
export function useIsModerator(): { moderator: boolean; loading: boolean } {
  const { user } = useAuth();
  const [moderator, setModerator] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!user) return;
    let active = true;
    isModerator()
      .then((m) => {
        if (active) setModerator(m);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  return { moderator: user ? moderator : false, loading: user ? checking : false };
}
