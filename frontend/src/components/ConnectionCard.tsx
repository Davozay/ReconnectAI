import { useState } from 'react';
import {
  CalendarDays,
  GraduationCap,
  MapPin,
  ShieldCheck,
  Smile,
  UserRound,
} from 'lucide-react';
import Avatar from './Avatar';
import ConnectButton from './ConnectButton';
import Modal from './Modal';
import type { MatchHighlights } from '../lib/api';
import './ConnectionCard.css';

export interface CardMatch {
  id: string;
  name: string;
  detail: string;
  strength: string;
  reasons: string[];
  color: string;
  highlights: MatchHighlights;
}

const STRENGTH_CLASS: Record<string, string> = {
  'Strong overlap': 'pill-green',
  Possible: 'pill-indigo',
  'Worth a look': 'pill-amber',
};

function HighlightBadges({ highlights }: { highlights: MatchHighlights }) {
  return (
    <div className="conn-badges">
      {highlights.schools.slice(0, 2).map((s) => (
        <span key={`s-${s}`} className="pill pill-indigo">
          <GraduationCap size={12} aria-hidden="true" />
          {s}
        </span>
      ))}
      {highlights.places.slice(0, 1).map((p) => (
        <span key={`p-${p}`} className="pill pill-neutral">
          <MapPin size={12} aria-hidden="true" />
          {p}
        </span>
      ))}
      {highlights.years.slice(0, 1).map((y) => (
        <span key={`y-${y}`} className="pill pill-neutral">
          <CalendarDays size={12} aria-hidden="true" />
          {y}
        </span>
      ))}
      {highlights.nicknames.slice(0, 1).map((n) => (
        <span key={`n-${n}`} className="pill pill-amber">
          <Smile size={12} aria-hidden="true" />
          “{n}”
        </span>
      ))}
    </div>
  );
}

export default function ConnectionCard({ match }: { match: CardMatch }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const nickname = match.highlights.nicknames[0];
  const school = match.highlights.schools[0];
  const place = match.highlights.places[0];
  const years = match.highlights.years[0];

  return (
    <li className="card conn-card">
      <div className="conn-top">
        <Avatar name={match.name} color={match.color} size="lg" />
        <span className={`pill ${STRENGTH_CLASS[match.strength] ?? 'pill-neutral'}`}>
          {match.strength}
        </span>
      </div>
      <p className="conn-name">{match.name}</p>
      {nickname && <p className="conn-nick">aka “{nickname}”</p>}
      <p className="conn-detail">{match.detail}</p>
      {(school ?? place ?? years) && (
        <p className="conn-facts">
          {[school, place, years].filter(Boolean).join(' · ')}
        </p>
      )}
      <HighlightBadges highlights={match.highlights} />
      {match.reasons[0] && <p className="conn-why">{match.reasons[0]}</p>}
      <div className="conn-actions">
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => setProfileOpen(true)}
        >
          <UserRound size={15} aria-hidden="true" />
          View Profile
        </button>
        <ConnectButton name={match.name} small />
      </div>

      <Modal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        label={`Why ${match.name} was suggested`}
      >
        <div className="conn-modal-head">
          <Avatar name={match.name} color={match.color} size="lg" />
          <div>
            <h2 className="conn-modal-name">{match.name}</h2>
            <p className="conn-modal-detail">{match.detail}</p>
          </div>
        </div>
        <HighlightBadges highlights={match.highlights} />
        <h3 className="conn-modal-why">Why you may remember each other</h3>
        <ul className="match-reasons">
          {match.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <div className="notice notice-indigo conn-modal-note">
          <ShieldCheck size={16} aria-hidden="true" />
          <p>
            A possibility with explanations — not a verified identity, and
            never based on faces.
          </p>
        </div>
        <div className="conn-modal-actions">
          <ConnectButton name={match.name} />
        </div>
      </Modal>
    </li>
  );
}
