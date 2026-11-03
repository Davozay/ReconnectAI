import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Flag, Search, ShieldCheck, UserPlus } from 'lucide-react';
import Avatar from '../components/Avatar';
import BlockConfirmModal from '../components/BlockConfirmModal';
import ReportModal from '../components/ReportModal';
import { useAuth } from '../context/useAuth';
import { useToast } from '../context/useToast';
import {
  DbError,
  blockUser,
  getDiscoverableProfiles,
  listMyRequests,
  sendRequest,
} from '../lib/db';
import type { Profile } from '../lib/db';
import './Discover.css';

const COLORS = ['#6255e8', '#e85a4f', '#16a34a', '#0ea5e9', '#d946ef'];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

export default function Discover() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState<string | null>(null);
  const [blockTarget, setBlockTarget] = useState<Profile | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [reportTarget, setReportTarget] = useState<Profile | null>(null);

  const myId = user?.id;

  useEffect(() => {
    let active = true;
    Promise.all([getDiscoverableProfiles(50), listMyRequests()])
      .then(([rows, requests]) => {
        if (!active) return;
        setProfiles(rows.filter((p) => p.user_id !== myId));
        setRequested(
          new Set([
            ...requests.outgoing.filter((r) => r.status === 'pending').map((r) => r.to_id),
            ...requests.incoming.map((r) => r.from_id),
          ]),
        );
        setConnectedIds(
          new Set(
            requests.connected.map((r) => (r.from_id === myId ? r.to_id : r.from_id)),
          ),
        );
      })
      .catch((err: unknown) => {
        if (active) toast(err instanceof DbError ? err.message : 'Could not load discovery.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [toast, myId]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter((p) =>
      [p.display_name, p.hometown, p.nickname, p.bio].join(' ').toLowerCase().includes(q),
    );
  }, [profiles, query]);

  const connect = async (profile: Profile) => {
    setSending(profile.user_id);
    try {
      await sendRequest(profile.user_id);
      setRequested((prev) => new Set(prev).add(profile.user_id));
      toast(`Request sent to ${profile.display_name}`);
    } catch (err) {
      toast(err instanceof DbError ? err.message : 'Could not send that request.');
    } finally {
      setSending(null);
    }
  };

  const confirmBlock = async () => {
    if (!blockTarget) return;
    setBlocking(true);
    try {
      await blockUser(blockTarget.user_id);
      setProfiles((prev) => prev.filter((p) => p.user_id !== blockTarget.user_id));
      toast(`Blocked ${blockTarget.display_name}. They were not notified.`);
      setBlockTarget(null);
    } catch (err) {
      toast(err instanceof DbError ? err.message : 'Could not block that user.');
    } finally {
      setBlocking(false);
    }
  };

  return (
    <div className="discover">
      <div className="page-head">
        <div>
          <h1>Discover</h1>
          <p>People who opted in to being found — with the reasons why.</p>
        </div>
      </div>

      <div className="card card-pad discover-search">
        <div className="search-box">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search names, hometowns, nicknames…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search discoverable people"
          />
        </div>
        <p className="discover-note">
          <ShieldCheck size={15} aria-hidden="true" />
          Only people who turned on discovery appear here. You are hidden until you opt in.
        </p>
      </div>

      {loading ? (
        <div className="card card-pad">
          <p className="discover-empty">Searching people who opted in…</p>
        </div>
      ) : results.length === 0 ? (
        <div className="card card-pad">
          <p className="discover-empty">
            {profiles.length === 0
              ? 'Nobody has opted into discovery yet. Check back soon — or invite an old friend.'
              : 'No matches for that search. Try a different name or place.'}
          </p>
        </div>
      ) : (
        <ul className="discover-list">
          {results.map((p) => {
            const pending = requested.has(p.user_id);
            const isConnected = connectedIds.has(p.user_id);
            return (
              <li key={p.user_id} className="card card-pad discover-card">
                <Avatar name={p.display_name} color={colorFor(p.user_id)} size="lg" />
                <div className="discover-card-body">
                  <p className="discover-name">{p.display_name}</p>
                  <p className="discover-detail">
                    {[p.hometown, p.nickname ? `“${p.nickname}”` : ''].filter(Boolean).join(' · ') ||
                      'ReConnect member'}
                  </p>
                  {p.bio.trim() && <p className="discover-bio">{p.bio}</p>}
                </div>
                <div className="discover-actions">
                  <button
                    type="button"
                    className={`btn btn-sm ${pending || isConnected ? 'btn-outline' : 'btn-primary'}`}
                    onClick={() => connect(p)}
                    disabled={pending || isConnected || sending === p.user_id}
                  >
                    <UserPlus size={15} aria-hidden="true" />
                    {isConnected
                      ? 'Connected'
                      : pending
                        ? 'Requested'
                        : sending === p.user_id
                          ? 'Sending…'
                          : 'Connect'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setBlockTarget(p)}
                    aria-label={`Block ${p.display_name}`}
                    data-tooltip={`Block ${p.display_name}`}
                  >
                    <Ban size={15} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setReportTarget(p)}
                    aria-label={`Report ${p.display_name}`}
                    data-tooltip={`Report ${p.display_name}`}
                  >
                    <Flag size={15} aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="discover-foot">
        Looking for your requests? <Link to="/app/connections">Open Connections</Link>
      </p>

      {blockTarget && (
        <BlockConfirmModal
          open
          onClose={() => setBlockTarget(null)}
          onConfirm={() => confirmBlock()}
          targetName={blockTarget.display_name}
          busy={blocking}
        />
      )}

      {reportTarget && (
        <ReportModal
          open
          onClose={() => setReportTarget(null)}
          targetId={reportTarget.user_id}
          targetName={reportTarget.display_name}
        />
      )}
    </div>
  );
}
