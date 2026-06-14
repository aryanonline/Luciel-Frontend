import * as React from 'react';
import { cn } from './cn';

/**
 * Field — a labeled form control wrapper with accessible error wiring. The label
 * is associated to the control via htmlFor/id; the error is announced via
 * aria-describedby + role="alert". Client-side validation is UX only (§3.1).
 */
export interface FieldProps {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: (props: {
    id: string;
    'aria-invalid'?: boolean;
    'aria-describedby'?: string;
  }) => React.ReactNode;
}

export function Field({ id, label, error, hint, required, children }: FieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="mb-vm-4">
      <label htmlFor={id} className="mb-vm-1 block text-vm-1 font-label">
        {label}
        {required && <span className="text-vm-danger"> *</span>}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && !error && (
        <p id={hintId} className="mt-vm-1 text-vm-0 text-vm-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-vm-1 text-vm-0 text-vm-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'min-h-[44px] w-full rounded-vm-control border border-vm-border bg-vm-bg px-vm-3 text-vm-2',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vm-focus focus-visible:ring-offset-1',
      'aria-[invalid=true]:border-vm-danger',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'min-h-[88px] w-full rounded-vm-control border border-vm-border bg-vm-bg p-vm-3 text-vm-2',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vm-focus focus-visible:ring-offset-1',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'min-h-[44px] w-full rounded-vm-control border border-vm-border bg-vm-bg px-vm-3 text-vm-2',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vm-focus focus-visible:ring-offset-1',
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = 'Select';
