import { Link } from 'react-router-dom';
import { ArrowRight, Construction } from 'lucide-react';
import SimBadge from '../components/SimBadge';
import './ComingSoon.css';

export default function ComingSoon({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="card card-pad soon">
      <Construction size={30} strokeWidth={1.5} aria-hidden="true" />
      <h1>{title}</h1>
      <p>{body}</p>
      <div className="soon-row">
        <SimBadge label="Next milestone" />
        <Link to="/app/detective" className="btn btn-primary btn-sm">
          Try the Memory Detective
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
