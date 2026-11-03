/* Trending-memory hashtags for ReConnect AI.
   Tags come only from real memories the viewer is allowed to see: the fetch
   goes through the memories RLS policies (shared + not blocked), and the
   ranking below counts distinct eligible memories per tag. Nothing here
   invents tags or counts. */

import { listRecentSharedMemories } from './db';
import type { Memory } from './db';

export const TRENDING_WINDOW_DAYS = 7;
export const TRENDING_RAIL_LIMIT = 3;

const TAG_RE = /#([\p{L}\p{N}_]+)/gu;

export interface TrendingTag {
  /** Lowercase canonical tag, without the leading '#'. */
  tag: string;
  /** Display form: the most frequent original casing. */
  display: string;
  /** Distinct eligible memories carrying this tag. */
  memoryCount: number;
  /** Newest carrying memory (tiebreak + freshness). */
  latestAt: string;
}

/** Canonical form: case-insensitive, without '#'. Empty when not a real tag. */
export function normalizeTag(raw: string): string {
  const cleaned = raw.trim().replace(/^#+/, '');
  if (!/^[\p{L}\p{N}_]+$/u.test(cleaned)) return '';
  return cleaned.toLowerCase();
}

/** Every hashtag in `text`, canonicalized and de-duplicated (first-seen order). */
export function extractHashtags(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(TAG_RE)) {
    const norm = match[1].toLowerCase();
    if (!seen.has(norm)) seen.add(norm);
  }
  return [...seen];
}

function displayFor(variants: Map<string, number>): string {
  let best = '';
  let bestCount = -1;
  for (const [variant, count] of variants) {
    if (count > bestCount) {
      best = variant;
      bestCount = count;
    }
  }
  return best;
}

export function memoryHasTag(memory: Memory, tag: string): boolean {
  const norm = tag.toLowerCase();
  return extractHashtags(`${memory.title}\n${memory.body}`).includes(norm);
}

/** Rank tags by distinct-memory count (desc), then newest memory (desc). */
export function rankTrendingTags(
  memories: Memory[],
  sinceIso: string,
  limit = TRENDING_RAIL_LIMIT,
): TrendingTag[] {
  const buckets = new Map<
    string,
    { ids: Set<string>; variants: Map<string, number>; latestAt: string }
  >();
  for (const memory of memories) {
    if (memory.created_at < sinceIso) continue;
    const text = `${memory.title}\n${memory.body}`;
    const tags = extractHashtags(text);
    if (tags.length === 0) continue;
    const rawByNorm = new Map<string, string>();
    for (const match of text.matchAll(TAG_RE)) {
      const norm = match[1].toLowerCase();
      if (!rawByNorm.has(norm)) rawByNorm.set(norm, match[1]);
    }
    for (const tag of tags) {
      let bucket = buckets.get(tag);
      if (!bucket) {
        bucket = { ids: new Set(), variants: new Map(), latestAt: memory.created_at };
        buckets.set(tag, bucket);
      }
      bucket.ids.add(memory.id);
      const raw = rawByNorm.get(tag) ?? tag;
      bucket.variants.set(raw, (bucket.variants.get(raw) ?? 0) + 1);
      if (memory.created_at > bucket.latestAt) bucket.latestAt = memory.created_at;
    }
  }
  return [...buckets.entries()]
    .map(([tag, bucket]) => ({
      tag,
      display: displayFor(bucket.variants),
      memoryCount: bucket.ids.size,
      latestAt: bucket.latestAt,
    }))
    .sort(
      (a, b) =>
        b.memoryCount - a.memoryCount ||
        (b.latestAt < a.latestAt ? -1 : b.latestAt > a.latestAt ? 1 : 0) ||
        (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0),
    )
    .slice(0, limit);
}

export function formatMemoryCount(count: number): string {
  return count === 1 ? '1 memory' : `${count.toLocaleString()} memories`;
}

/** Top tags from shared memories created within the past 7 days. */
export async function listTrendingTags(
  limit = TRENDING_RAIL_LIMIT,
): Promise<TrendingTag[]> {
  const since = new Date(
    Date.now() - TRENDING_WINDOW_DAYS * 24 * 3600 * 1000,
  ).toISOString();
  const memories = await listRecentSharedMemories(since);
  return rankTrendingTags(memories, since, limit);
}
