'use client';

import { useContext, useState } from 'react';
import { useLogout, usePrivy } from '@privy-io/react-auth';
import { UserFidContext } from '~/app/providers';

export function WebLogoutButton() {
  const { environment } = useContext(UserFidContext);
  const { ready, authenticated } = usePrivy();
  const { logout } = useLogout();
  const [busy, setBusy] = useState(false);

  if (environment !== 'web' || !ready || !authenticated) return null;

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await logout();
        } finally {
          setBusy(false);
        }
      }}
      className="mt-3 px-3 py-1.5 rounded-full text-xs text-white/80 bg-black/40 border border-white/15 active:bg-white/10 touch-manipulation disabled:opacity-50"
    >
      {busy ? 'Signing out…' : 'Log out'}
    </button>
  );
}
