import { cn } from './cn';

/**
 * Toggle — an accessible on/off switch (role="switch", aria-checked, keyboard
 * operable as a native button). Used for enabling channels/tools. Color is not
 * the only signal: the thumb position changes too.
 */
export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
}

export function Toggle({ checked, onChange, label, disabled, id }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-vm-pill transition-colors duration-vm ease-vm-ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vm-focus focus-visible:ring-offset-2',
        'disabled:opacity-50 disabled:pointer-events-none',
        checked ? 'bg-vm-accent' : 'bg-vm-border',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 transform rounded-full bg-white transition-transform duration-vm ease-vm-ease-out',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
