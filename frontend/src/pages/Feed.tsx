import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Lightbulb, Send, Sparkles, Trash2, X } from 'lucide-react';
import Avatar from '../components/Avatar';
import PostCard from '../components/PostCard';
import { PostSkeleton } from '../components/Skeleton';
import StoryTray from '../components/StoryTray';
import SuggestedForYou from '../components/SuggestedForYou';
import { useAuth } from '../context/useAuth';
import { useToast } from '../context/useToast';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import {
  createMemory,
  DbError,
  deleteMemory,
  FEED_PAGE_SIZE,
  getCommentCounts,
  getDiscoverableProfiles,
  getLikeCounts,
  getMyLikedIds,
  getMySavedIds,
  listSharedMemoriesByTag,
  listSharedMemoriesPage,
  subscribeToMemoryComments,
  subscribeToMemoryLikes,
  subscribeToMemorySaves,
  TAG_FEED_PAGE_SIZE,
  toggleMemoryLike,
  toggleMemorySave,
} from '../lib/db';
import type { Memory, Profile } from '../lib/db';
import { cursorOf, mergeUniqueById } from '../lib/paging';
import type { PageCursor } from '../lib/paging';
import { memoryHasTag, normalizeTag } from '../lib/trending';
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

/* Back-navigation cache: navigating away (profile, messages…) and returning
   restores the exact list + cursor + scroll position instead of refetching
   from scratch. Invalidated by publishing; keyed by tag filter. */
interface FeedCache {
  key: string;
  posts: Memory[];
  cursor: PageCursor | null;
  hasMore: boolean;
  scrollY: number;
}
let feedCache: FeedCache | null = null;

const ALL_KEY = '__all__';

