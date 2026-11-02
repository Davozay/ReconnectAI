import { useState } from 'react';
import { Check, UserPlus, UserCheck } from 'lucide-react';
import { useToast } from '../context/useToast';

type ConnectState = 'none' | 'requested' | 'connected';

/* Locally-functional connect button: none → requested → connected.
   Wires to the reconnection-request API in the next milestone. */
export default function ConnectButton({
  name,
  small = false,
}: {
  name: string;
  small?: boolean;
}) {
  const [state, setState] = useState<ConnectState>('none');
  const { toast } = useToast();

  if (state === 'connected') {
    return (
      <span className={`pill pill-green${small ? '' : ' pill-lg'}`}>
        <UserCheck size={14} aria-hidden="true" />
        Connected
      </span>
    );
  }

  if (state === 'requested') {
    return (
      <button
        type="button"
        className={`btn btn-outline ${small ? 'btn-sm' : ''}`}
        onClick={() => {
          setState('none');
          toast(`Request to ${name} withdrawn`);
        }}
        aria-label={`Withdraw connection request to ${name}`}
      >
        <Check size={15} aria-hidden="true" />
        Requested
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`btn btn-primary ${small ? 'btn-sm' : ''}`}
      onClick={() => {
        setState('requested');
        toast(`Connection request sent to ${name}`);
      }}
    >
      <UserPlus size={15} aria-hidden="true" />
      Connect
    </button>
  );
}
