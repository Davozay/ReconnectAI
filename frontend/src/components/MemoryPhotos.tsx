import { useEffect, useState } from 'react';
import MediaLightbox from './MediaLightbox';
import { listMemoryPhotos } from '../lib/db';
import { getMemoryPhotoUrl } from '../lib/storage';
import './MemoryPhotos.css';

/* Real photos attached to a memory (signed URLs, resolved on mount).
   Renders nothing until at least one photo loads — posts without photos
   are unaffected. Failures stay silent: a missing photo must never break
   the surrounding card. */
export default function MemoryPhotos({
  memoryId,
  label,
}: {
  memoryId: string;
  label: string;
}) {
  const [urls, setUrls] = useState<string[]>([]);
  const [viewer, setViewer] = useState(-1);

  useEffect(() => {
    let active = true;
    listMemoryPhotos(memoryId)
      .then((rows) => Promise.all(rows.map((r) => getMemoryPhotoUrl(r.storage_path))))
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
  const shown = urls.slice(0, 3);

  return (
    <>
      <div className={`memory-photos count-${shown.length}`}>
        {shown.map((url, i) => (
          <button
            key={url}
            type="button"
            className="memory-photos-btn"
            onClick={() => setViewer(i)}
            aria-label={`Open photo ${i + 1} of ${urls.length}`}
          >
            <img src={url} alt={label} loading="lazy" />
          </button>
        ))}
      </div>
      <MediaLightbox
        seeds={[]}
        photos={urls.map((src) => ({ src, label }))}
        index={viewer}
        onClose={() => setViewer(-1)}
        onIndex={setViewer}
        label={label}
      />
    </>
  );
}
