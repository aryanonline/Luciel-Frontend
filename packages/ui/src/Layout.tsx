import * as React from 'react';
import { cn } from './cn';

/**
 * Layout primitives — the spacing/measure rhythm that makes "minimal" read as
 * finished rather than bare (§5: generous whitespace, restraint). Container caps
 * the readable measure; Section provides consistent vertical rhythm; PageHeader
 * gives every dashboard surface the same title/description treatment.
 */

export function Container({
  className,
  size = 'lg',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { size?: 'sm' | 'md' | 'lg' }) {
  const max = size === 'sm' ? 'max-w-2xl' : size === 'md' ? 'max-w-4xl' : 'max-w-5xl';
  return <div className={cn('mx-auto w-full px-vm-5', max, className)} {...props} />;
}

export function Section({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <section className={cn('py-vm-8', className)} {...props} />;
}

export interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-vm-6 flex flex-wrap items-start justify-between gap-vm-4">
      <div className="min-w-0">
        <h1 className="font-heading text-vm-6 leading-tight tracking-tight">{title}</h1>
        {description && (
          <p className="mt-vm-2 max-w-2xl text-vm-2 text-vm-text-muted">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-vm-2">{actions}</div>}
    </div>
  );
}

/** Eyebrow label above a section heading (small caps-style, muted). */
export function Eyebrow({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        'mb-vm-2 text-vm-0 font-label uppercase tracking-[0.08em] text-vm-accent',
        className,
      )}
      {...props}
    />
  );
}
