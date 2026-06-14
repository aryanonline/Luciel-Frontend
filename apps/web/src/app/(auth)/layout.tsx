import Link from 'next/link';

/**
 * Auth layout — Control Plane, the credential surfaces (signup, verify, login,
 * forgot/reset). NOT gated (these are how you get authenticated). Minimal,
 * centered. Logout/login is one identity across surfaces (Arch §3.7.1a).
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-vm-bg text-vm-text">
      <header className="border-b border-vm-border">
        <div className="mx-auto max-w-5xl px-vm-5 py-vm-4">
          <Link href="/" className="font-heading text-vm-3">
            VantageMind
          </Link>
        </div>
      </header>
      <main className="mx-auto flex max-w-md flex-col px-vm-5 py-vm-8">{children}</main>
    </div>
  );
}
