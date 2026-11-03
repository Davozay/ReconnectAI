import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bell,
  Compass,
  Home,
  Menu,
  MessagesSquare,
  ScanSearch,
  UserRound,
} from 'lucide-react';
import Logo from '../components/Logo';
import MembershipButton from '../components/MembershipButton';
import MemoryArt from '../components/MemoryArt';
import MobileDrawer from '../components/MobileDrawer';
import ProfileMenu from '../components/ProfileMenu';
import SuggestedForYou from '../components/SuggestedForYou';
import ThemeToggle from '../components/ThemeToggle';
import { useAuth } from '../context/useAuth';
import { useUnreadMessages } from '../context/useUnreadMessages';
import { useUnreadNotifications } from '../context/useUnreadNotifications';
import { MAIN_NAV, SETTINGS_ITEM } from './nav-items';
import {
  formatMemberCount,
  getMemberCounts,
  listCommunities,
  listMyCommunityIds,
} from '../lib/communities';
import type { Community } from '../lib/communities';
import { formatMemoryCount, listTrendingTags } from '../lib/trending';
import type { TrendingTag } from '../lib/trending';
import './DashboardLayout.css';

const NAV = [...MAIN_NAV, SETTINGS_ITEM];

const TABS = [
  { to: '/app', label: 'Home', icon: Home, end: true },
  { to: '/app/discover', label: 'Discover', icon: Compass, end: false },
  { to: '/app/detective', label: 'Detective', icon: ScanSearch, end: false, fab: true },
  { to: '/app/messages', label: 'Messages', icon: MessagesSquare, end: false },
  { to: '/app/profile', label: 'Profile', icon: UserRound, end: false },
];

