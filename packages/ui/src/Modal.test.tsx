import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Modal } from './Modal';

/** A promise whose settlement the test controls, to observe the pending state. */
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Modal', () => {
  it('keeps the title and action row outside the scrolling body so long copy stays confirmable', () => {
    render(
      <Modal
        open
        onOpenChange={() => {}}
        title="Enable SMS — carrier registration and consent"
        description="Please read this before turning it on."
        confirmLabel="Acknowledge and enable SMS"
      >
        <p>Long A2P consent copy.</p>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('max-h-[85vh]');

    const scroller = dialog.querySelector('.overflow-y-auto');
    expect(scroller).not.toBeNull();
    expect(scroller).toContainElement(screen.getByText('Long A2P consent copy.'));
    expect(scroller).toContainElement(
      screen.getByText('Please read this before turning it on.'),
    );
    expect(scroller).not.toContainElement(
      screen.getByText('Enable SMS — carrier registration and consent'),
    );
    expect(scroller).not.toContainElement(
      screen.getByRole('button', { name: 'Acknowledge and enable SMS' }),
    );
    expect(scroller).not.toContainElement(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('keeps the Radix accessible name/description wiring intact', () => {
    render(
      <Modal open onOpenChange={() => {}} title="Delete this source" description="Can't be undone.">
        <p>body</p>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Delete this source');
    expect(dialog).toHaveAccessibleDescription("Can't be undone.");
  });

  it('disables both buttons and shows the busy label while an async confirm is in flight', async () => {
    const d = deferred();
    render(
      <Modal
        open
        onOpenChange={() => {}}
        title="Pause my Luciel"
        description="Your Luciel stops answering until you resume it."
        confirmLabel="Pause my Luciel"
        confirmPendingLabel="Pausing…"
        onConfirm={() => d.promise}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Pause my Luciel' }));

    const busy = await screen.findByRole('button', { name: 'Pausing…' });
    expect(busy).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    d.resolve();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Pause my Luciel' })).toBeEnabled(),
    );
  });

  it('keeps the dialog open and surfaces the reason when the confirm rejects', async () => {
    const onOpenChange = vi.fn();
    render(
      <Modal
        open
        onOpenChange={onOpenChange}
        title="Delete Luciel"
        description="This starts a 30-day grace period."
        confirmLabel="Delete my Luciel"
        onConfirm={() => Promise.reject(new Error('The server rejected that request.'))}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete my Luciel' }));

    expect(await screen.findByText('The server rejected that request.')).toBeInTheDocument();
    // The dialog must not close itself on failure — the owner has to see it.
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete my Luciel' })).toBeEnabled();
  });

  it('does not close on cancel while a confirm is still in flight', async () => {
    const d = deferred();
    const onOpenChange = vi.fn();
    render(
      <Modal
        open
        onOpenChange={onOpenChange}
        title="Prune leads"
        description="This permanently forgets those people."
        confirmLabel="Prune 40 permanently"
        confirmPendingLabel="Pruning…"
        onConfirm={() => d.promise}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Prune 40 permanently' }));
    await screen.findByRole('button', { name: 'Pruning…' });

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();

    d.resolve();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Prune 40 permanently' })).toBeEnabled(),
    );
  });

  it('still supports a plain synchronous confirm', () => {
    const onConfirm = vi.fn();
    render(
      <Modal
        open
        onOpenChange={() => {}}
        title="Enable SMS"
        description="Carrier registration and consent."
        confirmLabel="Acknowledge"
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeEnabled();
  });
});
