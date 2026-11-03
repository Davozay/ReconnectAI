import { useState } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import Avatar from './Avatar';
import { useAuth } from '../context/useAuth';
import { useToast } from '../context/useToast';
import { useSuggestedPeople } from '../hooks/useSuggestedPeople';
import { DbError, sendRequest } from '../lib/db';
import type { Profile } from '../lib/db';
import './SuggestedForYou.css';

function colorFor(id: string): string {
  const colors = ['#6255e8', '#e85a4f', '#16a34a', '#0ea5e9', '#d946ef'];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return colors[hash % colors.length];
}

function detailFor(p: Profile): string {
  return (
    [p.hometown, p.nickname ? `“${p.nickname}”` : ''].filter(Boolean).join(' · ') ||
    'ReConnect member'
  );
}

export default function SuggestedForYou({
  limit = 6,
  excludeIds = [],
}: {
  limit?: number;
  excludeIds?: string[];
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { people, loading, failed, requestedIds, markRequested, retry } =
    useSuggestedPeople(limit, excludeIds);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const connect = async (profile: Profile) => {
    if (sendingId) return;
    setSendingId(profile.user_id);
    try {
      await sendRequest(profile.user_id);
      markRequested(profile.user_id);
      toast(`Request sent to ${profile.display_name}`);
    } catch (err) {
      toast(err instanceof DbError ? err.message : 'Could not send that request.');
    } finally {
      setSendingId(null);
    }
  };

  return (
    <section className="card card-pad suggested" aria-label="Suggested for you">
      <div className="rail-head suggested-head">
        <h2>Suggested for you</h2>
        <Link to="/app/discover">See all</Link>
      </div>
      {!user ? (
        <p className="rail-note">
          <Link to="/login">Sign in</Link> to meet people you may remember.
        </p>
      ) : loading ? (
        <div className="suggested-scroll" aria-label="Loading suggestions">
          {[0, 1, 2].map((i) => (
            <div key={i} className="suggested-card is-loading" aria-hidden="true">
              <span className="skeleton skeleton-avatar" />
              <span className="skeleton skeleton-line" style={{ width: '70%' }} />
              <span className="skeleton skeleton-line" style={{ width: '50%' }} />
            </div>
          ))}
        </div>
      ) : failed ? (
        <p className="rail-note">
          Could not load suggestions.{' '}
          <button type="button" className="link-btn" onClick={retry}>
            Retry
          </button>
        </p>
      ) : people.length === 0 ? (
        <p className="rail-note">
          No new suggestions right now — check back after more people opt into
          discovery.
        </p>
      ) : (
        <div className="suggested-scroll">
          {people.map((p) => {
            const requested = requestedIds.has(p.user_id);
            const sending = sendingId === p.user_id;
            return (
              <div key={p.user_id} className="suggested-card">
                <Avatar name={p.display_name} color={colorFor(p.user_id)} size="md" />
                <p className="suggested-name">{p.display_name}</p>
                <p className="suggested-detail">{detailFor(p)}</p>
                <button
                  type="button"
                  className={`btn btn-sm suggested-btn ${requested ? 'btn-outline' : 'btn-primary'}`}
                  disabled={requested || sending}
                  onClick={() => connect(p)}
                >
                  <UserPlus size={14} aria-hidden="true" />
                  {requested ? 'Requested' : sending ? 'Sending…' : 'Connect'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
