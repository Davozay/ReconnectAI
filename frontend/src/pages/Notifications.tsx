import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCheck, Heart, MessageCircle, Sparkles, UserPlus } from 'lucide-react';
import { useToast } from '../context/useToast';
import { useUnreadNotifications } from '../context/useUnreadNotifications';
import { DbError, getDiscoverableProfiles } from '../lib/db';
import {
  NOTIFICATIONS_PAGE_SIZE,
  listNotificationsPage,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeNotifications,
} from '../lib/notifications';
import type { Notification } from '../lib/notifications';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import { cursorOf, mergeUniqueById } from '../lib/paging';
import type { PageCursor } from '../lib/paging';
import './Notifications.css';

const ICONS = {
  reconnection_request: UserPlus,
  reconnection_accepted: CheckCheck,
  new_message: MessageCircle,
  message_reaction: Heart,
  memory_like: Heart,
  memory_comment: MessageCircle,
  story_like: Heart,
} as const;

const COLORS: Record<Notification['notification_type'], string> = {
  reconnection_request: '#d946ef',
  reconnection_accepted: '#16a34a',
  new_message: '#0ea5e9',
  message_reaction: '#e85a4f',
  memory_like: '#e85a4f',
  memory_comment: '#0ea5e9',
  story_like: '#e85a4f',
};

