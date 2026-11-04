import { initials } from '../data/content';
import './Avatar.css';

interface AvatarProps {
  name: string;
  color?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Gradient ring for unviewed stories; 'viewed' renders a plain ring. */
  ring?: boolean | 'viewed';
}

export default function Avatar({
  name,
  color = 'var(--accent)',
  size = 'md',
  ring = false,
}: AvatarProps) {
  const core = (
    <span
      className={`avatar avatar-${size}`}
      style={{ background: color }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
  if (!ring) return core;
  return (
    <span
      className={`avatar-ring${ring === 'viewed' ? ' is-viewed' : ''}`}
      aria-hidden="true"
    >
      {core}
    </span>
  );
}
