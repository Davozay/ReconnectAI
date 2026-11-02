import { FlaskConical } from 'lucide-react';

export default function SimBadge({ label = 'Simulated' }: { label?: string }) {
  return (
    <span className="sim-badge" title="Demo preview — backend not connected yet">
      <FlaskConical size={12} strokeWidth={2.5} aria-hidden="true" />
      {label}
    </span>
  );
}
