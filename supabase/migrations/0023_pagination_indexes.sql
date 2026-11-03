-- 0023: Cursor-pagination indexes for feeds, directories, and threads.
--
-- The app pages newest-first with (created_at DESC, id DESC) cursors (see
-- frontend/src/lib/paging.ts). These indexes match that order exactly so
-- page fetches stay index-only scans as tables grow. No RLS changes: every
-- paged query hits the same tables and policies as before.
--
-- (Tag search uses ILIKE prefilters over the same shared-memories index. If
-- memories grow past ~100k rows, add pg_trgm + a GIN index on title/body.)

-- Shared community feed (+ tag prefilter): replace the 0001 index with the
-- cursor-ordered form under the same name.
drop index if exists public.memories_shared_idx;
create index if not exists memories_shared_idx
  on public.memories (created_at desc, id desc) where shared = true;

-- My Memories pages.
create index if not exists memories_author_cursor_idx
  on public.memories (author_id, created_at desc, id desc);

-- Opt-in directory (Discover): ordered by activity, then id for stability.
create index if not exists profiles_directory_idx
  on public.profiles (updated_at desc, user_id asc) where discoverable = true;

-- Notifications inbox pages.
create index if not exists notifications_recipient_cursor_idx
  on public.notifications (recipient_id, created_at desc, id desc);

-- Chat history pages: extend the 0006 index with the id tiebreak.
drop index if exists public.messages_conversation_idx;
create index if not exists messages_conversation_idx
  on public.messages (conversation_id, created_at desc, id desc);
