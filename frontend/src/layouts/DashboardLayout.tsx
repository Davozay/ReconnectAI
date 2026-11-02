import { useState } from 'react';
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
import MatchCard from '../components/MatchCard';
import MemoryArt from '../components/MemoryArt';
import MobileDrawer from '../components/MobileDrawer';
import ProfileMenu from '../components/ProfileMenu';
import SimBadge from '../components/SimBadge';
import ThemeToggle from '../components/ThemeToggle';
import { useAuth } from '../context/useAuth';
import { useToast } from '../context/useToast';
import { useUnreadMessages } from '../context/useUnreadMessages';
import { useUnreadNotifications } from '../context/useUnreadNotifications';
import { MAIN_NAV, SETTINGS_ITEM } from './nav-items';
import {
  MOCK_COMMUNITIES,
  MOCK_MATCHES,
  MOCK_TRENDING,
} from '../data/mock';
import './DashboardLayout.css';

const NAV = [...MAIN_NAV, SETTINGS_ITEM];

const TABS = [
  { to: '/app', label: 'Home', icon: Home, end: true },
  { to: '/app/discover', label: 'Discover', icon: Compass, end: false },
  { to: '/app/detective', label: 'Detective', icon: ScanSearch, end: false, fab: true },
  { to: '/app/messages', label: 'Messages', icon: MessagesSquare, end: false },
  { to: '/app/profile', label: 'Profile', icon: UserRound, end: false },
];

function JoinButton({ name }: { name: string }) {
  const [joined, setJoined] = useState(false);
  const { toast } = useToast();
  if (joined) {
    return (
      <span className="pill pill-green">
        Joined
      </span>
    );
  }
  return (
    <button
      type="button"
      className="btn btn-outline btn-sm"
      onClick={() => {
        setJoined(true);
        toast(`You joined ${name}`);
      }}
    >
      Join
    </button>
  );
}

function RightRail() {
  return (
    <aside className="dash-rail" aria-label="Suggestions and trends">
      <div className="card card-pad rail-card">
        <div className="rail-head">
          <h2>Suggested for you</h2>
          <Link to="/app/discover">See all</Link>
        </div>
        {MOCK_MATCHES.slice(0, 3).map((m) => (
          <MatchCard key={m.id} match={m} compact />
        ))}
      </div>

      <div className="card card-pad rail-card">
        <div className="rail-head">
          <h2>Childhood communities</h2>
        </div>
        <ul className="rail-list">
          {MOCK_COMMUNITIES.map((c) => (
            <li key={c.id} className="rail-row">
              <span className="rail-thumb">
                <MemoryArt seed={c.seed} label="" ratio="square" />
              </span>
              <div className="rail-row-body">
                <p className="rail-row-name">{c.name}</p>
                <p className="rail-row-sub">{c.members}</p>
              </div>
              <JoinButton name={c.name} />
            </li>
          ))}
        </ul>
      </div>

      <div className="card card-pad rail-card">
        <div className="rail-head">
          <h2>Trending memories</h2>
        </div>
        <ul className="rail-list">
          {MOCK_TRENDING.map((t) => (
            <li key={t.id}>
              <Link to="/app/discover" className="rail-trend">
                <strong>{t.tag}</strong>
                <span>{t.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <p className="rail-foot">
        ReConnect AI demo · Mock data · <SimBadge label="Simulated" />
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
