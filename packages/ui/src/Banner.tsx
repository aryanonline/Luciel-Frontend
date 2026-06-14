import * as React from 'react';
import { cn } from './cn';

/**
 * Banner — calm inline notice (at-cap, dunning, honest disclosures). Tone uses
 * the semantic tokens; an icon + text accompany the color (never color alone).
 * role="status" so assistive tech announces it without being assertive.
 */
export type BannerTone = 'info' | 'warning' | 'danger';

const config: Record<BannerTone, { cls: string; glyph: string }> = {
  info: { cls: 'border-vm-border bg-vm-accent-weak text-vm-text', glyph: 'ℹ' },
  warning: { cls: 'border-vm-border bg-vm-surface text-vm-warning', glyph: '!' },
  danger: { cls: 'border-vm-border bg-vm-surface text-vm-danger', glyph: '⚠' },
};

export interface BannerProps {
  tone?: BannerTone;
  children: React.ReactNode;
  className?: string;
}

export function Banner({ tone = 'info', children, className }: BannerProps) {
  const c = config[tone];
  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-vm-2 rounded-vm-card border p-vm-3 text-vm-1',
        c.cls,
        className,
      )}
    >
      <span aria-hidden="true" className="mt-0.5">
        {c.glyph}
      </span>
      <div>{children}</div>
    </div>
  );
}
