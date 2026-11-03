import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  Eye,
  EyeOff,
  GraduationCap,
  ImagePlus,
  MapPin,
  Pencil,
  Plus,
  Share2,
  Trash2,
} from 'lucide-react';
import Avatar from '../components/Avatar';
import MemoryArt from '../components/MemoryArt';
import Modal from '../components/Modal';
import { useAuth } from '../context/useAuth';
import { useToast } from '../context/useToast';
import {
  addLocation,
  addMemoryPhoto,
  addSchool,
  DbError,
  deleteLocation,
  deleteMemory,
  deleteMemoryPhoto,
  deleteSchool,
  listMemoryPhotos,
  listMyLocations,
  listMyMemories,
  listMySchools,
  getMyProfile,
  updateMemory,
  upsertMyProfile,
} from '../lib/db';
import type {
  ChildhoodLocation,
  ChildhoodSchool,
  Memory,
  MemoryPhoto,
  Profile as ProfileRow,
} from '../lib/db';
import {
  deleteMemoryPhotoObject,
  deleteProfilePhoto,
  getMemoryPhotoUrl,
  getProfilePhotoUrl,
  StorageError,
  uploadMemoryPhoto,
  uploadProfilePhoto,
} from '../lib/storage';
import './Profile.css';

type Tab = 'memories' | 'posts' | 'about';

