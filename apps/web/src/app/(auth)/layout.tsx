import Link from 'next/link';
import { Logo } from '@luciel/ui';

/**
 * Auth layout — the credential surfaces (signup, verify, login, forgot/reset).
 * NOT gated. Centered, calm, brand-marked.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-vm-surface text-vm-text">
      <header className="px-vm-5 py-vm-5">
        <Link href="/" aria-label="VantageMind home">
          <Logo />
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-vm-5 pb-vm-9">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
