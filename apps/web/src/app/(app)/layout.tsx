import Link from 'next/link';
import { LogoutButton } from '@/components/logout-button';

/**
 * Gated app layout — Control Plane (Space Instructions §1, §6.2). This route
 * group is where auth-aware code lives. The per-route AuthGuard (used by the
 * dashboard pages) does the UX redirect; real enforcement is server-side
 * middleware against the session cookie (Arch §3.7.1a) — see middleware.ts.
 *
 * frame-ancestors 'none' (CSP in middleware) keeps this surface un-iframable.
 * One account, one Luciel, one login — no switcher, no team surface.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-vm-bg text-vm-text">
      <header className="border-b border-vm-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-vm-5 py-vm-4">
          <Link href="/dashboard" className="font-heading text-vm-3">
            VantageMind
          </Link>
          <div className="flex items-center gap-vm-4">
            <span className="hidden text-vm-0 text-vm-text-muted sm:inline">
              One account, one Luciel, one login.
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-vm-5 py-vm-6">{children}</main>
    </div>
  );
}
