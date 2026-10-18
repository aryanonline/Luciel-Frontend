import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { VoiceDisclosure, VOICE_DISCLOSURE_INVARIANT } from '@/components/config/voice-disclosure';
import { ChannelsPillar } from '@/components/config/channels-pillar';
import { api } from '@/lib/api';
import { LucielApiError, type Luciel } from '@luciel/api-client';

/**
 * Round 7 — the voice-disclosure wording (settled contract): the personality block
 * carries an optional `voiceDisclosureIntro` (plain text, at most 200 characters,
 * empty = none) and a READ-ONLY `voiceDisclosurePreview` — the exact sentence callers
 * hear, which always includes the AI-identity and recording facts. Pinned: the
 * served preview renders verbatim with the invariant copy; the intro field counts
 * live and refuses past 200 at the field; a server 422 lands on the field; a server
 * that serves no preview gets no field (its strict PUT would refuse the key); and
 * the block sits under the Voice channel row.
 */

const PREVIEW =
  "Thanks for calling Sarah Chen Realty. You're speaking with an AI assistant, not a human, and this call is handled by an automated system. This call may be recorded and transcribed. If you'd prefer a person, just say so at any time.";

const luciel = (personality: Partial<Luciel['personality']> = {}): Luciel => ({
  instanceId: '44444444-4444-4444-8444-444444444444',
  name: 'Test Luciel',
  websiteUrl: 'example.com',
  state: 'active',
  channels: [
    { id: 'widget', enabled: true },
    { id: 'email', enabled: false },
    { id: 'sms', enabled: false, connectionStatus: 'unconfigured' },
    {
      id: 'voice',
      enabled: false,
      connectionStatus: 'unconfigured',
      voiceConsentAcknowledgedAt: '2026-09-01T00:00:00Z',
    },
    { id: 'whatsapp', enabled: false },
    { id: 'messenger', enabled: false },
    { id: 'instagram', enabled: false },
  ],
  tools: [],
  escalation: { primaryEmail: 'sales@acme.example', preferredChannel: 'email' },
  escalationContactHealth: [],
  personality: {
    preset: 'warm_concierge',
    voiceDisclosureIntro: 'Thanks for calling Sarah Chen Realty.',
    voiceDisclosurePreview: PREVIEW,
    ...personality,
  },
  leadRetentionDays: null,
});

afterEach(() => vi.restoreAllMocks());

describe('voice disclosure wording', () => {
  it('renders the served preview word for word, with the invariant copy', () => {
    renderWithQuery(<VoiceDisclosure luciel={luciel()} />);
    expect(screen.getByTestId('voice-disclosure-preview')).toHaveTextContent(PREVIEW);
    expect(screen.getByText(VOICE_DISCLOSURE_INVARIANT)).toBeInTheDocument();
    expect(screen.getByLabelText(/Your opening line/)).toHaveValue(
      'Thanks for calling Sarah Chen Realty.',
    );
    expect(screen.getByTestId('voice-intro-count')).toHaveTextContent('37 / 200 characters');
  });

  it('counts live and refuses past 200 characters at the field', () => {
    renderWithQuery(<VoiceDisclosure luciel={luciel()} />);
    fireEvent.change(screen.getByLabelText(/Your opening line/), {
      target: { value: 'x'.repeat(201) },
    });
    expect(screen.getByTestId('voice-intro-count')).toHaveTextContent('201 / 200 characters');
    expect(screen.getByRole('button', { name: 'Save opening line' })).toBeDisabled();
  });

  it('saves the trimmed intro and reports it', async () => {
    const update = vi.spyOn(api.luciel, 'updatePersonality').mockResolvedValue(luciel());
    renderWithQuery(<VoiceDisclosure luciel={luciel()} />);
    fireEvent.change(screen.getByLabelText(/Your opening line/), {
      target: { value: '  Hi, this is Sarah Chen Realty.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save opening line' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[0]).toMatchObject({
      preset: 'warm_concierge',
      voiceDisclosureIntro: 'Hi, this is Sarah Chen Realty.',
    });
    expect(await screen.findByText(/Callers hear your opening line first/)).toBeInTheDocument();
  });

  it('a server 422 about the intro lands on the field', async () => {
    vi.spyOn(api.luciel, 'updatePersonality').mockRejectedValue(
      new LucielApiError({
        code: 'validation_error',
        message: 'voiceDisclosureIntro: The opening line cannot claim to be a person.',
      }),
    );
    renderWithQuery(<VoiceDisclosure luciel={luciel()} />);
    fireEvent.change(screen.getByLabelText(/Your opening line/), {
      target: { value: "Hi, I'm Sarah." },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save opening line' }));
    expect(
      await screen.findByText('The opening line cannot claim to be a person.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Your opening line/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('a server that serves no preview gets no field — only what callers always hear', () => {
    renderWithQuery(
      <VoiceDisclosure
        luciel={luciel({ voiceDisclosureIntro: undefined, voiceDisclosurePreview: undefined })}
      />,
    );
    expect(screen.queryByLabelText(/Your opening line/)).not.toBeInTheDocument();
    expect(screen.getByTestId('voice-disclosure-unsupported')).toHaveTextContent(
      /speaking with an AI assistant/,
    );
    expect(screen.getByText(VOICE_DISCLOSURE_INVARIANT)).toBeInTheDocument();
  });

  it('sits under the Voice channel row', () => {
    renderWithQuery(<ChannelsPillar luciel={luciel()} />);
    const summary = screen.getByText('What callers hear first', { selector: 'summary' });
    expect(summary.closest('li')).toHaveTextContent(/Voice/);
  });
});
