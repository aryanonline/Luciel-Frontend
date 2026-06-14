import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ToolsPillar } from '@/components/config/tools-pillar';
import { PersonalityPillar } from '@/components/config/personality-pillar';
import { EscalationPillar } from '@/components/config/escalation-pillar';
import type { Luciel } from '@luciel/api-client';

/**
 * Product-invariant guards (Space Instructions §4). These fail the build if a
 * future change reintroduces a forbidden affordance.
 */
const luciel: Luciel = {
  instanceId: '33333333-3333-4333-8333-333333333333',
  name: 'Test Luciel',
  websiteUrl: 'example.com',
  state: 'active',
  channels: [],
  tools: [
    { id: 'book_appointment', enabled: false },
    { id: 'check_availability', enabled: false },
    { id: 'send_email', enabled: false },
    { id: 'send_sms', enabled: false },
    { id: 'lookup_record', enabled: false },
    { id: 'schedule_callback', enabled: false },
    { id: 'push_to_crm', enabled: false },
    { id: 'bring_your_own_webhook', enabled: false },
  ],
  escalation: { primaryEmail: 'owner@example.com', preferredChannel: 'email' },
  personality: { preset: 'warm_concierge' },
};

describe('Tools pillar — always-on cognition band is non-interactive (CJ §4.2)', () => {
  it('renders the exact "nothing to enable" doctrine line', () => {
    renderWithQuery(<ToolsPillar luciel={luciel} />);
    expect(
      screen.getByText(/Every Luciel does these\. There is nothing to enable/),
    ).toBeInTheDocument();
  });
});

describe('Personality pillar — no model selection (Arch §3.4.3)', () => {
  it('does not render any model picker control', () => {
    renderWithQuery(<PersonalityPillar luciel={luciel} />);
    // No interactive control is labeled "model" (no combobox/select/radio).
    expect(screen.queryByRole('combobox', { name: /model/i })).toBeNull();
    expect(screen.queryByLabelText(/model/i)).toBeNull();
    // The honesty line states model selection is platform-handled.
    expect(screen.getByText(/Model selection is handled by the platform/i)).toBeInTheDocument();
  });
});

describe('Escalation pillar — signals are fixed, only who/how editable (Vision §3.4)', () => {
  it('shows the doctrine line and per-signal channel selects (not signal toggles)', () => {
    renderWithQuery(<EscalationPillar luciel={luciel} />);
    expect(screen.getByText(/Luciel decides/i)).toBeInTheDocument();
    // Four routing selects, one per fixed signal.
    expect(screen.getByLabelText(/Channel for Lead asks for a human/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Channel for High-value lead spotted/i)).toBeInTheDocument();
  });
});
