import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Banner } from './Banner';
import { Button, type ButtonVariant } from './Button';
import { cn } from './cn';

/**
 * Modal — built on Radix Dialog so focus trapping, escape-to-close, ARIA
 * labelling, and scroll locking are correct by default (we don't override the
 * a11y away — §2/§5). Used for the Voice consent gate (Arch §3.1.2) and the
 * destructive confirmations ("this will affect your Luciel's answers" /
 * "can't be undone" — §4).
 *
 * `onConfirm` may return a promise. When it does, the Modal owns the outcome:
 * both buttons disable and the confirm label swaps to `confirmPendingLabel`
 * while it settles; on rejection the dialog STAYS OPEN and renders the reason
 * as a danger banner. Destructive call sites therefore pass `mutateAsync` (not
 * `mutate`) and never close the dialog themselves — a silent failure on pause,
 * delete or prune is the difference between an owner trusting this product and
 * not.
 */
export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Primary action (label + handler + variant for destructive flows). */
  confirmLabel?: string;
  confirmVariant?: ButtonVariant;
  onConfirm?: () => void | Promise<void>;
  /** Confirm label while an async onConfirm is in flight ("Pausing…"). */
  confirmPendingLabel?: string;
  cancelLabel?: string;
  /** Disable confirm until a precondition is met (e.g. consent checkbox). */
  confirmDisabled?: boolean;
}

function failureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : '';
  return message.length > 0 ? message : 'Something went wrong. Please try again.';
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  confirmVariant = 'primary',
  onConfirm,
  confirmPendingLabel = 'Working…',
  cancelLabel = 'Cancel',
  confirmDisabled,
}: ModalProps) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // A reopened dialog must never show the previous attempt's failure.
  React.useEffect(() => {
    if (!open) {
      setPending(false);
      setError(null);
    }
  }, [open]);

  const confirm = async () => {
    if (!onConfirm || pending) return;
    setError(null);
    let result: void | Promise<void>;
    try {
      result = onConfirm();
    } catch (err) {
      setError(failureMessage(err));
      return;
    }
    if (!(result instanceof Promise)) return;
    setPending(true);
    try {
      await result;
    } catch (err) {
      setError(failureMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        // Escape / overlay must not abandon a write that is already in flight.
        if (pending && !next) return;
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn('fixed inset-0 bg-black/40', 'data-[state=open]:animate-in')}
        />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2',
            'flex max-h-[85vh] flex-col',
            'rounded-vm-card border border-vm-border bg-vm-bg shadow-vm',
          )}
        >
          <Dialog.Title className="shrink-0 px-vm-5 pt-vm-5 font-heading text-vm-4">
            {title}
          </Dialog.Title>
          {/* Body scrolls; title and action row stay visible so long copy (the
              A2P consent gate) is readable and confirmable on small screens. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-vm-5">
            {description && (
              <Dialog.Description className="mt-vm-2 text-vm-1 text-vm-text-muted">
                {description}
              </Dialog.Description>
            )}
            {children && <div className="mt-vm-4">{children}</div>}
            {error && (
              <Banner tone="danger" className="mt-vm-4">
                {error}
              </Banner>
            )}
          </div>
          <div className="mt-vm-5 flex shrink-0 justify-end gap-vm-2 px-vm-5 pb-vm-5">
            <Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
              {cancelLabel}
            </Button>
            {confirmLabel && (
              <Button
                variant={confirmVariant}
                onClick={() => void confirm()}
                disabled={confirmDisabled || pending}
              >
                {pending ? confirmPendingLabel : confirmLabel}
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
