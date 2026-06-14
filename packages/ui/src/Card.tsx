import * as React from 'react';
import { cn } from './cn';

/** Card — raised panel using the surface/border/radius/shadow tokens (§5). */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-vm-card border border-vm-border bg-vm-bg p-vm-5 shadow-vm', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-vm-3', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('font-heading text-vm-4', className)} {...props} />;
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-vm-1 text-vm-1 text-vm-text-muted', className)} {...props} />;
}
