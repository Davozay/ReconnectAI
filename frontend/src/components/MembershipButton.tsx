import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { useToast } from '../context/useToast';
import { DbError } from '../lib/db';
import { joinCommunity, leaveCommunity } from '../lib/communities';

export default function MembershipButton({
  communityId,
  communityName,
  joined,
  onChange,
  small = false,
}: {
  communityId: string;
  communityName: string;
  joined: boolean;
  onChange: (joined: boolean) => void;
  small?: boolean;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (joined) {
        await leaveCommunity(communityId);
        onChange(false);
        toast(`You left ${communityName}`);
      } else {
        await joinCommunity(communityId);
        onChange(true);
        toast(`You joined ${communityName}`);
      }
    } catch (err) {
      toast(err instanceof DbError ? err.message : 'Could not update your membership.');
    } finally {
      setBusy(false);
    }
  };

  if (joined) {
    return (
      <button
        type="button"
        className={`btn btn-outline ${small ? 'btn-sm' : ''}`}
        onClick={toggle}
        disabled={busy}
        aria-label={`Leave ${communityName}`}
      >
        <Check size={15} aria-hidden="true" />
        {busy ? 'Leaving…' : 'Joined'}
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`btn btn-primary ${small ? 'btn-sm' : ''}`}
      onClick={toggle}
      disabled={busy}
    >
      <Plus size={15} aria-hidden="true" />
      {busy ? 'Joining…' : 'Join'}
    </button>
  );
}
