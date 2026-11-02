import { useEffect, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, LogOut, X } from 'lucide-react';
import Logo from './Logo';
import { useAuth } from '../context/useAuth';
import { useTheme } from '../context/useTheme';
import { useUnreadNotifications } from '../context/useUnreadNotifications';
import { MAIN_NAV, SETTINGS_ITEM } from '../layouts/nav-items';
import { THEME_OPTIONS } from './theme-options';
import './MobileDrawer.css';

export default function MobileDrawer({
  open,
  onClose,
  name,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
}) {
  const { signOut } = useAuth();
  const { preference, setPreference } = useTheme();
  const unread = useUnreadNotifications();
  const navigate = useNavigate();
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      restoreRef.current?.focus();
    };
  }, [open, onClose]);

  const logout = () => {
    onClose();
    void signOut().finally(() => navigate('/'));
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `drawer-link${isActive ? ' is-active' : ''}`;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="drawer-backdrop"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="drawer"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'tween', duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="drawer-head">
              <span onClick={onClose}>
                <Logo to="/app" />
              </span>
              <button
                ref={closeRef}
                type="button"
                className="drawer-close"
                onClick={onClose}
                aria-label="Close navigation menu"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <nav className="drawer-nav" aria-label="Main navigation">
              {MAIN_NAV.map((item) => {
                const { to, label, icon: Icon, end } = item;
                const badge =
                  to === '/app/notifications' && unread > 0 ? unread : item.badge;
                return (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    onClick={onClose}
                    className={linkClass}
                  >
                    <Icon size={20} aria-hidden="true" />
                    {label}
                    {!!badge && (
                      <span className="drawer-badge" aria-label={`${badge} new`}>
                        {badge}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </nav>

            <p className="drawer-label">Account</p>
            <nav className="drawer-nav" aria-label="Account">
              <NavLink
                to={SETTINGS_ITEM.to}
                onClick={onClose}
                className={linkClass}
              >
                <SETTINGS_ITEM.icon size={20} aria-hidden="true" />
                {SETTINGS_ITEM.label}
              </NavLink>
            </nav>

            <p className="drawer-label" id="drawer-appearance">
              Appearance
            </p>
            <div
              className="drawer-themes"
              role="radiogroup"
              aria-labelledby="drawer-appearance"
            >
              {THEME_OPTIONS.map(({ id, label, icon: Icon }) => {
                const selected = preference === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setPreference(id)}
                    className={`drawer-theme${selected ? ' is-selected' : ''}`}
                  >
                    <Icon size={17} aria-hidden="true" />
                    {label}
                    {selected && (
                      <Check size={15} aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              className="drawer-link drawer-logout"
              onClick={logout}
            >
              <LogOut size={20} aria-hidden="true" />
              Logout
            </button>

            <p className="drawer-foot">Signed in as {name}</p>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
