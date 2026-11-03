import { useCallback, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import MemoryArt from './MemoryArt';
import './MediaLightbox.css';

export interface LightboxPhoto {
  src: string;
  label: string;
}

export default function MediaLightbox({
  seeds,
  photos,
  index,
  onClose,
  onIndex,
  label,
}: {
  seeds: string[];
  /** Real photo URLs. When provided, they render instead of seeds. */
  photos?: LightboxPhoto[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
  label: string;
}) {
  const open = index >= 0;
  const total = photos ? photos.length : seeds.length;

  const step = useCallback(
    (dir: 1 | -1) => {
      onIndex((index + dir + total) % total);
    },
    [index, total, onIndex],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose, step]);

  return (
    <AnimatePresence>
      {open && index >= 0 && (
        <motion.div
          className="lightbox"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={label}
        >
          <button
            type="button"
            className="lightbox-close"
            onClick={onClose}
            aria-label="Close gallery"
            data-tooltip="Close gallery"
            data-tooltip-pos="left"
          >
            <X size={20} aria-hidden="true" />
          </button>
          {total > 1 && (
            <>
              <button
                type="button"
                className="lightbox-nav lightbox-prev"
                onClick={(e) => {
                  e.stopPropagation();
                  step(-1);
                }}
                aria-label="Previous photo"
                data-tooltip="Previous photo"
                data-tooltip-pos="right"
              >
                <ChevronLeft size={24} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="lightbox-nav lightbox-next"
                onClick={(e) => {
                  e.stopPropagation();
                  step(1);
                }}
                aria-label="Next photo"
                data-tooltip="Next photo"
                data-tooltip-pos="left"
              >
                <ChevronRight size={24} aria-hidden="true" />
              </button>
            </>
          )}
          <motion.div
            key={index}
            className="lightbox-media"
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            {photos ? (
              <img
                src={photos[index].src}
                alt={photos[index].label}
                className="lightbox-photo"
              />
            ) : (
              <MemoryArt seed={seeds[index]} label={label} />
            )}
          </motion.div>
          {total > 1 && (
            <span className="lightbox-count">
              {index + 1} / {total}
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
