import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from './cn';

/**
 * Button — token-backed. Component law (§5):
 *  - one primary (accent) per view max; everything else secondary/ghost;
 *  - visible focus ring (never removed), 44px min touch target, full keyboard
 *    operability (native <button>), AA contrast.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
}

const base =
  'inline-flex items-center justify-center gap-vm-2 rounded-vm-control font-label ' +
  'transition-[background-color,color,box-shadow] duration-vm ease-vm-ease-out ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vm-focus focus-visible:ring-offset-2 ' +
  'disabled:opacity-50 disabled:pointer-events-none select-none';

const sizes: Record<ButtonSize, string> = {
  md: 'min-h-[44px] px-vm-4 text-vm-1',
  lg: 'min-h-[52px] px-vm-6 text-vm-2',
};

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-vm-accent text-white hover:bg-vm-accent-hover active:bg-vm-accent-hover shadow-sm',
  secondary: 'bg-vm-bg text-vm-text border border-vm-border hover:bg-vm-surface',
  ghost: 'bg-transparent text-vm-text hover:bg-vm-surface',
  danger: 'bg-vm-danger text-white hover:opacity-90',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', asChild = false, className, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? 'button')}
        className={cn(base, sizes[size], variants[variant], className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
