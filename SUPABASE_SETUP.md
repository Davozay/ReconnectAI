# Supabase Setup for ReConnect AI

This guide wires the ReConnect AI app to your Supabase project. The frontend
is already pointed at a project URL in `frontend/.env.local`; follow the
steps below to create the schema, configure Auth, and connect the backend.

> The legacy draft `supabase/rls.sql` is superseded by the versioned
> migrations in `supabase/migrations/`. Do not apply both — use the
> migrations only.

## 1. Apply the migrations

In the Supabase dashboard, open the **SQL editor** and run each file in
`supabase/migrations/` **in order** (or use the CLI: `supabase db push` from
a linked project):

| File | Contents |
| ---- | -------- |
| `0001_core_tables.sql` | `profiles`, `childhood_schools`, `childhood_locations`, `memories` + indexes |
| `0002_social_tables.sql` | `memory_photos`, `reconnection_requests`, `user_blocks`, `user_reports` + indexes |
| `0003_rls.sql` | Row Level Security on all 8 tables (opt-in discovery, private-by-default memories) |
| `0004_storage.sql` | Private `profile-photos` and `memory-photos` buckets + access policies |
| `0005_cover_photo.sql` | `profiles.cover_storage_path` for custom cover photos (no policy changes needed) |
| `0006_conversations.sql` | `conversations`, `conversation_participants`, `messages`, `message_reactions`, `message_reads` |
| `0007_messaging_rls.sql` | Messaging RLS + `get_or_create_conversation()` RPC + rate limiting (30/min) |
| `0008_notifications_storage_realtime.sql` | `notifications` + triggers, `chat-attachments` bucket, connected-profile visibility, Realtime publication |
| `0009_likes_realtime.sql` | `memory_likes` + RLS, Realtime membership for requests and likes |
| `0010_block_enforcement.sql` | Blocks hide shared memories + connected profiles (directional) |
| `0011_moderation.sql` | `moderators` table + `is_moderator()` + moderator read/update policies for reports, profiles, messages |
| `0012_comments_saves.sql` | `memory_comments` + `memory_saves` + RLS, Realtime membership for both |
| `0013_like_comment_notifications.sql` | `memory_like` / `memory_comment` notification triggers (no self-notifies) |
| `0014_message_search.sql` | Trigram index for in-conversation search (perf-only, skippable) |
| `0015_stories.sql` | `stories` + `story_views` + private `story-media` bucket + connection-only RLS |
| `0016_reconnect_after_decline.sql` | Recipient can flip declined → accepted; request inserts denied for blocked pairs |
| `0017_school_groups.sql` | Group columns + school matching + 7 group RPCs; system messages RPC-only + rate-exempt |
| `0018_group_flavors.sql` | School/place/free group flavors; mutual place lookup; connection-gated free crews |
| `0019_fuzzy_affiliation_match.sql` | Tolerant group matching: punctuation-insensitive + affix-tolerant school/place names |
| `0020_story_likes.sql` | `story_likes` + RLS, `story_like` notifications, Realtime membership |
| `0021_request_profile_visibility.sql` | Pending/declined request counterparties can read each other's profiles (fixes anonymous names in Pending Requests) |

Realtime needs no dashboard toggle on Supabase Cloud — migration 0008 adds
the messaging tables to the `supabase_realtime` publication itself. If live
updates ever stop arriving, confirm those tables are still members of the
publication (Database → Replication).

Verify: **Table Editor** shows all 8 tables, each with RLS enabled (shield
icon), and **Storage** shows both buckets as **private**.

## 2. Configure Auth

In **Authentication → Settings**:

- **Site URL**: `http://localhost:5173` (add your production URL when you deploy).
- **Redirect URLs**: add
  - `http://localhost:5173/**`
  - `http://localhost:5173/reset-password`
- **Email confirmation**: leave **Confirm email** ON (recommended). Sign-up
  then requires inbox verification before the first session; the app shows a
  "Check your inbox" screen with resend support.
- **Password recovery**: enabled by default; reset links land on
  `/reset-password` (see `resetPassword` in `frontend/src/context/AuthContext.tsx`).
