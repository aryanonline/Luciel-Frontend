/**
 * Dashboard layout — Control Plane, GATED (Space Instructions §1, §6.2).
 * This route group is where auth-aware code lives. Real gating (session cookie
 * check → redirect unauthenticated to /login; unverified → verify wall, Arch
 * §3.7.1a) is enforced in middleware.ts in the auth-build milestone. For the
 * scaffold this layout is a structural shell only; it does NOT fake an auth
 * check (honesty about what isn't built — Space Instructions §3.7).
 *
 * frame-ancestors 'none' (set in middleware CSP) keeps this surface
 * un-iframable — clickjacking defense (§3.6).
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-vm-bg text-vm-text">
      <header className="border-b border-vm-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-vm-5 py-vm-4">
          <span className="font-heading text-vm-3">Dashboard</span>
          <span className="text-vm-0 text-vm-text-muted">One account, one Luciel, one login.</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-vm-5 py-vm-6">{children}</main>
    </div>
  );
}
