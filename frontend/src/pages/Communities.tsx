import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import MemoryArt from '../components/MemoryArt';
import MembershipButton from '../components/MembershipButton';
import { useToast } from '../context/useToast';
import { DbError } from '../lib/db';
import {
  createCommunity,
  formatMemberCount,
  getMemberCounts,
  listCommunities,
  listMyCommunityIds,
} from '../lib/communities';
import type { Community } from '../lib/communities';
import './Communities.css';

export default function Communities() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;
    listCommunities()
      .then(async (rows) => {
        if (!active) return;
        setCommunities(rows);
        const ids = rows.map((c) => c.id);
        const [loadedCounts, myIds] = await Promise.all([
          getMemberCounts(ids),
          listMyCommunityIds(ids),
        ]);
        if (!active) return;
        setCounts(loadedCounts);
        setMine(myIds);
      })
      .catch((err: unknown) => {
        if (active) toast(err instanceof DbError ? err.message : 'Could not load communities.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [toast]);

  const membershipChanged = (id: string, joined: boolean) => {
    setMine((prev) => {
      const next = new Set(prev);
      if (joined) next.add(id);
      else next.delete(id);
      return next;
    });
    setCounts((prev) => ({
      ...prev,
      [id]: Math.max(0, (prev[id] ?? (joined ? 0 : 1)) + (joined ? 1 : -1)),
    }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const created = await createCommunity({ name, description });
      setCommunities((prev) => [created, ...prev]);
      setCounts((prev) => ({ ...prev, [created.id]: 1 }));
      setMine((prev) => new Set(prev).add(created.id));
      setName('');
      setDescription('');
      toast(`“${created.name}” is live — you are its first member`);
    } catch (err) {
      toast(err instanceof DbError ? err.message : 'Could not create that community.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="communities">
      <div className="page-head">
        <div>
          <h1>Communities</h1>
          <p>Childhood schools, neighborhoods, and crews — open to everyone.</p>
        </div>
      </div>

      <form className="card card-pad community-new" onSubmit={submit}>
        <h2>Start a community</h2>
        <div className="community-new-row">
          <label className="field community-new-name">
            <span className="field-label">Name</span>
            <input
              className="input"
              type="text"
              placeholder="e.g. Maplewood Elementary Alumni"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              aria-label="Community name"
            />
          </label>
          <label className="field community-new-desc">
            <span className="field-label">Description (optional)</span>
            <input
              className="input"
              type="text"
              placeholder="Who is this community for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              aria-label="Community description"
            />
          </label>
          <button
            type="submit"
            className="btn btn-primary btn-sm community-new-btn"
            disabled={!name.trim() || creating}
          >
            <Plus size={15} aria-hidden="true" />
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>

      {loading ? (
        <div className="card card-pad">
          <p className="community-empty">Loading communities…</p>
        </div>
      ) : communities.length === 0 ? (
        <div className="card card-pad">
          <h2 className="community-empty-title">No communities yet</h2>
          <p className="community-empty">
            Be the first — start one above for your school, street, or crew.
          </p>
        </div>
      ) : (
        <ul className="community-list">
          {communities.map((c) => (
            <li key={c.id} className="card card-pad community-card">
              <Link
                to={`/app/communities/${c.id}`}
                className="community-thumb"
                aria-label={`Open ${c.name}`}
              >
                <MemoryArt seed={c.image_seed || `community-${c.id}`} label="" ratio="square" />
              </Link>
              <div className="community-card-body">
                <Link to={`/app/communities/${c.id}`} className="community-name">
                  {c.name}
                </Link>
                <p className="community-sub">{formatMemberCount(counts[c.id] ?? 0)}</p>
                {c.description.trim() && (
                  <p className="community-desc">{c.description}</p>
                )}
              </div>
              <MembershipButton
                communityId={c.id}
                communityName={c.name}
                joined={mine.has(c.id)}
                onChange={(joined) => membershipChanged(c.id, joined)}
                small
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
