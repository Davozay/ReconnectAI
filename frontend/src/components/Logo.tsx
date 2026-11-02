import { Link } from 'react-router-dom';
import './Logo.css';

export default function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="logo" aria-label="ReConnect AI home">
      <span className="logo-mark" aria-hidden="true">
        <span className="logo-ring logo-ring-a" />
        <span className="logo-ring logo-ring-b" />
      </span>
      <span className="logo-word">
        ReConnect <em>AI</em>
      </span>
    </Link>
  );
}
