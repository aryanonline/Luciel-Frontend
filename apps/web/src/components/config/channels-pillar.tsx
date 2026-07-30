'use client';

import * as React from 'react';
import {
  Banner,
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
import {
  LucielApiError,
  type ChannelId,
  type Luciel,
  type ChannelConfig,
  type MetaChannel,
} from '@luciel/api-client';
import {
  useConnectionLifecycle,
  useConnectionProviders,
  useConnections,
  useLucielMutations,
} from '@/lib/hooks';
import { ConnectionControl } from './connection-control';
import { CredentialFields, credentialFieldsComplete } from './credential-fields';
import { EmailChannelProvisioning } from './email-provisioning';
import { channelLabel, chipKind } from './labels';

/**
 * Channels pillar (Vision §3.1, Customer Journey §4.1). Multi-select of channels.
 * The widget is on by default. SMS/Voice run on the BUSINESS'S OWN phone number —
 * the tenant brings their number (BYO); the platform never provisions one
 * (Arch §3.1.4/§3.1.6, Decision #48). One number backs both SMS and Voice.
 * BYO is two ordered steps: the tenant's OWN Twilio account first ("Action
 * needed: connect your Twilio account"), then which of that account's numbers
 * Luciel answers on ("Action needed: add your number") — you cannot designate a
 * number before the account holding it is on file. Both are actionable next
 * steps, not errors. A supplied number sits at "Action needed: complete carrier
 * registration" (connectionStatus pending_carrier_registration) until the TENANT
 * completes their own A2P 10DLC Brand + Campaign registration and asks the
 * platform to re-verify. The platform never registers on their behalf and there
 * is no background poller (Legal §A2, Arch §3.1.6), so Re-verify is the only
 * exit from that state.
 *
 * Voice enablement is a HARD GATE: a one-time consent-acknowledgment modal must
 * be accepted before Voice activates (Arch §3.1.2). The platform always plays an
 * AI-identity + recording/transcription notice that cannot be disabled; the
 * admin confirms they're responsible for jurisdiction consent law.
 *
 * SMS enablement is likewise a HARD GATE (Legal §A2/§A6): before SMS switches on
 * the admin acknowledges that they register with the carriers themselves, are
 * the sender of record, owe the carrier fees, and own lawful opt-in plus
 * STOP/HELP handling under CASL and, where applicable, the TCPA.
 *
 * Channel-→tool cascade (Arch §3.3 / Decision §43): disabling the SMS channel
 * force-disables send_sms; disabling the Email channel force-disables send_email.
 * The tools-pillar UI also shows the tool toggle as blocked (see tools-pillar.tsx).
 *
 * WhatsApp and Instagram/Messenger run on ONE Meta connection (Decision #7,
 * contract §2): a single `channel_auth` grant to the owner's Meta Business
 * account authorizes all three surfaces, and each enabled channel then names the
 * asset it answers on. Authorization alone does not make a channel live — until
 * that id is bound, inbound has nothing to route by — but binding one channel
 * never unbinds another, so turning a second Meta channel on cannot knock the
 * first offline. Both rules are enforced by the shared connection control.
 */

/** Channel IDs whose disable cascades to a dependent send tool. */
const CHANNEL_TOOL_CASCADE: Partial<Record<ChannelConfig['id'], string>> = {
  sms: 'send_sms',
  email: 'send_email',
};

/**
 * The Meta channels each UI row covers and the destination it answers on
 * (contract §2). One row can cover more than one Meta channel: Instagram DMs and
 * Messenger are the same Page, so the one Page id is bound for both. The owner
 * pastes the id — there is no asset picker route, and which of their numbers or
 * Pages Luciel should answer on is not ours to guess.
 */
const META_CHANNEL: Partial<
  Record<
    ChannelId,
    { channels: MetaChannel[]; purpose: string; destination: { label: string; hint: string } }
  >
> = {
  whatsapp: {
    channels: ['whatsapp'],
    purpose:
      'Luciel replies to people who message your business on WhatsApp, from your own WhatsApp Business number — the conversation stays in your Meta account.',
    destination: {
      label: 'WhatsApp phone number ID',
      hint: 'In Meta Business Suite → WhatsApp Manager → API Setup, the "Phone number ID" (digits, not the phone number itself).',
    },
  },
  instagram_messenger: {
    channels: ['instagram', 'messenger'],
    purpose:
      'Luciel replies to Instagram DMs and Facebook Messenger for your Page, from your own Meta account — both run on the same Page, so one id covers them.',
    destination: {
      label: 'Facebook Page ID',
      hint: 'In your Facebook Page settings → About → Page ID. This is the Page your Instagram account is linked to.',
    },
  },
};

/** UX-only E.164 shape check (client validation is never a security control). */
const E164 = /^\+[1-9]\d{7,14}$/;

/** Where the tenant registers their own A2P 10DLC brand + campaign (Legal §A2). */
const A2P_GUIDE_URL = 'https://www.twilio.com/docs/messaging/compliance/a2p-10dlc';

export function ChannelsPillar({ luciel }: { luciel: Luciel }) {
  const {
    updateChannels,
    acknowledgeVoiceConsent,
    updateTools,
    startConnection,
    reverifySmsNumber,
  } = useLucielMutations();
  const connections = useConnections();
  const { connect, submitCredentials } = useConnectionLifecycle();
  // One row per type (§3.8.2) — and for Meta that is the point: every Meta
  // channel reads the same grant instead of competing for the slot.
  const metaConnection = connections.data?.find((c) => c.connectionType === 'channel_auth');
  const smsConnection = connections.data?.find((c) => c.connectionType === 'sms_sender');
  const smsProviders = useConnectionProviders('sms_sender');
  const twilioOption = smsProviders.data
    ?.find((group) => group.connectionType === 'sms_sender')
    ?.providers.find((option) => option.provider === 'twilio');
  const twilioFields = twilioOption?.credentialFields ?? [];
  const [voiceModalOpen, setVoiceModalOpen] = React.useState(false);
  const [consentChecked, setConsentChecked] = React.useState(false);
  const [smsModalOpen, setSmsModalOpen] = React.useState(false);
  const [smsAckChecked, setSmsAckChecked] = React.useState(false);
  const [phoneNumber, setPhoneNumber] = React.useState('');
  const [twilioValues, setTwilioValues] = React.useState<Record<string, string>>({});
  const [twilioNotice, setTwilioNotice] = React.useState<string | null>(null);

  // One BYO number backs both SMS and Voice (Arch §3.1.4/§3.1.6). Derive the shared
  // number status from whichever of the two carries a connectionStatus.
  const smsChannel = luciel.channels.find((c) => c.id === 'sms');
  const voiceChannel = luciel.channels.find((c) => c.id === 'voice');
  const phoneEnabled = Boolean(smsChannel?.enabled || voiceChannel?.enabled);
  const numberStatus = smsChannel?.connectionStatus ?? voiceChannel?.connectionStatus;
  const numberConfigured =
    numberStatus === 'connected' || numberStatus === 'pending_carrier_registration';
  // BYO is two steps and they are ordered: you cannot designate one of the
  // account's numbers before the account itself is on file. The Account SID is
  // the non-secret half of the credential, so its presence is the proof.
  const twilioConnected = numberConfigured || Boolean(smsConnection?.nonSecretConfig?.accountSid);
  const needsTwilio = phoneEnabled && !twilioConnected;
  const needsNumber = phoneEnabled && twilioConnected && !numberConfigured;
  const phonePending = phoneEnabled && numberStatus === 'pending_carrier_registration';
  const phoneValid = E164.test(phoneNumber.trim());
  // The backend stamps smsComplianceAcknowledgedAt server-side on first SMS
  // enable, so the durable stamp alone carries this gate.
  const smsAcknowledged = Boolean(smsChannel?.smsComplianceAcknowledgedAt);

  /**
   * Step one of BYO (contract §1a): the customer's OWN Twilio credential. The
   * start creates the row the credentials belong to, so the two run together —
   * a started row with nothing in it is a dead end.
   */
  const submitTwilio = async () => {
    setTwilioNotice(null);
    try {
      const start = await connect.mutateAsync({
        connectionType: 'sms_sender',
        provider: 'twilio',
      });
      const connectionId = start.connectionId ?? smsConnection?.connectionId;
      if (!connectionId) {
        setTwilioNotice('We could not start the Twilio connection. Please try again.');
        return;
      }
      await submitCredentials.mutateAsync({ connectionId, fields: twilioValues });
      setTwilioValues({});
    } catch (err) {
      setTwilioNotice(
        err instanceof LucielApiError
          ? err.message
          : 'We could not save those Twilio details. Please check them and try again.',
      );
    }
  };

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
    // SMS requires the carrier/consent-responsibility ack (Legal §A2/§A6).
    if (id === 'sms' && enabled && !smsAcknowledged) {
      setSmsModalOpen(true);
      return;
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

  const confirmSmsAck = async () => {
    const next = luciel.channels.map((c) => (c.id === 'sms' ? { ...c, enabled: true } : c));
    await updateChannels.mutateAsync(next);
    setSmsModalOpen(false);
    setSmsAckChecked(false);
  };

  return (
    <Card>
      <CardTitle>Channels your Luciel uses</CardTitle>
      <CardDescription>
        Pick how customers reach your Luciel. The website widget is on by default. For SMS and Voice,
        your business brings its own phone number — one number backs both. Connect your Twilio
        account below and name the number to turn them on.
      </CardDescription>
      <ul className="mt-vm-4 divide-y divide-vm-border">
        {luciel.channels.map((c) => {
          // SMS/Voice share the BYO number; their status is surfaced in the number
          // block below, so we don't render a duplicate per-row chip for them.
          const isPhoneChannel = c.id === 'sms' || c.id === 'voice';
          const meta = META_CHANNEL[c.id];
          // A Meta row's status comes from the connection control, which knows
          // that authorized-without-a-destination is not live (contract §2).
          const showControl = Boolean(meta) && c.enabled;
          const chip = isPhoneChannel || showControl ? null : chipKind(c.connectionStatus);
          return (
            <li key={c.id} className="py-vm-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-vm-3">
                  <Toggle
                    checked={c.enabled}
                    onChange={(next) => setEnabled(c.id, next)}
                    label={`Enable ${channelLabel[c.id]}`}
                  />
                  <span className="text-vm-2">{channelLabel[c.id]}</span>
                </div>
                {chip && c.enabled && <StatusChip kind={chip} />}
              </div>
              {showControl && meta && (
                <div className="mt-vm-3 pl-[3.5rem]">
                  <ConnectionControl
                    connectionType="channel_auth"
                    label={channelLabel[c.id]}
                    purpose={meta.purpose}
                    connection={metaConnection}
                    provider="meta"
                    destinationField={{ ...meta.destination, channels: meta.channels }}
                    unavailableReason="Meta app not configured"
                  />
                  <p className="mt-vm-2 text-vm-0 text-vm-text-muted" role="note">
                    One Meta sign-in covers WhatsApp, Instagram DMs and Messenger. Each channel
                    keeps its own id, so turning another one on never disconnects this one.
                  </p>
                </div>
              )}
              {/* Luciel's work address is part of the Email channel, so it is set up
                  in this row and nowhere else (Decision #4). Rendered whether or not
                  the channel is on: the address can be provisioned first, and the
                  component itself says Luciel isn't answering email until it is on. */}
              {c.id === 'email' && (
                <div className="mt-vm-3 pl-[3.5rem]">
                  <EmailChannelProvisioning emailChannelEnabled={c.enabled} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {phoneEnabled && (
        <div className="mt-vm-4 rounded-vm-card border border-vm-border p-vm-4">
          <div className="flex items-center justify-between gap-vm-3">
            <span className="text-vm-2 font-label">Your business phone number (SMS &amp; Voice)</span>
            {phonePending ? (
              <StatusChip kind="action_needed" detail="complete carrier registration" />
            ) : needsTwilio ? (
              <StatusChip kind="action_needed" detail="connect your Twilio account" />
            ) : needsNumber ? (
              <StatusChip kind="action_needed" detail="add your number" />
            ) : (
              <StatusChip kind="connected" />
            )}
          </div>
          {phonePending ? (
            <div className="mt-vm-2 space-y-vm-3 text-vm-1 text-vm-text-muted">
              <p>
                Your number is on file, but its A2P 10DLC carrier registration isn&apos;t verified
                yet — so SMS and Voice aren&apos;t sending. You complete the Brand and Campaign
                registration yourself, in your own carrier account, in your business&apos;s name.
                VantageMind guides and verifies but never registers on your behalf, and no shared or
                platform number is used.
              </p>
              <p>
                Nothing checks this in the background. When you&apos;ve finished registering, use
                Re-verify and we&apos;ll read your number&apos;s current carrier status.
              </p>
              <div className="flex flex-wrap items-center gap-vm-3">
                <Button
                  variant="secondary"
                  onClick={() => reverifySmsNumber.mutate()}
                  disabled={reverifySmsNumber.isPending}
                >
                  {reverifySmsNumber.isPending ? 'Re-verifying…' : 'Re-verify'}
                </Button>
                <a
                  href={A2P_GUIDE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  How to register your brand and campaign
                </a>
              </div>
              {reverifySmsNumber.data?.statusDetail && (
                <p>{reverifySmsNumber.data.statusDetail}</p>
              )}
              {reverifySmsNumber.isError && (
                <p className="text-vm-danger">
                  We couldn&apos;t reach the carrier just now. Your number is unchanged — try
                  Re-verify again in a moment.
                </p>
              )}
            </div>
          ) : needsTwilio ? (
            /* Step one: the customer's OWN Twilio account (Arch §3.1.4). The
               fields are whatever the registry advertises, so a provider that
               starts asking for one more thing needs no frontend change. */
            <div className="mt-vm-3">
              <p className="mb-vm-3 text-vm-1 text-vm-text-muted">
                Connect your Twilio account so Luciel can text and call from your own business
                number — your number stays yours and your carrier costs are billed by Twilio
                directly.
              </p>
              {smsProviders.isError && (
                <Banner tone="warning">
                  We could not load the Twilio form just now. Reload the page to try again.
                </Banner>
              )}
              {twilioNotice && <Banner tone="warning">{twilioNotice}</Banner>}
              {twilioFields.length > 0 && (
                <>
                  <CredentialFields
                    idPrefix="twilio"
                    fields={twilioFields}
                    values={twilioValues}
                    onChange={setTwilioValues}
                  />
                  <p className="mt-vm-2 text-vm-0 text-vm-text-muted">
                    Give either your Auth Token or an API Key SID and Secret — whichever your Twilio
                    account uses. Find both in the Twilio Console under Account Info.
                  </p>
                  <Button
                    variant="primary"
                    className="mt-vm-3"
                    onClick={() => void submitTwilio()}
                    disabled={
                      connect.isPending ||
                      submitCredentials.isPending ||
                      !credentialFieldsComplete(twilioFields, twilioValues)
                    }
                  >
                    {connect.isPending || submitCredentials.isPending
                      ? 'Saving…'
                      : 'Connect Twilio account'}
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="mt-vm-3">
              <p className="mb-vm-3 text-vm-1 text-vm-text-muted">
                Your Twilio account is connected. Tell us which of its numbers Luciel uses, in E.164
                format (e.g. +14155551234). Your Luciel sends and receives on this number; the
                platform never provisions one for you.
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

          {/* Durable SMS disclosure — the enablement modal is one-off, this is not
              (Legal §A2/§A6, Arch §3.4.2). */}
          {smsChannel?.enabled && (
            <p className="mt-vm-4 border-t border-vm-border pt-vm-3 text-vm-0 text-vm-text-muted">
              On SMS you are the sender of record: carrier registration and fees are yours, and so is
              lawful opt-in and honoring opt-out under CASL and, where applicable, the TCPA. The
              platform honors STOP and HELP automatically at the channel layer, and the first
              outbound message to a recipient carries an AI-identity and STOP notice.
            </p>
          )}
        </div>
      )}

      {/* SMS hard gate — carrier registration + consent responsibility (Legal §A2/§A6). */}
      <Modal
        open={smsModalOpen}
        onOpenChange={(o) => {
          setSmsModalOpen(o);
          if (!o) setSmsAckChecked(false);
        }}
        title="Enable SMS — carrier registration and consent"
        description="SMS is sent in your business's name, not ours. Please read this before turning it on."
        confirmLabel="Acknowledge and enable SMS"
        confirmDisabled={!smsAckChecked}
        onConfirm={confirmSmsAck}
      >
        <div className="space-y-vm-3 text-vm-1">
          <p>
            <strong>You register with the carriers, not us.</strong> If your number isn&apos;t
            already carrier-registered, you complete the required A2P 10DLC Brand and Campaign
            registration yourself, in your own carrier account. VantageMind provides the guidance and
            verifies your number&apos;s status, but does not perform, submit, or operate the
            registration for you.{' '}
            <a
              href={A2P_GUIDE_URL}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Registration steps and the business details you&apos;ll need
            </a>
            .
          </p>
          <p>
            <strong>You are the sender of record.</strong> The registration is made in your
            business&apos;s legal name — carrier rules require the registered sender to be the party
            actually messaging the consumer, which is you. It needs accurate business information
            (legal name, address, and a Tax ID where applicable).
          </p>
          <p>
            <strong>Carrier costs are yours.</strong> Number rental, message usage, and any carrier
            registration fees are paid to your carrier directly. VantageMind is never in that
            billing path.
          </p>
          <p>
            <strong>Consent and opt-out are yours.</strong> You are responsible for the lawfulness of
            your opt-in and for honoring opt-out — the consent and opt-out obligations of CASL in
            Canada and, where applicable, the US TCPA. The platform enforces STOP and HELP handling
            at the channel layer and the first outbound message carries an AI-identity and STOP
            notice, but the lawful basis for contacting any given recipient is yours as the sender.
          </p>
          <p>
            If you message only Canadian recipients, US A2P 10DLC may not apply and no US 10DLC fee
            is incurred — but Canadian carrier requirements and CASL consent and opt-out obligations
            still do.
          </p>
          <label className="flex items-start gap-vm-2">
            <input
              type="checkbox"
              checked={smsAckChecked}
              onChange={(e) => setSmsAckChecked(e.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <span>
              I understand I complete A2P 10DLC carrier registration myself as the sender of record,
              that carrier and registration fees are mine, and that I&apos;m responsible for lawful
              opt-in and for honoring STOP/HELP under CASL and, where applicable, the TCPA.
            </span>
          </label>
        </div>
      </Modal>

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
            recorded/transcribed. This notice cannot be disabled.
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
