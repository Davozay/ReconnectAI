import { useId } from 'react';
import './MemoryArt.css';

/* Generative "memory photo" — deterministic abstract art derived from a
   seed string, standing in for user photos until real uploads exist. */

const PALETTES: [string, string][] = [
  ['#6255e8', '#b7aefc'],
  ['#ff766b', '#ffc9c4'],
  ['#0ea5e9', '#a5e3fc'],
  ['#16a34a', '#a9e8c3'],
  ['#d946ef', '#f3b8fd'],
  ['#f59e0b', '#fde3ae'],
];

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function MemoryArt({
  seed,
  label,
  ratio = 'landscape',
  className = '',
}: {
  seed: string;
  label: string;
  ratio?: 'landscape' | 'square' | 'story';
  className?: string;
}) {
  const uid = useId().replace(/[:]/g, '');
  const h = hashSeed(seed);
  const rand = mulberry32(h);
  const [deep, soft] = PALETTES[h % PALETTES.length];
  const circles = Array.from({ length: 5 }, (_, i) => ({
    cx: 8 + rand() * 84,
    cy: 8 + rand() * 84,
    r: 10 + rand() * 26,
    o: 0.25 + rand() * 0.45,
    dark: i % 2 === 0,
  }));
  const sunX = 12 + rand() * 60;
  const sunY = 10 + rand() * 30;

  return (
    <div className={`memory-art ratio-${ratio} ${className}`} aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={`g-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={soft} />
            <stop offset="100%" stopColor={deep} />
          </linearGradient>
          <filter id={`n-${uid}`}>
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves="2"
              result="n"
            />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.06 0" />
            <feComposite operator="over" in2="SourceGraphic" />
          </filter>
        </defs>
        <g filter={`url(#n-${uid})`}>
          <rect width="100" height="100" fill={`url(#g-${uid})`} />
          <circle cx={sunX} cy={sunY} r="9" fill="#ffffff" opacity="0.85" />
          {circles.map((c, i) => (
            <circle
              key={i}
              cx={c.cx}
              cy={c.cy}
              r={c.r}
              fill={c.dark ? deep : '#ffffff'}
              opacity={c.o}
            />
          ))}
          <ellipse cx="50" cy="108" rx="70" ry="26" fill={deep} opacity="0.35" />
        </g>
      </svg>
      <span className="memory-art-label">{label}</span>
    </div>
  );
}
