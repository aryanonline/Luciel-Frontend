'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Button } from '@luciel/ui';
import { api } from '@/lib/api';

/**
 * Logout — available from the dashboard (and the marketing surface), one
 * identity (Arch §3.7.1a). Clears cached session state and routes home.
 *
 * The local cache is cleared only once the server has actually ended the
 * session. Clearing first and failing would leave the admin on a stripped-out
 * page still holding a live session, looking logged out while they are not
 * (P1-17).
 */
export function LogoutButton() {
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const logout = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await api.auth.logout();
      qc.clear();
      router.replace('/');
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="ghost" onClick={() => void logout()} disabled={busy}>
        {busy ? 'Logging out…' : 'Log out'}
      </Button>
      {failed && (
        <Banner tone="danger" className="mt-vm-2">
          We could not log you out — you are still signed in. Please try again.
        </Banner>
      )}
    </>
  );
}
