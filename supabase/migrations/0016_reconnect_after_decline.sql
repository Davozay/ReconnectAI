-- 0016: Reconnect after decline + block-checked request inserts.
--
-- 1. Declining is no longer a dead end: the recipient of a declined
--    request can flip it straight to accepted ("oops, I meant to
--    connect"). The existing accepted trigger notifies the requester,
--    and messaging/stories inherit the connection as usual. Blocked
--    pairs cannot use this path (unblock first).
-- 2. Closes a gap in requests_sender_insert (0003): blocks now actually
--    prevent new reconnection requests in BOTH directions, as 0010's
--    header always claimed. Uses blocked_with() from 0010, so 0010 must
--    be applied first (migrations run in order).

drop policy if exists "requests_recipient_reconnect" on public.reconnection_requests;
create policy "requests_recipient_reconnect" on public.reconnection_requests
  for update to authenticated
  using (
    auth.uid() = to_id
    and status = 'declined'
    and not public.blocked_with(from_id)
  )
  with check (
    auth.uid() = to_id
    and status = 'accepted'
  );

drop policy if exists "requests_sender_insert" on public.reconnection_requests;
create policy "requests_sender_insert" on public.reconnection_requests
  for insert to authenticated
  with check (
    auth.uid() = from_id
    and status = 'pending'
    and not public.blocked_with(to_id)
  );
