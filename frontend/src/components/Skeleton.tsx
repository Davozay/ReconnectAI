import './Skeleton.css';

export function SkeletonLine({ width = '100%' }: { width?: string }) {
  return (
    <span
      className="skeleton skeleton-line"
      style={{ width }}
      aria-hidden="true"
    />
  );
}

export function PostSkeleton() {
  return (
    <div className="card card-pad skeleton-post" aria-hidden="true">
      <div className="skeleton-row">
        <span className="skeleton skeleton-avatar" />
        <div className="skeleton-col">
          <SkeletonLine width="40%" />
          <SkeletonLine width="65%" />
        </div>
      </div>
      <SkeletonLine width="92%" />
      <SkeletonLine width="78%" />
      <span className="skeleton skeleton-media" />
    </div>
  );
}

export function StorySkeletonRow() {
  return (
    <div className="skeleton-stories" aria-hidden="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} className="skeleton skeleton-story" />
      ))}
    </div>
  );
}
