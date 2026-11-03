import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import Avatar from '../components/Avatar';
import MemoryArt from '../components/MemoryArt';
import MembershipButton from '../components/MembershipButton';
import { useToast } from '../context/useToast';
import { DbError, getProfilesByIds } from '../lib/db';
import type { Memory } from '../lib/db';
import {
  formatMemberCount,
  getCommunity,
  getMemberCounts,
  joinCommunity,
  listCommunityMembers,
  listMemberMemories,
  listMyCommunityIds,
} from '../lib/communities';
import type { Community } from '../lib/communities';
import './CommunityDetails.css';

const COLORS = ['#6255e8', '#e85a4f', '#16a34a', '#0ea5e9', '#d946ef'];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function CommunityDetails() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [community, setCommunity] = useState<Community | null>(null);
  const [count, setCount] = useState(0);
  const [joined, setJoined] = useState(false);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [memories, setMemories] = useState<Memory[]>([]);
  const [contentKey, setContentKey] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      const found = await getCommunity(id);
      if (!active) return;
      if (!found) {
        setCommunity(null);
        setLoading(false);
        return;
      }
      setCommunity(found);
      const [counts, myIds] = await Promise.all([
        getMemberCounts([found.id]),
        listMyCommunityIds([found.id]),
      ]);
      if (!active) return;
      setCount(counts[found.id] ?? 0);
      setJoined(myIds.has(found.id));
      setLoading(false);
    })().catch((err: unknown) => {
      if (active) {
        toast(err instanceof DbError ? err.message : 'Could not load that community.');
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [id, toast]);

  // Members + their shared memories: visible to members only (RLS).
  useEffect(() => {
    if (!id || !joined) return;
    let active = true;
    listCommunityMembers(id)
      .then((rows) => {
        if (!active) return;
        const ids = rows.map((r) => r.user_id);
        setMemberIds(ids);
        return Promise.all([getProfilesByIds(ids), listMemberMemories(ids)]).then(
          ([profiles, shared]) => {
            if (!active) return;
            const byId: Record<string, string> = {};
            for (const p of profiles) byId[p.user_id] = p.display_name;
            setNames(byId);
            setMemories(shared);
            setContentKey(id);
          },
        );
      })
      .catch((err: unknown) => {
        if (active) toast(err instanceof DbError ? err.message : 'Could not load community content.');
      });
    return () => {
      active = false;
    };
  }, [id, joined, toast]);

  const membershipChanged = (next: boolean) => {
    setJoined(next);
    setCount((c) => Math.max(0, c + (next ? 1 : -1)));
    // Fresh (or cleared) content on every toggle; the effect refetches on join.
    setMemberIds([]);
    setNames({});
    setMemories([]);
    setContentKey(null);
  };

  // Joining from the locked-content prompt reuses the same toggle path.
  const joinFromPrompt = async () => {
    if (!community) return;
    try {
      await joinCommunity(community.id);
      membershipChanged(true);
      toast(`You joined ${community.name}`);
    } catch (err) {
      toast(err instanceof DbError ? err.message : 'Could not join that community.');
    }
  };

  if (loading) {
    return (
      <div className="community-details" aria-label="Loading community">
        <div className="card card-pad">
          <p className="community-details-empty">Loading community…</p>
        </div>
      </div>
    );
  }

  if (!community) {
    return (
      <div className="community-details">
        <div className="card card-pad">
          <h2 className="community-details-title">Community not found</h2>
          <p className="community-details-empty">
            It may have been deleted. <Link to="/app/communities">Browse communities</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="community-details">
      <Link to="/app/communities" className="btn btn-ghost btn-sm community-details-back">
        <ArrowLeft size={15} aria-hidden="true" />
        All communities
      </Link>

      <div className="card card-pad community-details-head">
        <span className="community-details-art">
          <MemoryArt
            seed={community.image_seed || `community-${community.id}`}
            label=""
            ratio="square"
          />
        </span>
        <div className="community-details-id">
          <h1>{community.name}</h1>
          <p className="community-details-sub">{formatMemberCount(count)}</p>
          {community.description.trim() && (
            <p className="community-details-desc">{community.description}</p>
          )}
        </div>
        <MembershipButton
          communityId={community.id}
          communityName={community.name}
          joined={joined}
          onChange={membershipChanged}
          small
        />
      </div>

      {!joined ? (
        <div className="card card-pad">
          <h2 className="community-details-title">Members only</h2>
          <p className="community-details-empty">
            Join {community.name} to see its members and the memories they shared.
          </p>
          <button type="button" className="btn btn-primary btn-sm" onClick={joinFromPrompt}>
            Join {community.name}
          </button>
        </div>
      ) : contentKey !== id ? (
        <div className="card card-pad">
          <p className="community-details-empty">Loading community content…</p>
        </div>
      ) : (
        <>
          <div className="card card-pad">
            <h2 className="community-details-title">Members ({memberIds.length})</h2>
            {memberIds.length === 0 ? (
              <p className="community-details-empty">No members to show yet.</p>
            ) : (
              <ul className="community-details-members">
                {memberIds.map((uid) => (
                  <li key={uid}>
                    <Avatar name={names[uid] ?? '?'} color={colorFor(uid)} size="sm" />
                    <span>{names[uid] ?? 'A ReConnect member'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card card-pad">
            <h2 className="community-details-title">Shared memories</h2>
            {memories.length === 0 ? (
              <p className="community-details-empty">
                No shared memories from members yet — members’ public memories appear here.
              </p>
            ) : (
              <ul className="community-details-memories">
                {memories.map((m) => (
                  <li key={m.id}>
                    <p className="community-details-memory-head">
                      <strong>{names[m.author_id] ?? 'A ReConnect member'}</strong>
                      <span> · {formatDate(m.created_at)}</span>
                    </p>
                    {m.title.trim() && (
                      <p className="community-details-memory-title">{m.title}</p>
                    )}
                    <p className="community-details-memory-body">{m.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
