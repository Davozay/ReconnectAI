-- 0004: Private storage buckets for profile and memory photos.
--
-- Both buckets are private (public = false): no public reads. The frontend
-- uses short-lived signed URLs (createSignedUrl, default 60s) for display.
-- Object layout: "<owner-uuid>/<filename>" — the first folder MUST be the
-- owner's auth.uid(); policies enforce it so users cannot write into other
-- users' folders.

insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', false)
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public)
values ('memory-photos', 'memory-photos', false)
on conflict (id) do update set public = false;

-- ------------------------------------------------------- profile-photos
drop policy if exists "profile_photos_owner_read" on storage.objects;
create policy "profile_photos_owner_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'profile-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Discoverable profiles' avatars are visible to signed-in users.
drop policy if exists "profile_photos_discoverable_read" on storage.objects;
create policy "profile_photos_discoverable_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'profile-photos'
    and exists (
      select 1 from public.profiles p
      where p.user_id::text = (storage.foldername(name))[1]
        and p.discoverable = true
    )
  );

drop policy if exists "profile_photos_owner_insert" on storage.objects;
create policy "profile_photos_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "profile_photos_owner_update" on storage.objects;
create policy "profile_photos_owner_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'profile-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'profile-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "profile_photos_owner_delete" on storage.objects;
create policy "profile_photos_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'profile-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- -------------------------------------------------------- memory-photos
drop policy if exists "memory_photos_owner_read" on storage.objects;
create policy "memory_photos_owner_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'memory-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Photos attached to explicitly shared memories are visible to others.
drop policy if exists "memory_photos_shared_read" on storage.objects;
create policy "memory_photos_shared_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'memory-photos'
    and exists (
      select 1
      from public.memory_photos mp
      join public.memories m on m.id = mp.memory_id
      where mp.storage_path = storage.objects.name
        and m.shared = true
    )
  );

drop policy if exists "memory_photos_owner_insert" on storage.objects;
create policy "memory_photos_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'memory-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "memory_photos_owner_delete" on storage.objects;
create policy "memory_photos_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'memory-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
