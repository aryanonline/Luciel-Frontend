'use client';

import * as React from 'react';
import {
  Card,
  CardTitle,
  CardDescription,
  Toggle,
  Modal,
  StatusChip,
  Field,
  Input,
  Button,
} from '@luciel/ui';
import type { Luciel, ChannelConfig } from '@luciel/api-client';
import { useLucielMutations } from '@/lib/hooks';
import { channelLabel, chipKind } from './labels';

/**
 * Channels pillar (Vision §3.1, Customer Journey §4.1). Multi-select of channels.
 * The widget is on by default. SMS/Voice run on the BUSINESS'S OWN phone number —
 * the tenant brings their number (BYO); the platform never provisions one
 * (Arch §3.1.4/§3.1.6, Decision #48). One number backs both SMS and Voice.
 * Until a number is supplied, SMS/Voice are "Action needed: add your number" and
 * are not live; a supplied number shows "being activated with carriers" while it
 * completes carrier registration (connectionStatus pending_carrier_registration).
 *
 * Voice enablement is a HARD GATE: a one-time consent-acknowledgment modal must
 * be accepted before Voice activates (Arch §3.1.2). The platform always plays an
 * AI-identity + recording/transcription notice the admin can reword but not
 * disable; the admin confirms they're responsible for jurisdiction consent law.
 *
 * Channel-→tool cascade (Arch §3.3 / Decision §43): disabling the SMS channel
 * force-disables send_sms; disabling the Email channel force-disables send_email.
 * The tools-pillar UI also shows the tool toggle as blocked (see tools-pillar.tsx).
 */

/** Channel IDs whose disable cascades to a dependent send tool. */
const CHANNEL_TOOL_CASCADE: Partial<Record<ChannelConfig['id'], string>> = {
  sms: 'send_sms',
  email: 'send_email',
};

/** UX-only E.164 shape check (client validation is never a security control). */
const E164 = /^\+[1-9]\d{7,14}$/;

export function ChannelsPillar({ luciel }: { luciel: Luciel }) {
  const { updateChannels, acknowledgeVoiceConsent, updateTools, startConnection } =
    useLucielMutations();
  const [voiceModalOpen, setVoiceModalOpen] = React.useState(false);
  const [consentChecked, setConsentChecked] = React.useState(false);
  const [phoneNumber, setPhoneNumber] = React.useState('');

  // One BYO number backs both SMS and Voice (Arch §3.1.4/§3.1.6). Derive the shared
  // number status from whichever of the two carries a connectionStatus.
  const smsChannel = luciel.channels.find((c) => c.id === 'sms');
  const voiceChannel = luciel.channels.find((c) => c.id === 'voice');
  const phoneEnabled = Boolean(smsChannel?.enabled || voiceChannel?.enabled);
  const numberStatus = smsChannel?.connectionStatus ?? voiceChannel?.connectionStatus;
  const numberConfigured =
    numberStatus === 'connected' || numberStatus === 'pending_carrier_registration';
  const needsNumber = phoneEnabled && !numberConfigured;
  const phonePending = phoneEnabled && numberStatus === 'pending_carrier_registration';
  const phoneValid = E164.test(phoneNumber.trim());

  const submitNumber = () => {
    if (!phoneValid) return;
    startConnection.mutate({
      connectionType: 'sms_sender',
      provider: 'twilio',
      phoneNumber: phoneNumber.trim(),
    });
    setPhoneNumber('');
  };

  const setEnabled = (id: ChannelConfig['id'], enabled: boolean) => {
    // Voice requires the consent ack before it can be switched on (Arch §3.1.2).
    if (id === 'voice' && enabled) {
      const voice = luciel.channels.find((c) => c.id === 'voice');
      if (!voice?.voiceConsentAcknowledgedAt) {
        setVoiceModalOpen(true);
        return;
      }
    }
    const nextChannels = luciel.channels.map((c) => (c.id === id ? { ...c, enabled } : c));
    updateChannels.mutate(nextChannels);

    // Cascade: disabling a channel force-disables its dependent send tool (Arch §3.3).
    if (!enabled) {
      const dependentToolId = CHANNEL_TOOL_CASCADE[id];
      if (dependentToolId) {
        const nextTools = luciel.tools.map((t) =>
          t.id === dependentToolId ? { ...t, enabled: false } : t,
        );
        updateTools.mutate(nextTools);
      }
    }
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
        Pick how customers reach your Luciel. The website widget is on by default. For SMS and Voice,
        your business brings its own phone number — one number backs both. Add your number below to
        turn them on.
      </CardDescription>
      <ul className="mt-vm-4 divide-y divide-vm-border">
        {luciel.channels.map((c) => {
          // SMS/Voice share the BYO number; their status is surfaced in the number
          // block below, so we don't render a duplicate per-row chip for them.
          const isPhoneChannel = c.id === 'sms' || c.id === 'voice';
          const chip = isPhoneChannel ? null : chipKind(c.connectionStatus);
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

      {phoneEnabled && (
        <div className="mt-vm-4 rounded-vm-card border border-vm-border p-vm-4">
          <div className="flex items-center justify-between gap-vm-3">
            <span className="text-vm-2 font-label">Your business phone number (SMS &amp; Voice)</span>
            {phonePending ? (
              <StatusChip kind="action_needed" detail="being activated with carriers" />
            ) : needsNumber ? (
              <StatusChip kind="action_needed" detail="add your number" />
            ) : (
              <StatusChip kind="connected" />
            )}
          </div>
          {phonePending ? (
            <p className="mt-vm-2 text-vm-1 text-vm-text-muted">
              Your number is being activated with the carriers. SMS and Voice go live once carrier
              registration completes — no shared or platform number is used (Arch §3.1.4/§3.1.6).
            </p>
          ) : (
            <div className="mt-vm-3">
              <p className="mb-vm-3 text-vm-1 text-vm-text-muted">
                Enter the number your business already owns, in E.164 format (e.g. +14155551234).
                Your Luciel sends and receives on this number; the platform never provisions one for
                you.
              </p>
              <div className="flex items-end gap-vm-2">
                <div className="flex-1">
                  <Field
                    id="byo-phone-number"
                    label="Business phone number"
                    hint="Start with + and country code, e.g. +14155551234."
                    error={
                      phoneNumber.length > 0 && !phoneValid
                        ? 'Enter a valid international number starting with + and country code.'
                        : undefined
                    }
                  >
                    {(fieldProps) => (
                      <Input
                        {...fieldProps}
                        type="tel"
                        inputMode="tel"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        placeholder="+14155551234"
                      />
                    )}
                  </Field>
                </div>
                <Button
                  variant="primary"
                  onClick={submitNumber}
                  disabled={!phoneValid || startConnection.isPending}
                  className="mb-vm-4"
                >
                  Add number
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

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
