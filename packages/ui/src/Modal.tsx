import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button, type ButtonVariant } from './Button';
import { cn } from './cn';

/**
 * Modal — built on Radix Dialog so focus trapping, escape-to-close, ARIA
 * labelling, and scroll locking are correct by default (we don't override the
 * a11y away — §2/§5). Used for the Voice consent gate (Arch §3.1.2) and the
 * destructive confirmations ("this will affect your Luciel's answers" /
 * "can't be undone" — §4).
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
  onConfirm?: () => void;
  cancelLabel?: string;
  /** Disable confirm until a precondition is met (e.g. consent checkbox). */
  confirmDisabled?: boolean;
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
  cancelLabel = 'Cancel',
  confirmDisabled,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn('fixed inset-0 bg-black/40', 'data-[state=open]:animate-in')}
        />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2',
            'rounded-vm-card border border-vm-border bg-vm-bg p-vm-5 shadow-vm',
          )}
        >
          <Dialog.Title className="font-heading text-vm-4">{title}</Dialog.Title>
          {description && (
            <Dialog.Description className="mt-vm-2 text-vm-1 text-vm-text-muted">
              {description}
            </Dialog.Description>
          )}
          {children && <div className="mt-vm-4">{children}</div>}
          <div className="mt-vm-5 flex justify-end gap-vm-2">
            <Dialog.Close asChild>
              <Button variant="ghost">{cancelLabel}</Button>
            </Dialog.Close>
            {confirmLabel && (
              <Button variant={confirmVariant} onClick={onConfirm} disabled={confirmDisabled}>
                {confirmLabel}
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