function errMessage(err: unknown): string {
  return err instanceof DbError || err instanceof StorageError || err instanceof Error
    ? err.message
    : 'Something went wrong.';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

async function fetchPhotoUrls(memoryId: string) {
  const rows = await listMemoryPhotos(memoryId);
  return Promise.all(
    rows.map(async (row) => ({ row, url: await getMemoryPhotoUrl(row.storage_path) })),
  );
}

interface ProfilePageData {
  profile: ProfileRow | null;
  schools: ChildhoodSchool[];
  locations: ChildhoodLocation[];
  memories: Memory[];
  avatarUrl: string | null;
  coverUrl: string | null;
}

async function fetchProfilePage(): Promise<ProfilePageData> {
  const [p, s, l, m] = await Promise.all([
    getMyProfile(),
    listMySchools(),
    listMyLocations(),
    listMyMemories(),
  ]);
  let avatarUrl: string | null = null;
  let coverUrl: string | null = null;
  if (p?.avatar_storage_path) {
    avatarUrl = await getProfilePhotoUrl(p.avatar_storage_path).catch(() => null);
  }
  if (p?.cover_storage_path) {
    coverUrl = await getProfilePhotoUrl(p.cover_storage_path).catch(() => null);
  }
  return { profile: p, schools: s, locations: l, memories: m, avatarUrl, coverUrl };
}

function MemoryPhotos({ memoryId, refreshKey }: { memoryId: string; refreshKey: number }) {
  const { toast } = useToast();
  const [photos, setPhotos] = useState<{ row: MemoryPhoto; url: string }[]>([]);
  const [viewer, setViewer] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchPhotoUrls(memoryId).then(
      (withUrls) => {
        if (active) setPhotos(withUrls);
      },
      () => {
        if (active) setPhotos([]);
      },
    );
    return () => {
      active = false;
    };
  }, [memoryId, refreshKey]);

  const attach = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const up = await uploadMemoryPhoto(file);
      await addMemoryPhoto({
        memory_id: memoryId,
        storage_path: up.path,
        content_type: file.type,
        bytes: file.size,
        width: up.width,
        height: up.height,
      });
      toast('Photo attached — visible only to you unless shared');
      setPhotos(await fetchPhotoUrls(memoryId).catch(() => []));
    } catch (err) {
      toast(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: MemoryPhoto) => {
    setBusy(true);
    try {
      const deleted = await deleteMemoryPhoto(row.id);
      if (deleted) await deleteMemoryPhotoObject(deleted.storage_path).catch(() => {});
      toast('Photo deleted');
      setPhotos(await fetchPhotoUrls(memoryId).catch(() => []));
    } catch (err) {
      toast(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="memory-photos">
      {photos.map(({ row, url }) => (
        <span key={row.id} className="memory-photo">
          <button type="button" onClick={() => setViewer(url)} aria-label="View photo">
            <img src={url} alt="Memory photo" loading="lazy" />
          </button>
          <button
            type="button"
            className="memory-photo-del"
            onClick={() => remove(row)}
            disabled={busy}
            aria-label="Delete photo"
            data-tooltip="Delete photo"
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </span>
      ))}
      <button
        type="button"
        className="memory-photo-add"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        aria-label="Attach a photo"
        data-tooltip="Attach a photo"
      >
        <ImagePlus size={18} aria-hidden="true" />
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
      <Modal open={viewer !== null} onClose={() => setViewer(null)} label="Memory photo" wide>
        {viewer && <img src={viewer} alt="Memory photo" className="memory-viewer-img" />}
      </Modal>
    </div>
  );
}

export default function Profile() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('memories');
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [schools, setSchools] = useState<ChildhoodSchool[]>([]);
  const [locations, setLocations] = useState<ChildhoodLocation[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ url: string; label: string } | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const coverRef = useRef<HTMLInputElement>(null);
  const [photoTick, setPhotoTick] = useState(0);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [hometown, setHometown] = useState('');
  const [nickname, setNickname] = useState('');
  const [discoverable, setDiscoverable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarRef = useRef<HTMLInputElement>(null);

  const [schoolName, setSchoolName] = useState('');
  const [schoolYears, setSchoolYears] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [addingSchool, setAddingSchool] = useState(false);
  const [addingPlace, setAddingPlace] = useState(false);

  const fallbackName = user?.name ?? 'Friend';

  useEffect(() => {
    let active = true;
    fetchProfilePage()
      .then(({ profile: p, schools: s, locations: l, memories: m, avatarUrl, coverUrl }) => {
        if (!active) return;
        setProfile(p);
        setSchools(s);
        setLocations(l);
        setMemories(m);
        setCoverUrl(coverUrl);
        if (p) {
          setName(p.display_name);
          setBio(p.bio);
          setHometown(p.hometown);
          setNickname(p.nickname);
          setDiscoverable(p.discoverable);
          setAvatarUrl(avatarUrl);
        } else {
          setName(fallbackName);
        }
      })
      .catch((err: unknown) => {
        if (active) toast(errMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [toast, fallbackName]);

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast('Display name is required');
      return;
    }
    setSaving(true);
    try {
      const updated = await upsertMyProfile({
        display_name: name.trim(),
        bio: bio.trim(),
        hometown: hometown.trim(),
        nickname: nickname.trim(),
        discoverable,
      });
      setProfile(updated);
      setEditing(false);
      toast('Profile updated');
    } catch (err) {
      toast(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const changeAvatar = async (file: File | undefined) => {
    if (!file) return;
    setAvatarBusy(true);
    try {
      const oldPath = profile?.avatar_storage_path ?? '';
      const up = await uploadProfilePhoto(file);
      const updated = await upsertMyProfile({
        display_name: profile?.display_name || name.trim() || user?.name || 'Friend',
        avatar_storage_path: up.path,
      });
      setProfile(updated);
      if (oldPath && oldPath !== up.path) {
        await deleteProfilePhoto(oldPath).catch(() => {});
      }
      setAvatarUrl(await getProfilePhotoUrl(up.path));
      toast('Profile photo updated — private unless you opt into discovery');
    } catch (err) {
      toast(errMessage(err));
    } finally {
      setAvatarBusy(false);
    }
  };

  const changeCover = async (file: File | undefined) => {
    if (!file) return;
    setCoverBusy(true);
    try {
      const oldPath = profile?.cover_storage_path ?? '';
      const up = await uploadProfilePhoto(file);
      const updated = await upsertMyProfile({
        display_name: profile?.display_name || name.trim() || user?.name || 'Friend',
        cover_storage_path: up.path,
      });
      setProfile(updated);
      if (oldPath && oldPath !== up.path) {
        await deleteProfilePhoto(oldPath).catch(() => {});
      }
      setCoverUrl(await getProfilePhotoUrl(up.path));
      toast('Cover photo updated');
    } catch (err) {
      toast(errMessage(err));
    } finally {
      setCoverBusy(false);
    }
  };

  const removeCover = async () => {
    const oldPath = profile?.cover_storage_path ?? '';
    if (!oldPath) return;
    setCoverBusy(true);
    try {
      const updated = await upsertMyProfile({
        display_name: profile?.display_name || name.trim() || user?.name || 'Friend',
        cover_storage_path: '',
      });
      setProfile(updated);
      setCoverUrl(null);
      await deleteProfilePhoto(oldPath).catch(() => {});
      toast('Cover photo removed');
    } catch (err) {
      toast(errMessage(err));
    } finally {
      setCoverBusy(false);
    }
  };

  const submitSchool = async (e: FormEvent) => {
    e.preventDefault();
    if (!schoolName.trim()) return;
    setAddingSchool(true);
    try {
      const row = await addSchool({ school_name: schoolName, years_label: schoolYears });
      setSchools((prev) => [...prev, row]);
      setSchoolName('');
      setSchoolYears('');
      toast('School added');
    } catch (err) {
      toast(errMessage(err));
    } finally {
      setAddingSchool(false);
    }
  };

  const submitPlace = async (e: FormEvent) => {
    e.preventDefault();
    if (!placeName.trim()) return;
    setAddingPlace(true);
    try {
      const row = await addLocation({ place_name: placeName });
      setLocations((prev) => [...prev, row]);
      setPlaceName('');
      toast('Place added');
    } catch (err) {
      toast(errMessage(err));
    } finally {
      setAddingPlace(false);
    }
  };

  const removeSchool = async (id: string) => {
    try {
      await deleteSchool(id);
      setSchools((prev) => prev.filter((s) => s.id !== id));
      toast('School removed');
    } catch (err) {
      toast(errMessage(err));
    }
  };

  const removePlace = async (id: string) => {
    try {
      await deleteLocation(id);
      setLocations((prev) => prev.filter((l) => l.id !== id));
      toast('Place removed');
    } catch (err) {
      toast(errMessage(err));
    }
  };

  const removeMemory = async (id: string) => {
    try {
      const rows = await listMemoryPhotos(id);
      await deleteMemory(id);
      await Promise.all(rows.map((r) => deleteMemoryPhotoObject(r.storage_path).catch(() => {})));
      setMemories((prev) => prev.filter((m) => m.id !== id));
      toast('Memory deleted');
    } catch (err) {
      toast(errMessage(err));
    }
  };

  const toggleShared = async (memory: Memory) => {
    try {
      const updated = await updateMemory(memory.id, { shared: !memory.shared });
      setMemories((prev) => prev.map((m) => (m.id === memory.id ? updated : m)));
      setPhotoTick((t) => t + 1);
      toast(updated.shared ? 'Memory shared with the community' : 'Memory is private again');
    } catch (err) {
      toast(errMessage(err));
    }
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/app/profile`);
      toast('Profile link copied');
    } catch {
      toast('Could not copy the link on this device');
    }
  };

  const sharedMemories = memories.filter((m) => m.shared);
  const displayName = profile?.display_name || name || user?.name || 'Friend';

  if (loading) {
    return (
      <div className="profile" aria-label="Loading profile">
        <div className="card card-pad profile-empty">
          <p>Loading your profile…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="profile">
      <div className="card profile-top">
        <div className="profile-cover">
          {coverUrl ? (
            <button
              type="button"
              className="cover-view-btn"
              onClick={() => setViewer({ url: coverUrl, label: 'Cover photo' })}
              aria-label="View cover photo"
            >
              <img src={coverUrl} alt="Profile cover photo" className="cover-img" />
            </button>
          ) : (
            <MemoryArt
              seed={`cover-${user?.id ?? 'me'}`}
              label={hometown.trim()}
              ratio="landscape"
            />
          )}
          <div className="cover-actions">
            <button
              type="button"
              className="btn btn-sm cover-btn"
              onClick={() => coverRef.current?.click()}
              disabled={coverBusy}
            >
              <ImagePlus size={14} aria-hidden="true" />
              {coverBusy ? 'Uploading…' : coverUrl ? 'Change cover' : 'Add cover'}
            </button>
            {coverUrl && (
              <button
                type="button"
                className="btn btn-sm cover-btn"
                onClick={() => removeCover()}
                disabled={coverBusy}
                aria-label="Remove cover photo"
                data-tooltip="Remove cover photo"
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            )}
          </div>
          <input
            ref={coverRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              void changeCover(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
        <div className="profile-head">
          <span className="profile-avatar">
            {avatarUrl ? (
              <button
                type="button"
                className="profile-avatar-btn"
                onClick={() => setViewer({ url: avatarUrl, label: 'Profile photo' })}
                aria-label="View profile photo"
              >
                <img
                  src={avatarUrl}
                  alt={`${displayName}'s profile photo`}
                  className="profile-avatar-img"
                />
              </button>
            ) : (
              <Avatar name={displayName} size="xl" />
            )}
          </span>
          <div className="profile-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={share}>
              <Share2 size={15} aria-hidden="true" />
              Share
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing(true)}>
              <Pencil size={15} aria-hidden="true" />
              Edit profile
            </button>
          </div>
        </div>
        <div className="profile-id">
          <div className="profile-name-row">
            <h1>{displayName}</h1>
            <span className={`pill ${discoverable ? 'pill-green' : 'pill-neutral'}`}>
              {discoverable ? 'Discoverable' : 'Private'}
            </span>
          </div>
          {nickname.trim() && <p className="profile-handle">“{nickname.trim()}”</p>}
          {bio.trim() && <p className="profile-bio">{bio}</p>}
          <div className="profile-facts">
            {hometown.trim() && (
              <span>
                <MapPin size={14} aria-hidden="true" />
                {hometown}
              </span>
            )}
            <span>
              <CalendarDays size={14} aria-hidden="true" />
              Reconnecting since 2026
            </span>
          </div>
          {schools.length > 0 && (
            <div className="profile-schools">
              {schools.map((s) => (
                <span key={s.id} className="pill pill-indigo">
                  <GraduationCap size={13} aria-hidden="true" />
                  {s.school_name}
                  {s.years_label ? ` · ${s.years_label}` : ''}
                </span>
              ))}
            </div>
          )}
          <div className="profile-stats">
            <span className="profile-stat">
              <strong>{memories.length}</strong> Memories
            </span>
            <span className="profile-stat">
              <strong>{sharedMemories.length}</strong> Shared
            </span>
            <span className="profile-stat">
              <strong>{schools.length}</strong> Schools
            </span>
          </div>
        </div>
        <div className="profile-tabs" role="tablist" aria-label="Profile sections">
          {(
            [
              ['memories', 'Memories'],
              ['posts', 'Posts'],
              ['about', 'About'],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`profile-tab${tab === id ? ' is-active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'memories' && (
        <div className="card card-pad">
          {memories.length === 0 ? (
            <div className="profile-empty">
              <h2>No memories yet</h2>
              <p>Share your first childhood memory with the community.</p>
              <Link to="/app" className="btn btn-primary btn-sm">
                Go to Home feed
              </Link>
            </div>
          ) : (
            <ul className="memory-list">
              {memories.map((m) => (
                <li key={m.id} className="memory-item">
                  <div className="memory-item-head">
                    <div>
                      {m.title.trim() && <h3>{m.title}</h3>}
                      <p className="memory-date">
                        {formatDate(m.created_at)}
                        {m.analysis ? ' · from Memory Detective' : ''}
                      </p>
                    </div>
                    <span className={`pill ${m.shared ? 'pill-green' : 'pill-neutral'}`}>
                      {m.shared ? 'Shared' : 'Private'}
                    </span>
                  </div>
                  <p className="memory-body">{m.body}</p>
                  <MemoryPhotos memoryId={m.id} refreshKey={photoTick} />
                  <div className="memory-item-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => toggleShared(m)}
                    >
                      {m.shared ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                      {m.shared ? 'Make private' : 'Share'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm is-danger"
                      onClick={() => removeMemory(m.id)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'posts' && (
        <div className="card card-pad">
          {sharedMemories.length === 0 ? (
            <div className="profile-empty">
              <h2>No posts yet</h2>
              <p>Share a memory to publish it to the community feed.</p>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setTab('memories')}>
                View my memories
              </button>
            </div>
          ) : (
            <ul className="memory-list">
              {sharedMemories.map((m) => (
                <li key={m.id} className="memory-item">
                  <div className="memory-item-head">
                    <div>
                      {m.title.trim() && <h3>{m.title}</h3>}
                      <p className="memory-date">{formatDate(m.created_at)}</p>
                    </div>
                    <span className="pill pill-green">Shared</span>
                  </div>
                  <p className="memory-body">{m.body}</p>
                  <MemoryPhotos memoryId={m.id} refreshKey={photoTick} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'about' && (
        <div className="card card-pad profile-about">
          <h2>About</h2>
          <dl>
            <div>
              <dt>Hometown</dt>
              <dd>{hometown.trim() || '—'}</dd>
            </div>
            <div>
              <dt>Nickname</dt>
              <dd>{nickname.trim() || '—'}</dd>
            </div>
            <div>
              <dt>Discovery</dt>
              <dd>{discoverable ? 'Opted in — old friends can find you' : 'Private — hidden from discovery'}</dd>
            </div>
          </dl>

          <h2 className="about-sub">Schools</h2>
          <p className="empty-note">
            Groups match on these names — a school mentioned only in your bio won’t match.
          </p>
          {schools.length === 0 && <p className="empty-note">No schools yet — add your first below.</p>}
          <ul className="about-list">
            {schools.map((s) => (
              <li key={s.id}>
                <span>
                  <GraduationCap size={14} aria-hidden="true" />
                  {s.school_name}
                  {s.years_label ? ` · ${s.years_label}` : ''}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm is-danger"
                  onClick={() => removeSchool(s.id)}
                  aria-label={`Remove ${s.school_name}`}
                  data-tooltip={`Remove ${s.school_name}`}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <form onSubmit={submitSchool} className="about-add">
            <input
              className="input"
              placeholder="School name"
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              aria-label="School name"
            />
            <input
              className="input"
              placeholder="Years, e.g. 1996 – 2001"
              value={schoolYears}
              onChange={(e) => setSchoolYears(e.target.value)}
              aria-label="Years attended"
            />
            <button type="submit" className="btn btn-outline btn-sm" disabled={addingSchool || !schoolName.trim()}>
              <Plus size={14} aria-hidden="true" />
              {addingSchool ? 'Adding…' : 'Add school'}
            </button>
          </form>

          <h2 className="about-sub">Childhood places</h2>
          <p className="empty-note">
            Groups match on these names too — a place mentioned only in your bio won’t match.
          </p>
          {locations.length === 0 && <p className="empty-note">No places yet — add your first below.</p>}
          <ul className="about-list">
            {locations.map((l) => (
              <li key={l.id}>
                <span>
                  <MapPin size={14} aria-hidden="true" />
                  {l.place_name}
                  {l.years_label ? ` · ${l.years_label}` : ''}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm is-danger"
                  onClick={() => removePlace(l.id)}
                  aria-label={`Remove ${l.place_name}`}
                  data-tooltip={`Remove ${l.place_name}`}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <form onSubmit={submitPlace} className="about-add">
            <input
              className="input"
              placeholder="Place name, e.g. Riverside"
              value={placeName}
              onChange={(e) => setPlaceName(e.target.value)}
              aria-label="Place name"
            />
            <button type="submit" className="btn btn-outline btn-sm" disabled={addingPlace || !placeName.trim()}>
              <Plus size={14} aria-hidden="true" />
              {addingPlace ? 'Adding…' : 'Add place'}
            </button>
          </form>
        </div>
      )}

      <Modal open={editing} onClose={() => setEditing(false)} label="Edit profile">
        <h2 className="modal-title">Edit profile</h2>
        <form onSubmit={saveProfile}>
          <div className="edit-avatar-row">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Profile photo preview" className="edit-avatar-img" />
            ) : (
              <Avatar name={displayName} size="lg" />
            )}
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => avatarRef.current?.click()}
              disabled={avatarBusy}
            >
              <ImagePlus size={15} aria-hidden="true" />
              {avatarBusy ? 'Uploading…' : avatarUrl ? 'Change photo' : 'Add photo'}
            </button>
            <input
              ref={avatarRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                void changeAvatar(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          <label className="field">
            <span className="field-label">Display name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="field">
            <span className="field-label">Bio</span>
            <textarea className="textarea" value={bio} onChange={(e) => setBio(e.target.value)} rows={3} />
          </label>
          <label className="field">
            <span className="field-label">Hometown</span>
            <input className="input" value={hometown} onChange={(e) => setHometown(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Childhood nickname</span>
            <input className="input" value={nickname} onChange={(e) => setNickname(e.target.value)} />
          </label>
          <button
            type="button"
            role="switch"
            aria-checked={discoverable}
            onClick={() => setDiscoverable((v) => !v)}
            className={`switch-row${discoverable ? ' is-on' : ''}`}
          >
            <span className="switch-track" aria-hidden="true">
              <span className="switch-thumb" />
            </span>
            <span>
              <strong>Let old friends find me</strong>
              <small>Your display name becomes visible in discovery.</small>
            </span>
          </button>
          <button type="submit" className="btn btn-primary btn-block" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      </Modal>

      <Modal
        open={viewer !== null}
        onClose={() => setViewer(null)}
        label={viewer?.label ?? 'Profile photo'}
        wide
      >
        {viewer && (
          <img src={viewer.url} alt={viewer.label} className="profile-viewer-img" />
        )}
      </Modal>
    </div>
  );
}
