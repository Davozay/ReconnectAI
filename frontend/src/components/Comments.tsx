import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Send, Trash2 } from 'lucide-react';
import Avatar from './Avatar';
import { useToast } from '../context/useToast';
import {
  DbError,
  addComment,
  deleteComment,
  getProfilesByIds,
  listComments,
  subscribeToMemoryComments,
} from '../lib/db';
import type { MemoryComment } from '../lib/db';
import type { PostComment } from '../data/mock';
import './Comments.css';

/** Live thread wiring. When absent, comments stay local-only. */
export interface LiveThread {
  memoryId: string;
  memoryAuthorId: string;
  myId: string;
}

const AVATAR_COLORS = ['#6255e8', '#e85a4f', '#16a34a', '#0ea5e9', '#d946ef'];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
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

function LiveComments({ live, currentUser }: { live: LiveThread; currentUser: string }) {
  const { toast } = useToast();
  const [items, setItems] = useState<MemoryComment[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    listComments(live.memoryId)
      .then((rows) => {
        if (!active) return;
        setItems(rows);
        const ids = [...new Set(rows.map((r) => r.user_id))];
        if (ids.length === 0) {
          setNames({});
          return;
        }
        getProfilesByIds(ids)
          .then((profiles) => {
            if (!active) return;
            const map: Record<string, string> = {};
            for (const p of profiles) map[p.user_id] = p.display_name;
            setNames(map);
          })
          .catch(() => {});
      })
      .catch((err: unknown) => {
        if (active) toast(err instanceof DbError ? err.message : 'Could not load comments.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [live.memoryId, tick, toast]);

  useEffect(() => {
    return subscribeToMemoryComments(() => setTick((k) => k + 1));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const row = await addComment(live.memoryId, text);
      setItems((prev) => (prev.some((c) => c.id === row.id) ? prev : [...prev, row]));
      setNames((prev) => ({ ...prev, [row.user_id]: currentUser }));
      setDraft('');
    } catch (err) {
      toast(err instanceof DbError ? err.message : 'Could not post that comment.');
    } finally {
      setPosting(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteComment(id);
      setItems((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      toast(err instanceof DbError ? err.message : 'Could not delete that comment.');
    }
  };

  const canDelete = (c: MemoryComment) =>
    c.user_id === live.myId || live.memoryAuthorId === live.myId;

  return (
    <div className="comments">
      {loading ? (
        <p className="comments-empty">Loading comments…</p>
      ) : (
        <ul className="comment-list">
          {items.map((c) => (
            <li key={c.id} className="comment">
              <Avatar
                name={names[c.user_id] ?? '…'}
                color={colorFor(c.user_id)}
                size="xs"
              />
              <div className="comment-body">
                <p className="comment-text">
                  <strong>{names[c.user_id] ?? 'A ReConnect member'}</strong>{' '}
                  {c.body}
                </p>
                <span className="comment-time">{timeAgo(c.created_at)}</span>
                {canDelete(c) && (
                  <button
                    type="button"
                    className="comment-delete"
                    onClick={() => remove(c.id)}
                    aria-label="Delete comment"
                    data-tooltip="Delete comment"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {!loading && items.length === 0 && (
        <p className="comments-empty">No comments yet — share the first memory.</p>
      )}
      <form className="comment-form" onSubmit={submit}>
        <input
          className="input comment-input"
          placeholder="Add a comment…"
          value={draft}
          maxLength={1000}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Add a comment"
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={!draft.trim() || posting}
          aria-label="Post comment"
          data-tooltip="Post comment"
        >
          <Send size={14} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}

function LocalComments({
  postId,
  initial,
  currentUser,
}: {
  postId: string;
  initial: PostComment[];
  currentUser: string;
}) {
  const [comments, setComments] = useState<PostComment[]>(initial);
  const [draft, setDraft] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setComments((prev) => [
      ...prev,
      {
        id: `${postId}-c${prev.length + 1}`,
        author: currentUser,
        color: '#6255e8',
        text,
        time: 'now',
      },
    ]);
    setDraft('');
  };

  return (
    <div className="comments">
      <ul className="comment-list">
        {comments.map((c) => (
          <li key={c.id} className="comment">
            <Avatar name={c.author} color={c.color} size="xs" />
            <div className="comment-body">
              <p className="comment-text">
                <strong>{c.author}</strong> {c.text}
              </p>
              <span className="comment-time">{c.time}</span>
            </div>
          </li>
        ))}
      </ul>
      {comments.length === 0 && (
        <p className="comments-empty">No comments yet — share the first memory.</p>
      )}
      <form className="comment-form" onSubmit={submit}>
        <input
          className="input comment-input"
          placeholder="Add a comment…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Add a comment"
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={!draft.trim()}
          aria-label="Post comment"
          data-tooltip="Post comment"
        >
          <Send size={14} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}

export default function Comments({
  postId,
  initial,
  currentUser,
  live,
}: {
  postId: string;
  initial: PostComment[];
  currentUser: string;
  live?: LiveThread;
}) {
  if (live) return <LiveComments live={live} currentUser={currentUser} />;
  return <LocalComments postId={postId} initial={initial} currentUser={currentUser} />;
}
