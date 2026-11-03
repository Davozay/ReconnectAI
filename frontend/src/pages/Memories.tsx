import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, ScanSearch, Trash2 } from 'lucide-react';
import Modal from '../components/Modal';
import { useToast } from '../context/useToast';
import {
  DbError,
  MY_MEMORIES_PAGE_SIZE,
  deleteMemory,
  listMemoryPhotos,
  listMyMemoriesPage,
  updateMemory,
} from '../lib/db';
import type { Memory, MemoryPhoto } from '../lib/db';
import { cursorOf, mergeUniqueById } from '../lib/paging';
import type { PageCursor } from '../lib/paging';
import { getMemoryPhotoUrl } from '../lib/storage';
import './Memories.css';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function MemoryThumbs({ memoryId }: { memoryId: string }) {
  const [urls, setUrls] = useState<string[]>([]);
  const [viewer, setViewer] = useState(-1);

  useEffect(() => {
    let active = true;
    listMemoryPhotos(memoryId)
      .then((rows: MemoryPhoto[]) =>
        Promise.all(rows.map((r) => getMemoryPhotoUrl(r.storage_path))),
      )
      .then((loaded) => {
        if (active) setUrls(loaded);
      })
      .catch(() => {
        if (active) setUrls([]);
      });
    return () => {
      active = false;
    };
  }, [memoryId]);

  if (urls.length === 0) return null;
  return (
    <div className="mem-thumbs">
      {urls.map((url, i) => (
        <button
          key={url}
          type="button"
          className="mem-thumb"
          onClick={() => setViewer(i)}
          aria-label={`Open photo ${i + 1}`}
        >
          <img src={url} alt="Memory photo" loading="lazy" />
        </button>
      ))}
      <Modal
        open={viewer >= 0}
        onClose={() => setViewer(-1)}
        label="Memory photo"
        wide
      >
        {viewer >= 0 && urls[viewer] && (
          <img src={urls[viewer]} alt="Memory photo" className="mem-viewer-img" />
        )}
      </Modal>
    </div>
  );
}

export default function Memories() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [cursor, setCursor] = useState<PageCursor | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [retryKey, setRetryKey] = useState(0);
  const loadingMoreRef = useRef(false);
  const cursorRef = useRef<PageCursor | null>(null);
  const hasMoreRef = useRef(true);

  useEffect(() => {
    cursorRef.current = cursor;
    hasMoreRef.current = hasMore;
  });

  useEffect(() => {
    let active = true;
    listMyMemoriesPage(MY_MEMORIES_PAGE_SIZE)
      .then((page) => {
        if (!active) return;
        setMemories(page.rows);
        setCursor(page.rows.length > 0 ? cursorOf(page.rows[page.rows.length - 1]) : null);
        setHasMore(page.hasMore);
        setFailed(false);
      })
      .catch((err: unknown) => {
        if (active) {
          setFailed(true);
          toast(err instanceof DbError ? err.message : 'Could not load your memories.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [toast, retryKey]);

  const loadMore = () => {
    const c = cursorRef.current;
    if (loadingMoreRef.current || !hasMoreRef.current || !c) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setMoreFailed(false);
    listMyMemoriesPage(MY_MEMORIES_PAGE_SIZE, c)
      .then((page) => {
        setMemories((prev) => mergeUniqueById(prev, page.rows));
        setCursor(
          page.rows.length > 0 ? cursorOf(page.rows[page.rows.length - 1]) : c,
        );
        setHasMore(page.hasMore);
      })
      .catch((err: unknown) => {
        setMoreFailed(true);
        toast(err instanceof DbError ? err.message : 'Could not load more memories.');
      })
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  };

  const retryFirstPage = () => {
    setFailed(false);
    setLoading(true);
    setRetryKey((k) => k + 1);
  };

  const toggleShared = async (memory: Memory) => {
    try {
      const updated = await updateMemory(memory.id, { shared: !memory.shared });
      setMemories((prev) => prev.map((m) => (m.id === memory.id ? updated : m)));
      toast(updated.shared ? 'Memory shared with the community' : 'Memory is private again');
    } catch (err) {
      toast(err instanceof DbError ? err.message : 'Could not update that memory.');
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteMemory(id);
      setMemories((prev) => prev.filter((m) => m.id !== id));
      toast('Memory deleted');
    } catch (err) {
      toast(err instanceof DbError ? err.message : 'Could not delete that memory.');
    }
  };

  if (loading) {
    return (
      <div className="memories" aria-label="Loading memories">
        <div className="page-head">
          <div>
            <h1>Memories</h1>
            <p>Every childhood memory you’ve saved.</p>
          </div>
        </div>
        <div className="card card-pad">
          <p className="empty-note">Loading your memories…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="memories">
      <div className="page-head">
        <div>
          <h1>Memories</h1>
          <p>
            {memories.length === 0
              ? 'Every childhood memory you’ve saved.'
              : `${memories.length} shown${hasMore ? ' so far' : ''} · ${memories.filter((m) => m.shared).length} shared`}
          </p>
        </div>
        <Link to="/app/detective" className="btn btn-primary btn-sm">
          <ScanSearch size={15} aria-hidden="true" />
          New memory
        </Link>
      </div>

      {failed && memories.length === 0 ? (
        <div className="card card-pad mem-empty">
          <h2>Could not load your memories</h2>
          <p>Check your connection and try again.</p>
          <div className="mem-empty-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={retryFirstPage}
            >
              Retry
            </button>
          </div>
        </div>
      ) : memories.length === 0 ? (
        <div className="card card-pad mem-empty">
          <h2>No memories yet</h2>
          <p>Run the Memory Detective on an old photo, or post from the Home feed.</p>
          <div className="mem-empty-actions">
            <Link to="/app/detective" className="btn btn-primary btn-sm">
              Try the Memory Detective
            </Link>
            <Link to="/app" className="btn btn-outline btn-sm">
              Go to Home feed
            </Link>
          </div>
        </div>
      ) : (
        <ul className="mem-list">
          {memories.map((m) => (
            <li key={m.id} className="card card-pad mem-card">
              <div className="mem-card-head">
                <div>
                  {m.title.trim() && <h3>{m.title}</h3>}
                  <p className="mem-date">
                    {formatDate(m.created_at)}
                    {m.analysis ? ' · from Memory Detective' : ''}
                  </p>
                </div>
                <span className={`pill ${m.shared ? 'pill-green' : 'pill-neutral'}`}>
                  {m.shared ? 'Shared' : 'Private'}
                </span>
              </div>
              <p className="mem-body">{m.body}</p>
              <MemoryThumbs memoryId={m.id} />
              <div className="mem-card-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => toggleShared(m)}
                >
                  {m.shared ? (
                    <EyeOff size={14} aria-hidden="true" />
                  ) : (
                    <Eye size={14} aria-hidden="true" />
                  )}
                  {m.shared ? 'Make private' : 'Share'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm is-danger"
                  onClick={() => remove(m.id)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {memories.length > 0 && (hasMore || moreFailed) && (
        <div className="mem-more">
          {moreFailed ? (
            <>
              <p className="empty-note">Could not load more memories.</p>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={loadMore}
              >
                Retry
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={loadMore}
              disabled={loadingMore}
              aria-busy={loadingMore}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
