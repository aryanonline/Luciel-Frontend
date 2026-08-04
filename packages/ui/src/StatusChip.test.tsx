import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusChip } from './StatusChip';

describe('StatusChip', () => {
  it('renders a text label (never color alone) for each kind', () => {
    render(<StatusChip kind="connected" />);
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('appends a detail to the label', () => {
    render(<StatusChip kind="action_needed" detail="connect Google Calendar" />);
    expect(screen.getByText('Action needed: connect Google Calendar')).toBeInTheDocument();
  });

  // Harmony wave 2, item 6a: the non-actionable chip must read "Not available
  // yet", never borrow the word "Action" or the warning color action_needed
  // uses — the whole point is that this row has nothing to act on.
  it('renders "Not available yet" for not_available, muted rather than warning-colored', () => {
    render(<StatusChip kind="not_available" />);
    const chip = screen.getByText('Not available yet');
    expect(chip).toBeInTheDocument();
    // The label text sits in an inner <span>; the outer chip <span> carries
    // the color classes.
    const outer = chip.parentElement;
    expect(outer?.className).toContain('text-vm-text-muted');
    expect(outer?.className).not.toContain('text-vm-warning');
  });
});
