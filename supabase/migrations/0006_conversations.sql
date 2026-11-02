-- 0006: Private messaging tables (conversations, participants, messages,
-- reactions, read receipts).
--
-- Conversations are strictly 1:1 and can only be created through the
-- get_or_create_conversation() RPC in 0007 (accepted reconnection required,
-- duplicates impossible). RLS policies land in 0007.

-- ------------------------------------------------------------ conversations
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz null
);

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

create index if not exists conversations_last_message_idx
  on public.conversations (last_message_at desc nulls last);

-- ------------------------------------------------- conversation_participants
create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists conversation_participants_user_idx
  on public.conversation_participants (user_id);

-- ----------------------------------------------------------------- messages
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  content text not null default '' check (char_length(content) <= 2000),
  message_type text not null default 'text'
    check (message_type in ('text', 'image', 'system')),
  attachment_path text not null default '' check (char_length(attachment_path) <= 512),
  created_at timestamptz not null default now(),
  edited_at timestamptz null,
  deleted_at timestamptz null,
  check (content <> '' or attachment_path <> '' or message_type = 'system')
);

create index if not exists messages_conversation_idx
  on public.messages (conversation_id, created_at desc);
create index if not exists messages_sender_idx
  on public.messages (sender_id);

-- -------------------------------------------------------- message_reactions
create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create index if not exists message_reactions_message_idx
  on public.message_reactions (message_id);

-- ------------------------------------------------------------ message_reads
create table if not exists public.message_reads (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