const TOASTS: Record<Notification['notification_type'], string> = {
  reconnection_request: 'New reconnection request',
  reconnection_accepted: 'A reconnection request was accepted',
  new_message: 'New message received',
  message_reaction: 'Someone reacted to your message',
  memory_like: 'Someone liked your memory',
  memory_comment: 'Someone commented on your memory',
  story_like: 'Someone liked your story',
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function textFor(n: Notification, actorName: string): string {
  switch (n.notification_type) {
    case 'reconnection_request':
      return `${actorName} sent you a reconnection request`;
    case 'reconnection_accepted':
      return `${actorName} accepted your reconnection request`;
    case 'new_message':
      return `New message from ${actorName}`;
    case 'message_reaction':
      return `${actorName} reacted to your message`;
    case 'memory_like':
      return `${actorName} liked your memory`;
    case 'memory_comment':
      return `${actorName} commented on your memory`;
    case 'story_like':
      return `${actorName} liked your story`;
  }
}

function targetFor(n: Notification): string {
  switch (n.notification_type) {
    case 'reconnection_request':
    case 'reconnection_accepted':
      return '/app/connections';
    case 'new_message':
    case 'message_reaction':
      return '/app/messages';
    case 'memory_like':
    case 'memory_comment':
    case 'story_like':
      return '/app';
  }
}

function isMissingTable(err: unknown): boolean {
  return (
    err instanceof DbError &&
    (err.code === '42P01' || /does not exist|relation/i.test(err.message))
  );
}

export default function Notifications() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [cursor, setCursor] = useState<PageCursor | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [missingConfig, setMissingConfig] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  // Accurate unread total: the live badge count minus reads made on this
  // page (the badge only refetches on new arrivals). Falls back to at least
  // the loaded unread rows while the count is still resolving. The delta
  // resets whenever a fresh count arrives.
  const unreadTotal = useUnreadNotifications();
  const [readAdjust, setReadAdjust] = useState({ base: -1, delta: 0 });
  const syncedDelta = readAdjust.base === unreadTotal ? readAdjust.delta : 0;
  const unread = Math.max(
    unreadTotal - syncedDelta,
    items.filter((n) => !n.is_read).length,
  );
  const loadingMoreRef = useRef(false);
  const cursorRef = useRef<PageCursor | null>(null);
  const hasMoreRef = useRef(true);
  const filterRef = useRef(false);

  useEffect(() => {
    cursorRef.current = cursor;
    hasMoreRef.current = hasMore;
    filterRef.current = showUnreadOnly;
  });

  // Actor display names (directory snapshot, once per mount).
  useEffect(() => {
    let active = true;
    getDiscoverableProfiles(100)
      .then((profiles) => {
        if (!active) return;
        const map: Record<string, string> = {};
        for (const p of profiles) map[p.user_id] = p.display_name;
        setNames(map);
      })
      .catch(() => {
        // Names fall back to "A ReConnect member".
      });
    return () => {
      active = false;
    };
  }, []);

  // First page (resets whenever the All/Unread filter changes).
  useEffect(() => {
    let active = true;
    const unreadOnly = showUnreadOnly;
    listNotificationsPage({ limit: NOTIFICATIONS_PAGE_SIZE, unreadOnly })
      .then((page) => {
        if (!active) return;
        setItems(page.rows);
        setCursor(page.rows.length > 0 ? cursorOf(page.rows[page.rows.length - 1]) : null);
        setHasMore(page.hasMore);
        setFailed(false);
        setMoreFailed(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (isMissingTable(err)) {
          setMissingConfig(true);
        } else {
          setFailed(true);
          toast(err instanceof DbError ? err.message : 'Could not load notifications.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [toast, showUnreadOnly, retryKey]);

  useEffect(() => {
    return subscribeNotifications((n) => {
      setItems((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev]));
      toast(TOASTS[n.notification_type]);
    });
  }, [toast]);

  const loadMore = () => {
    const c = cursorRef.current;
    if (loadingMoreRef.current || !hasMoreRef.current || !c) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setMoreFailed(false);
    listNotificationsPage({
      limit: NOTIFICATIONS_PAGE_SIZE,
      cursor: c,
      unreadOnly: filterRef.current,
    })
      .then((page) => {
        setItems((prev) => mergeUniqueById(prev, page.rows));
        setCursor(
          page.rows.length > 0 ? cursorOf(page.rows[page.rows.length - 1]) : c,
        );
        setHasMore(page.hasMore);
      })
      .catch((err: unknown) => {
        setMoreFailed(true);
        toast(err instanceof DbError ? err.message : 'Could not load older notifications.');
      })
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  };

  const sentinelRef = useInfiniteScroll({
    onLoadMore: loadMore,
    hasMore,
    loading: loadingMore,
    disabled: loading,
  });

  const retryFirstPage = () => {
    setFailed(false);
    setLoading(true);
    setRetryKey((k) => k + 1);
  };

  const visible = items;

  const open = async (n: Notification) => {
    if (!n.is_read) {
      setReadAdjust((s) => ({
        base: unreadTotal,
        delta: (s.base === unreadTotal ? s.delta : 0) + 1,
      }));
      // In Unread mode a read item leaves the list (matches the old filter).
      setItems((prev) =>
        showUnreadOnly
          ? prev.filter((x) => x.id !== n.id)
          : prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)),
      );
      try {
        await markNotificationRead(n.id);
      } catch {
        /* stays locally read; refetch converges */
      }
    }
    if (n.notification_type === 'new_message' && n.related_entity_id) {
      navigate('/app/messages', { state: { conversationId: n.related_entity_id } });
    } else {
      navigate(targetFor(n));
    }
  };

  const markAll = async () => {
    // Mark-all reads EVERYTHING server-side (beyond loaded pages too).
    setReadAdjust({ base: unreadTotal, delta: unreadTotal });
    setItems((prev) =>
      showUnreadOnly ? prev.filter((n) => n.is_read) : prev.map((n) => ({ ...n, is_read: true })),
    );
    try {
      await markAllNotificationsRead();
    } catch (err) {
      toast(err instanceof DbError ? err.message : 'Could not update notifications.');
    }
  };

  if (missingConfig) {
    return (
      <div className="notifications">
        <div className="page-head">
          <div>
            <h1>Notifications</h1>
            <p>Stay in the loop.</p>
          </div>
        </div>
        <div className="card card-pad">
          <p className="empty-note">
            Messaging is not available yet. Database configuration is required.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="notifications">
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>{loading ? 'Loading…' : unread > 0 ? `${unread} unread updates` : 'All caught up'}</p>
        </div>
      </div>

      <div className="card card-pad">
        <div className="notif-tools">
          <div className="filter-row" role="group" aria-label="Filter notifications">
            <button
              type="button"
              className={`filter-pill${!showUnreadOnly ? ' is-active' : ''}`}
              onClick={() => setShowUnreadOnly(false)}
              aria-pressed={!showUnreadOnly}
            >
              All
            </button>
            <button
              type="button"
              className={`filter-pill${showUnreadOnly ? ' is-active' : ''}`}
              onClick={() => setShowUnreadOnly(true)}
              aria-pressed={showUnreadOnly}
            >
              Unread
            </button>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={unread === 0}
            onClick={() => markAll()}
          >
            <CheckCheck size={16} aria-hidden="true" />
            Mark all read
          </button>
        </div>

        {loading ? (
          <p className="empty-note">Loading your notifications…</p>
        ) : failed && visible.length === 0 ? (
          <div className="notif-error">
            <p className="empty-note">Could not load notifications. Check your connection.</p>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={retryFirstPage}
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <ul className="notif-list">
              {visible.map((n) => {
                const Icon = ICONS[n.notification_type];
                const color = COLORS[n.notification_type];
                const actor = names[n.actor_id] ?? 'A ReConnect member';
                return (
                  <li key={n.id} className={`notif${!n.is_read ? ' is-unread' : ''}`}>
                    <button
                      type="button"
                      className="notif-button"
                      onClick={() => open(n)}
                      aria-label={`${textFor(n, actor)} — open`}
                    >
                      <span
                        className="notif-icon"
                        style={{ background: `${color}1a`, color }}
                      >
                        <Icon size={17} aria-hidden="true" />
                      </span>
                      <div className="notif-body">
                        <p>{textFor(n, actor)}</p>
                        <span>{timeAgo(n.created_at)}</span>
                      </div>
                      {!n.is_read && <span className="notif-dot" aria-label="Unread" />}
                    </button>
                  </li>
                );
              })}
            </ul>
            {visible.length === 0 && (
              <p className="empty-note">
                {items.length === 0 ? (
                  <>
                    Nothing yet — new requests, messages, likes, and comments will appear
                    here, live.{' '}
                    <Sparkles size={14} aria-hidden="true" />
                  </>
                ) : (
                  'No unread notifications.'
                )}
              </p>
            )}
            {hasMore && !moreFailed && (
              <div ref={sentinelRef} className="notif-sentinel" aria-hidden="true" />
            )}
            {loadingMore && <p className="empty-note">Loading older notifications…</p>}
            {moreFailed && (
              <div className="notif-error">
                <p className="empty-note">Could not load older notifications.</p>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={loadMore}
                >
                  Retry
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
