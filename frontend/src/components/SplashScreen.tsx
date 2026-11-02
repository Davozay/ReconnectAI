import { useState } from 'react';
import './SplashScreen.css';

/* Cinematic boot splash for ReConnect AI: ambient light → rings enter and
   interlock → wordmark reveal → AI glow. Pure CSS/SVG, no dependencies.
   Timing is event-driven (animation/transition end) so it never blocks the
   main thread and needs no JS animation loop. Shows until `ready` flips
   (auth session restored), holds the finished logo if loading runs long,
   then fades out and reports via onExited for unmount. */
export default function SplashScreen({
  ready,
  onExited,
}: {
  ready: boolean;
  onExited: () => void;
}) {
  // Minimum display so instant restores read as a brand flash, not a flicker.
  const [minElapsed, setMinElapsed] = useState(false);
  const leaving = ready && minElapsed;

  return (
    <div
      className={`splash${leaving ? ' is-leaving' : ''}`}
      role="status"
      aria-label="Loading ReConnect AI"
      onAnimationEnd={(e) => {
        // Only the root's invisible 0.9s timer (child animations bubble up too).
        if (e.target === e.currentTarget) setMinElapsed(true);
      }}
      onTransitionEnd={(e) => {
        if (leaving && e.target === e.currentTarget && e.propertyName === 'opacity') {
          onExited();
        }
      }}
    >
      <div className="splash-ambient" aria-hidden="true">
        <span className="splash-glow is-left" />
        <span className="splash-glow is-right" />
      </div>

      <div className="splash-core" aria-hidden="true">
        <svg className="splash-rings" viewBox="0 0 240 140">
          <defs>
            <linearGradient id="splash-grad-a" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#6255e8" />
            </linearGradient>
            <linearGradient id="splash-grad-b" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ff766b" />
              <stop offset="100%" stopColor="#f472b6" />
            </linearGradient>
            <radialGradient id="splash-pulse-grad">
              <stop offset="0%" stopColor="#c482ff" stopOpacity="0.85" />
              <stop offset="55%" stopColor="#ff82aa" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#ff82aa" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle className="splash-pulse" cx="120" cy="70" r="34" fill="url(#splash-pulse-grad)" />
          <g className="splash-ring-a">
            <circle
              cx="88"
              cy="70"
              r="44"
              fill="none"
              stroke="url(#splash-grad-a)"
              strokeWidth="13"
            />
          </g>
          <g className="splash-ring-b">
            <circle
              cx="152"
              cy="70"
              r="44"
              fill="none"
              stroke="url(#splash-grad-b)"
              strokeWidth="13"
            />
          </g>
          {/* Weave: a short arc of the left ring redrawn on top (same
              entrance animation as its ring), so the crossings interlock
              over-under instead of just overlapping. */}
          <g className="splash-ring-a">
            <circle
              cx="88"
              cy="70"
              r="44"
              fill="none"
              stroke="url(#splash-grad-a)"
              strokeWidth="13"
              strokeLinecap="round"
              strokeDasharray="23 253.5"
              transform="rotate(302 88 70)"
            />
          </g>
        </svg>
        <p className="splash-word">
          ReConnect <em>AI</em>
        </p>
      </div>
    </div>
  );
}
