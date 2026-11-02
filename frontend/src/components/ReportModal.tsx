import { useState } from 'react';
import { Flag } from 'lucide-react';
import Modal from './Modal';
import { REPORT_CATEGORIES } from '../lib/shield';
import { DbError, createReport } from '../lib/db';
import type { UserReport } from '../lib/db';
import { useAuth } from '../context/useAuth';
import { useToast } from '../context/useToast';
import './ReportModal.css';

type ReportCategory = UserReport['category'];

export default function ReportModal({
  open,
  onClose,
  targetId,
  targetName,
  targetType = 'user',
}: {
  open: boolean;
  onClose: () => void;
  targetId: string;
  targetName: string;
  targetType?: UserReport['target_type'];
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [category, setCategory] = useState<ReportCategory>('scam');
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!user) {
      setError('Sign in to send a report.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      await createReport({
        target_type: targetType,
        target_id: targetId,
        category,
        details: details.trim(),
      });
      toast('Report sent. Our team will review it.');
      setDetails('');
      onClose();
    } catch (err) {
      setError(
        err instanceof DbError ? err.message : 'Could not send the report.',
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} label={`Report ${targetName}`}>
      <div className="report-modal">
        <h2>
          <Flag size={18} aria-hidden="true" />
          Report {targetName}
        </h2>
        <p className="report-sub">
          Reports go to ReConnect moderators only — never to the person you
          report. False reports may limit your account.
        </p>
        <label className="field">
          <span className="field-label">What happened?</span>
          <select
            className="select"
            value={category}
            onChange={(e) => setCategory(e.target.value as ReportCategory)}
          >
            {REPORT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Details (optional)</span>
          <textarea
            className="textarea"
            rows={3}
            maxLength={2000}
            placeholder="What did they do? Anything we should know…"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="report-actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={sending}
          >
            {sending ? 'Sending…' : 'Send report'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
