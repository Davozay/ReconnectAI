import { useEffect, useState } from 'react';
import { Eye, Heart, Trash2, X } from 'lucide-react';
import Avatar from './Avatar';
import { useToast } from '../context/useToast';
import { DbError, getProfilesByIds } from '../lib/db';
import {
  deleteStory,
  listStoryLikes,
  listStoryViews,
  markStoryViewed,
  subscribeToStories,
  toggleStoryLike,
} from '../lib/stories';
import type { Story, StoryLike, StoryView } from '../lib/stories';
import { StorageError, deleteStoryMedia, getStoryMediaUrl } from '../lib/storage';
import './StoryViewer.css';

export interface StoryGroup {
  authorId: string;
  name: string;
  color: string;
  /** Chronological (oldest first). */
  stories: Story[];
}

function errMessage(err: unknown): string {
  return err instanceof DbError || err instanceof StorageError || err instanceof Error
    ? err.message
    : 'Something went wrong.';
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

function StoryImage({ path, caption }: { path: string; caption: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getStoryMediaUrl(path)
      .then((u) => {
        if (active) setUrl(u);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [path]);

  if (!url) return <p className="story-loading">Loading…</p>;
  return <img src={url} alt={caption.trim() || 'Story photo'} className="story-img" />;
}

export default function StoryViewer({
  groups,
  startGroup,
  myId,
  onClose,
  onDeleted,
}: {
  groups: StoryGroup[];
  startGroup: number;
  myId: string;
  onClose: () => void;
  onDeleted: (storyId: string) => void;
}) {
  const { toast } = useToast();
  const [authorId, setAuthorId] = useState(groups[startGroup]?.authorId ?? '');
  const [storyId, setStoryId] = useState(groups[startGroup]?.stories[0]?.id ?? '');
  const [cycle, setCycle] = useState(0);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [views, setViews] = useState<StoryView[]>([]);
  const [viewNames, setViewNames] = useState<Record<string, string>>({});
  const [viewsLoading, setViewsLoading] = useState(false);
  const [likes, setLikes] = useState<StoryLike[]>([]);
  const [likesOpen, setLikesOpen] = useState(false);
  const [likeNames, setLikeNames] = useState<Record<string, string>>({});
  const [liking, setLiking] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const gIdx = groups.findIndex((g) => g.authorId === authorId);
  const group = gIdx === -1 ? null : groups[gIdx];
  const sIdx = group ? group.stories.findIndex((s) => s.id === storyId) : -1;
  const story = sIdx === -1 || !group ? null : group.stories[sIdx];
  const mine = group?.authorId === myId;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // The current story can vanish mid-view (expiry, deletion elsewhere):
  // close rather than strand the viewer on a blank screen.
  useEffect(() => {
    if (!story) onClose();
  });

  // Likes for the current story, kept live while it is on screen.
  const storyKey = story?.id ?? '';
  useEffect(() => {
    if (!storyKey) return;
    let active = true;
    const load = () => {
      listStoryLikes(storyKey)
        .then((rows) => {
          if (active) setLikes(rows);
        })
        .catch(() => {});
    };
    load();
    const unsubscribe = subscribeToStories(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [storyKey]);

  if (!group || !story) return null;

  const goTo = (aId: string, sId: string) => {
    setAuthorId(aId);
    setStoryId(sId);
    setCycle((c) => c + 1);
    setViewsOpen(false);
    setLikesOpen(false);
    setLikes([]);
    markStoryViewed(sId).catch(() => {});
  };

  const advance = () => {
    if (sIdx + 1 < group.stories.length) {
      goTo(group.authorId, group.stories[sIdx + 1].id);
      return;
    }
    const next = groups[gIdx + 1];
    if (next?.stories[0]) goTo(next.authorId, next.stories[0].id);
    else onClose();
  };

  const back = () => {
    if (sIdx > 0) {
      goTo(group.authorId, group.stories[sIdx - 1].id);
      return;
    }
    const prev = groups[gIdx - 1];
    if (prev?.stories.length) goTo(prev.authorId, prev.stories[prev.stories.length - 1].id);
    else goTo(group.authorId, story.id);
  };

  const toggleViews = () => {
    if (viewsOpen) {
      setViewsOpen(false);
      return;
    }
    setViewsOpen(true);
    setViewsLoading(true);
    listStoryViews(story.id)
      .then((rows) => {
        setViews(rows);
        const ids = [...new Set(rows.map((r) => r.viewer_id))];
        if (ids.length === 0) return;
        getProfilesByIds(ids)
          .then((profiles) => {
            const map: Record<string, string> = {};
            for (const p of profiles) map[p.user_id] = p.display_name;
            setViewNames(map);
          })
          .catch(() => {});
      })
      .catch((err: unknown) => {
        toast(errMessage(err));
        setViewsOpen(false);
      })
      .finally(() => setViewsLoading(false));
  };

  const toggleLikes = () => {
    if (likesOpen) {
      setLikesOpen(false);
      return;
    }
    setLikesOpen(true);
    const ids = [...new Set(likes.map((l) => l.user_id))];
    if (ids.length === 0) return;
    getProfilesByIds(ids)
      .then((profiles) => {
        const map: Record<string, string> = {};
        for (const p of profiles) map[p.user_id] = p.display_name;
        setLikeNames(map);
      })
      .catch(() => {});
  };

  const toggleLike = () => {
    if (!story || liking) return;
    setLiking(true);
    const wasLiked = likes.some((l) => l.user_id === myId);
    setLikes((prev) =>
      wasLiked
        ? prev.filter((l) => l.user_id !== myId)
        : [...prev, { story_id: story.id, user_id: myId, created_at: new Date().toISOString() }],
    );
    toggleStoryLike(story.id)
      .then(() => listStoryLikes(story.id).then(setLikes).catch(() => {}))
      .catch((err: unknown) => {
        toast(errMessage(err));
        listStoryLikes(story.id).then(setLikes).catch(() => {});
      })
      .finally(() => setLiking(false));
  };

  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      const deleted = await deleteStory(story.id);
      if (deleted) await deleteStoryMedia(deleted.media_path).catch(() => {});
      const nextInGroup = group.stories[sIdx + 1] ?? group.stories.filter((s) => s.id !== story.id)[0] ?? null;
      const nextGroup = groups.find((g) => g.authorId !== group.authorId && g.stories.length > 0) ?? null;
      onDeleted(story.id);
      if (nextInGroup) {
        setStoryId(nextInGroup.id);
        setCycle((c) => c + 1);
      } else if (nextGroup?.stories[0]) {
        setAuthorId(nextGroup.authorId);
        setStoryId(nextGroup.stories[0].id);
        setCycle((c) => c + 1);
      } else {
        onClose();
      }
      toast('Story deleted.');
    } catch (err) {
      toast(errMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  const paused = viewsOpen || likesOpen || deleting;
  const liked = likes.some((l) => l.user_id === myId);
  const likeLabel = likes.length === 0 ? 'Like' : `${likes.length} like${likes.length === 1 ? '' : 's'}`;

  return (
    <div
      className="story-viewer"
      role="dialog"
      aria-label={`${group.name}'s story`}
      tabIndex={-1}
      autoFocus
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'ArrowRight') advance();
        if (e.key === 'ArrowLeft') back();
      }}
    >
      <div className="story-stage">
        <StoryImage key={story.id} path={story.media_path} caption={story.caption} />

        <button type="button" className="story-zone is-prev" onClick={back} aria-label="Previous story" />
        <button type="button" className="story-zone is-next" onClick={advance} aria-label="Next story" />

        <div className="story-top">
          <div className="story-progress" aria-hidden="true">
            {group.stories.map((s, i) => (
              <span key={s.id} className="story-progress-track">
                {i < sIdx && <span className="story-progress-fill is-done" />}
                {i === sIdx && (
                  <span
                    key={`${story.id}-${cycle}`}
                    className={`story-progress-fill is-active${paused ? ' is-paused' : ''}`}
                    onAnimationEnd={advance}
                  />
                )}
              </span>
            ))}
          </div>
          <div className="story-head">
            <Avatar name={group.name} color={group.color} size="sm" />
            <div className="story-head-text">
              <strong>{group.name}</strong>
              <span>{timeAgo(story.created_at)}</span>
            </div>
            <button type="button" className="story-icon-btn" onClick={onClose} aria-label="Close story" data-tooltip="Close story" data-tooltip-pos="bottom">
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="story-foot">
          {story.caption.trim() && <p className="story-caption">{story.caption}</p>}
          {!mine && (
            <div className="story-own-actions">
              <button
                type="button"
                className={`story-pill-btn${liked ? ' is-liked' : ''}`}
                onClick={toggleLike}
                disabled={liking}
                aria-pressed={liked}
                aria-label={liked ? 'Unlike this story' : 'Like this story'}
              >
                <Heart size={15} aria-hidden="true" fill={liked ? 'currentColor' : 'none'} />
                {likeLabel}
              </button>
            </div>
          )}
          {mine && (
            <div className="story-own-actions">
              <button type="button" className="story-pill-btn" onClick={toggleLikes} aria-expanded={likesOpen}>
                <Heart size={15} aria-hidden="true" />
                {likesOpen ? 'Hide likes' : likeLabel}
              </button>
              <button type="button" className="story-pill-btn" onClick={toggleViews} aria-expanded={viewsOpen}>
                <Eye size={15} aria-hidden="true" />
                {viewsOpen ? 'Hide views' : 'Views'}
              </button>
              <button
                type="button"
                className="story-pill-btn is-danger"
                onClick={() => remove()}
                disabled={deleting}
              >
                <Trash2 size={15} aria-hidden="true" />
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          )}
          {mine && likesOpen && (
            <div className="story-views">
              {likes.length === 0 ? (
                <p>No likes yet.</p>
              ) : (
                <ul>
                  {likes.map((l) => (
                    <li key={l.user_id}>{likeNames[l.user_id] ?? 'A ReConnect member'}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {mine && viewsOpen && (
            <div className="story-views">
              {viewsLoading ? (
                <p>Loading views…</p>
              ) : views.length === 0 ? (
                <p>No views yet.</p>
              ) : (
                <ul>
                  {views.map((v) => (
                    <li key={v.viewer_id}>{viewNames[v.viewer_id] ?? 'A ReConnect member'}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
