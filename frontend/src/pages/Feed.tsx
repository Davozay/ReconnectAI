import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Lightbulb, Send, Sparkles, Trash2 } from 'lucide-react';
import Avatar from '../components/Avatar';
import PostCard from '../components/PostCard';
import { PostSkeleton } from '../components/Skeleton';
import StoryTray from '../components/StoryTray';
import { useAuth } from '../context/useAuth';
import { useToast } from '../context/useToast';
import {
  createMemory,
  DbError,
  deleteMemory,
  getCommentCounts,
  getDiscoverableProfiles,
  getLikeCounts,
  getMyLikedIds,
  getMySavedIds,
  listSharedMemories,
  subscribeToMemoryComments,
  subscribeToMemoryLikes,
  subscribeToMemorySaves,
  toggleMemoryLike,
  toggleMemorySave,
} from '../lib/db';
import type { Memory, Profile } from '../lib/db';
import { MEMORY_PROMPTS } from '../data/mock';
import type { FeedPost } from '../data/mock';
import './Feed.css';

const POST_COLORS = ['#6255e8', '#e85a4f', '#16a34a', '#0ea5e9', '#d946ef'];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return POST_COLORS[hash % POST_COLORS.length];
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function toPost(m: Memory, authorName: string | null): FeedPost {
  return {
    id: m.id,
    author: authorName ?? 'A ReConnect member',
    handle: '',
    meta: m.title.trim() || 'Childhood memory',
    time: timeAgo(m.created_at),
    text: m.body,
    tags: m.analysis ? ['Memory Detective'] : [],
    likes: 0,
    comments: [],
    color: colorFor(m.id),
    media: [],
  };
}

