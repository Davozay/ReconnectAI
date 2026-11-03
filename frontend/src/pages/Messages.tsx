import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, UIEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  Ban,
  Check,
  CheckCheck,
  Flag,
  ImagePlus,
  LoaderCircle,
  Pencil,
  Search,
  Send,
  Smile,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import Avatar from '../components/Avatar';
import BlockConfirmModal from '../components/BlockConfirmModal';
import GroupInfoModal from '../components/GroupInfoModal';
import Modal from '../components/Modal';
import NewGroupModal from '../components/NewGroupModal';
import ReportModal from '../components/ReportModal';
import { useAuth } from '../context/useAuth';
import { useToast } from '../context/useToast';
import {
  DbError,
  blockUser,
  getConnectionWith,
  getProfilesByIds,
  isMissingTable,
  listMyBlocks,
  unblockUser,
} from '../lib/db';
import type { ReconnectionRequest } from '../lib/db';
import {
  deleteMessage,
  editMessage,
  getReads,
  listConversations,
  listMessages,
  listReactions,
  markRead,
  searchMessages,
  sendMessage,
  subscribeToConversation,
  subscribeToInbox,
  toggleReaction,
} from '../lib/messages';
import type {
  ConversationPreview,
  Message,
  Reaction,
  RealtimeStatus,
} from '../lib/messages';
import {
  StorageError,
  getChatAttachmentUrl,
  getProfilePhotoUrl,
  uploadChatAttachment,
} from '../lib/storage';
import './Messages.css';

const EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '🙏', '🎉', '👏'];

function errMessage(err: unknown): string {
  return err instanceof DbError || err instanceof StorageError || err instanceof Error
    ? err.message
    : 'Something went wrong.';
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function previewText(m: Message | null): string {
  if (!m) return 'No messages yet';
  if (m.deleted_at) return 'Message deleted';
  if (m.message_type === 'image') return m.content.trim() || '📷 Photo';
  return m.content;
}

function highlightHit(text: string, query: string) {
  const needle = query.trim();
  if (!needle) return text;
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + needle.length)}</mark>
      {text.slice(idx + needle.length)}
    </>
  );
}

