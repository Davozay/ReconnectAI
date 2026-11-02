import { ShieldAlert, Info } from 'lucide-react';
import type { ShieldWarning } from '../lib/shield';
import './ScamWarning.css';

/* Non-accusatory safety notices for a message or pasted text. */
export default function ScamWarning({ warnings }: { warnings: ShieldWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="scam-warnings" aria-label="Safety notices">
      {warnings.map((w) => (
        <li key={w.code} className="scam-warning">
          {w.code === 'new_connection' ? (
            <Info size={16} aria-hidden="true" />
          ) : (
            <ShieldAlert size={16} aria-hidden="true" />
          )}
          <div>
            <strong>{w.title}</strong>
            <p>{w.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
