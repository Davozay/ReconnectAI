import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Flag, Search, ShieldCheck, UserPlus } from 'lucide-react';
import Avatar from '../components/Avatar';
import BlockConfirmModal from '../components/BlockConfirmModal';
import ReportModal from '../components/ReportModal';
import { useAuth } from '../context/useAuth';
import { useToast } from '../context/useToast';
import {
  DbError,
  DISCOVER_PAGE_SIZE,
  blockUser,
  listMyRequests,
  searchDiscoverableProfiles,
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
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState<string | null>(null);
  const [blockTarget, setBlockTarget] = useState<Profile | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [reportTarget, setReportTarget] = useState<Profile | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const myId = user?.id;
  const requestIdRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const offsetRef = useRef(0);
  const hasMoreRef = useRef(true);
  const queryRef = useRef('');

  useEffect(() => {
    offsetRef.current = offset;
    hasMoreRef.current = hasMore;
    queryRef.current = debouncedQuery;
  });

  // Debounce keystrokes into server searches (250ms).
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Connection state for the action buttons (fetched once per mount).
  useEffect(() => {
    let active = true;
    listMyRequests()
      .then((requests) => {
        if (!active) return;
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
      .catch(() => {
        // Buttons fall back to "Connect"; the server guards duplicates.
      });
    return () => {
      active = false;
    };
  }, [myId]);

  // First page (resets whenever the debounced search changes).
  useEffect(() => {
    let active = true;
    const requestId = ++requestIdRef.current;
    const q = debouncedQuery;
    searchDiscoverableProfiles({ query: q, limit: DISCOVER_PAGE_SIZE })
      .then((page) => {
        if (!active || requestId !== requestIdRef.current) return;
        setProfiles(page.rows);
        setOffset(page.rows.length);
        setHasMore(page.hasMore);
        setFailed(false);
        setMoreFailed(false);
      })
      .catch((err: unknown) => {
        if (!active || requestId !== requestIdRef.current) return;
        setFailed(true);
        toast(err instanceof DbError ? err.message : 'Could not load discovery.');
      })
      .finally(() => {
        if (active && requestId === requestIdRef.current) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [debouncedQuery, retryKey, toast]);

  const loadMore = () => {
    if (loadingMoreRef.current || !hasMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setMoreFailed(false);
    searchDiscoverableProfiles({
      query: queryRef.current,
      limit: DISCOVER_PAGE_SIZE,
      offset: offsetRef.current,
    })
      .then((page) => {
        setProfiles((prev) => {
          const seen = new Set(prev.map((p) => p.user_id));
          return [...prev, ...page.rows.filter((r) => !seen.has(r.user_id))];
        });
        setOffset((o) => o + page.rows.length);
        setHasMore(page.hasMore);
      })
      .catch((err: unknown) => {
        setMoreFailed(true);
        toast(err instanceof DbError ? err.message : 'Could not load more results.');
      })
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  };

  const retryFirstPage = () => {
    setFailed(false);
    setLoading(true);
    setRetryKey((k) => k + 1);
  };

  const results = profiles;

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
      ) : failed && results.length === 0 ? (
        <div className="card card-pad discover-error">
          <p className="discover-empty">Could not load discovery. Check your connection.</p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={retryFirstPage}
          >
            Retry
          </button>
        </div>
      ) : results.length === 0 ? (
        <div className="card card-pad">
          <p className="discover-empty">
            {debouncedQuery.trim()
              ? 'No matches for that search. Try a different name or place.'
              : 'Nobody has opted into discovery yet. Check back soon — or invite an old friend.'}
          </p>
        </div>
      ) : (
        <>
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
        {(hasMore || moreFailed) && (
          <div className="discover-more">
            {moreFailed ? (
              <>
                <p className="discover-empty">Could not load more results.</p>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={loadMore}
                >
                  Retry
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={loadMore}
                disabled={loadingMore}
                aria-busy={loadingMore}
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        )}
      </>
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
