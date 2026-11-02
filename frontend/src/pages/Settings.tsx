import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Bell, Eye, Flag, Gavel, ShieldCheck } from 'lucide-react';
import ScamWarning from '../components/ScamWarning';
import ThemeSelector from '../components/ThemeSelector';
import { useToast } from '../context/useToast';
import { useAuth } from '../context/useAuth';
import { useIsModerator } from '../context/useIsModerator';
import { ApiError } from '../lib/api';
import {
  DbError,
  getDiscoverableProfiles,
  getMyProfile,
  listMyBlocks,
  listMyReports,
  unblockUser,
  upsertMyProfile,
} from '../lib/db';
import type { UserReport } from '../lib/db';
import {
  getShieldStatus,
  scamCheck,
  shieldIdentity,
} from '../lib/shield';
import type { ShieldWarning } from '../lib/shield';
import './Settings.css';

const PREFS_KEY = 'reconnect:prefs';

interface Prefs {
  emailNotifs: boolean;
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { emailNotifs: true, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { emailNotifs: true };
}

function shortUuid(id: string): string {
  return id.length > 13 ? `${id.slice(0, 8)}…` : id;
}

const REPORT_CATEGORY_LABELS: Record<UserReport['category'], string> = {
  impersonation: 'Impersonation',
  scam: 'Scam',
  harassment: 'Harassment',
  suspicious_message: 'Suspicious message',
  unauthorized_photo: 'Unauthorized photo',
};

const REPORT_STATUS_PILLS: Record<UserReport['status'], string> = {
  open: 'pill pill-amber',
  reviewing: 'pill pill-indigo',
  resolved: 'pill pill-green',
  dismissed: 'pill pill-neutral',
};

function formatReportDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
}

