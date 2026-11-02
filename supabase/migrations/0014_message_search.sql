-- 0014: Trigram index for message search.
--
-- Perf-only: in-conversation search uses `content ilike %query%`, which
-- works without this index. pg_trgm keeps it fast on long histories.
-- RLS on messages already scopes reads to conversation participants, so
-- no policy changes are needed. Safe to skip if pg_trgm is unavailable.

create extension if not exists pg_trgm;

create index if not exists messages_content_trgm_idx
  on public.messages using gin (content gin_trgm_ops);
