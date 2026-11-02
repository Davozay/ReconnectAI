import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, MapPin, Users } from 'lucide-react';
import Avatar from './Avatar';
import Modal from './Modal';
import { useAuth } from '../context/useAuth';
import { useToast } from '../context/useToast';
import {
  DbError,
  listMyBlocks,
  listMyLocations,
  listMyRequests,
  listMySchools,
  getProfilesByIds,
} from '../lib/db';
import { addGroupMember, createGroup, listAffiliationMates } from '../lib/messages';
import type { AffiliationKind, GroupCandidate } from '../lib/messages';
import './NewGroupModal.css';

type Flavor = AffiliationKind | 'free';

const COLORS = ['#6255e8', '#e85a4f', '#16a34a', '#0ea5e9', '#d946ef'];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

function errMessage(err: unknown): string {
  return err instanceof DbError || err instanceof Error ? err.message : 'Something went wrong.';
}

export default function NewGroupModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const myId = user?.id ?? '';
  const [flavor, setFlavor] = useState<Flavor>('school');
  const [schools, setSchools] = useState<string[]>([]);
  const [places, setPlaces] = useState<string[]>([]);
  const [connections, setConnections] = useState<GroupCandidate[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [affiliation, setAffiliation] = useState('');
  const [title, setTitle] = useState('');
  const [mates, setMates] = useState<GroupCandidate[]>([]);
  const [loadingMates, setLoadingMates] = useState(false);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    Promise.all([listMySchools(), listMyLocations(), listMyRequests(), listMyBlocks()])
      .then(([schoolRows, placeRows, requests, blocks]) => {
        if (!active) return;
        const schoolNames = [
          ...new Set(schoolRows.map((r) => r.school_name.trim()).filter(Boolean)),
        ];
        const placeNames = [
          ...new Set(placeRows.map((r) => r.place_name.trim()).filter(Boolean)),
        ];
        setSchools(schoolNames);
        setPlaces(placeNames);
        const blocked = new Set(blocks);
        const peerIds = [
          ...new Set(
            requests.connected
              .map((r) => (r.from_id === myId ? r.to_id : r.from_id))
              .filter((id) => !blocked.has(id)),
          ),
        ];
        const startFlavor: Flavor = schoolNames.length > 0
          ? 'school'
          : placeNames.length > 0
            ? 'place'
            : 'free';
        setFlavor(startFlavor);
        const firstAffiliation = startFlavor === 'school'
          ? (schoolNames[0] ?? '')
          : startFlavor === 'place'
            ? (placeNames[0] ?? '')
            : '';
        setAffiliation(firstAffiliation);
        setTitle(firstAffiliation);
        if (startFlavor !== 'free' && firstAffiliation) {
          setLoadingMates(true);
          listAffiliationMates(startFlavor, firstAffiliation)
            .then((rows) => {
              if (active) setMates(rows);
            })
            .catch((err: unknown) => {
              if (active) toast(errMessage(err));
            })
            .finally(() => {
              if (active) setLoadingMates(false);
            });
        }
        if (peerIds.length === 0) {
          setConnections([]);
          return;
        }
        getProfilesByIds(peerIds)
          .then((profiles) => {
            if (!active) return;
            setConnections(
              profiles.map((p) => ({
                user_id: p.user_id,
                display_name: p.display_name,
                avatar_storage_path: p.avatar_storage_path ?? null,
              })),
            );
          })
          .catch(() => {});
      })
      .catch((err: unknown) => {
        if (active) toast(errMessage(err));
      })
      .finally(() => {
        if (active) setLoadingLists(false);
      });
    return () => {
      active = false;
    };
  }, [open, toast, myId]);

  const loadMates = (kind: AffiliationKind, name: string) => {
    setMates([]);
    setLoadingMates(true);
    listAffiliationMates(kind, name)
      .then(setMates)
      .catch((err: unknown) => toast(errMessage(err)))
      .finally(() => setLoadingMates(false));
  };

  const pickFlavor = (next: Flavor) => {
    setFlavor(next);
    setSelected(new Set());
    setFilter('');
    if (next === 'free') {
      setAffiliation('');
      setTitle('');
      setMates([]);
      return;
    }
    const first = (next === 'school' ? schools : places)[0] ?? '';
    setAffiliation(first);
    setTitle(first);
    if (first) loadMates(next, first);
  };

  const pickAffiliation = (name: string) => {
    setAffiliation(name);
    setTitle(name);
    setSelected(new Set());
    if (flavor !== 'free') loadMates(flavor, name);
  };

  const copyAffiliation = async () => {
    if (!affiliation) return;
    try {
      await navigator.clipboard.writeText(affiliation);
      toast('Copied — send it to them so the spelling matches exactly.');
    } catch {
      toast('Could not copy on this device.');
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const create = async () => {
    if (busy) return;
    if (flavor === 'free' && !title.trim()) {
      toast('Give your group a name.');
      return;
    }
    if (flavor !== 'free' && !affiliation) return;
    setBusy(true);
    try {
      const id = await createGroup(
        flavor === 'free' ? null : { kind: flavor, name: affiliation },
        title.trim() || affiliation,
      );
      let failed = 0;
      for (const memberId of selected) {
        try {
          await addGroupMember(id, memberId);
        } catch {
          failed += 1;
        }
      }
      if (failed > 0) {
        toast(`Group created, but ${failed} member${failed === 1 ? '' : 's'} could not be added.`);
      } else {
        toast(selected.size === 0 ? 'Group created — add people anytime.' : 'Group created.');
      }
      onCreated(id);
    } catch (err) {
      toast(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const candidates = flavor === 'free' ? connections : mates;
  const visible = candidates.filter((m) =>
    m.display_name.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const affiliationOptions = flavor === 'school' ? schools : places;

  const emptyHint =
    flavor === 'free'
      ? 'No connections yet — connect with old friends first, then gather them here.'
      : `Nobody else lists “${affiliation || 'this'}” yet. They must add it under Profile → About → ${
          flavor === 'school' ? 'Schools' : 'Places'
        } with the same spelling — a ${flavor} written only in their bio doesn’t count.`;

  return (
    <Modal open={open} onClose={onClose} label="Create a group">
      <h2 className="modal-title">New group</h2>

      {loadingLists ? (
        <p className="empty-note">Loading…</p>
      ) : (
        <>
          <div className="filter-row" role="group" aria-label="Group type">
            <button
              type="button"
              className={`filter-pill${flavor === 'school' ? ' is-active' : ''}`}
              onClick={() => pickFlavor('school')}
              aria-pressed={flavor === 'school'}
            >
              <GraduationCap size={14} aria-hidden="true" /> School
            </button>
            <button
              type="button"
              className={`filter-pill${flavor === 'place' ? ' is-active' : ''}`}
              onClick={() => pickFlavor('place')}
              aria-pressed={flavor === 'place'}
            >
              <MapPin size={14} aria-hidden="true" /> Estate / place
            </button>
            <button
              type="button"
              className={`filter-pill${flavor === 'free' ? ' is-active' : ''}`}
              onClick={() => pickFlavor('free')}
              aria-pressed={flavor === 'free'}
            >
              <Users size={14} aria-hidden="true" /> Free crew
            </button>
          </div>

          {flavor === 'free' ? (
            <p className="empty-note group-flavor-note">
              Any circle — past jobs, childhood crews, old friends. Members must be your
              connections.
            </p>
          ) : affiliationOptions.length === 0 ? (
            <p className="empty-note group-flavor-note">
              Add a childhood {flavor === 'school' ? 'school' : 'place'} to your{' '}
              <Link to="/app/profile">profile</Link> first — groups form around ones you
              list.
            </p>
          ) : (
            <label className="field">
              <span className="field-label">
                {flavor === 'school' ? (
                  <GraduationCap size={15} aria-hidden="true" />
                ) : (
                  <MapPin size={15} aria-hidden="true" />
                )}
                {flavor === 'school' ? 'School' : 'Estate / place'}
              </span>
              <select
                className="select"
                value={affiliation}
                onChange={(e) => pickAffiliation(e.target.value)}
                aria-label={flavor === 'school' ? 'School for this group' : 'Place for this group'}
              >
                {affiliationOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="field">
            <span className="field-label">Group name</span>
            <input
              className="input"
              value={title}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                flavor === 'free' ? 'e.g. Old colleagues, Childhood crew…' : affiliation
              }
              aria-label="Group name"
            />
          </label>

          <div className="field">
            <span className="field-label">
              Add {flavor === 'free' ? 'connections' : flavor === 'school' ? 'schoolmates' : 'neighbors'} ({selected.size} selected)
            </span>
            <div className="search-box">
              <input
                type="search"
                placeholder="Filter by name…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label="Filter people by name"
              />
            </div>
            {loadingMates ? (
              <p className="empty-note">Finding people…</p>
            ) : candidates.length === 0 ? (
              <>
                <p className="empty-note">{emptyHint}</p>
                {flavor !== 'free' && affiliation && (
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => copyAffiliation()}
                  >
                    Copy {flavor === 'school' ? 'school' : 'place'} name to share
                  </button>
                )}
              </>
            ) : (
              <ul className="group-pick-list">
                {visible.map((m) => (
                  <li key={m.user_id}>
                    <label className="group-pick">
                      <input
                        type="checkbox"
                        checked={selected.has(m.user_id)}
                        onChange={() => toggle(m.user_id)}
                      />
                      <Avatar name={m.display_name} color={colorFor(m.user_id)} size="sm" />
                      <span>{m.display_name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {flavor !== 'free' && (
              <p className="field-hint">
                Only people who list this {flavor} under Profile → About can join — and the
                database enforces it.
              </p>
            )}
          </div>

          <div className="group-modal-actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => create()}
              disabled={busy || (flavor !== 'free' && !affiliation)}
            >
              {busy ? 'Creating…' : 'Create group'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
