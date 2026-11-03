import { useCallback, useEffect, useRef, useState } from 'react';
import { Brush, Check, RotateCcw, X } from 'lucide-react';
import Modal from './Modal';
import './BlurEditor.css';

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* Client-side face blur: draw rectangles over faces, previewed live on a
   canvas. Uses ctx.filter blur with a mosaic fallback for browsers without
   canvas-filter support. Nothing is uploaded. */
export default function BlurEditor({
  open,
  photoUrl,
  onApply,
  onClose,
}: {
  open: boolean;
  photoUrl: string;
  onApply: (dataUrl: string) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [intensity, setIntensity] = useState(12);
  const [drawing, setDrawing] = useState<{ x: number; y: number } | null>(null);
  const [filterOk] = useState(
    () =>
      typeof CanvasRenderingContext2D !== 'undefined' &&
      'filter' in CanvasRenderingContext2D.prototype,
  );

  useEffect(() => {
    if (!open) return;
    const image = new Image();
    let cancelled = false;
    image.onload = () => {
      if (!cancelled) setImg(image);
    };
    image.src = photoUrl;
    return () => {
      cancelled = true;
    };
  }, [open, photoUrl]);

  // Canvas pixel size derived from loaded-image state (ref-free for render).
  const dims = (() => {
    if (!img) return { w: 1, h: 1 };
    const scale = Math.min(
      1,
      1200 / Math.max(img.naturalWidth, img.naturalHeight),
    );
    return {
      w: Math.round(img.naturalWidth * scale),
      h: Math.round(img.naturalHeight * scale),
    };
  })();

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    const scale = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.filter = 'none';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, w, h);
    for (const r of regions) {
      if (filterOk) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.clip();
        ctx.filter = `blur(${intensity}px)`;
        ctx.drawImage(img, 0, 0, w, h);
        ctx.restore();
      } else {
        // Mosaic fallback: shrink the region, then scale it back up.
        const tiny = document.createElement('canvas');
        const tw = Math.max(1, Math.round(r.w / 14));
        const th = Math.max(1, Math.round(r.h / 14));
        tiny.width = tw;
        tiny.height = th;
        const tctx = tiny.getContext('2d');
        if (!tctx) continue;
        tctx.drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, tw, th);
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tiny, 0, 0, tw, th, r.x, r.y, r.w, r.h);
        ctx.restore();
      }
    }
    ctx.filter = 'none';
  }, [img, regions, intensity, filterOk]);

  useEffect(() => {
    draw();
  }, [draw]);

  const toCanvas = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
    };
  };



  const apply = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onApply(canvas.toDataURL('image/jpeg', 0.92));
  };

  return (
    <Modal open={open} onClose={onClose} label="Blur faces in photo" wide>
      <h2 className="modal-title">Blur faces</h2>
      <p className="blur-sub">
        Drag over each face to blur it. Previewed instantly — nothing is
        uploaded.
      </p>
      <div
        ref={wrapRef}
        className="blur-stage"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          const p = toCanvas(e.clientX, e.clientY);
          setDrawing(p);
        }}
        onPointerMove={(e) => {
          if (!drawing) return;
          const p = toCanvas(e.clientX, e.clientY);
          const { w, h } = dims;
          setRegions((prev) => {
            const next = [...prev];
            const x = Math.max(0, Math.min(drawing.x, p.x));
            const y = Math.max(0, Math.min(drawing.y, p.y));
            next[next.length - 1] = {
              x,
              y,
              w: Math.min(Math.abs(p.x - drawing.x), w - x),
              h: Math.min(Math.abs(p.y - drawing.y), h - y),
            };
            return next;
          });
        }}
        onPointerUp={() => {
          setRegions((prev) => {
            const last = prev[prev.length - 1];
            if (last && (last.w < 10 || last.h < 10)) return prev.slice(0, -1);
            return prev;
          });
          setDrawing(null);
        }}
        onPointerCancel={() => {
          setRegions((prev) => prev.slice(0, -1));
          setDrawing(null);
        }}
      >
        <canvas
          ref={canvasRef}
          className="blur-canvas"
          onPointerDown={() =>
            setRegions((prev) => [...prev, { x: 0, y: 0, w: 0, h: 0 }])
          }
        />
        {regions.map((r, i) => {
          const { w, h } = dims;
          if (r.w < 2 || r.h < 2) return null;
          return (
            <span
              key={i}
              className="blur-region"
              style={{
                left: `${(r.x / w) * 100}%`,
                top: `${(r.y / h) * 100}%`,
                width: `${(r.w / w) * 100}%`,
                height: `${(r.h / h) * 100}%`,
              }}
            >
              <button
                type="button"
                aria-label={`Remove blur region ${i + 1}`}
                data-tooltip={`Remove blur region ${i + 1}`}
                onClick={() =>
                  setRegions((prev) => prev.filter((_, j) => j !== i))
                }
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          );
        })}
      </div>

      <label className="field blur-intensity">
        <span className="field-label">
          <Brush size={15} aria-hidden="true" />
          Blur strength: {intensity}px
        </span>
        <input
          type="range"
          min={4}
          max={28}
          value={intensity}
          onChange={(e) => setIntensity(Number(e.target.value))}
          aria-label="Blur strength"
        />
      </label>

      <div className="blur-actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setRegions([])}
          disabled={regions.length === 0}
        >
          <RotateCcw size={14} aria-hidden="true" />
          Clear all
        </button>
        <span className="blur-count">
          {regions.length} {regions.length === 1 ? 'face' : 'faces'} blurred
        </span>
        <button
          type="button"
          className="btn btn-primary"
          onClick={apply}
          disabled={regions.length === 0}
        >
          <Check size={15} aria-hidden="true" />
          Apply blur
        </button>
      </div>
    </Modal>
  );
}
