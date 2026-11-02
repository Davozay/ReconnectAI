-- 0005: Optional custom cover photo for profiles.
--
-- Stores the storage object path (in the private `profile-photos` bucket,
-- layout "<owner-uuid>/<file>") for a user-uploaded profile cover. Empty
-- means "use the generated art fallback". No new RLS or storage policies
-- are needed: the existing profiles owner/discoverable policies and the
-- profile-photos owner-folder storage policies already cover this column
-- and bucket path.

alter table public.profiles
  add column if not exists cover_storage_path text not null default ''
  check (char_length(cover_storage_path) <= 512);