export default function Feed() {
  const { user } = useAuth();
  const { toast } = useToast();
  const name = user?.name ?? 'Friend';
  const [searchParams] = useSearchParams();
  const activeTag = normalizeTag(searchParams.get('tag') ?? '');
  const feedKey = activeTag || ALL_KEY;
  const useCache = feedCache != null && feedCache.key === feedKey;
  const [loading, setLoading] = useState(() => !useCache);
  const [draft, setDraft] = useState('');
  const [shared, setShared] = useState(true);
  const [posting, setPosting] = useState(false);
  const [posts, setPosts] = useState<Memory[]>(() =>
    useCache && feedCache ? feedCache.posts : [],
  );
  const [cursor, setCursor] = useState<PageCursor | null>(() =>
    useCache && feedCache ? feedCache.cursor : null,
  );
  const [hasMore, setHasMore] = useState(() =>
    useCache && feedCache ? feedCache.hasMore : true,
  );
  // Which tag the visible `posts` belong to (null = none yet). The fetch
  // effect runs whenever this stops matching the active tag.
  const [postsTag, setPostsTag] = useState<string | null>(() =>
    useCache ? feedKey : null,
  );
  const [savedScrollY] = useState(() =>
    useCache && feedCache ? feedCache.scrollY : 0,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState(false);
  const [people, setPeople] = useState<Profile[]>([]);
  const [likeCounts, setLikeCounts] = useState<Record<string, number> | null>(null);
  const [myLikes, setMyLikes] = useState<Set<string>>(new Set());
  const [likesTick, setLikesTick] = useState(0);
  const [commentCounts, setCommentCounts] = useState<Record<string, number> | null>(null);
  const [mySaves, setMySaves] = useState<Set<string>>(new Set());
  const [savesReady, setSavesReady] = useState(false);
  const [commentsTick, setCommentsTick] = useState(0);
  const [savesTick, setSavesTick] = useState(0);
  const myId = user?.id;
  const requestIdRef = useRef(0);
  // Live mirrors for the unmount-save and the sentinel callback.
  const postsRef = useRef(posts);
  const cursorRef = useRef(cursor);
  const hasMoreRef = useRef(hasMore);
  const keyRef = useRef(feedKey);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    postsRef.current = posts;
    cursorRef.current = cursor;
    hasMoreRef.current = hasMore;
    keyRef.current = feedKey;
  });

  // Persist list state on unmount for instant back-navigation.
  useEffect(
    () => () => {
      feedCache = {
        key: keyRef.current,
        posts: postsRef.current,
        cursor: cursorRef.current,
        hasMore: hasMoreRef.current,
        scrollY: window.scrollY,
      };
    },
    [],
  );

  // Restore the saved scroll position after a cache-hit mount.
  useEffect(() => {
    if (savedScrollY > 0) {
      requestAnimationFrame(() => window.scrollTo(0, savedScrollY));
    }
  }, [savedScrollY]);

  // Tag switches start at the top (mounts restore instead — see above).
  const prevTagRef = useRef(activeTag);
  useEffect(() => {
    if (prevTagRef.current !== activeTag) {
      prevTagRef.current = activeTag;
      window.scrollTo(0, 0);
    }
  }, [activeTag]);

  useEffect(() => {
    if (postsTag === activeTag) return;
    let active = true;
    const requestId = ++requestIdRef.current;
    const tag = activeTag;
    const memoriesPromise: Promise<{ rows: Memory[]; rawLast: Memory | null; hasMore: boolean }> = tag
      ? listSharedMemoriesByTag(tag, { limit: TAG_FEED_PAGE_SIZE }).then((page) => ({
          rows: page.rows.filter((m) => memoryHasTag(m, tag)),
          rawLast: page.rows[page.rows.length - 1] ?? null,
          hasMore: page.hasMore,
        }))
      : listSharedMemoriesPage(FEED_PAGE_SIZE).then((page) => ({
          rows: page.rows,
          rawLast: page.rows[page.rows.length - 1] ?? null,
          hasMore: page.hasMore,
        }));
    Promise.all([memoriesPromise, getDiscoverableProfiles(6)])
      .then(([page, profiles]) => {
        if (!active || requestId !== requestIdRef.current) return;
        setPosts(page.rows);
        setCursor(page.rawLast ? cursorOf(page.rawLast) : null);
        setHasMore(page.hasMore);
        setPeople(profiles.filter((p) => p.user_id !== myId).slice(0, 3));
        setPageError(false);
        setPostsTag(tag);
      })
      .catch((err: unknown) => {
        if (!active || requestId !== requestIdRef.current) return;
        // A failed first page leaves no ambiguous state: empty list + error card.
        setPosts([]);
        setCursor(null);
        setHasMore(false);
        setPageError(true);
        setPostsTag(tag);
        toast(err instanceof DbError ? err.message : 'Could not load your feed.');
      })
      .finally(() => {
        if (active && requestId === requestIdRef.current) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [toast, myId, activeTag, postsTag]);

  const loadMore = () => {
    const c = cursorRef.current;
    if (loadingMoreRef.current || !hasMoreRef.current || !c) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setPageError(false);
    const tag = keyRef.current === ALL_KEY ? '' : keyRef.current;
    const promise = tag
      ? listSharedMemoriesByTag(tag, { limit: TAG_FEED_PAGE_SIZE, cursor: c })
      : listSharedMemoriesPage(FEED_PAGE_SIZE, c);
    promise
      .then((page) => {
        const exact = tag
          ? page.rows.filter((m) => memoryHasTag(m, tag))
          : page.rows;
        const rawLast = page.rows[page.rows.length - 1] ?? null;
        setPosts((prev) => mergeUniqueById(prev, exact));
        setCursor(rawLast ? cursorOf(rawLast) : c);
        setHasMore(page.hasMore);
      })
      .catch((err: unknown) => {
        setPageError(true);
        toast(err instanceof DbError ? err.message : 'Could not load more memories.');
      })
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  };

  const sentinelRef = useInfiniteScroll({
    onLoadMore: loadMore,
    hasMore: hasMore && !activeTag,
    loading: loadingMore,
    disabled: loading,
  });

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
      if (shared) {
        feedCache = null;
        setCursor(null);
        setHasMore(true);
        setPostsTag(null);
      }
    } catch (err) {
      toast(err instanceof DbError ? err.message : 'Could not post your memory.');
    } finally {
      setPosting(false);
    }
  };

  const retryFirstPage = () => {
    setPageError(false);
    setLoading(true);
    setPostsTag(null);
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

  const peopleIds = useMemo(() => people.map((p) => p.user_id), [people]);
  // Tag switches (and publish refreshes) show skeletons until the new first
  // page lands.
  const switching = !loading && postsTag !== activeTag;

  if (loading || switching) {
    return (
      <div className="feed" aria-label="Loading feed">
        <PostSkeleton />
        <PostSkeleton />
      </div>
    );
  }

  if (pageError && posts.length === 0) {
    return (
      <div className="feed">
        <div className="feed-head">
          <h1>Home</h1>
        </div>
        <div className="card card-pad feed-empty">
          <h2>Could not load your feed</h2>
          <p>Check your connection and try again.</p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={retryFirstPage}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="feed">
      <div className="feed-head">
        <h1>Home</h1>
      </div>

      {activeTag && (
        <div className="card card-pad tag-filter" role="status">
          <p>
            Showing memories tagged <strong>#{activeTag}</strong>
          </p>
          <Link to="/app" className="btn btn-ghost btn-sm">
            <X size={14} aria-hidden="true" />
            Clear
          </Link>
        </div>
      )}

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
            {activeTag ? (
              <>
                <h2>No memories tagged #{activeTag}</h2>
                <p>Nobody you can see has shared a memory with that tag yet.</p>
                <Link to="/app" className="btn btn-outline btn-sm">
                  Back to full feed
                </Link>
              </>
            ) : (
              <>
                <h2>No community memories yet</h2>
                <p>Be the first — share a memory above, or run the Memory Detective.</p>
                <Link to="/app/detective" className="btn btn-primary btn-sm">
                  Try the Memory Detective
                </Link>
              </>
            )}
          </div>
        ) : (
          <>
            {posts.map((m, idx) => {
              const author = people.find((p) => p.user_id === m.author_id);
              const mine = m.author_id === user?.id;
              const authorName = mine ? name : (author?.display_name ?? null);
              return (
                <Fragment key={m.id}>
                  <div className="feed-post-wrap">
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
              {idx === 2 && (
                <SuggestedForYou limit={3} excludeIds={peopleIds} />
              )}
            </Fragment>
            );
          })}
          {posts.length > 0 && posts.length < 3 && (
            <SuggestedForYou limit={3} excludeIds={peopleIds} />
          )}
          {!activeTag && hasMore && !pageError && (
            <div ref={sentinelRef} className="feed-sentinel" aria-hidden="true" />
          )}
          {loadingMore && (
            <>
              <PostSkeleton />
              <PostSkeleton />
            </>
          )}
          {pageError && (
            <div className="card card-pad feed-more-error" role="alert">
              <p>Could not load more memories.</p>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={loadMore}
              >
                Retry
              </button>
            </div>
          )}
          {!activeTag && !hasMore && !pageError && (
            <p className="feed-end">You&apos;ve explored all available memories</p>
          )}
          {activeTag && hasMore && !pageError && (
            <button
              type="button"
              className="btn btn-outline btn-block feed-load-more"
              onClick={loadMore}
              disabled={loadingMore}
              aria-busy={loadingMore}
            >
              {loadingMore ? 'Loading…' : 'Load More Memories'}
            </button>
          )}
        </>
        )}
      </div>
    </div>
  );
}
