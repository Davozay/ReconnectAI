import { useEffect, useRef } from 'react';

/* IntersectionObserver sentinel for infinite scrolling (no scroll listeners).
   Fires onLoadMore when the sentinel scrolls near the viewport; ignored while
   loading, exhausted, errored, or disabled. Disconnects on unmount. */

export function useInfiniteScroll({
  onLoadMore,
  hasMore,
  loading,
  disabled = false,
  rootMargin = '400px 0px',
}: {
  onLoadMore: () => void;
  hasMore: boolean;
  loading: boolean;
  disabled?: boolean;
  rootMargin?: string;
}) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const callbackRef = useRef(onLoadMore);
  const loadingRef = useRef(loading);

  // Mirror latest values every render (ref writes belong in effects).
  useEffect(() => {
    callbackRef.current = onLoadMore;
    loadingRef.current = loading;
  });

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || disabled || !hasMore) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !loadingRef.current) {
          callbackRef.current();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [disabled, hasMore, rootMargin]);

  return sentinelRef;
}
