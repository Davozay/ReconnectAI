import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Ban, Check, Flag, MessageCircle, X } from 'lucide-react';
import Avatar from '../components/Avatar';
import BlockConfirmModal from '../components/BlockConfirmModal';
import ReportModal from '../components/ReportModal';
import { useToast } from '../context/useToast';
import { useAuth } from '../context/useAuth';
import {
  DbError,
  acceptRequest,
  blockUser,
  cancelRequest,
  declineRequest,
  getProfilesByIds,
  listMyBlocks,
  listMyRequests,
  sendRequest,
  subscribeToRequests,
} from '../lib/db';
import { getOrCreateConversation } from '../lib/messages';
import type { ReconnectionRequest } from '../lib/db';
import './Connections.css';

const COLORS = ['#6255e8', '#e85a4f', '#16a34a', '#0ea5e9', '#d946ef'];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

export default function Connections() {
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [incoming, setIncoming] = useState<ReconnectionRequest[]>([]);
  const [outgoing, setOutgoing] = useState<ReconnectionRequest[]>([]);
  const [connected, setConnected] = useState<ReconnectionRequest[]>([]);
  const [declined, setDeclined] = useState<ReconnectionRequest[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);
  const [blockTarget, setBlockTarget] = useState<{ id: string; name: string } | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const prevIncomingRef = useRef<Set<string>>(new Set());
  const firstLoadRef = useRef(true);

  useEffect(() => {
    let active = true;
    listMyRequests()
      .then((requests) => {
        if (!active) return;
        setIncoming(requests.incoming);
        setOutgoing(requests.outgoing);
        setConnected(requests.connected);
        setDeclined(requests.declined);
        const ids = [
          ...new Set(
            requests.incoming
              .concat(requests.outgoing, requests.connected, requests.declined)
              .flatMap((r) => [r.from_id, r.to_id]),
          ),
        ];
        return getProfilesByIds(ids).then((profiles) => {
          if (!active) return;
          const map: Record<string, string> = {};
          for (const p of profiles) map[p.user_id] = p.display_name;
          setNames(map);
          const fresh = requests.incoming.filter(
            (r) => !prevIncomingRef.current.has(r.id),
          );
          prevIncomingRef.current = new Set(requests.incoming.map((r) => r.id));
          if (!firstLoadRef.current && fresh.length > 0) {
            const name = map[fresh[0].from_id] ?? 'Someone';
            toast(
              fresh.length === 1
                ? `New reconnection request from ${name}`
                : `${fresh.length} new reconnection requests`,
            );
          }
          firstLoadRef.current = false;
        });
      })
      .catch((err: unknown) => {
        if (active) toast(err instanceof DbError ? err.message : 'Could not load connections.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [toast, refreshKey]);

  useEffect(() => {
    return subscribeToRequests(() => setRefreshKey((k) => k + 1));
  }, []);

  const peerName = (id: string) => names[id] ?? 'A ReConnect member';

  const peerOf = (r: ReconnectionRequest) =>
    r.from_id === user?.id ? r.to_id : r.from_id;

  const pendingOutgoing = outgoing.filter((r) => r.status === 'pending');

  const messagePeer = async (peerId: string) => {
    try {
      const conversationId = await getOrCreateConversation(peerId);
      navigate('/app/messages', { state: { conversationId } });
    } catch (err) {
      toast(err instanceof DbError ? err.message : 'Could not open that conversation.');
    }
  };

  const act = async (r: ReconnectionRequest, action: 'accept' | 'decline' | 'cancel') => {
    try {
      if (action === 'accept') {
        await acceptRequest(r.id);
        toast(`You reconnected with ${peerName(r.from_id)}`);
      } else if (action === 'decline') {
        await declineRequest(r.id);
        toast('Request declined');
      } else {
        await cancelRequest(r.id);
        toast('Request withdrawn');
      }
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast(err instanceof DbError ? err.message : 'Action failed');
    }
  };

  const reconnect = async (r: ReconnectionRequest) => {
    const peer = peerOf(r);
    const hasLive =
      incoming.some((x) => x.from_id === peer) ||
      connected.some((x) => peerOf(x) === peer) ||
      pendingOutgoing.some((x) => x.to_id === peer);
    if (hasLive) {
      toast('You already have an active request or connection with them.');
      setRefreshKey((k) => k + 1);
      return;
    }
    try {
      const blocks = await listMyBlocks();
      if (blocks.includes(peer)) {
        toast('Unblock them in Settings first.');
        return;
      }
      if (r.from_id === user?.id) {
        await sendRequest(peer);
        toast(`Request sent to ${peerName(peer)}`);
      } else {
        await acceptRequest(r.id);
        toast(`You reconnected with ${peerName(peer)}`);
      }
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast(err instanceof DbError ? err.message : 'Action failed');
    }
  };

  const confirmBlock = async () => {
    if (!blockTarget) return;
    setBlocking(true);
    try {
      await blockUser(blockTarget.id);
      toast(`Blocked ${blockTarget.name}. They were not notified.`);
      setBlockTarget(null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast(err instanceof DbError ? err.message : 'Could not block that user.');
    } finally {
      setBlocking(false);
    }
  };

  if (loading) {
    return (
      <div className="connections">
        <div className="page-head">
          <div>
            <h1>Connections</h1>
            <p>Reconnection requests and the friends you’ve found.</p>
          </div>
        </div>
        <section className="card card-pad" aria-label="Loading">
          <p className="empty-note">Loading your connections…</p>
        </section>
      </div>
    );
  }

  return (
    <div className="connections">
      <div className="page-head">
        <div>
          <h1>Connections</h1>
          <p>Reconnection requests and the friends you’ve found.</p>
        </div>
      </div>

      <section className="card card-pad" aria-label="Pending requests">
        <h2 className="section-title">
          Pending requests
          {incoming.length > 0 && <span className="count-badge">{incoming.length}</span>}
        </h2>
        {incoming.length === 0 ? (
          <p className="empty-note">All caught up — no pending requests right now.</p>
        ) : (
          <ul className="request-list">
            {incoming.map((r) => (
              <li key={r.id} className="request">
                <Avatar name={peerName(r.from_id)} color={colorFor(r.from_id)} size="md" />
                <div className="request-body">
                  <p className="request-name">{peerName(r.from_id)}</p>
                  {r.message && (
                    <p className="request-reason">
                      <MessageCircle size={13} aria-hidden="true" />
                      {r.message}
                    </p>
                  )}
                  <div className="request-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => act(r, 'accept')}
                    >
                      <Check size={15} aria-hidden="true" />
                      Accept
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => act(r, 'decline')}
                    >
                      <X size={15} aria-hidden="true" />
                      Decline
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => setBlockTarget({ id: r.from_id, name: peerName(r.from_id) })}
                      aria-label={`Block ${peerName(r.from_id)}`}
                    >
                      <Ban size={15} aria-hidden="true" />
                      Block
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => setReportTarget({ id: r.from_id, name: peerName(r.from_id) })}
                      aria-label={`Report ${peerName(r.from_id)}`}
                    >
                      <Flag size={15} aria-hidden="true" />
                      Report
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pendingOutgoing.length > 0 && (
        <section className="card card-pad" aria-label="Sent requests">
          <h2 className="section-title">
            Sent requests
            <span className="count-badge is-neutral">{pendingOutgoing.length}</span>
          </h2>
          <ul className="request-list">
            {pendingOutgoing.map((r) => (
              <li key={r.id} className="request">
                <Avatar name={peerName(r.to_id)} color={colorFor(r.to_id)} size="md" />
                <div className="request-body">
                  <p className="request-name">{peerName(r.to_id)}</p>
                  <div className="request-actions">
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => act(r, 'cancel')}
                    >
                      <X size={15} aria-hidden="true" />
                      Withdraw
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {declined.length > 0 && (
        <section className="card card-pad" aria-label="Declined requests">
          <h2 className="section-title">
            Declined
            <span className="count-badge is-neutral">{declined.length}</span>
          </h2>
          <ul className="request-list">
            {declined.map((r) => {
              const peer = peerOf(r);
              const iDeclined = r.from_id !== user?.id;
              return (
                <li key={r.id} className="request">
                  <Avatar name={peerName(peer)} color={colorFor(peer)} size="md" />
                  <div className="request-body">
                    <p className="request-name">{peerName(peer)}</p>
                    <p className="request-detail">
                      {iDeclined
                        ? 'You declined their request — changed your mind?'
                        : 'They declined your request — try once more?'}
                    </p>
                    <div className="request-actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => reconnect(r)}
                      >
                        <Check size={15} aria-hidden="true" />
                        {iDeclined ? 'Connect' : 'Send again'}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card card-pad" aria-label="Your connections">
        <h2 className="section-title">
          Your connections
          <span className="count-badge is-neutral">{connected.length}</span>
        </h2>
        {connected.length === 0 ? (
          <p className="empty-note">
            No connections yet. <Link to="/app/discover">Discover old friends</Link> to get started.
            {user ? '' : ' (You are signed out.)'}
          </p>
        ) : (
          <ul className="connection-grid">
            {connected.map((r) => {
              const peerId = peerOf(r);
              return (
                <li key={r.id} className="connection">
                  <Avatar name={peerName(peerId)} color={colorFor(peerId)} size="md" />
                  <p className="connection-name">{peerName(peerId)}</p>
                  <p className="connection-detail">Connected</p>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm connection-message"
                    onClick={() => messagePeer(peerId)}
                  >
                    <MessageCircle size={14} aria-hidden="true" />
                    Message
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {reportTarget && (
        <ReportModal
          open
          onClose={() => setReportTarget(null)}
          targetId={reportTarget.id}
          targetName={reportTarget.name}
        />
      )}

      {blockTarget && (
        <BlockConfirmModal
          open
          onClose={() => setBlockTarget(null)}
          onConfirm={() => confirmBlock()}
          targetName={blockTarget.name}
          busy={blocking}
        />
      )}
    </div>
  );
}
