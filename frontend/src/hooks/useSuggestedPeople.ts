import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/useAuth';
import { getDiscoverableProfiles, listMyRequests } from '../lib/db';
import { filterSuggestedPeople } from '../lib/suggested';
import type { Profile } from '../lib/db';

const FETCH_BUFFER = 10;

/** Directory profiles worth suggesting, minus self/excluded/requested/connected. */
export function useSuggestedPeople(limit: number, excludeIds: string[] = []) {
  const { user } = useAuth();
  const [people, setPeople] = useState<Profile[]>([]);
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const excludeKey = excludeIds.join(',');
  const excludeRef = useRef(excludeIds);

  useEffect(() => {
    excludeRef.current = excludeIds;
  });

  useEffect(() => {
    if (!user) return;
    let active = true;
    const selfId = user.id;
    const excluded = excludeRef.current;
    Promise.all([
      getDiscoverableProfiles(limit + excluded.length + FETCH_BUFFER),
      listMyRequests(),
    ])
      .then(([profiles, requests]) => {
        if (!active) return;
        setPeople(filterSuggestedPeople(profiles, requests, selfId, excluded, limit));
        setRequestedIds(
          new Set([
            ...requests.outgoing
              .filter((r) => r.status === 'pending')
              .map((r) => r.to_id),
            ...requests.incoming.map((r) => r.from_id),
          ]),
        );
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user, limit, excludeKey, retryKey]);

  return {
    people,
    loading: loading && people.length === 0,
    failed,
    requestedIds,
    markRequested: (id: string) =>
      setRequestedIds((prev) => new Set(prev).add(id)),
    retry: () => {
      setFailed(false);
      setLoading(true);
      setRetryKey((k) => k + 1);
    },
  };
}
