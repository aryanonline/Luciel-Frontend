'use client';

import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@luciel/ui';
import { api } from '@/lib/api';

/**
 * Logout — available from the dashboard (and the marketing surface), one
 * identity (Arch §3.7.1a). Clears cached session state and routes home.
 */
export function LogoutButton() {
  const router = useRouter();
  const qc = useQueryClient();
  return (
    <Button
      variant="ghost"
      onClick={async () => {
        await api.auth.logout();
        qc.clear();
        router.replace('/');
      }}
    >
      Log out
    </Button>
  );
}
