import { useEffect, useState } from 'react';
import { Flag, Image, MessageCircle, UserRound } from 'lucide-react';
import { useToast } from '../context/useToast';
import {
  DbError,
  getProfilesByIds,
  isMissingTable,
  listAllReports,
  updateReportStatus,
} from '../lib/db';
import type { UserReport } from '../lib/db';
import { getMessagesByIds } from '../lib/messages';
import type { Message } from '../lib/messages';
import './Moderation.css';

type Filter = 'all' | UserReport['status'];

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'reviewing', label: 'Reviewing' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'dismissed', label: 'Dismissed' },
];

const TYPE_ICONS = {
  user: UserRound,
  message: MessageCircle,
  photo: Image,
  post: Flag,
} as const;

const CATEGORY_LABELS: Record<UserReport['category'], string> = {
  impersonation: 'Impersonation',
  scam: 'Scam',
  harassment: 'Harassment',
  suspicious_message: 'Suspicious message',
  unauthorized_photo: 'Unauthorized photo',
};

function shortId(id: string): string {
  return id.length > 13 ? `${id.slice(0, 8)}…` : id;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

export default function Moderation() {
  const { toast } = useToast();
  const [reports, setReports] = useState<UserReport[]>([]);
  const [filter, setFilter] = useState<Filter>('open');
  const [loading, setLoading] = useState(true);
  const [missingConfig, setMissingConfig] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Record<string, Message>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listAllReports(filter === 'all' ? 'all' : filter)
      .then((rows) => {
        if (!active) return;
        setReports(rows);
        const userIds = new Set<string>();
        const messageIds: string[] = [];
        for (const r of rows) {
          userIds.add(r.reporter_id);
          if (r.target_type === 'user') userIds.add(r.target_id);
          if (r.target_type === 'message') messageIds.push(r.target_id);
        }
        getProfilesByIds([...userIds])
          .then((profiles) => {
            if (!active) return;
            const map: Record<string, string> = {};
            for (const p of profiles) map[p.user_id] = p.display_name;
            setNames(map);
          })
          .catch(() => {});
        if (messageIds.length > 0) {
          getMessagesByIds(messageIds)
            .then((msgs) => {
              if (!active) return;
              const map: Record<string, Message> = {};
              const senderIds = new Set<string>();
              for (const m of msgs) {
                map[m.id] = m;
                senderIds.add(m.sender_id);
              }
              setMessages(map);
              getProfilesByIds([...senderIds])
                .then((profiles) => {
                  if (!active) return;
                  setNames((prev) => {
                    const next = { ...prev };
                    for (const p of profiles) next[p.user_id] = p.display_name;
                    return next;
                  });
                })
                .catch(() => {});
            })
            .catch(() => {});
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (isMissingTable(err)) setMissingConfig(true);
        else toast(err instanceof DbError ? err.message : 'Could not load reports.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [toast, filter]);

  const setStatus = async (id: string, status: UserReport['status']) => {
    setSaving(id);
    try {
      await updateReportStatus(id, status);
      setReports((prev) =>
        filter === 'all' || filter === status
          ? prev.map((r) => (r.id === id ? { ...r, status } : r))
          : prev.filter((r) => r.id !== id),
      );
      toast(`Report marked ${status}.`);
    } catch (err) {
      toast(err instanceof DbError ? err.message : 'Could not update that report.');
    } finally {
      setSaving(null);
    }
  };

  const targetSummary = (r: UserReport): string => {
    if (r.target_type === 'user') return `User: ${names[r.target_id] ?? shortId(r.target_id)}`;
    if (r.target_type === 'message') {
      const m = messages[r.target_id];
      if (!m) return `Message ${shortId(r.target_id)} (no longer available)`;
      const sender = names[m.sender_id] ?? shortId(m.sender_id);
      const body = m.deleted_at ? '(deleted by sender)' : m.content || '(photo)';
      return `${sender}: “${body.slice(0, 160)}${body.length > 160 ? '…' : ''}”`;
    }
    return `${r.target_type} ${shortId(r.target_id)} — review in the Supabase dashboard`;
  };

  if (missingConfig) {
    return (
      <div className="moderation">
        <div className="page-head">
          <div>
            <h1>Moderation</h1>
            <p>Review user reports.</p>
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
    <div className="moderation">
      <div className="page-head">
        <div>
          <h1>Moderation</h1>
          <p>Review reports. Reporters stay anonymous to the reported.</p>
        </div>
      </div>

      <div className="card card-pad">
        <div className="filter-row" role="group" aria-label="Filter reports">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`filter-pill${filter === f.id ? ' is-active' : ''}`}
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="card card-pad">
          <p className="empty-note">Loading reports…</p>
        </div>
      ) : reports.length === 0 ? (
        <div className="card card-pad mod-center">
          <p className="empty-note">
            {filter === 'all'
              ? 'No reports filed. Quiet is good.'
              : `No ${filter} reports.`}
          </p>
        </div>
      ) : (
        <ul className="mod-list">
          {reports.map((r) => {
            const Icon = TYPE_ICONS[r.target_type];
            return (
              <li key={r.id} className="card card-pad mod-card">
                <div className="mod-head">
                  <span className="mod-type">
                    <Icon size={15} aria-hidden="true" />
                    {CATEGORY_LABELS[r.category]}
                  </span>
                  <label className="mod-status">
                    <span className="sr-only">Status for this report</span>
                    <select
                      className="input input-sm"
                      value={r.status}
                      disabled={saving === r.id}
                      onChange={(e) =>
                        setStatus(r.id, e.target.value as UserReport['status'])
                      }
                    >
                      <option value="open">Open</option>
                      <option value="reviewing">Reviewing</option>
                      <option value="resolved">Resolved</option>
                      <option value="dismissed">Dismissed</option>
                    </select>
                  </label>
                </div>
                <p className="mod-target">{targetSummary(r)}</p>
                {r.details.trim() && (
                  <blockquote className="mod-details">“{r.details}”</blockquote>
                )}
                <p className="mod-meta">
                  Reported by {names[r.reporter_id] ?? shortId(r.reporter_id)} ·{' '}
                  {formatDate(r.created_at)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