- **Email uniqueness**: enforced by Supabase Auth itself — a second account
  can never register or log in with an address that already has an account.
  The app normalizes addresses (trim + lowercase) and shows a clear
  "already exists" message on duplicates.
- **Password policy**: the app requires 8+ characters with uppercase,
  lowercase, digit, and symbol on signup and password reset (see
  `frontend/src/lib/password.ts`, with a live strength meter). Sign-in
  accepts existing passwords unchanged so earlier accounts keep working.

No email-server setup is needed for development (Supabase sends the mails).

## 3. Frontend environment

`frontend/.env.local` (gitignored) must use the **`VITE_` prefix** — Vite
ignores `NEXT_PUBLIC_*` variables:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=paste-your-publishable-key-here
VITE_API_URL=http://localhost:8001
```

Find both values under **Project Settings → API**. Only the publishable key
goes here — **never** the `service_role` secret.

## 4. Backend environment

```sh
cd backend
pip install -r requirements.txt  # adds pyjwt, cryptography, httpx
cp .env.example .env  # then edit
```

Set in `backend/.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
```

That is the only required Shield setting: access tokens are verified against
your project's **current asymmetric signing keys** via
`<SUPABASE_URL>/auth/v1/.well-known/jwks.json` (issuer, audience, and
expiration are validated; keys are cached for 10 minutes with automatic
refresh on rotation). Optional overrides:

- `SUPABASE_JWKS_URL` — explicit JWKS document URL (default: derived).
- `SUPABASE_JWT_ISSUER` / `SUPABASE_JWT_AUDIENCE` — expected claims
  (defaults: `<SUPABASE_URL>/auth/v1` and `authenticated`).
- `SUPABASE_JWT_SECRET` — **legacy HS256 fallback** for older projects only.
- `SHIELD_DEMO_MODE=true` — hackathon header auth when Supabase is unset.
- `SHIELD_ADMIN_IDS` — comma-separated admin user IDs for moderation routes.
- `CORS_ORIGINS` — must include the frontend origin (default `http://localhost:5173`).

Start the API with `uvicorn main:app --reload --port 8001` from `backend/`.

## 5. Verify end to end (Phase 8 checklist)

1. `npm run dev` (frontend) + backend running.
2. **Register** at `/signup` → confirm via inbox → **log in** at `/login`.
3. **Refresh** — the session persists (no redirect to login).
4. Complete **onboarding** → open Supabase Table Editor: a `profiles` row
   and a `childhood_schools` row exist for your user.
5. **Profile page**: edit bio/hometown, add a school and a place, upload an
   avatar. Reload — everything persists.
6. **Home feed**: post a memory (shared on/off), delete it.
7. **Memory Detective**: run a live analysis, save it as a memory —
   it appears on your profile as **private**.
8. **Privacy**: in Storage, both buckets stay private; profile/memory photos
   load through short-lived signed URLs only. With a second account, confirm
   you cannot see the first account's private rows (RLS returns nothing).
9. **Detective still works** signed out (live AI unchanged).

## 6. Automated checks

```sh
cd backend && python -m pytest -q        # Shield + JWKS + Detective tests
cd frontend && npm run lint              # ESLint
cd frontend && npm run build             # tsc + production build
```

## Notes

- The FastAPI Shield store is still in-memory (resets on restart); Supabase
  JWTs now secure it. The persistent social graph (requests, blocks,
  reports) lives in the Supabase tables above.
- The Memory Detective integration is untouched: same routes, same Meta
  Model API client, same prompts.
- Expired stories are hidden by queries but their rows and media stay in
  the database. Optional cleanup (run occasionally in the SQL editor):
  `delete from public.stories where expires_at < now();` then remove the
  orphaned `story-media` objects listed by their `media_path` values.

## 7. Testing messaging with two accounts

Sign in as user A in one browser and user B in another (or normal +
incognito). Both accounts need confirmed emails and completed onboarding.

1. A: Discover → send B a request (B must have discovery on).
2. B: Connections updates live with a toast; a notification appears and
   the bell dot lights. Accept the request.
3. A: gets an acceptance notification. Connections → Message opens the
   thread. Send "hello".
