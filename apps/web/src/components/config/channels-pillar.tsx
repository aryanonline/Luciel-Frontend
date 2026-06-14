'use client';

import * as React from 'react';
import { Card, CardTitle, CardDescription, Toggle, Modal, StatusChip } from '@luciel/ui';
import type { Luciel, ChannelConfig } from '@luciel/api-client';
import { useLucielMutations } from '@/lib/hooks';
import { channelLabel, chipKind } from './labels';

/**
 * Channels pillar (Vision §3.1, Customer Journey §4.1). Multi-select of channels.
 * The widget is on by default. SMS/Voice share one provisioned number — no
 * separate number per channel (Vision §3.1).
 *
 * Voice enablement is a HARD GATE: a one-time consent-acknowledgment modal must
 * be accepted before Voice activates (Arch §3.1.2). The platform always plays an
 * AI-identity + recording/transcription notice the admin can reword but not
 * disable; the admin confirms they're responsible for jurisdiction consent law.
 */
export function ChannelsPillar({ luciel }: { luciel: Luciel }) {
  const { updateChannels, acknowledgeVoiceConsent } = useLucielMutations();
  const [voiceModalOpen, setVoiceModalOpen] = React.useState(false);
  const [consentChecked, setConsentChecked] = React.useState(false);

  const setEnabled = (id: ChannelConfig['id'], enabled: boolean) => {
    // Voice requires the consent ack before it can be switched on (Arch §3.1.2).
    if (id === 'voice' && enabled) {
      const voice = luciel.channels.find((c) => c.id === 'voice');
      if (!voice?.voiceConsentAcknowledgedAt) {
        setVoiceModalOpen(true);
        return;
      }
    }
    const next = luciel.channels.map((c) => (c.id === id ? { ...c, enabled } : c));
    updateChannels.mutate(next);
  };

  const confirmVoiceConsent = async () => {
    await acknowledgeVoiceConsent.mutateAsync();
    const next = luciel.channels.map((c) => (c.id === 'voice' ? { ...c, enabled: true } : c));
    await updateChannels.mutateAsync(next);
    setVoiceModalOpen(false);
    setConsentChecked(false);
  };

  return (
    <Card>
      <CardTitle>Channels your Luciel uses</CardTitle>
      <CardDescription>
        Pick how customers reach your Luciel. The website widget is on by default. Enabling SMS or
        Voice provisions one shared phone number — phone is opt-in.
      </CardDescription>
      <ul className="mt-vm-4 divide-y divide-vm-border">
        {luciel.channels.map((c) => {
          const chip = chipKind(c.connectionStatus);
          return (
            <li key={c.id} className="flex items-center justify-between py-vm-3">
              <div className="flex items-center gap-vm-3">
                <Toggle
                  checked={c.enabled}
                  onChange={(next) => setEnabled(c.id, next)}
                  label={`Enable ${channelLabel[c.id]}`}
                />
                <span className="text-vm-2">{channelLabel[c.id]}</span>
              </div>
              {chip && c.enabled && <StatusChip kind={chip} />}
            </li>
          );
        })}
      </ul>

      <Modal
        open={voiceModalOpen}
        onOpenChange={(o) => {
          setVoiceModalOpen(o);
          if (!o) setConsentChecked(false);
        }}
        title="Enable Voice — one-time acknowledgment"
        description="Before Voice activates, please confirm you understand the recording disclosure."
        confirmLabel="Acknowledge and enable Voice"
        confirmDisabled={!consentChecked}
        onConfirm={confirmVoiceConsent}
      >
        <div className="space-y-vm-3 text-vm-1">
          <p>
            The platform always plays a spoken notice at the start of every call: that the caller is
            speaking with an AI assistant for your business and that the call may be
            recorded/transcribed. You can reword this notice in your brand voice, but you cannot
            disable it.
          </p>
          <p>
            You are responsible for confirming this disclosure meets the consent law of every place
            you take calls. In two-party-consent jurisdictions (including Ontario and several US
            states), recording without valid consent can be a criminal offence.
          </p>
          <label className="flex items-start gap-vm-2">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <span>
              I understand and confirm I&apos;m responsible for consent compliance in the
              jurisdictions where I take calls.
            </span>
          </label>
        </div>
      </Modal>
    </Card>
  );
}
