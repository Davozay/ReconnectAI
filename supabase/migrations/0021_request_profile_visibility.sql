-- 0021: Show request counterparties' profiles (pending or declined).
--
-- Before this migration, profiles were visible only to the owner,
-- everyone (when discoverable), accepted-connection counterparties, and
-- moderators. A non-discoverable user who sent you a request was none of
-- those, so Pending Requests rendered them as "A ReConnect member" with no
-- way to know who you were accepting or declining. The same gap hid names
-- in Sent and Declined.
--
-- Now a pending or declined request in either direction reveals the
-- counterparty's profile, mirroring profiles_connected_read (0010):
-- same directional block guard (hidden only from users the owner blocked),
-- same participant EXISTS shape. Cancelled requests grant nothing, since
-- the app no longer surfaces those rows anywhere.

drop policy if exists "profiles_request_read" on public.profiles;
create policy "profiles_request_read" on public.profiles
  for select to authenticated
  using (
    user_id <> auth.uid()
    and not public.blocked_by(profiles.user_id)
    and exists (
      select 1 from public.reconnection_requests r
      where r.status in ('pending', 'declined')
        and ((r.from_id = auth.uid() and r.to_id = profiles.user_id)
          or (r.from_id = profiles.user_id and r.to_id = auth.uid()))
    )
  );
