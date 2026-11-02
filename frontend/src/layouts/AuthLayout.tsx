import { Outlet } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import Logo from '../components/Logo';
import './AuthLayout.css';

export default function AuthLayout() {
  return (
    <div className="auth-shell">
      <aside className="auth-side" aria-hidden="true">
        <div className="dot-grid-light auth-side-inner">
          <Logo to="/" />
          <blockquote className="auth-quote">
            “Twenty years later, one class photo found my best friend from
            Maplewood. I cried at the reunion.”
            <footer>— Amara, beta member</footer>
          </blockquote>
          <div className="auth-side-badges">
            <span className="pill pill-amber">Private by default</span>
            <span className="pill pill-amber">No facial recognition</span>
            <span className="pill pill-amber">Mutual acceptance only</span>
          </div>
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-main-inner">
          <div className="auth-mobile-logo">
            <Logo to="/" />
          </div>
          <Outlet />
          <p className="auth-assurance">
            <ShieldCheck size={15} aria-hidden="true" />
            Your photos stay private until you choose to share them.
          </p>
        </div>
      </main>
    </div>
  );
}
