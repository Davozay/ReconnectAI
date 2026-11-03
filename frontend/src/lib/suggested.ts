/* Suggested-people filtering for ReConnect AI (pure logic + shared types).
   Kept outside the component file so fast-refresh rules stay happy and the
   filter stays probeable in isolation. */

import type { Profile, ReconnectionRequest } from './db';

export interface RequestSets {
  outgoing: ReconnectionRequest[];
  incoming: ReconnectionRequest[];
  connected: ReconnectionRequest[];
}

/** Filter directory profiles down to genuine suggestions: not self, not
    excluded, and nobody already requested/connected. */
export function filterSuggestedPeople(
  profiles: Profile[],
  requests: RequestSets,
  selfId: string | undefined,
  excludeIds: string[],
  limit: number,
): Profile[] {
  const excluded = new Set(excludeIds);
  const connectedPeers = new Set(
    requests.connected.map((r) => (r.from_id === selfId ? r.to_id : r.from_id)),
  );
  const pendingOut = new Set(
    requests.outgoing.filter((r) => r.status === 'pending').map((r) => r.to_id),
  );
  const incomingFrom = new Set(requests.incoming.map((r) => r.from_id));
  return profiles
    .filter(
      (p) =>
        p.user_id !== selfId &&
        !excluded.has(p.user_id) &&
        !connectedPeers.has(p.user_id) &&
        !pendingOut.has(p.user_id) &&
        !incomingFrom.has(p.user_id),
    )
    .slice(0, limit);
}
