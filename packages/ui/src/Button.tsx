import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from './cn';

/**
 * Button — token-backed. Component law (Space Instructions §5):
 *  - one primary (accent) per view max; everything else secondary/ghost;
 *  - visible focus ring (never removed), 44px min touch target, full keyboard
 *    operability (native <button> gives this), correct contrast (AA).
 * Styling uses token-backed Tailwind utilities (resolve to --vm-* vars).
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Render as child (e.g. wrap an <a>) while keeping button styling. */
  asChild?: boolean;
}

const base =
  'inline-flex items-center justify-center gap-vm-2 min-h-[44px] px-vm-4 rounded-vm-control ' +
  'text-vm-1 font-label transition-colors duration-vm ease-vm-ease-out ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vm-focus focus-visible:ring-offset-2 ' +
  'disabled:opacity-50 disabled:pointer-events-none';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-vm-accent text-white hover:bg-vm-accent-hover',
  secondary: 'bg-vm-surface text-vm-text border border-vm-border hover:bg-vm-accent-weak',
  ghost: 'bg-transparent text-vm-text hover:bg-vm-surface',
  danger: 'bg-vm-danger text-white hover:opacity-90',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', asChild = false, className, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        // Default to type="button" so a stray button never submits a form.
        type={asChild ? undefined : (type ?? 'button')}
        className={cn(base, variants[variant], className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
