import { Link, Outlet } from 'react-router-dom';
import Logo from '../components/Logo';
import './MarketingLayout.css';

export default function MarketingLayout() {
  return (
    <div className="marketing">
      <header className="marketing-nav">
        <div className="wrap marketing-nav-inner">
          <Logo />
          <nav className="marketing-links" aria-label="Primary">
            <a href="#how">How it works</a>
            <a href="#detective">Memory Detective</a>
            <a href="#privacy">Privacy</a>
          </nav>
          <div className="marketing-cta">
            <Link to="/login" className="btn btn-ghost btn-sm">
              Sign in
            </Link>
            <Link to="/signup" className="btn btn-primary btn-sm">
              Start reconnecting
            </Link>
          </div>
        </div>
      </header>

      <main>
        <Outlet />
      </main>

      <footer className="marketing-footer">
        <div className="wrap marketing-footer-inner">
          <div>
            <Logo to="/" />
            <p className="marketing-tagline">
              Rediscover people. Relive memories.
            </p>
          </div>
          <nav className="marketing-foot-links" aria-label="Footer">
            <Link to="/login">Sign in</Link>
            <Link to="/signup">Create account</Link>
            <a href="#privacy">Privacy promise</a>
          </nav>
        </div>
        <div className="wrap marketing-foot-base">
          <small>
            Built for the Meta Global AI Developer Hackathon 2026 · Demo
            preview
          </small>
        </div>
      </footer>
    </div>
  );
}
