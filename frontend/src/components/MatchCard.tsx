import Avatar from './Avatar';
import ConnectButton from './ConnectButton';
import type { PotentialMatch } from '../data/mock';
import './MatchCard.css';

const CONFIDENCE_CLASS: Record<string, string> = {
  'Strong overlap': 'pill-green',
  Possible: 'pill-indigo',
  'Worth a look': 'pill-amber',
};

export default function MatchCard({
  match,
  compact = false,
}: {
  match: PotentialMatch;
  compact?: boolean;
}) {
  return (
    <div className={`match-card2${compact ? ' is-compact' : ''}`}>
      <Avatar name={match.name} color={match.color} size={compact ? 'sm' : 'md'} />
      <div className="match-card2-body">
        <p className="match-card2-name">
          {match.name}
          <span className="match-card2-handle">{match.handle}</span>
        </p>
        <p className="match-card2-detail">{match.detail}</p>
        {!compact && (
          <>
            <span className={`pill ${CONFIDENCE_CLASS[match.confidence]}`}>
              {match.confidence}
            </span>
            <ul className="match-card2-reasons">
              {match.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="match-card2-action">
        <ConnectButton name={match.name} small={compact} />
      </div>
    </div>
  );
}
