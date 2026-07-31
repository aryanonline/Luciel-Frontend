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
  /**
   * Adds a close control. Only for a notice the owner is finished with once
   * they have read it — a standing disclosure must not be dismissable, or it
   * stops being a disclosure.
   */
  onDismiss?: () => void;
}

export function Banner({ tone = 'info', children, className, onDismiss }: BannerProps) {
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
      <div className="flex-1">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss this message"
          className="-mr-vm-1 -mt-vm-1 rounded-vm-card px-vm-2 py-vm-1 text-vm-1 leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vm-focus focus-visible:ring-offset-2"
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
}