export default function Feed() {
  const { user } = useAuth();
  const { toast } = useToast();
  const name = user?.name ?? 'Friend';
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [shared, setShared] = useState(true);
  const [posting, setPosting] = useState(false);
  const [posts, setPosts] = useState<Memory[]>([]);
  const [people, setPeople] = useState<Profile[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [likeCounts, setLikeCounts] = useState<Record<string, number> | null>(null);
  const [myLikes, setMyLikes] = useState<Set<string>>(new Set());
  const [likesTick, setLikesTick] = useState(0);
  const [commentCounts, setCommentCounts] = useState<Record<string, number> | null>(null);
  const [mySaves, setMySaves] = useState<Set<string>>(new Set());
  const [savesReady, setSavesReady] = useState(false);
  const [commentsTick, setCommentsTick] = useState(0);
  const [savesTick, setSavesTick] = useState(0);
  const myId = user?.id;

  useEffect(() => {
    let active = true;
    Promise.all([listSharedMemories(30), getDiscoverableProfiles(6)])
      .then(([memories, profiles]) => {
        if (!active) return;
        setPosts(memories);
        setPeople(profiles.filter((p) => p.user_id !== myId).slice(0, 3));
      })
      .catch((err: unknown) => {
        if (active) toast(err instanceof DbError ? err.message : 'Could not load your feed.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [toast, myId, refreshKey]);

  useEffect(() => {
    if (posts.length === 0) return;
    let active = true;
    const ids = posts.map((m) => m.id);
    Promise.all([getLikeCounts(ids), getMyLikedIds(ids)])
      .then(([counts, liked]) => {
        if (!active) return;
        setLikeCounts(counts);
        setMyLikes(liked);
      })
      .catch(() => {
        // Pre-migration fallback: likes stay local-only.
        if (active) setLikeCounts(null);
      });
    return () => {
      active = false;
    };
  }, [posts, likesTick]);

  useEffect(() => {
    return subscribeToMemoryLikes(() => setLikesTick((k) => k + 1));
  }, []);

  useEffect(() => {
    if (posts.length === 0) return;
    let active = true;
    getCommentCounts(posts.map((m) => m.id))
      .then((counts) => {
        if (active) setCommentCounts(counts);
      })
      .catch(() => {
        // Pre-migration fallback: comments stay local-only.
        if (active) setCommentCounts(null);
      });
    return () => {
      active = false;
    };
  }, [posts, commentsTick]);

  useEffect(() => {
    if (posts.length === 0) return;
    let active = true;
    getMySavedIds(posts.map((m) => m.id))
      .then((saved) => {
        if (!active) return;
        setMySaves(saved);
        setSavesReady(true);
      })
      .catch(() => {
        // Pre-migration fallback: saves stay local-only.
        if (active) setSavesReady(false);
      });
    return () => {
      active = false;
    };
  }, [posts, savesTick]);

  useEffect(() => {
    const offComments = subscribeToMemoryComments(() => setCommentsTick((k) => k + 1));
    const offSaves = subscribeToMemorySaves(() => setSavesTick((k) => k + 1));
    return () => {
      offComments();
      offSaves();
    };
  }, []);

  const publish = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      await createMemory({ body: text, shared });
      setDraft('');
      toast(shared ? 'Your memory was shared with the community' : 'Your memory was saved privately');
      if (shared) setRefreshKey((k) => k + 1);
    } catch (err) {
      toast(err instanceof DbError ? err.message : 'Could not post your memory.');
    } finally {
      setPosting(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteMemory(id);
      setPosts((prev) => prev.filter((m) => m.id !== id));
      toast('Memory deleted');
    } catch (err) {
      toast(err instanceof DbError ? err.message : 'Could not delete that memory.');
    }
  };

  const handleToggleLike = async (id: string) => {
    const wasLiked = myLikes.has(id);
    setMyLikes((prev) => {
      const next = new Set(prev);
      if (wasLiked) next.delete(id);
      else next.add(id);
      return next;
    });
    setLikeCounts((prev) =>
      prev ? { ...prev, [id]: Math.max(0, (prev[id] ?? 0) + (wasLiked ? -1 : 1)) } : prev,
    );
    try {
      await toggleMemoryLike(id);
    } catch (err) {
      setMyLikes((prev) => {
        const next = new Set(prev);
        if (wasLiked) next.add(id);
        else next.delete(id);
        return next;
      });
      setLikeCounts((prev) =>
        prev ? { ...prev, [id]: Math.max(0, (prev[id] ?? 0) + (wasLiked ? 1 : -1)) } : prev,
      );
      toast(err instanceof DbError ? err.message : 'Could not update like.');
    }
  };

  const handleToggleSave = async (id: string) => {
    const wasSaved = mySaves.has(id);
    setMySaves((prev) => {
      const next = new Set(prev);
      if (wasSaved) next.delete(id);
      else next.add(id);
      return next;
    });
    try {
      await toggleMemorySave(id);
      toast(wasSaved ? 'Removed from your saved memories' : 'Saved to your memories');
    } catch (err) {
      setMySaves((prev) => {
        const next = new Set(prev);
        if (wasSaved) next.add(id);
        else next.delete(id);
        return next;
      });
      toast(err instanceof DbError ? err.message : 'Could not update save.');
    }
  };

  if (loading) {
    return (
      <div className="feed" aria-label="Loading feed">
        <PostSkeleton />
        <PostSkeleton />
      </div>
    );
  }

  return (
    <div className="feed">
      <div className="feed-head">
        <h1>Home</h1>
      </div>

      <StoryTray />

      <form className="card composer" onSubmit={publish}>
        <div className="composer-top">
          <Avatar name={name} size="md" />
          <textarea
            className="composer-input"
            placeholder="Share a childhood memory…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            aria-label="Share a childhood memory"
          />
        </div>
        <div className="composer-foot">
          <div className="composer-tools">
            <label className="composer-share">
              <input
                type="checkbox"
                checked={shared}
                onChange={(e) => setShared(e.target.checked)}
              />
              <span>Share with community</span>
            </label>
            <div className="composer-prompts">
              <Lightbulb size={15} aria-hidden="true" />
              {MEMORY_PROMPTS.slice(0, 1).map((q) => (
                <button
                  key={q.id}
                  type="button"
                  className="composer-prompt"
                  onClick={() => setDraft((d) => (d ? d : `${q.prompt} `))}
                >
                  {q.prompt}
                </button>
              ))}
            </div>
          </div>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={!draft.trim() || posting}
          >
            <Send size={14} aria-hidden="true" />
            {posting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </form>

      {people.length > 0 && (
        <section className="card card-pad recommend" aria-label="Recommended for you">
          <div className="recommend-head">
            <Sparkles size={17} aria-hidden="true" />
            <h2>People you may remember</h2>
          </div>
          <p className="recommend-sub">
            Old friends and colleagues who opted into discovery.
          </p>
          <ul className="recommend-people">
            {people.map((p) => (
              <li key={p.user_id}>
                <Avatar name={p.display_name} color={colorFor(p.user_id)} size="sm" />
                <div>
                  <p className="recommend-name">{p.display_name}</p>
                  <p className="recommend-sub2">
                    {[p.hometown, p.nickname ? `“${p.nickname}”` : ''].filter(Boolean).join(' · ') || 'ReConnect member'}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <Link to="/app/discover" className="btn btn-outline btn-sm btn-block recommend-more">
            See all suggestions
          </Link>
        </section>
      )}

      <div className="post-list">
        {posts.length === 0 ? (
          <div className="card card-pad feed-empty">
            <h2>No community memories yet</h2>
            <p>Be the first — share a memory above, or run the Memory Detective.</p>
            <Link to="/app/detective" className="btn btn-primary btn-sm">
              Try the Memory Detective
            </Link>
          </div>
        ) : (
          posts.map((m) => {
            const author = people.find((p) => p.user_id === m.author_id);
            const mine = m.author_id === user?.id;
            const authorName = mine ? name : (author?.display_name ?? null);
            return (
              <div key={m.id} className="feed-post-wrap">
                <PostCard
                  post={toPost(m, authorName)}
                  currentUser={name}
                  like={
                    likeCounts
                      ? {
                          count: likeCounts[m.id] ?? 0,
                          liked: myLikes.has(m.id),
                          onToggle: () => handleToggleLike(m.id),
                        }
                      : undefined
                  }
                  save={
                    savesReady
                      ? {
                          saved: mySaves.has(m.id),
                          onToggle: () => handleToggleSave(m.id),
                        }
                      : undefined
                  }
                  commentCount={commentCounts ? (commentCounts[m.id] ?? 0) : undefined}
                  thread={
                    commentCounts && myId
                      ? { memoryAuthorId: m.author_id, myId }
                      : undefined
                  }
                />
                {mine && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm is-danger feed-delete"
                    onClick={() => remove(m.id)}
                    aria-label="Delete this memory"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    Delete
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
