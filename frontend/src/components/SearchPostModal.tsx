import { useState } from 'react';
import { Eye, Send, Users } from 'lucide-react';
import BlurEditor from './BlurEditor';
import Modal from './Modal';
import './SearchPostModal.css';

export interface SearchPost {
  id: string;
  caption: string;
  visibility: 'connections' | 'community';
  photo: string | null;
  blurred: boolean;
  createdAt: string;
}

const PERMISSIONS = [
  {
    id: 'faces',
    label: 'Faces are blurred or I have permission to share this photo',
  },
  {
    id: 'visibility',
    label: 'I understand who can see this post',
  },
  {
    id: 'accuracy',
    label: 'Everything I wrote is my own memory, not a guess about others',
  },
] as const;

/* Memory Search Post composer. Posts are saved on this device until the
   community feed lands — publishing is never faked. Sharing permissions
   are mandatory before a post with other people can be saved. */
export default function SearchPostModal({
  open,
  onClose,
  photoUrl,
  captionSeed,
  onPublished,
}: {
  open: boolean;
  onClose: () => void;
  photoUrl: string | null;
  captionSeed: string;
  onPublished: (post: SearchPost) => void;
}) {
  // Fresh state per mount; the parent remounts via `key` on every open.
  const [caption, setCaption] = useState(captionSeed);
  const [visibility, setVisibility] =
    useState<SearchPost['visibility']>('connections');
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [blurred, setBlurred] = useState<string | null>(null);
  const [blurOpen, setBlurOpen] = useState(false);
  const [blurSession, setBlurSession] = useState(0);

  const openBlur = () => {
    setBlurSession((s) => s + 1);
    setBlurOpen(true);
  };

  const allChecked = PERMISSIONS.every((p) => checks[p.id]);
  const canPublish = allChecked && (caption.trim() !== '' || photoUrl !== null);
  const shownPhoto = blurred ?? photoUrl;

  const publish = () => {
    if (!canPublish) return;
    onPublished({
      id: `post-${Date.now()}`,
      caption: caption.trim(),
      visibility,
      photo: shownPhoto,
      blurred: blurred !== null,
      createdAt: new Date().toISOString(),
    });
  };

  return (
    <>
      <Modal open={open} onClose={onClose} label="Create Memory Search Post">
        <h2 className="modal-title">Memory Search Post</h2>
        <p className="post-sub">
          Ask the community for help identifying this memory. Saved on this
          device until community publishing launches.
        </p>

        {shownPhoto && (
          <div className="post-photo">
            <img src={shownPhoto} alt="Photo attached to your search post" />
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={openBlur}
            >
              <Eye size={14} aria-hidden="true" />
              {blurred ? 'Edit face blur' : 'Blur faces'}
            </button>
          </div>
        )}

        <label className="field">
          <span className="field-label">What should people look for?</span>
          <textarea
            className="textarea"
            rows={3}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="e.g. Does anyone recognize this sports day? Trying to find my old friends from 4B."
          />
        </label>

        <div
          className="post-visibility"
          role="radiogroup"
          aria-label="Who can see this post"
        >
          <button
            type="button"
            role="radio"
            aria-checked={visibility === 'connections'}
            className={`post-vis${visibility === 'connections' ? ' is-selected' : ''}`}
            onClick={() => setVisibility('connections')}
          >
            <Users size={16} aria-hidden="true" />
            Connections only
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={visibility === 'community'}
            className={`post-vis${visibility === 'community' ? ' is-selected' : ''}`}
            onClick={() => setVisibility('community')}
          >
            <Eye size={16} aria-hidden="true" />
            Whole community
          </button>
        </div>

        <fieldset className="post-perms">
          <legend>Sharing permissions (all required)</legend>
          {PERMISSIONS.map((p) => (
            <label key={p.id} className="post-perm">
              <input
                type="checkbox"
                checked={!!checks[p.id]}
                onChange={(e) =>
                  setChecks((prev) => ({ ...prev, [p.id]: e.target.checked }))
                }
              />
              {p.label}
            </label>
          ))}
        </fieldset>

        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={!canPublish}
          onClick={publish}
        >
          <Send size={15} aria-hidden="true" />
          Save search post
        </button>
      </Modal>

      {photoUrl && (
        <BlurEditor
          key={blurSession}
          open={blurOpen}
          photoUrl={photoUrl}
          onClose={() => setBlurOpen(false)}
          onApply={(dataUrl) => {
            setBlurred(dataUrl);
            setBlurOpen(false);
          }}
        />
      )}
    </>
  );
}
