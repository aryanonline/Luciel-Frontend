import Link from 'next/link';
import { Container, Logo, Button } from '@luciel/ui';
import { SiteFooter } from '@/components/marketing/site-footer';

/**
 * Marketing layout — Control Plane, PRE-AUTH (§1, §6.1). Ships NO auth-aware
 * code and NO admin API client. SEO-indexable, cacheable. The job is conversion
 * to /signup, not feature enumeration.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-vm-bg text-vm-text">
      <header className="sticky top-0 z-10 border-b border-vm-border bg-vm-bg/90 backdrop-blur">
        <Container className="flex items-center justify-between py-vm-4">
          <Link href="/" aria-label="VantageMind home">
            <Logo />
          </Link>
          <nav className="flex items-center gap-vm-2 text-vm-1 sm:gap-vm-4">
            <Link
              href="/#how-it-works"
              className="hidden px-vm-2 text-vm-text-muted hover:text-vm-text sm:inline"
            >
              How it works
            </Link>
            <Link
              href="/#pricing"
              className="hidden px-vm-2 text-vm-text-muted hover:text-vm-text sm:inline"
            >
              Pricing
            </Link>
            <Link href="/login" className="px-vm-2 text-vm-text-muted hover:text-vm-text">
              Log in
            </Link>
            <Button asChild variant="primary">
              <Link href="/signup">Start free</Link>
            </Button>
          </nav>
        </Container>
      </header>
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
