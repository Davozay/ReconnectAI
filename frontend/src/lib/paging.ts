/* Shared pagination primitives for ReConnect AI.
   Two strategies, matching the Supabase guides used across the data layer:
   - Cursor paging (feeds, threads): order (created_at DESC, id DESC) and pass
     the last row back as the cursor. Stable when new rows arrive at the top.
   - Offset paging (directories): .range() with a deterministic order.
   Every paged fetch over-fetches by one (limit+1) so hasMore never needs a
   count query. */

export interface PageCursor {
  created_at: string;
  id: string;
}

/** Cursor pointing just past `row` in (created_at DESC, id DESC) order. */
export function cursorOf(row: { created_at: string; id: string }): PageCursor {
  return { created_at: row.created_at, id: row.id };
}

/** PostgREST filter matching rows strictly after `cursor` in the shared order. */
export function cursorFilter(cursor: PageCursor): string {
  return `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`;
}

/** Append page rows to a list without duplicates (offset paging can overlap
    when rows shift; realtime inserts can race with page fetches). */
export function mergeUniqueById<T extends { id: string }>(prev: T[], next: T[]): T[] {
  if (prev.length === 0) return next;
  if (next.length === 0) return prev;
  const seen = new Set(prev.map((row) => row.id));
  const fresh = next.filter((row) => !seen.has(row.id));
  return fresh.length === 0 ? prev : [...prev, ...fresh];
}
