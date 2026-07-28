import { AuthGuard } from '@/components/auth-guard';
import { DashboardNav } from '@/components/dashboard-nav';
import { AccountNotices } from '@/components/account-notices';

/**
 * Dashboard shell — gates the surface (AuthGuard), renders account notices
 * (Legal §A5's "in-dashboard notification visible on next login"), and the
 * section nav. First-run lives outside this layout (no nav) so a brand-new owner
 * sees only the "create your Luciel" flow (Customer Journey Phase 3).
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <AccountNotices />
      <div className="flex gap-vm-6">
        <DashboardNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </AuthGuard>
  );
}
