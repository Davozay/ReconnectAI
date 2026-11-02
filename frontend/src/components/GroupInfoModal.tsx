import { useCallback, useEffect, useState } from 'react';
import { GraduationCap, MapPin } from 'lucide-react';
import Avatar from './Avatar';
import Modal from './Modal';
import { useToast } from '../context/useToast';
import { DbError, getProfilesByIds, listMyBlocks, listMyRequests } from '../lib/db';
import {
  addGroupMember,
  deleteGroup,
  leaveGroup,
  listAffiliationMates,
  listGroupMembers,
  removeGroupMember,
  renameGroup,
} from '../lib/messages';
import type { AffiliationKind, GroupCandidate } from '../lib/messages';
import './GroupInfoModal.css';

const COLORS = ['#6255e8', '#e85a4f', '#16a34a', '#0ea5e9', '#d946ef'];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

function errMessage(err: unknown): string {
  return err instanceof DbError || err instanceof Error ? err.message : 'Something went wrong.';
}

export default function GroupInfoModal({
  open,
  onClose,
  conversationId,
  title,
  affiliationType,
  affiliationName,
  creatorId,
  myId,
  onChanged,
  onLeft,
}: {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  title: string;
  affiliationType: AffiliationKind | null;
  affiliationName: string | null;
  creatorId: string | null;
  myId: string;
  onChanged: () => void;
  onLeft: () => void;
}) {
  const { toast } = useToast();
  const [members, setMembers] = useState<string[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [renameText, setRenameText] = useState(title);
  const [renaming, setRenaming] = useState(false);
  const [mates, setMates] = useState<GroupCandidate[]>([]);
  const [addPick, setAddPick] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isCreator = creatorId === myId;

  const loadMembers = useCallback(
    () =>
      listGroupMembers(conversationId)
        .then((ids) => {
          setMembers(ids);
          return getProfilesByIds(ids).then((profiles) => {
            const map: Record<string, string> = {};
            for (const p of profiles) map[p.user_id] = p.display_name;
            setNames(map);
          });
        })
        .catch(() => {}),
    [conversationId],
  );

  useEffect(() => {
    if (!open) return;
    let active = true;
    loadMembers()
      .then(() => {
        if (!active || !isCreator) return;
        if (affiliationType && affiliationName) {
          return listAffiliationMates(affiliationType, affiliationName)
            .then((rows) => {
              if (active) setMates(rows);
            })
            .catch(() => {});
        }
        return Promise.all([listMyRequests(), listMyBlocks()])
          .then(([requests, blocks]) => {
            if (!active) return;
            const blocked = new Set(blocks);
            const peerIds = [
              ...new Set(
                requests.connected
                  .map((r) => (r.from_id === myId ? r.to_id : r.from_id))
                  .filter((id) => !blocked.has(id)),
              ),
            ];
            if (peerIds.length === 0) {
              setMates([]);
              return;
            }
            return getProfilesByIds(peerIds).then((profiles) => {
              if (!active) return;
              setMates(
                profiles.map((p) => ({
                  user_id: p.user_id,
                  display_name: p.display_name,
                  avatar_storage_path: p.avatar_storage_path ?? null,
                })),
              );
            });
          })
          .catch(() => {});
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
  }, [open, conversationId, title, affiliationType, affiliationName, isCreator, myId, toast, loadMembers]);

  const doRename = async () => {
    const next = renameText.trim();
    if (!next || next === title || renaming) return;
    setRenaming(true);
    try {
      await renameGroup(conversationId, next);
      toast('Group renamed.');
      onChanged();
    } catch (err) {
      toast(errMessage(err));
    } finally {
      setRenaming(false);
    }
  };

  const doAdd = async () => {
    if (!addPick || adding) return;
    setAdding(true);
    try {
      await addGroupMember(conversationId, addPick);
      setAddPick('');
      await loadMembers();
      onChanged();
      toast('Member added.');
    } catch (err) {
      toast(errMessage(err));
    } finally {
      setAdding(false);
    }
  };

  const doRemove = async (id: string) => {
    setRemovingId(id);
    try {
      await removeGroupMember(conversationId, id);
      await loadMembers();
      onChanged();
      toast('Member removed.');
    } catch (err) {
      toast(errMessage(err));
    } finally {
      setRemovingId(null);
    }
  };

  const doLeave = async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      await leaveGroup(conversationId);
      toast(isCreator ? 'You left — managing moved to the earliest member.' : 'You left the group.');
      onLeft();
    } catch (err) {
      toast(errMessage(err));
    } finally {
      setLeaving(false);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteGroup(conversationId);
      toast('Group deleted.');
      onLeft();
    } catch (err) {
      toast(errMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  const candidates = mates.filter((m) => !members.includes(m.user_id));

  return (
    <Modal open={open} onClose={onClose} label={`Group info for ${title}`}>
      <h2 className="modal-title">{title}</h2>
      <p className="empty-note">
        {affiliationType === 'school' ? (
          <GraduationCap size={14} aria-hidden="true" />
        ) : affiliationType === 'place' ? (
          <MapPin size={14} aria-hidden="true" />
        ) : null}{' '}
        {affiliationName ?? 'Free crew'} · {members.length} member
        {members.length === 1 ? '' : 's'}
      </p>

      {isCreator && (
        <label className="field">
          <span className="field-label">Group name</span>
          <span className="group-add-row">
            <input
              className="input"
              value={renameText}
              maxLength={80}
              onChange={(e) => setRenameText(e.target.value)}
              aria-label="Group name"
            />
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => doRename()}
              disabled={renaming || !renameText.trim() || renameText.trim() === title}
            >
              {renaming ? 'Saving…' : 'Save'}
            </button>
          </span>
        </label>
      )}

      <div className="field">
        <span className="field-label">Members</span>
        {loading ? (
          <p className="empty-note">Loading members…</p>
        ) : (
          <ul className="group-member-list">
            {members.map((id) => (
              <li key={id}>
                <span className="group-member">
                  <Avatar
                    name={id === myId ? 'You' : (names[id] ?? '…')}
                    color={colorFor(id)}
                    size="sm"
                  />
                  <span>{id === myId ? 'You' : (names[id] ?? 'A ReConnect member')}</span>
                  {id === creatorId && <span className="group-creator-tag">Creator</span>}
                  {isCreator && id !== myId && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm is-danger"
                      onClick={() => doRemove(id)}
                      disabled={removingId === id}
                      aria-label={`Remove ${names[id] ?? 'member'}`}
                    >
                      {removingId === id ? '…' : 'Remove'}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {isCreator && (
        <div className="field">
          <span className="field-label">
            Add{' '}
            {affiliationType === 'school'
              ? 'schoolmates'
              : affiliationType === 'place'
                ? 'neighbors'
                : 'connections'}
          </span>
          {candidates.length === 0 ? (
            <p className="empty-note">Everyone who lists this school is already in.</p>
          ) : (
            <span className="group-add-row">
              <select
                className="select"
                value={addPick}
                onChange={(e) => setAddPick(e.target.value)}
                aria-label={
                  affiliationType === 'school'
                    ? 'Schoolmate to add'
                    : affiliationType === 'place'
                      ? 'Neighbor to add'
                      : 'Connection to add'
                }
              >
                <option value="">
                  Choose a{' '}
                  {affiliationType === 'school'
                    ? 'schoolmate'
                    : affiliationType === 'place'
                      ? 'neighbor'
                      : 'connection'}
                  …
                </option>
                {candidates.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => doAdd()}
                disabled={!addPick || adding}
              >
                {adding ? 'Adding…' : 'Add'}
              </button>
            </span>
          )}
        </div>
      )}

      <div className="group-danger-zone">
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => doLeave()}
          disabled={leaving}
        >
          {leaving ? 'Leaving…' : 'Leave group'}
        </button>
        {isCreator && (
          <button
            type="button"
            className="btn btn-ghost btn-sm is-danger"
            onClick={() => doDelete()}
            disabled={deleting}
          >
            {deleting ? 'Deleting…' : confirmDelete ? 'Tap again to delete' : 'Delete group'}
          </button>
        )}
      </div>
    </Modal>
  );
}
