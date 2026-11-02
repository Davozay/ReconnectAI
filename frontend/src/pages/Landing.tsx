import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Camera,
  MessagesSquare,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import Reveal from '../components/Reveal';
import SimBadge from '../components/SimBadge';
import './Landing.css';

const TICKER = [
  'Maplewood Elementary ’98',
  '“Jo-Jo”',
  'Riverside Primary',
  'Sports day trophy',
  'Mrs. Whitfield’s class',
  'St. Anne’s High ’05',
  'Class picnic ’97',
  '“Captain Curly”',
];

const STEPS = [
  {
    n: '01',
    title: 'Share a photo or a memory',
    body: 'Upload an old class photo or write down what you remember — a nickname, a teacher, the walk to school. Everything stays private by default.',
  },
  {
    n: '02',
    title: 'Let the Memory Detective read the clues',
    body: 'AI extracts school names, dates, places, and details from your photo and notes. Never faces — we don’t do facial recognition, ever.',
  },
  {
    n: '03',
    title: 'Meet explainable matches',
    body: 'See people you may know, with clear reasons why — same school, same years, same stories. You both agree before connecting.',
  },
];

const PRIVACY = [
  {
    title: 'Opt-in discovery',
    body: 'Nobody can find you unless you switch discovery on — per school, per era, per memory.',
  },
  {
    title: 'Private-by-default photos',
    body: 'Uploads are visible to you alone until you explicitly share them with a match.',
  },
  {
    title: 'No face database',
    body: 'We never identify people by face or build searchable biometric records. Clues come from text, places, and stories you volunteer.',
  },
  {
    title: 'Mutual acceptance',
    body: 'A reconnection only happens when both sides say yes. Either side can withdraw at any time.',
  },
];

