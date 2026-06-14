import Link from 'next/link';

/**
 * Marketing layout — Control Plane, PRE-AUTH (Space Instructions §1, §6.1).
 * This route group ships NO auth-aware code and NO admin API client. It is
 * SEO-indexable and cacheable. Keep it minimal: the job is conversion to
 * /signup, not feature enumeration.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-vm-bg text-vm-text">
      <header className="border-b border-vm-border">
        <nav className="mx-auto flex max-w-5xl items-center justify-between px-vm-5 py-vm-4">
          <Link href="/" className="font-heading text-vm-3">
            VantageMind
          </Link>
          <div className="flex items-center gap-vm-4 text-vm-1">
            {/* Logout is available from marketing too — one identity (Arch §3.7.1a).
                Login/signup links are plain navigation; no auth logic here. */}
            <Link href="/login" className="text-vm-text-muted hover:text-vm-text">
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-vm-control bg-vm-accent px-vm-4 py-vm-2 text-white"
            >
              Start free
            </Link>
          </div>
        </nav>
      </header>
      <main>{children}</main>
      <footer className="border-t border-vm-border px-vm-5 py-vm-6 text-vm-0 text-vm-text-muted">
        <div className="mx-auto max-w-5xl">© VantageMind. Powered by VantageMind.</div>
      </footer>
    </div>
  );
}
