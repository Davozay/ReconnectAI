import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, LogOut, UserRound } from 'lucide-react';
import Avatar from './Avatar';
import { useAuth } from '../context/useAuth';
import { useTheme } from '../context/useTheme';
import { THEME_OPTIONS } from './theme-options';
import './ProfileMenu.css';

/* Accessible profile dropdown menu. Opens with click or Enter/Space,
   closes on Escape, outside click, or selection. Arrow keys move
   between items; focus returns to the trigger on close. */
export default function ProfileMenu({
  name,
  compact = false,
  direction = 'down',
  align = 'left',
}: {
  name: string;
  compact?: boolean;
  direction?: 'up' | 'down';
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const { signOut } = useAuth();
  const { preference, setPreference } = useTheme();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open ]);

  const focusItem = (items: HTMLElement[], i: number) => {
    items[(i + items.length) % items.length].focus();
  };

  const onMenuKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === 'Tab') {
      setOpen(false);
      return;
    }
    const items = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [role="menuitemradio"]',
      ) ?? [],
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem(items, current + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem(items, current - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1].focus();
    }
  };

  const handleSignOut = () => {
    close();
    void signOut().finally(() => navigate('/'));
  };

  return (
    <div
      className={`profile-menu align-${align}`}
      ref={rootRef}
      onKeyDown={onMenuKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`profile-trigger${compact ? ' is-compact' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Account menu for ${name}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar name={name} size="sm" />
        {!compact && <span className="profile-trigger-name">{name}</span>}
        {!compact && (
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={`profile-chevron${open ? ' is-open' : ''}`}
          />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id={menuId}
            role="menu"
            aria-label={`Account menu for ${name}`}
            className={`profile-pop dir-${direction}`}
            initial={{ opacity: 0, y: direction === 'up' ? 8 : -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: direction === 'up' ? 8 : -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="profile-pop-head">
              <Avatar name={name} color="var(--accent)" size="sm" />
              <div>
                <p className="profile-pop-name">{name}</p>
                <Link
                  to="/app/profile"
                  role="menuitem"
                  className="profile-pop-link"
                  onClick={() => close()}
                >
                  <UserRound size={14} aria-hidden="true" />
                  View profile
                </Link>
              </div>
            </div>

            <p className="profile-pop-label" id={`${menuId}-theme`}>
              Appearance
            </p>
            <div role="group" aria-labelledby={`${menuId}-theme`}>
              {THEME_OPTIONS.map(({ id, label, icon: Icon }) => {
                const selected = preference === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    className={`profile-item${selected ? ' is-selected' : ''}`}
                    onClick={() => setPreference(id)}
                  >
                    <Icon size={16} aria-hidden="true" />
                    {label}
                    {selected && (
                      <Check
                        size={15}
                        aria-hidden="true"
                        className="profile-check"
                      />
                    )}
                  </button>
                );
              })}
            </div>

            <hr className="profile-sep" />

            <button
              type="button"
              role="menuitem"
              className="profile-item is-danger"
              onClick={handleSignOut}
            >
              <LogOut size={16} aria-hidden="true" />
              Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