4. B: Messages list updates live with an unread badge. Open the thread —
   the message is there, and A sees "Seen" without refreshing.
5. B replies → A receives it live. React, edit, and delete a message —
   the other side updates live each time.
6. A shares a photo → B views it fullscreen. Confirm the photo does NOT
   appear in the community feed.
7. A blocks B (thread header) → neither side can send; B vanishes from
   A's discovery. Unblock from Settings.
8. Refresh both browsers mid-chat → full history persists (PostgreSQL,
   not localStorage).
9. RLS spot-checks (Table Editor / second account): A cannot read B's
   private rows; sending to a non-connection fails with "You need an
   accepted connection".
10. **Feed realtime**: A posts a shared memory → B's feed shows it after
    refresh. B likes, saves, and comments → A's like count, comment count,
    and open thread update live without refreshing, and A gets "liked
    your memory" / "commented on your memory" notifications with a live
    bell dot (tapping one opens the feed). Liking/commenting your own
    memory notifies nobody. Saves persist per account (A cannot see B's
    saves); comment authors can delete their own comments, and the memory
    author can delete any comment on it.
11. **Search + stories**: in any thread, open the header search, type a
    word from an old message → results list with highlighted matches;
    tap one → the thread loads older history if needed, scrolls to it,
    and flashes it. Post a story (Home → Your story → +): it appears in
    B's tray with an unviewed ring within seconds (A and B must be
    connected); B watches it fullscreen with progress bars; A sees B in
    the story's Views list. B taps Like on A's story → the heart fills
    with a live count, and A gets a "liked your story" notification with a
    live bell dot; A opens the story → Likes lists B. Stories vanish 24h
    after posting.
12. **Decline → reconnect**: B declines A's request → both see a Declined
    section in Connections. B taps Connect → instantly connected, A gets
    an acceptance notification (works even with discovery off). Or A taps
    Send again → B gets a fresh request. Blocked pairs get "Unblock them
    in Settings first" instead. Discover now shows Connected (disabled)
    for existing connections instead of offering another request.
13. **Groups**: A and B both list "Royal Kids Academy" under
    Profile → About → Schools (same spelling; letter case, punctuation,
    and extra words like "High School" are ignored — but a school written
    only in the bio never matches). A: Messages → New
    group → School → pick the school → name it → tick B → Create. B's
    list gains the group live with an unread badge. Both chat; sender
    names show on others' bubbles; event lines ("A added B") appear
    centered. A opens group info (header tap): renames, removes B (B
    loses access immediately), re-adds B. B taps a new-message
    notification → lands straight in the group thread. C (no such school
    listed) never appears in the picker. A leaves → B becomes creator
    with an event line. Deleting (creator, two taps) wipes the thread
    for everyone. Repeat once as Estate/place (shared childhood place)
    and once as Free crew (requires a title; picker lists connections
    only — non-connections fail with "Connect with them first").

## 8. Moderating reports

Reports filed from Discover, Messages, or profiles land in the
`user_reports` table and in the in-app queue at **Settings → Moderation →
Open moderation queue** (`/app/moderation`). Only moderators can open it:
everyone else sees a "moderators only" notice, and RLS denies non-moderator
reads even through direct API calls.

1. Apply migration `0011_moderation.sql` (see §1).
2. Find your auth user id: **Authentication → Users** → click your user →
   copy the **UID**. (It must be the account you log in with.)
3. In the **SQL editor**, run (no client can do this — dashboard SQL only):

```sql
insert into public.moderators (user_id) values ('PASTE-UID-HERE');
```

4. Refresh the app. **Settings** now shows a **Moderation** card linking to
   the queue.
5. In the queue, filter by status (open / reviewing / resolved /
   dismissed), read the reporter's note, preview reported message text, and
   move each report through the workflow with the status dropdown.
6. Reporters track their own filings under **Settings → My reports**; the
   reported person is never told who filed.

Trust note: moderators can read all reports, any profile's basics, and any
message's content — the minimum needed to review reports. They cannot write
anything except report statuses, and only you (via dashboard SQL) can add
or remove moderators.
