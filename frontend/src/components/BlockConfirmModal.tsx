import { BellOff, EyeOff, MessageCircleOff, UserX } from 'lucide-react';
import Modal from './Modal';
import './BlockConfirmModal.css';

export default function BlockConfirmModal({
  open,
  onClose,
  onConfirm,
  targetName,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  targetName: string;
  busy?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} label={`Block ${targetName}`}>
      <h2 className="modal-title">Block {targetName}?</h2>
      <ul className="block-confirm-list">
        <li>
          <MessageCircleOff size={16} aria-hidden="true" />
          They won&apos;t be able to message you or send new reconnection requests.
        </li>
        <li>
          <EyeOff size={16} aria-hidden="true" />
          They won&apos;t find you in discovery or see your shared memories and posts.
        </li>
        <li>
          <UserX size={16} aria-hidden="true" />
          Your existing conversation stays visible to you, but no new messages can be sent.
        </li>
        <li>
          <BellOff size={16} aria-hidden="true" />
          They won&apos;t be notified that you blocked them.
        </li>
      </ul>
      <p className="empty-note">You can unblock them anytime from Settings.</p>
      <div className="block-confirm-actions">
        <button
          type="button"
          className="btn btn-outline"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary block-confirm-go"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Blocking…' : `Block ${targetName}`}
        </button>
      </div>
    </Modal>
  );
}
