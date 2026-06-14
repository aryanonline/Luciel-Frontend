'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@luciel/ui';

/**
 * Dashboard sidebar nav. Surfaces follow the Customer-Journey order
 * (Space Instructions §6.2). One account, one Luciel, one login — so there is no
 * Luciel switcher, no team/role surface (Vision §2, Arch §3.7.1).
 */
const links = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/configure', label: 'Configure' },
  { href: '/dashboard/embed', label: 'Embed & launch' },
  { href: '/dashboard/conversations', label: 'Conversations' },
  { href: '/dashboard/leads', label: 'Leads' },
  { href: '/dashboard/billing', label: 'Billing' },
  { href: '/dashboard/analytics', label: 'Analytics' },
  { href: '/dashboard/audit', label: 'Audit log' },
  { href: '/dashboard/account', label: 'Manage account' },
];

export function DashboardNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Dashboard sections" className="w-56 shrink-0">
      <ul className="space-y-vm-1">
        {links.map((l) => {
          const active =
            pathname === l.href || (l.href !== '/dashboard' && pathname.startsWith(l.href));
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block rounded-vm-control px-vm-3 py-vm-2 text-vm-1',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vm-focus',
                  active
                    ? 'bg-vm-accent-weak font-label text-vm-accent'
                    : 'text-vm-text hover:bg-vm-surface',
                )}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