function makeTempId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `temp-${crypto.randomUUID()}`;
  }
  return `temp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function ChatImage({ path, onOpen }: { path: string; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getChatAttachmentUrl(path)
      .then((u) => {
        if (active) setUrl(u);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [path]);

  if (!url) return <span className="chat-img-loading">Loading photo…</span>;
  return (
    <button
      type="button"
      className="chat-img-btn"
      onClick={() => onOpen(url)}
      aria-label="View photo"
    >
      <img src={url} alt="Shared photo" loading="lazy" />
    </button>
  );
}

interface PendingItem {
  tempId: string;
  content: string;
  error: boolean;
}

export default function Messages() {
  const { user } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const myId = user?.id ?? '';
  const initialActiveId =
    (location.state as { conversationId?: string } | null)?.conversationId ?? null;

  const [previews, setPreviews] = useState<ConversationPreview[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [missingConfig, setMissingConfig] = useState(false);
  const [listTick, setListTick] = useState(0);
  const [query, setQuery] = useState('');

  const [activeId, setActiveId] = useState<string | null>(initialActiveId);
  const activeIdRef = useRef<string | null>(initialActiveId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingThread, setLoadingThread] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [reads, setReads] = useState<{ user_id: string; last_read_at: string }[]>([]);
  const [connStatus, setConnStatus] = useState<RealtimeStatus | null>(null);
  const [connection, setConnection] = useState<ReconnectionRequest | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [peerAvatars, setPeerAvatars] = useState<Record<string, string>>({});

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [reactFor, setReactFor] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [peerOpen, setPeerOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportMessageId, setReportMessageId] = useState<string | null>(null);
  const [blockConfirm, setBlockConfirm] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [searching, setSearching] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const searchTimer = useRef<number | null>(null);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  const [senderNames, setSenderNames] = useState<Record<string, string>>({});
  const [myBlocks, setMyBlocks] = useState<Set<string>>(new Set());

  const seenRef = useRef<Set<string>>(new Set());
  const nearBottomRef = useRef(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const activePreview = previews.find((p) => p.conversation.id === activeId) ?? null;
  const peerId = activePreview?.peerId ?? '';
  const peerProfile = activePreview?.peerProfile ?? null;
  const peerName = peerProfile?.display_name ?? 'A ReConnect member';
  const isGroup = activePreview?.conversation.kind === 'group';
  const groupTitle =
    activePreview?.conversation.title?.trim() ||
    activePreview?.conversation.affiliation_name ||
    'Group';
  const memberIds = activePreview?.memberIds ?? [];
  const iBlockedMember =
    isGroup && memberIds.some((id) => id !== myId && myBlocks.has(id));

  /* ---------- conversation list ---------- */

  useEffect(() => {
    let active = true;
    listConversations()
      .then((rows) => {
        if (!active) return;
        setPreviews(rows);
        rows.forEach((r) => {
          if (r.peerProfile?.avatar_storage_path) {
            getProfilePhotoUrl(r.peerProfile.avatar_storage_path)
              .then((url) => {
                if (active) setPeerAvatars((prev) => ({ ...prev, [r.peerId]: url }));
              })
              .catch(() => {});
          }
        });
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (isMissingTable(err)) setMissingConfig(true);
        else toast(errMessage(err));
      })
      .finally(() => {
        if (active) setLoadingList(false);
      });
    return () => {
      active = false;
    };
  }, [toast, listTick]);

  useEffect(() => {
    return subscribeToInbox(() => setListTick((k) => k + 1));
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    listMyBlocks()
      .then((b) => {
        if (active) setMyBlocks(new Set(b));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!activeId || !isGroup) return;
    const missing = [...new Set(messages.map((m) => m.sender_id))].filter(
      (id) => id !== myId && !(id in senderNames),
    );
    if (missing.length === 0) return;
    let active = true;
    getProfilesByIds(missing)
      .then((profiles) => {
        if (!active) return;
        setSenderNames((prev) => {
          const next = { ...prev };
          for (const p of profiles) next[p.user_id] = p.display_name;
          for (const id of missing) {
            if (!(id in next)) next[id] = 'A ReConnect member';
          }
          return next;
        });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [messages, activeId, isGroup, myId, senderNames]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return previews;
    return previews.filter((p) => {
      const name =
        p.conversation.kind === 'group'
          ? (p.conversation.title?.trim() || p.conversation.affiliation_name || 'Group')
          : (p.peerProfile?.display_name ?? '');
      return (
        name.toLowerCase().includes(q) ||
        previewText(p.lastMessage).toLowerCase().includes(q)
      );
    });
  }, [previews, query]);

  /* ---------- thread loading ---------- */

  const selectConversation = (id: string | null) => {
    activeIdRef.current = id;
    setActiveId(id);
    if (id) {
      setLoadingThread(true);
      setMessages([]);
      setReactions([]);
      setReads([]);
      setHasMore(false);
      setPending([]);
      setEditingId(null);
      setActionsFor(null);
      setReactFor(null);
      setConnection(null);
      setBlocked(false);
      setSearchOpen(false);
      setSearchText('');
      setSearchResults([]);
      setFlashId(null);
      setGroupInfoOpen(false);
      nearBottomRef.current = true;
      seenRef.current = new Set();
    }
  };

  useEffect(() => {
    if (!activeId) return;
    let active = true;
    const convId = activeId;
    listMessages(convId, { limit: 30 })
      .then(({ messages: rows, hasMore: more }) => {
        if (!active) return;
        rows.forEach((m) => seenRef.current.add(m.id));
        setMessages(rows);
        setHasMore(more);
        const ids = rows.map((m) => m.id);
        if (ids.length > 0) {
          listReactions(ids)
            .then((r) => {
              if (active) setReactions(r);
            })
            .catch(() => {});
        }
        getReads(convId)
          .then((r) => {
            if (active) setReads(r);
          })
          .catch(() => {});
        markRead(convId).catch(() => {});
        setListTick((k) => k + 1);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (isMissingTable(err)) setMissingConfig(true);
        else toast(errMessage(err));
      })
      .finally(() => {
        if (active) setLoadingThread(false);
      });
    return () => {
      active = false;
    };
  }, [activeId, toast]);

  useEffect(() => {
    if (!activeId || !peerId) return;
    let active = true;
    getConnectionWith(peerId)
      .then((c) => {
        if (active) setConnection(c);
      })
      .catch(() => {});
    listMyBlocks()
      .then((b) => {
        if (active) setBlocked(b.includes(peerId));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [activeId, peerId]);

  useEffect(() => {
    if (!activeId) return;
    const convId = activeId;
    return subscribeToConversation(convId, {
      onInsert: (m) => {
        if (seenRef.current.has(m.id)) return;
        seenRef.current.add(m.id);
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        if (m.sender_id !== myId) {
          markRead(convId).catch(() => {});
        }
        setListTick((k) => k + 1);
      },
      onUpdate: (m) => {
        setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)));
      },
      onDelete: (id) => {
        setMessages((prev) => prev.filter((m) => m.id !== id));
      },
      onReactions: () => {
        const ids = [...seenRef.current].filter((id) => !id.startsWith('temp-'));
        if (ids.length === 0) return;
        listReactions(ids)
          .then(setReactions)
          .catch(() => {});
      },
      onReads: () => {
        getReads(convId)
          .then(setReads)
          .catch(() => {});
      },
      onStatus: setConnStatus,
    });
  }, [activeId, myId]);

  useEffect(() => {
    if (nearBottomRef.current) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const handleScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  /* ---------- sending ---------- */

  const deliver = async (tempId: string, content: string, convId: string) => {
    try {
      const row = await sendMessage({ conversation_id: convId, content });
      seenRef.current.delete(tempId);
      seenRef.current.add(row.id);
      setPending((prev) => prev.filter((p) => p.tempId !== tempId));
      if (activeIdRef.current === convId) {
        setMessages((prev) => {
          const withoutTemp = prev.filter((m) => m.id !== tempId);
          return withoutTemp.some((m) => m.id === row.id)
            ? withoutTemp
            : [...withoutTemp, row];
        });
      }
      setListTick((k) => k + 1);
      markRead(convId).catch(() => {});
    } catch (err) {
      setPending((prev) =>
        prev.map((p) => (p.tempId === tempId ? { ...p, error: true } : p)),
      );
      toast(errMessage(err));
    }
  };

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    const convId = activeIdRef.current;
    if (!text || !convId || sending || blocked) return;
    const tempId = makeTempId();
    seenRef.current.add(tempId);
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        conversation_id: convId,
        sender_id: myId,
        content: text,
        message_type: 'text',
        attachment_path: '',
        created_at: new Date().toISOString(),
        edited_at: null,
        deleted_at: null,
      },
    ]);
    setPending((prev) => [...prev, { tempId, content: text, error: false }]);
    setDraft('');
    setSending(true);
    try {
      await deliver(tempId, text, convId);
    } finally {
      setSending(false);
    }
  };

  const attach = async (file: File | undefined) => {
    const convId = activeIdRef.current;
    if (!file || !convId || blocked) return;
    setUploading(true);
    try {
      const up = await uploadChatAttachment(file);
      const row = await sendMessage({
        conversation_id: convId,
        content: draft.trim(),
        attachment_path: up.path,
        message_type: 'image',
      });
      seenRef.current.add(row.id);
      if (activeIdRef.current === convId) {
        setMessages((prev) =>
          prev.some((m) => m.id === row.id) ? prev : [...prev, row],
        );
      }
      setDraft('');
      setListTick((k) => k + 1);
      markRead(convId).catch(() => {});
      toast('Photo shared — visible only in this conversation');
    } catch (err) {
      toast(errMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const loadOlder = async () => {
    const convId = activeIdRef.current;
    const oldest = messages[0]?.created_at;
    if (!convId || !oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const { messages: older, hasMore: more } = await listMessages(convId, {
        limit: 30,
        before: oldest,
      });
      older.forEach((m) => seenRef.current.add(m.id));
      setMessages((prev) => [...older, ...prev]);
      setHasMore(more);
      const ids = older.map((m) => m.id);
      if (ids.length > 0) {
        const r = await listReactions(ids);
        setReactions((prev) => [...prev, ...r.filter((x) => !prev.some((p) => p.id === x.id))]);
      }
    } catch (err) {
      toast(errMessage(err));
    } finally {
      setLoadingOlder(false);
    }
  };

  /* ---------- in-thread search ---------- */

  const runSearch = async (convId: string, q: string) => {
    setSearching(true);
    try {
      const rows = await searchMessages(convId, q);
      if (activeIdRef.current !== convId) return;
      setSearchResults(rows);
      const missing = [...new Set(rows.map((m) => m.sender_id))].filter(
        (id) => id !== myId && !(id in senderNames),
      );
      if (missing.length > 0) {
        getProfilesByIds(missing)
          .then((profiles) => {
            if (activeIdRef.current !== convId) return;
            setSenderNames((prev) => {
              const next = { ...prev };
              for (const p of profiles) next[p.user_id] = p.display_name;
              return next;
            });
          })
          .catch(() => {});
      }
    } catch (err) {
      if (activeIdRef.current === convId) toast(errMessage(err));
    } finally {
      if (activeIdRef.current === convId) setSearching(false);
    }
  };

  const onSearchChange = (value: string) => {
    setSearchText(value);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    const convId = activeIdRef.current;
    const q = value.trim();
    if (!q || !convId) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    searchTimer.current = window.setTimeout(() => {
      void runSearch(convId, q);
    }, 300);
  };

  const jumpToMessage = async (id: string) => {
    const convId = activeIdRef.current;
    if (!convId) return;
    if (!messages.some((m) => m.id === id)) {
      let oldest = messages[0]?.created_at;
      if (!oldest) return;
      setLoadingOlder(true);
      try {
        for (let page = 0; page < 10; page += 1) {
          const { messages: older, hasMore: more } = await listMessages(convId, {
            limit: 30,
            before: oldest,
          });
          if (older.length === 0) {
            setHasMore(false);
            break;
          }
          older.forEach((m) => seenRef.current.add(m.id));
          setMessages((prev) => [...older, ...prev]);
          if (older.some((m) => m.id === id)) {
            setHasMore(more);
            break;
          }
          oldest = older[0].created_at;
          if (!more) {
            setHasMore(false);
            break;
          }
          if (page === 9) toast('That message is deep in history — loaded 300 more above.');
        }
        if (![...seenRef.current].includes(id)) {
          toast('Could not load that message.');
          return;
        }
      } catch (err) {
        toast(errMessage(err));
        return;
      } finally {
        setLoadingOlder(false);
      }
    }
    requestAnimationFrame(() => {
      scrollRef.current
        ?.querySelector(`[data-mid="${id}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setFlashId(id);
      window.setTimeout(() => {
        setFlashId((cur) => (cur === id ? null : cur));
      }, 1800);
    });
  };

  /* ---------- message actions ---------- */

  const react = async (messageId: string, emoji: string) => {
    setReactFor(null);
    try {
      await toggleReaction(messageId, emoji);
      const ids = messages.map((m) => m.id).filter((id) => !id.startsWith('temp-'));
      if (ids.length > 0) setReactions(await listReactions(ids));
    } catch (err) {
      toast(errMessage(err));
    }
  };

  const saveEdit = async (messageId: string) => {
    const text = editText.trim();
    if (!text) return;
    try {
      const updated = await editMessage(messageId, text);
      setMessages((prev) => prev.map((m) => (m.id === messageId ? updated : m)));
      setEditingId(null);
      setActionsFor(null);
    } catch (err) {
      toast(errMessage(err));
    }
  };

  const remove = async (messageId: string) => {
    try {
      await deleteMessage(messageId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, deleted_at: new Date().toISOString() } : m,
        ),
      );
      setActionsFor(null);
    } catch (err) {
      toast(errMessage(err));
    }
  };

  const doBlock = async () => {
    if (!peerId) return;
    setBlocking(true);
    try {
      await blockUser(peerId);
      setBlocked(true);
      setBlockConfirm(false);
      toast(`Blocked ${peerName}. They were not notified.`);
    } catch (err) {
      toast(errMessage(err));
    } finally {
      setBlocking(false);
    }
  };

  const doUnblock = async () => {
    if (!peerId) return;
    try {
      await unblockUser(peerId);
      setBlocked(false);
      toast('Unblocked.');
    } catch (err) {
      toast(errMessage(err));
    }
  };

  /* ---------- derived ---------- */

  const lastOwnMessage = [...messages].reverse().find(
    (m) => m.sender_id === myId && !m.deleted_at && !m.id.startsWith('temp-'),
  );
  const peerRead = reads.find((r) => r.user_id === peerId);
  const seen =
    lastOwnMessage != null &&
    peerRead != null &&
    peerRead.last_read_at >= lastOwnMessage.created_at;

  const grouped: { day: string; items: Message[] }[] = [];
  for (const m of messages) {
    const day = dayLabel(m.created_at);
    const last = grouped[grouped.length - 1];
    if (last && last.day === day) last.items.push(m);
    else grouped.push({ day, items: [m] });
  }

  const reactionsFor = (messageId: string) => {
    const rows = reactions.filter((r) => r.message_id === messageId);
    const byEmoji = new Map<string, { count: number; mine: boolean }>();
    for (const r of rows) {
      const entry = byEmoji.get(r.emoji) ?? { count: 0, mine: false };
      entry.count += 1;
      if (r.user_id === myId) entry.mine = true;
      byEmoji.set(r.emoji, entry);
    }
    return [...byEmoji.entries()];
  };

  if (missingConfig) {
    return (
      <div className="messages-page">
        <div className="page-head">
          <div>
            <h1>Messages</h1>
            <p>Private conversations with your reconnected friends.</p>
          </div>
        </div>
        <div className="card card-pad">
          <p className="empty-note">
            Messaging is not available yet. Database configuration is required.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`messages-page${activeId ? ' is-thread' : ''}`}>
      {/* ---------- conversation list ---------- */}
      <section
        className="card msg-list-pane"
        aria-label="Conversations"
      >
        <div className="msg-list-head">
          <div className="msg-list-title">
            <h1>Messages</h1>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setNewGroupOpen(true)}
            >
              <Users size={15} aria-hidden="true" />
              New group
            </button>
          </div>
          <div className="search-box">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search conversations…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search conversations"
            />
          </div>
        </div>
        <div className="msg-list-scroll">
          {loadingList ? (
            <p className="empty-note">Loading conversations…</p>
          ) : filtered.length === 0 ? (
            <div className="msg-empty">
              <h2>No conversations yet</h2>
              <p>
                Your next great conversation starts with a reconnection. Discover
                someone from your past!
              </p>
              <Link to="/app/discover" className="btn btn-primary btn-sm">
                Discover people
              </Link>
            </div>
          ) : (
            <ul className="msg-convos">
              {filtered.map((p) => {
                const isActive = p.conversation.id === activeId;
                const group = p.conversation.kind === 'group';
                const avatar = group ? undefined : peerAvatars[p.peerId];
                const name = group
                  ? (p.conversation.title?.trim() || p.conversation.affiliation_name || 'Group')
                  : (p.peerProfile?.display_name ?? 'A ReConnect member');
                return (
                  <li key={p.conversation.id}>
                    <button
                      type="button"
                      className={`msg-convo${isActive ? ' is-active' : ''}`}
                      onClick={() => selectConversation(p.conversation.id)}
                      aria-current={isActive || undefined}
                    >
                      {avatar ? (
                        <img src={avatar} alt="" className="msg-convo-avatar" aria-hidden="true" />
                      ) : (
                        <Avatar name={name} size="md" />
                      )}
                      <span className="msg-convo-body">
                        <span className="msg-convo-top">
                          <strong>{name}</strong>
                          {p.lastMessage && (
                            <time>{timeAgo(p.lastMessage.created_at)}</time>
                          )}
                        </span>
                        <span className="msg-convo-bottom">
                          <span className="msg-convo-preview">
                            {p.lastMessage
                              ? `${p.lastMessage.sender_id === myId ? 'You: ' : ''}${previewText(p.lastMessage)}`
                              : group
                                ? `${p.memberIds.length} members — say hello 👋`
                                : 'Say hello 👋'}
                          </span>
                          {p.unreadCount > 0 && (
                            <span className="msg-unread" aria-label={`${p.unreadCount} unread`}>
                              {p.unreadCount > 9 ? '9+' : p.unreadCount}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* ---------- thread ---------- */}
      <section className="card msg-thread-pane" aria-label="Conversation">
        {!activeId || !activePreview ? (
          <div className="msg-empty msg-thread-empty">
            <h2>Pick a conversation</h2>
            <p>Choose someone on the left to start catching up.</p>
          </div>
        ) : (
          <>
            <div className="msg-thread-head">
              <button
                type="button"
                className="btn btn-ghost btn-sm msg-back"
                onClick={() => selectConversation(null)}
                aria-label="Back to conversations"
                data-tooltip="Back to conversations"
                data-tooltip-pos="bottom"
              >
                <ArrowLeft size={18} aria-hidden="true" />
              </button>
              {isGroup ? (
                <button
                  type="button"
                  className="msg-peer"
                  onClick={() => setGroupInfoOpen(true)}
                  aria-label={`View group info for ${groupTitle}`}
                >
                  <Avatar name={groupTitle} size="sm" />
                  <span className="msg-peer-text">
                    <strong>{groupTitle}</strong>
                    {connStatus && connStatus !== 'SUBSCRIBED' ? (
                      <small className="msg-reconnecting">Reconnecting…</small>
                    ) : (
                      <small>
                        {memberIds.length} member{memberIds.length === 1 ? '' : 's'}
                        {activePreview?.conversation.affiliation_name
                          ? ` · ${activePreview.conversation.affiliation_name}`
                          : ''}
                      </small>
                    )}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  className="msg-peer"
                  onClick={() => setPeerOpen(true)}
                  aria-label={`View ${peerName}'s profile`}
                >
                  {peerAvatars[peerId] ? (
                    <img
                      src={peerAvatars[peerId]}
                      alt=""
                      className="msg-peer-avatar"
                      aria-hidden="true"
                    />
                  ) : (
                    <Avatar name={peerName} size="sm" />
                  )}
                  <span className="msg-peer-text">
                    <strong>{peerName}</strong>
                    {connStatus && connStatus !== 'SUBSCRIBED' ? (
                      <small className="msg-reconnecting">Reconnecting…</small>
                    ) : (
                      connection && (
                        <small>
                          Connected {new Date(connection.created_at).toLocaleDateString(undefined, {
                            month: 'short',
                            year: 'numeric',
                          })}
                        </small>
                      )
                    )}
                  </span>
                </button>
              )}
              <div className="msg-head-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSearchOpen((v) => !v)}
                  aria-label="Search in conversation"
                  aria-expanded={searchOpen}
                  data-tooltip="Search in conversation"
                  data-tooltip-pos="bottom"
                >
                  <Search size={15} aria-hidden="true" />
                </button>
                {!isGroup && (!blocked ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setBlockConfirm(true)}
                    aria-label={`Block ${peerName}`}
                  >
                    <Ban size={15} aria-hidden="true" />
                    <span className="msg-head-label">Block</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => doUnblock()}
                  >
                    Unblock
                  </button>
                ))}
                {!isGroup && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setReportOpen(true)}
                    aria-label="Report conversation"
                  >
                    <Flag size={15} aria-hidden="true" />
                    <span className="msg-head-label">Report</span>
                  </button>
                )}
              </div>
            </div>

            {searchOpen && (
              <div className="msg-search">
                <div className="search-box">
                  <Search size={16} aria-hidden="true" />
                  <input
                    type="search"
                    placeholder="Search in conversation…"
                    value={searchText}
                    onChange={(e) => onSearchChange(e.target.value)}
                    aria-label="Search in conversation"
                  />
                  {searchText && (
                    <button
                      type="button"
                      className="msg-search-clear"
                      onClick={() => onSearchChange('')}
                      aria-label="Clear search"
                      data-tooltip="Clear search"
                    >
                      <X size={15} aria-hidden="true" />
                    </button>
                  )}
                </div>
                {searching && <p className="empty-note">Searching…</p>}
                {!searching && searchText.trim() && searchResults.length === 0 && (
                  <p className="empty-note">No messages found.</p>
                )}
                {searchResults.length > 0 && (
                  <ul className="msg-search-results">
                    {searchResults.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          className="msg-search-hit"
                          onClick={() => jumpToMessage(r.id)}
                        >
                          <span className="msg-search-who">
                            {r.sender_id === myId
                              ? 'You'
                              : isGroup
                                ? (senderNames[r.sender_id] ?? '…')
                                : peerName}
                          </span>
                          <span className="msg-search-text">
                            {r.message_type === 'image' && !r.content.trim()
                              ? '📷 Photo'
                              : highlightHit(r.content.slice(0, 140), searchText)}
                          </span>
                          <time>{timeAgo(r.created_at)}</time>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div
              className="msg-scroll"
              ref={scrollRef}
              onScroll={handleScroll}
              role="log"
              aria-label="Messages"
              aria-live="off"
            >
              {loadingThread ? (
                <p className="empty-note">Loading messages…</p>
              ) : messages.length === 0 ? (
                <div className="msg-empty">
                  {isGroup ? (
                    <>
                      <h2>Welcome to {groupTitle}!</h2>
                      <p>Say hello to your schoolmates.</p>
                    </>
                  ) : (
                    <>
                      <h2>You&apos;re connected!</h2>
                      <p>Say hello and start making new memories.</p>
                    </>
                  )}
                </div>
              ) : (
                <>
                  {hasMore && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm msg-older"
                      onClick={() => loadOlder()}
                      disabled={loadingOlder}
                    >
                      {loadingOlder ? 'Loading…' : 'Load older messages'}
                    </button>
                  )}
                  {grouped.map((g) => (
                    <div key={`${g.day}-${g.items[0]?.id ?? ''}`} className="msg-day">
                      <p className="msg-day-label">{g.day}</p>
                      {g.items.map((m) => {
                        const mine = m.sender_id === myId;
                        const failed = pending.find((p) => p.tempId === m.id)?.error;
                        const chips = reactionsFor(m.id);
                        return (
                          <div
                            key={m.id}
                            data-mid={m.id}
                            className={`msg-row${mine ? ' is-mine' : ''}${flashId === m.id ? ' is-flash' : ''}${m.message_type === 'system' ? ' is-system' : ''}`}
                          >
                            {m.message_type === 'system' ? (
                              <p className="msg-system">{m.content}</p>
                            ) : (
                            <div className={`msg-bubble${m.deleted_at ? ' is-deleted' : ''}`}>
                              {isGroup && !mine && !m.deleted_at && (
                                <span className="msg-sender">
                                  {senderNames[m.sender_id] ?? '…'}
                                </span>
                              )}
                              {m.deleted_at ? (
                                <p className="msg-deleted">This message was deleted.</p>
                              ) : editingId === m.id ? (
                                <span className="msg-edit">
                                  <input
                                    className="input input-sm"
                                    value={editText}
                                    onChange={(e) => setEditText(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') void saveEdit(m.id);
                                      if (e.key === 'Escape') setEditingId(null);
                                    }}
                                    aria-label="Edit message"
                                  />
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    onClick={() => saveEdit(m.id)}
                                    aria-label="Save edit"
                                    data-tooltip="Save edit"
                                  >
                                    <Check size={14} aria-hidden="true" />
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => setEditingId(null)}
                                    aria-label="Cancel edit"
                                    data-tooltip="Cancel edit"
                                  >
                                    <X size={14} aria-hidden="true" />
                                  </button>
                                </span>
                              ) : (
                                <>
                                  {m.attachment_path && (
                                    <ChatImage
                                      path={m.attachment_path}
                                      onOpen={(url) => setViewer(url)}
                                    />
                                  )}
                                  {m.content.trim() && (
                                    <p className="msg-text">{m.content}</p>
                                  )}
                                  <span className="msg-meta">
                                    <time>{clock(m.created_at)}</time>
                                    {m.edited_at && <span> · edited</span>}
                                  </span>
                                </>
                              )}
                              {!m.deleted_at && chips.length > 0 && (
                                <span className="msg-chips">
                                  {chips.map(([emoji, info]) => (
                                    <button
                                      key={emoji}
                                      type="button"
                                      className={`msg-chip${info.mine ? ' is-mine' : ''}`}
                                      onClick={() => react(m.id, emoji)}
                                      aria-label={`React ${emoji}, ${info.count}`}
                                    >
                                      {emoji} {info.count}
                                    </button>
                                  ))}
                                </span>
                              )}
                              {failed && (
                                <span className="msg-failed">
                                  Couldn’t send.{' '}
                                  <button
                                    type="button"
                                    className="link-btn"
                                    onClick={() => {
                                      const item = pending.find((p) => p.tempId === m.id);
                                      if (item && activeIdRef.current) {
                                        setPending((prev) =>
                                          prev.map((p) =>
                                            p.tempId === m.id ? { ...p, error: false } : p,
                                          ),
                                        );
                                        void deliver(m.id, item.content, activeIdRef.current);
                                      }
                                    }}
                                  >
                                    Retry
                                  </button>
                                </span>
                              )}
                            </div>
                            )}
                            {m.message_type !== 'system' && !m.deleted_at && !m.id.startsWith('temp-') && (
                              <span className="msg-tools">
                                <button
                                  type="button"
                                  className="msg-tool"
                                  onClick={() =>
                                    setActionsFor(actionsFor === m.id ? null : m.id)
                                  }
                                  aria-label="Message options"
                                  aria-expanded={actionsFor === m.id}
                                  data-tooltip="Message options"
                                >
                                  •••
                                </button>
                                {actionsFor === m.id && (
                                  <span className="msg-menu" role="menu">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setReactFor(reactFor === m.id ? null : m.id)
                                      }
                                    >
                                      React
                                    </button>
                                    {mine && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditingId(m.id);
                                            setEditText(m.content);
                                            setActionsFor(null);
                                          }}
                                        >
                                          <Pencil size={13} aria-hidden="true" /> Edit
                                        </button>
                                        <button
                                          type="button"
                                          className="is-danger"
                                          onClick={() => remove(m.id)}
                                        >
                                          <Trash2 size={13} aria-hidden="true" /> Delete
                                        </button>
                                      </>
                                    )}
                                    {!mine && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setReportMessageId(m.id);
                                          setActionsFor(null);
                                        }}
                                      >
                                        <Flag size={13} aria-hidden="true" /> Report
                                      </button>
                                    )}
                                  </span>
                                )}
                                {reactFor === m.id && (
                                  <span className="msg-react-row" role="group" aria-label="Pick a reaction">
                                    {EMOJIS.map((e) => (
                                      <button
                                        key={e}
                                        type="button"
                                        onClick={() => react(m.id, e)}
                                        aria-label={`React ${e}`}
                                      >
                                        {e}
                                      </button>
                                    ))}
                                  </span>
                                )}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  <div ref={bottomRef} aria-hidden="true" />
                </>
              )}
            </div>

            {lastOwnMessage && seen && (
              <p className="msg-seen">
                <CheckCheck size={14} aria-hidden="true" /> Seen
              </p>
            )}

            {blocked ? (
              <p className="empty-note msg-blocked">
                You blocked {peerName}. <Link to="/app/settings">Manage in Settings</Link>
              </p>
            ) : iBlockedMember ? (
              <p className="empty-note msg-blocked">
                You blocked a member of this group.{' '}
                <Link to="/app/settings">Manage in Settings</Link>
              </p>
            ) : (
              <form className="msg-composer" onSubmit={(e) => send(e)}>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading || sending}
                  aria-label="Share a photo"
                  data-tooltip="Share a photo"
                >
                  {uploading ? (
                    <LoaderCircle size={17} className="spin" aria-hidden="true" />
                  ) : (
                    <ImagePlus size={17} aria-hidden="true" />
                  )}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(e) => {
                    void attach(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setShowEmoji((v) => !v)}
                  aria-label="Add emoji"
                  aria-expanded={showEmoji}
                  data-tooltip="Add emoji"
                >
                  <Smile size={17} aria-hidden="true" />
                </button>
                <textarea
                  className="msg-input"
                  placeholder={uploading ? 'Uploading photo…' : 'Write a message…'}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={1}
                  disabled={uploading}
                  aria-label="Write a message"
                />
                <button
                  type="submit"
                  className="msg-send"
                  disabled={!draft.trim() || sending || uploading}
                  aria-label={sending ? 'Sending message' : 'Send message'}
                  data-tooltip={sending ? 'Sending message' : 'Send message'}
                >
                  {sending ? (
                    <LoaderCircle size={17} className="spin" aria-hidden="true" />
                  ) : (
                    <Send size={17} aria-hidden="true" />
                  )}
                </button>
                {showEmoji && (
                  <span className="msg-emoji-row" role="group" aria-label="Insert emoji">
                    {EMOJIS.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => setDraft((d) => `${d}${e}`)}
                        aria-label={`Insert ${e}`}
                      >
                        {e}
                      </button>
                    ))}
                  </span>
                )}
              </form>
            )}
          </>
        )}
      </section>

      <Modal open={viewer !== null} onClose={() => setViewer(null)} label="Shared photo" wide>
        {viewer && <img src={viewer} alt="Shared photo" className="msg-viewer-img" />}
      </Modal>

      <Modal open={peerOpen} onClose={() => setPeerOpen(false)} label={`${peerName}'s profile`}>
        <h2 className="modal-title">{peerName}</h2>
        <div className="msg-peer-card">
          {peerAvatars[peerId] ? (
            <img
              src={peerAvatars[peerId]}
              alt={`${peerName}'s profile photo`}
              className="msg-peer-photo"
            />
          ) : (
            <Avatar name={peerName} size="lg" />
          )}
          <dl>
            {peerProfile?.nickname?.trim() && (
              <div>
                <dt>Nickname</dt>
                <dd>“{peerProfile.nickname.trim()}”</dd>
              </div>
            )}
            {peerProfile?.hometown?.trim() && (
              <div>
                <dt>Hometown</dt>
                <dd>{peerProfile.hometown.trim()}</dd>
              </div>
            )}
            {peerProfile?.bio?.trim() && (
              <div>
                <dt>About</dt>
                <dd>{peerProfile.bio.trim()}</dd>
              </div>
            )}
            {connection && (
              <div>
                <dt>Connected</dt>
                <dd>
                  {new Date(connection.created_at).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </dd>
              </div>
            )}
          </dl>
          {connection?.message?.trim() && (
            <p className="msg-reconnect-note">
              How you reconnected: “{connection.message.trim()}”
            </p>
          )}
          <button
            type="button"
            className="btn btn-outline btn-block btn-sm"
            onClick={() => {
              setPeerOpen(false);
              setReportOpen(true);
            }}
          >
            <Flag size={14} aria-hidden="true" />
            Report {peerName}
          </button>
        </div>
      </Modal>

      {peerId && (
        <ReportModal
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          targetId={peerId}
          targetName={peerName}
        />
      )}

      {peerId && blockConfirm && (
        <BlockConfirmModal
          open
          onClose={() => setBlockConfirm(false)}
          onConfirm={() => doBlock()}
          targetName={peerName}
          busy={blocking}
        />
      )}

      {reportMessageId && (
        <ReportModal
          open
          onClose={() => setReportMessageId(null)}
          targetId={reportMessageId}
          targetName="message"
          targetType="message"
        />
      )}

      {newGroupOpen && (
        <NewGroupModal
          open
          onClose={() => setNewGroupOpen(false)}
          onCreated={(id) => {
            setNewGroupOpen(false);
            setListTick((k) => k + 1);
            selectConversation(id);
          }}
        />
      )}

      {groupInfoOpen && activeId && isGroup && (
        <GroupInfoModal
          open
          onClose={() => setGroupInfoOpen(false)}
          conversationId={activeId}
          title={groupTitle}
          affiliationType={activePreview?.conversation.affiliation_type ?? null}
          affiliationName={activePreview?.conversation.affiliation_name ?? null}
          creatorId={activePreview?.conversation.created_by ?? null}
          myId={myId}
          onChanged={() => setListTick((k) => k + 1)}
          onLeft={() => {
            setGroupInfoOpen(false);
            selectConversation(null);
            setListTick((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