export default function Settings() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { moderator } = useIsModerator();
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [discoverable, setDiscoverable] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [profileLive, setProfileLive] = useState(false);
  const [backendLive, setBackendLive] = useState(false);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [blockedNames, setBlockedNames] = useState<Record<string, string>>({});
  const [checkText, setCheckText] = useState('');
  const [checkWarnings, setCheckWarnings] = useState<ShieldWarning[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [myReports, setMyReports] = useState<UserReport[]>([]);

  const identity = shieldIdentity(user);
  const myName = user?.name ?? 'Friend';

  useEffect(() => {
    if (!user) return;
    let active = true;
    Promise.all([
      getMyProfile(),
      listMyBlocks(),
      getDiscoverableProfiles(100),
      getShieldStatus(),
    ])
      .then(([profile, blocks, profiles, status]) => {
        if (!active) return;
        setProfileLive(true);
        setDisplayName(profile?.display_name ?? myName);
        setDiscoverable(profile?.discoverable ?? false);
        setBlocked(blocks);
        const map: Record<string, string> = {};
        for (const p of profiles) map[p.user_id] = p.display_name;
        setBlockedNames(map);
        setBackendLive(status !== null);
      })
      .catch(() => {
        if (active) setProfileLive(false);
      });
    listMyReports()
      .then((rows) => {
        if (active) setMyReports(rows);
      })
      .catch(() => {
        /* reports table may predate this account's migrations; section stays empty */
      });
    return () => {
      active = false;
    };
  }, [user, myName]);

  const update = (patch: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    toast('Preference saved');
  };

  const toggleDiscoverable = async () => {
    const next = !discoverable;
    try {
      await upsertMyProfile({
        display_name: displayName || user?.name || 'Friend',
        discoverable: next,
      });
      setDiscoverable(next);
      toast(next ? 'Discovery on — old friends can find you' : 'Discovery off — you are hidden');
    } catch (err) {
      toast(err instanceof DbError ? err.message : 'Could not update discovery');
    }
  };

  const unblock = async (target: string) => {
    try {
      await unblockUser(target);
      setBlocked((prev) => prev.filter((b) => b !== target));
      toast(`Unblocked ${blockedNames[target] ?? shortUuid(target)}`);
    } catch (err) {
      toast(err instanceof DbError ? err.message : 'Could not unblock');
    }
  };

  const runSafetyCheck = async () => {
    if (!identity || !checkText.trim()) return;
    setChecking(true);
    setCheckWarnings(null);
    try {
      const res = await scamCheck(identity, checkText.trim());
      setCheckWarnings(res.warnings);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Safety check failed');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="settings">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Appearance, discovery, and notifications.</p>
        </div>
        {profileLive ? (
          <span className="pill pill-green">
            <ShieldCheck size={14} aria-hidden="true" />
            Synced
          </span>
        ) : (
          <span className="pill pill-neutral">Offline</span>
        )}
      </div>

      <div className="card card-pad settings-card">
        <h2>Appearance</h2>
        <ThemeSelector />
      </div>

      <div className="card card-pad settings-card">
        <h2>Privacy</h2>
        <button
          type="button"
          role="switch"
          aria-checked={discoverable}
          onClick={toggleDiscoverable}
          className={`switch-row${discoverable ? ' is-on' : ''}`}
        >
          <span className="setting-icon">
            <Eye size={17} aria-hidden="true" />
          </span>
          <span>
            <strong>Let old friends find me</strong>
            <small>
              {profileLive
                ? 'Stored in your Supabase profile and enforced by Row Level Security.'
                : 'People with overlapping schools and years can request to connect.'}
            </small>
          </span>
          <span className="switch-track" aria-hidden="true">
            <span className="switch-thumb" />
          </span>
        </button>
        {!user && (
          <p className="empty-note">
            Sign in to sync discovery with your account.
          </p>
        )}
      </div>

      {profileLive && (
        <div className="card card-pad settings-card">
          <h2>Blocked users</h2>
          {blocked.length === 0 ? (
            <p className="empty-note">
              Nobody blocked. Blocked people can’t find you, request you, or
              message you.
            </p>
          ) : (
            <ul className="block-list">
              {blocked.map((b) => (
                <li key={b}>
                  <span>
                    <Ban size={14} aria-hidden="true" />
                    {blockedNames[b] ?? shortUuid(b)}
                  </span>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => unblock(b)}
                  >
                    Unblock
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {profileLive && moderator && (
        <div className="card card-pad settings-card">
          <h2>Moderation</h2>
          <p className="empty-note">
            You’re a ReConnect moderator. Review reports from the community.
          </p>
          <div className="safety-actions">
            <Link to="/app/moderation" className="btn btn-outline btn-sm">
              <Gavel size={15} aria-hidden="true" />
              Open moderation queue
            </Link>
          </div>
        </div>
      )}

      {profileLive && (
        <div className="card card-pad settings-card">
          <h2>My reports</h2>
          {myReports.length === 0 ? (
            <p className="empty-note">
              You haven’t filed any reports. Anything you file stays anonymous
              to the reported person.
            </p>
          ) : (
            <ul className="block-list">
              {myReports.map((r) => (
                <li key={r.id}>
                  <span>
                    <Flag size={14} aria-hidden="true" />
                    {REPORT_CATEGORY_LABELS[r.category]} ·{' '}
                    {formatReportDate(r.created_at)}
                  </span>
                  <span className={REPORT_STATUS_PILLS[r.status]}>{r.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="card card-pad settings-card">
        <h2>Notifications</h2>
        <button
          type="button"
          role="switch"
          aria-checked={prefs.emailNotifs}
          onClick={() => update({ emailNotifs: !prefs.emailNotifs })}
          className={`switch-row${prefs.emailNotifs ? ' is-on' : ''}`}
        >
          <span className="setting-icon">
            <Bell size={17} aria-hidden="true" />
          </span>
          <span>
            <strong>Memory updates</strong>
            <small>Likes, comments, and newly found friends.</small>
          </span>
          <span className="switch-track" aria-hidden="true">
            <span className="switch-thumb" />
          </span>
        </button>
      </div>

      {backendLive && identity && (
        <div className="card card-pad settings-card">
          <h2>Check a suspicious message</h2>
          <p className="empty-note">
            Paste text you received. It’s checked on ReConnect servers with
            local pattern matching — never sent to advertisers or external AI.
          </p>
          <label className="field">
            <span className="field-label">Message text</span>
            <textarea
              className="textarea"
              rows={3}
              maxLength={2000}
              placeholder="Paste the message here…"
              value={checkText}
              onChange={(e) => setCheckText(e.target.value)}
            />
          </label>
          <div className="safety-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={runSafetyCheck}
              disabled={checking || !checkText.trim()}
            >
              <ShieldCheck size={15} aria-hidden="true" />
              {checking ? 'Checking…' : 'Check message'}
            </button>
          </div>
          {checkWarnings && checkWarnings.length === 0 && (
            <p className="empty-note">No warning signs found. Stay sharp anyway.</p>
          )}
          {checkWarnings && <ScamWarning warnings={checkWarnings} />}
        </div>
      )}

      <div className="notice notice-amber">
        <Eye size={18} aria-hidden="true" />
        <p>
          Your photos stay private until you share them, and ReConnect AI never
          identifies people by face.{' '}
          {profileLive
            ? 'Your privacy settings are stored securely in Supabase.'
            : 'Sign in to sync these settings with your account.'}
        </p>
      </div>
    </div>
  );
}
