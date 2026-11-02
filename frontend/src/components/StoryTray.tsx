import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import Avatar from './Avatar';
import Modal from './Modal';
import StoryViewer from './StoryViewer';
import type { StoryGroup } from './StoryViewer';
import { useAuth } from '../context/useAuth';
import { useToast } from '../context/useToast';
import { DbError, getProfilesByIds, isMissingTable } from '../lib/db';
import {
  listLiveStories,
  listMyViewedIds,
  markStoryViewed,
  postStory,
  subscribeToStories,
} from '../lib/stories';
import type { Story } from '../lib/stories';
import { StorageError, uploadStoryMedia } from '../lib/storage';
import './StoryTray.css';

const AVATAR_COLORS = ['#6255e8', '#e85a4f', '#16a34a', '#0ea5e9', '#d946ef'];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function errMessage(err: unknown): string {
  return err instanceof DbError || err instanceof StorageError || err instanceof Error
    ? err.message
    : 'Something went wrong.';
}

export default function StoryTray() {
  const { user } = useAuth();
  const { toast } = useToast();
  const myId = user?.id ?? '';
  const myName = user?.name ?? 'You';
  const [groups, setGroups] = useState<StoryGroup[]>([]);
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Record<string, string>>({});
  const [supported, setSupported] = useState(true);
  const [tick, setTick] = useState(0);
  const [watchIdx, setWatchIdx] = useState<number | null>(null);
  const [watchMine, setWatchMine] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [sharing, setSharing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    Promise.all([listLiveStories(), listMyViewedIds()])
      .then(([stories, viewedIds]) => {
        if (!active) return;
        const byAuthor = new Map<string, Story[]>();
        for (const s of stories) {
          const list = byAuthor.get(s.author_id) ?? [];
          list.push(s);
          byAuthor.set(s.author_id, list);
        }
        const authorIds = [...byAuthor.keys()];
        getProfilesByIds(authorIds)
          .then((profiles) => {
            if (!active) return;
            const map: Record<string, string> = {};
            for (const p of profiles) map[p.user_id] = p.display_name;
            setNames(map);
          })
          .catch(() => {});
        setGroups(
          authorIds.map((authorId) => ({
            authorId,
            name: authorId === myId ? myName : 'A ReConnect member',
            color: colorFor(authorId),
            stories: (byAuthor.get(authorId) ?? []).sort((a, b) =>
              a.created_at < b.created_at ? -1 : 1,
            ),
          })),
        );
        setViewed(viewedIds);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (isMissingTable(err)) setSupported(false);
        else {
          toast(errMessage(err));
          setSupported(false);
        }
      });
    return () => {
      active = false;
    };
  }, [toast, myId, myName, tick]);

  useEffect(() => {
    if (!supported) return;
    return subscribeToStories(() => setTick((k) => k + 1));
  }, [supported]);

  const resolved = useMemo(
    () =>
      groups.map((g) => ({
        ...g,
        name: g.authorId === myId ? myName : (names[g.authorId] ?? g.name),
      })),
    [groups, names, myId, myName],
  );

  const myGroup = resolved.find((g) => g.authorId === myId) ?? null;
  const others = useMemo(() => {
    const rest = resolved.filter((g) => g.authorId !== myId);
    const unviewedFirst = (g: StoryGroup) =>
      g.stories.every((s) => viewed.has(s.id)) ? 1 : 0;
    return [...rest].sort((a, b) => {
      const order = unviewedFirst(a) - unviewedFirst(b);
      if (order !== 0) return order;
      const aLast = a.stories[a.stories.length - 1]?.created_at ?? '';
      const bLast = b.stories[b.stories.length - 1]?.created_at ?? '';
      return aLast < bLast ? 1 : -1;
    });
  }, [resolved, viewed, myId]);

  if (!user || !supported) return null;

  const openGroup = (idx: number) => {
    const first = others[idx]?.stories[0];
    if (first) markStoryViewed(first.id).catch(() => {});
    setWatchIdx(idx);
  };

  const openMine = () => {
    const first = myGroup?.stories[0];
    if (first) markStoryViewed(first.id).catch(() => {});
    setWatchMine(true);
  };

  const handleDeleted = (storyId: string) => {
    setGroups((prev) =>
      prev
        .map((g) => ({ ...g, stories: g.stories.filter((s) => s.id !== storyId) }))
        .filter((g) => g.stories.length > 0),
    );
  };

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setCaption('');
  };

  const clearPending = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingFile(null);
    setPreviewUrl(null);
    setCaption('');
  };

  const share = async () => {
    if (!pendingFile || sharing) return;
    setSharing(true);
    try {
      const up = await uploadStoryMedia(pendingFile);
      await postStory(up.path, caption);
      clearPending();
      setTick((k) => k + 1);
      toast('Story shared — visible to your connections for 24 hours');
    } catch (err) {
      toast(errMessage(err));
    } finally {
      setSharing(false);
    }
  };

  return (
    <section className="card card-pad story-tray" aria-label="Stories">
      <ul className="story-tray-list">
        <li className="story-tile">
          <button
            type="button"
            className="story-tile-btn"
            onClick={() => (myGroup ? openMine() : fileRef.current?.click())}
            aria-label={myGroup ? 'Watch your story' : 'Share your first story'}
          >
            <span className={`story-ring${myGroup ? ' has-stories' : ''}`}>
              <Avatar name={myName} color={colorFor(myId)} size="md" />
            </span>
            <span className="story-tile-name">You</span>
          </button>
          <button
            type="button"
            className="story-add"
            onClick={() => fileRef.current?.click()}
            aria-label="Add to your story"
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        </li>
        {others.map((g, i) => {
          const seenAll = g.stories.every((s) => viewed.has(s.id));
          return (
            <li key={g.authorId} className="story-tile">
              <button
                type="button"
                className="story-tile-btn"
                onClick={() => openGroup(i)}
                aria-label={`Watch ${g.name}'s story`}
              >
                <span className={`story-ring has-stories${seenAll ? ' is-seen' : ''}`}>
                  <Avatar name={g.name} color={g.color} size="md" />
                </span>
                <span className="story-tile-name">{g.name}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          pickFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      <Modal open={pendingFile !== null} onClose={clearPending} label="Share a story">
        <h2 className="modal-title">Share a story</h2>
        {previewUrl && (
          <img src={previewUrl} alt="Story preview" className="story-preview" />
        )}
        <label className="field">
          <span className="field-label">Caption (optional)</span>
          <input
            className="input"
            value={caption}
            maxLength={200}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Say something about this moment…"
          />
        </label>
        <div className="story-share-actions">
          <button type="button" className="btn btn-outline" onClick={clearPending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => share()}
            disabled={sharing}
          >
            {sharing ? 'Sharing…' : 'Share story'}
          </button>
        </div>
      </Modal>

      {watchMine && myGroup && (
        <StoryViewer
          groups={[myGroup]}
          startGroup={0}
          myId={myId}
          onClose={() => setWatchMine(false)}
          onDeleted={handleDeleted}
        />
      )}
      {watchIdx !== null && others.length > 0 && (
        <StoryViewer
          groups={others}
          startGroup={Math.min(watchIdx, others.length - 1)}
          myId={myId}
          onClose={() => setWatchIdx(null)}
          onDeleted={handleDeleted}
        />
      )}
    </section>
  );
}
