import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Bookmark,
  GraduationCap,
  Heart,
  MapPin,
  MessageCircle,
  Play,
  Share2,
} from 'lucide-react';
import Avatar from './Avatar';
import Comments from './Comments';
import type { LiveThread } from './Comments';
import MemoryArt from './MemoryArt';
import MediaLightbox from './MediaLightbox';
import MemoryPhotos from './MemoryPhotos';
import { useToast } from '../context/useToast';
import type { FeedPost } from '../data/content';
import './PostCard.css';

export default function PostCard({
  post,
  currentUser,
  like,
  save,
  commentCount,
  thread,
  photoMemoryId,
}: {
  post: FeedPost;
  currentUser: string;
  /** Real like state; when absent, likes stay local-only. */
  like?: { count: number; liked: boolean; onToggle: () => void };
  /** Real save state; when absent, saves stay local-only. */
  save?: { saved: boolean; onToggle: () => void };
  /** Real comment count; falls back to the post's bundled comments. */
  commentCount?: number;
  /** Live thread wiring; when absent, comments stay local-only. */
  thread?: { memoryAuthorId: string; myId: string };
  /** Memory id whose attached photos to show; when absent, no photos load. */
  photoMemoryId?: string;
}) {
  const [liked, setLiked] = useState(false);
  const likedNow = like?.liked ?? liked;
  const likeCount = like ? like.count : post.likes + (liked ? 1 : 0);
  const [saved, setSaved] = useState(false);
  const savedNow = save?.saved ?? saved;
  const [showComments, setShowComments] = useState(false);
  const [lightbox, setLightbox] = useState(-1);
  const { toast } = useToast();

  const live: LiveThread | undefined = thread
    ? { memoryId: post.id, memoryAuthorId: thread.memoryAuthorId, myId: thread.myId }
    : undefined;

  const toggleSave = () => {
    if (save) {
      save.onToggle();
      return;
    }
    setSaved((v) => !v);
    toast(saved ? 'Removed from your saved memories' : 'Saved to your memories');
  };

  const share = async () => {
    const url = `${window.location.origin}/app#${post.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied to clipboard');
    } catch {
      toast('Could not copy the link on this device');
    }
  };

  return (
    <article className="card post-card" aria-label={`Post by ${post.author}`}>
      <header className="post-card-head">
        <Avatar name={post.author} color={post.color} />
        <div className="post-card-id">
          <p className="post-card-author">
            {post.author}
            <span className="post-card-handle">{post.handle}</span>
          </p>
          <p className="post-card-meta">
            {post.meta} · {post.time}
          </p>
        </div>
      </header>

      <p className="post-card-text">{post.text}</p>

      <div className="post-card-tags">
        {post.schoolTag && (
          <span className="pill pill-indigo">
            <GraduationCap size={13} aria-hidden="true" />
            {post.schoolTag}
          </span>
        )}
        {post.tags.map((t) => (
          <span key={t} className="pill pill-neutral">
            {t}
          </span>
        ))}
      </div>

      {post.media.length > 0 && (
        <div
          className={`post-media count-${Math.min(post.media.length, 3)}${post.reel ? ' is-reel' : ''}`}
        >
          {post.media.slice(0, 3).map((seed, i) => (
            <button
              key={seed}
              type="button"
              className="post-media-btn"
              onClick={() => setLightbox(i)}
              aria-label={`Open photo ${i + 1} of ${post.media.length}`}
            >
              <MemoryArt seed={seed} label={post.tags[0] ?? 'Memory'} />
              {post.reel && i === 0 && (
                <span className="reel-badge">
                  <Play size={15} aria-hidden="true" fill="currentColor" />
                  Memory reel · 0:12
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {photoMemoryId && (
        <MemoryPhotos memoryId={photoMemoryId} label={post.tags[0] ?? 'Memory'} />
      )}

      <footer className="post-card-actions">
        <motion.button
          type="button"
          className={`post-action${likedNow ? ' is-liked' : ''}`}
          onClick={() => (like ? like.onToggle() : setLiked((v) => !v))}
          aria-pressed={likedNow}
          aria-label={likedNow ? 'Unlike this post' : 'Like this post'}
          whileTap={{ scale: 0.82 }}
          transition={{ type: 'spring', stiffness: 500, damping: 15 }}
        >
          <Heart
            size={19}
            aria-hidden="true"
            fill={likedNow ? 'currentColor' : 'none'}
          />
          <span>{likeCount}</span>
        </motion.button>
        <button
          type="button"
          className={`post-action${showComments ? ' is-active' : ''}`}
          onClick={() => setShowComments((v) => !v)}
          aria-expanded={showComments}
          aria-label="Toggle comments"
        >
          <MessageCircle size={19} aria-hidden="true" />
          <span>{commentCount ?? post.comments.length}</span>
        </button>
        <button
          type="button"
          className={`post-action${savedNow ? ' is-saved' : ''}`}
          onClick={toggleSave}
          aria-pressed={savedNow}
          aria-label={savedNow ? 'Unsave this post' : 'Save this post'}
          data-tooltip={savedNow ? 'Unsave this post' : 'Save this post'}
        >
          <Bookmark
            size={19}
            aria-hidden="true"
            fill={savedNow ? 'currentColor' : 'none'}
          />
        </button>
        <button
          type="button"
          className="post-action post-share"
          onClick={share}
          aria-label="Copy link to this post"
          data-tooltip="Copy link to this post"
        >
          <Share2 size={19} aria-hidden="true" />
        </button>
      </footer>

      {showComments && (
        <Comments
          postId={post.id}
          initial={post.comments}
          currentUser={currentUser}
          live={live}
        />
      )}

      <MediaLightbox
        seeds={post.media}
        index={lightbox}
        onClose={() => setLightbox(-1)}
        onIndex={setLightbox}
        label={post.tags[0] ?? 'Memory'}
      />
      <span className="post-card-locale">
        <MapPin size={12} aria-hidden="true" />
        {post.meta.split('·')[0]?.trim()}
      </span>
    </article>
  );
}
