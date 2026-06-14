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
});