export default function Landing() {
  return (
    <div className="landing">
      {/* HERO */}
      <section className="wrap hero">
        <motion.div
          className="hero-copy"
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="kicker">For everyone you lost touch with</p>
          <h1>
            Find the friends <span className="accent-word">time scattered.</span>
          </h1>
          <p className="hero-sub">
            ReConnect AI helps you rediscover childhood friends, former
            classmates and colleagues, and long-lost acquaintances — through
            old photographs, half-remembered nicknames, and the stories only
            you share.
          </p>
          <div className="hero-actions">
            <Link to="/signup" className="btn btn-primary btn-lg">
              Start reconnecting
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link to="/app/detective" className="btn btn-outline btn-lg">
              <ScanSearch size={18} aria-hidden="true" />
              Try the Detective
            </Link>
          </div>
          <div className="hero-proof">
            <span className="hero-avatars" aria-hidden="true">
              <i style={{ background: '#6255e8' }}>MR</i>
              <i style={{ background: '#e85a4f' }}>DO</i>
              <i style={{ background: '#16a34a' }}>PS</i>
              <i style={{ background: '#17171e' }}>+</i>
            </span>
            <p>
              <strong>12,400+ memories</strong> shared by early members
            </p>
          </div>
        </motion.div>

        <motion.div
          className="hero-collage"
          initial={{ opacity: 0, scale: 0.96, rotate: 1 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ duration: 0.7, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          aria-hidden="true"
        >
          <figure className="polaroid polaroid-a">
            <span className="polaroid-photo">
              <Camera size={30} strokeWidth={1.5} />
            </span>
            <figcaption>sports day ’98 🏆</figcaption>
          </figure>
          <figure className="polaroid polaroid-b">
            <span className="polaroid-photo photo-amber">
              <Users size={30} strokeWidth={1.5} />
            </span>
            <figcaption>class 4B, back row?</figcaption>
          </figure>
          <div className="match-card">
            <p className="match-card-kicker">
              <Sparkles size={13} aria-hidden="true" />
              Possible match
            </p>
            <p className="match-card-name">J. Mensah</p>
            <p className="match-card-why">
              Same school · same years · same trophy story
            </p>
          </div>
        </motion.div>
      </section>

      {/* TICKER */}
      <div className="ticker" aria-hidden="true">
        <div className="ticker-track">
          {[...TICKER, ...TICKER].map((item, i) => (
            <span key={i} className="ticker-item">
              {item}
            </span>
          ))}
        </div>
      </div>

      {/* HOW IT WORKS */}
      <section id="how" className="wrap section how">
        <Reveal>
          <p className="kicker">How it works</p>
          <h2>
            Three small steps to a <span className="accent-word">big reunion.</span>
          </h2>
        </Reveal>
        <ol className="how-steps">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.08}>
              <li className="how-step">
                <span className="how-num">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* DETECTIVE PREVIEW */}
      <section id="detective" className="detective-band">
        <div className="wrap detective-grid">
          <Reveal>
            <div>
              <p className="kicker">AI Memory Detective</p>
              <h2>
                Your old photos are full of{' '}
                <span className="accent-word">clues.</span>
              </h2>
              <p>
                Upload a childhood photograph and the Detective reads what’s
                visible — banner text, dates, uniforms, places — then combines
                it with your memories to suggest who else might share them.
              </p>
              <ul className="detective-points">
                <li>
                  <ScanSearch size={17} aria-hidden="true" />
                  Reads text and scenes in photos (OCR + vision)
                </li>
                <li>
                  <MessagesSquare size={17} aria-hidden="true" />
                  Understands nicknames and half-remembered stories
                </li>
                <li>
                  <ShieldCheck size={17} aria-hidden="true" />
                  Explains every match — never claims verified identity
                </li>
              </ul>
              <div className="detective-cta">
                <Link to="/app/detective" className="btn btn-dark">
                  Open the Memory Detective
                  <ArrowRight size={17} aria-hidden="true" />
                </Link>
                <SimBadge />
              </div>
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="detective-mock" aria-hidden="true">
              <div className="mock-head">
                <span className="mock-dot" />
                <span className="mock-dot" />
                <span className="mock-dot" />
                <span className="mock-title">sports-day-1998.jpg</span>
              </div>
              <div className="mock-photo">
                <Camera size={34} strokeWidth={1.25} />
                <span>Your photo stays private</span>
              </div>
              <ul className="mock-clues">
                <li>
                  <span>School banner</span>
                  <strong>“Hills Christian Academy, Maitama”</strong>
                </li>
                <li>
                  <span>Date on trophy</span>
                  <strong>2013</strong>
                </li>
                <li>
                  <span>Scene</span>
                  <strong>Sports field, class event</strong>
                </li>
              </ul>
            </div>
          </Reveal>
        </div>
      </section>

      {/* PRIVACY */}
      <section id="privacy" className="privacy-band">
        <div className="wrap privacy-grid">
          <Reveal>
            <div>
              <p className="kicker kicker-light">The privacy promise</p>
              <h2 className="privacy-title">
                Nostalgia should never cost you your privacy.
              </h2>
              <p className="privacy-sub">
                Reconnection only works with trust. These four rules are
                non-negotiable in everything we build.
              </p>
              <Link to="/signup" className="btn btn-amber">
                Join with confidence
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
            </div>
          </Reveal>
          <div className="privacy-list">
            {PRIVACY.map((p, i) => (
              <Reveal key={p.title} delay={i * 0.06}>
                <div className="privacy-row">
                  <ShieldCheck size={20} aria-hidden="true" />
                  <div>
                    <h3>{p.title}</h3>
                    <p>{p.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CLOSING CTA */}
      <section className="wrap section closing">
        <Reveal>
          <h2>
            Someone out there remembers <span className="accent-word">you</span>,
            too.
          </h2>
          <p>
            Your desk mate. Your teammate. The kid who shared your umbrella
            every rainy walk home. Say hello again.
          </p>
          <Link to="/signup" className="btn btn-primary btn-lg">
            Begin your story
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </Reveal>
      </section>
    </div>
  );
}
