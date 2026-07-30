import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Modal } from './Modal';

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
});