function CommunitiesRail() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [mine, setMine] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    let active = true;
    listCommunities(3)
      .then(async (rows) => {
        if (!active) return;
        setCommunities(rows);
        const ids = rows.map((c) => c.id);
        const [loadedCounts, myIds] = await Promise.all([
          getMemberCounts(ids),
          listMyCommunityIds(ids),
        ]);
        if (!active) return;
        setCounts(loadedCounts);
        setMine(myIds);
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
  }, [user]);

  const membershipChanged = (id: string, joined: boolean) => {
    setMine((prev) => {
      const next = new Set(prev);
      if (joined) next.add(id);
      else next.delete(id);
      return next;
    });
    setCounts((prev) => ({
      ...prev,
      [id]: Math.max(0, (prev[id] ?? (joined ? 0 : 1)) + (joined ? 1 : -1)),
    }));
  };

  return (
    <div className="card card-pad rail-card">
      <div className="rail-head">
        <h2>Childhood communities</h2>
        <Link to="/app/communities">See all</Link>
      </div>
      {!user ? (
        <p className="rail-note">
          <Link to="/login">Sign in</Link> to browse communities.
        </p>
      ) : loading ? (
        <p className="rail-note">Loading communities…</p>
      ) : failed ? (
        <p className="rail-note">Could not load communities.</p>
      ) : communities.length === 0 ? (
        <p className="rail-note">
          No communities yet — <Link to="/app/communities">start the first one</Link>.
        </p>
      ) : (
        <ul className="rail-list">
          {communities.map((c) => (
            <li key={c.id} className="rail-row">
              <Link
                to={`/app/communities/${c.id}`}
                className="rail-thumb"
                aria-label={`Open ${c.name}`}
              >
                <MemoryArt
                  seed={c.image_seed || `community-${c.id}`}
                  label=""
                  ratio="square"
                />
              </Link>
              <div className="rail-row-body">
                <Link to={`/app/communities/${c.id}`} className="rail-row-link">
                  {c.name}
                </Link>
                <p className="rail-row-sub">{formatMemberCount(counts[c.id] ?? 0)}</p>
              </div>
              <MembershipButton
                communityId={c.id}
                communityName={c.name}
                joined={mine.has(c.id)}
                onChange={(joined) => membershipChanged(c.id, joined)}
                small
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TrendingRail() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tags, setTags] = useState<TrendingTag[]>([]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    listTrendingTags()
      .then((rows) => {
        if (active) setTags(rows);
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
  }, [user]);

  return (
    <div className="card card-pad rail-card">
      <div className="rail-head">
        <h2>Trending memories</h2>
      </div>
      {!user ? (
        <p className="rail-note">
          <Link to="/login">Sign in</Link> to see what the community remembers.
        </p>
      ) : loading ? (
        <p className="rail-note">Finding trending memories…</p>
      ) : failed ? (
        <p className="rail-note">Could not load trending memories.</p>
      ) : tags.length === 0 ? (
        <p className="rail-note">
          Nothing trending yet — share a memory with a #hashtag to start one.
        </p>
      ) : (
        <ul className="rail-list">
          {tags.map((t) => (
            <li key={t.tag}>
              <Link to={`/app?tag=${encodeURIComponent(t.tag)}`} className="rail-trend">
                <strong>#{t.display}</strong>
                <span>{formatMemoryCount(t.memoryCount)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RightRail() {
  return (
    <aside className="dash-rail" aria-label="Suggestions and trends">
      <SuggestedForYou limit={6} />

      <CommunitiesRail />
      <TrendingRail />

      <p className="rail-foot">
        ReConnect AI · Rediscover people. Relive memories.
      </p>
    </aside>
  );
}

export default function DashboardLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const name = user?.name ?? 'Friend';
  const [drawerOpen, setDrawerOpen] = useState(false);
  const unread = useUnreadNotifications();
  const unreadMessages = useUnreadMessages();

  return (
    <div className="dash">
      <aside className="dash-sidebar" aria-label="App navigation">
        <div className="dash-sidebar-logo">
          <Logo to="/app" />
        </div>
        <nav className="dash-nav">
          {NAV.map((item) => {
            const { to, label, icon: Icon, end } = item;
            const badge =
              to === '/app/notifications' && unread > 0
                ? unread
                : to === '/app/messages' && unreadMessages > 0
                  ? unreadMessages
                  : item.badge;
            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                title={label}
                aria-label={label}
                className={({ isActive }) =>
                  `dash-nav-link${isActive ? ' is-active' : ''}`
                }
              >
                <Icon size={20} aria-hidden="true" />
                <span className="dash-nav-label">{label}</span>
                {!!badge && (
                  <span className="dash-badge" aria-label={`${badge} new`}>
                    {badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>
        <div className="dash-sidebar-foot">
          <ProfileMenu name={name} direction="up" align="left" />
        </div>
      </aside>

      <div className="dash-center">
        <header className="dash-header">
          <div className="dash-header-actions">
            <ThemeToggle />
            <Link
              to="/app/notifications"
              className="icon-btn icon-btn-link"
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            >
              <Bell size={19} aria-hidden="true" />
              {unread > 0 && <span className="icon-dot" aria-hidden="true" />}
            </Link>
          </div>
        </header>

        <header className="dash-mobilebar">
          <div className="dash-mobile-left">
            <button
              type="button"
              className="icon-btn"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation menu"
              aria-haspopup="dialog"
              data-tooltip="Open navigation menu"
              data-tooltip-pos="bottom"
            >
              <Menu size={20} aria-hidden="true" />
            </button>
            <Logo to="/app" />
          </div>
          <div className="dash-mobile-actions">
            <Link
              to="/app/notifications"
              className="icon-btn icon-btn-link"
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            >
              <Bell size={19} aria-hidden="true" />
              {unread > 0 && <span className="icon-dot" aria-hidden="true" />}
            </Link>
            <ProfileMenu name={name} compact direction="down" align="right" />
          </div>
        </header>

        <main className="dash-content">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <RightRail />

      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        name={name}
      />

      <nav className="dash-tabs" aria-label="App navigation">
        {TABS.map(({ to, label, icon: Icon, end, fab }) =>
          fab ? (
            <NavLink
              key={to}
              to={to}
              end={end}
              className="dash-fab"
              aria-label="Open Memory Detective"
            >
              <Icon size={22} aria-hidden="true" />
            </NavLink>
          ) : (
            <NavLink
              key={to}
              to={to}
              end={end}
              aria-label={
                to === '/app/messages' && unreadMessages > 0
                  ? `Messages, ${unreadMessages} unread`
                  : label
              }
              className={({ isActive }) =>
                `dash-tab${isActive ? ' is-active' : ''}`
              }
            >
              <Icon size={21} aria-hidden="true" />
              <span>{label}</span>
              {to === '/app/messages' && unreadMessages > 0 && (
                <span className="dash-tab-badge" aria-hidden="true">
                  {unreadMessages > 99 ? '99+' : unreadMessages}
                </span>
              )}
            </NavLink>
          ),
        )}
      </nav>
    </div>
  );
}
