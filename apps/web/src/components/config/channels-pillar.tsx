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
  type ConnectionType,
  type Luciel,
  type ChannelConfig,
  type ProviderCredentialField,
} from '@luciel/api-client';
import {
  useConnectionLifecycle,
  useConnectionProviders,
  useConnections,
  useLucielMutations,
} from '@/lib/hooks';
import { useActionNotice } from '@/lib/use-action-notice';
import { ConnectionControl } from './connection-control';
import { CredentialFields, credentialFieldsComplete } from './credential-fields';
import { EmailChannelProvisioning } from './email-provisioning';
import { channelLabel, chipKind, offRowConnectionNote, toolMeta } from './labels';
import { MESSAGING_SURFACES } from './messaging-surfaces';

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
 * Meta messaging is THREE channel rows on TWO grants (Arch §3.1.2, Decision #7,
 * contract §2). WhatsApp and Messenger are separate rows sharing the one
 * Facebook grant (`channel_auth`) — signing in on either row authorizes both;
 * Instagram DMs sign in separately on Business Login for Instagram
 * (`instagram_auth`), because Facebook rejects an authorize request carrying
 * the `instagram_*` scopes and fails the whole dialog with it — so putting
 * Instagram on the shared grant took WhatsApp and Messenger down too. Each row
 * gets its own control, and the owner is never told that one sign-in covers
 * Instagram.
 *
 * Within a grant, authorization alone does not make a channel live — until its
 * id is bound, inbound has nothing to route by — but binding one channel never
 * unbinds another, so turning a second surface on cannot knock the first
 * offline. Both rules are enforced by the shared connection control.
 */

/** Channel IDs whose disable cascades to a dependent send tool. Typed against
 * the tool-label map so the cascade toast can name the tool by its product
 * label rather than its raw wire id. */
const CHANNEL_TOOL_CASCADE: Partial<Record<ChannelConfig['id'], keyof typeof toolMeta>> = {
  sms: 'send_sms',
  email: 'send_email',
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
  const { connect, reconnect, submitCredentials } = useConnectionLifecycle();
  // One row per type (§3.8.2), so a surface reads the grant it rides: WhatsApp
  // and Messenger share the Facebook row, Instagram has its own.
  const connectionFor = (type: ConnectionType) =>
    connections.data?.find((c) => c.connectionType === type);
  const smsConnection = connectionFor('sms_sender');
  const smsProviders = useConnectionProviders('sms_sender');
  const twilioOption = smsProviders.data
    ?.find((group) => group.connectionType === 'sms_sender')
    ?.providers.find((option) => option.provider === 'twilio');
  const twilioFields = twilioOption?.credentialFields ?? [];
  const twilioUnavailable = twilioOption?.configured === false;
  const [voiceModalOpen, setVoiceModalOpen] = React.useState(false);
  const [consentChecked, setConsentChecked] = React.useState(false);
  const [smsModalOpen, setSmsModalOpen] = React.useState(false);
  const [smsAckChecked, setSmsAckChecked] = React.useState(false);
  /** Whether the SMS modal is closing because the ack succeeded (vs a dismissal). */
  const smsConfirmedRef = React.useRef(false);
  const [phoneNumber, setPhoneNumber] = React.useState('');
  const [changingNumber, setChangingNumber] = React.useState(false);
  const [rotatingTwilio, setRotatingTwilio] = React.useState(false);
  const [twilioValues, setTwilioValues] = React.useState<Record<string, string>>({});
  const [twilioNotice, setTwilioNotice] = React.useState<string | null>(null);
  const channelAction = useActionNotice();

  // One BYO number backs both SMS and Voice (Arch §3.1.4/§3.1.6). Derive the shared
  // number status from whichever of the two carries a connectionStatus.
  const smsChannel = luciel.channels.find((c) => c.id === 'sms');
  const voiceChannel = luciel.channels.find((c) => c.id === 'voice');
  const phoneEnabled = Boolean(smsChannel?.enabled || voiceChannel?.enabled);
  // The ONE shared phone panel renders INSIDE the first enabled phone row —
  // under the toggle it belongs to, the same inline pattern the messaging
  // surfaces use — never as a block after the whole channel list.
  const phonePanelHost: ChannelConfig['id'] | null = smsChannel?.enabled
    ? 'sms'
    : voiceChannel?.enabled
      ? 'voice'
      : null;
  const numberStatus = smsChannel?.connectionStatus ?? voiceChannel?.connectionStatus;
  const numberConfigured =
    numberStatus === 'connected' || numberStatus === 'pending_carrier_registration';
  // BYO is two steps and they are ordered: you cannot designate one of the
  // account's numbers before the account itself is on file. The Account SID is
  // the non-secret half of the credential, so its presence is the proof.
  const twilioConnected = numberConfigured || Boolean(smsConnection?.nonSecretConfig?.accountSid);
  // The saved Twilio credential stopped working (health sweep marked the row
  // expired/error, served back through the channel's connectionStatus). The
  // honest ask is new CREDENTIALS on the same row — not "add your number",
  // which is what the two-step derivation below would otherwise fall into.
  const needsCredentialRefresh =
    phoneEnabled && (numberStatus === 'expired' || numberStatus === 'error');
  const needsTwilio = phoneEnabled && !twilioConnected && !needsCredentialRefresh;
  const needsNumber =
    phoneEnabled && twilioConnected && !numberConfigured && !needsCredentialRefresh;
  const phonePending = phoneEnabled && numberStatus === 'pending_carrier_registration';
  const phoneValid = E164.test(phoneNumber.trim());
  // The number the tenant designated, read from the row that holds it — a live
  // number is shown back, not asked for again. Same destination the shared
  // control reads (contract §2).
  // A number awaiting its operability confirmation lives under
  // pendingDestination (c21 anti-squatting) — still the owner's number on file.
  const designatedNumber =
    typeof smsConnection?.nonSecretConfig?.destination === 'string'
      ? smsConnection.nonSecretConfig.destination
      : typeof smsConnection?.nonSecretConfig?.pending_destination === 'string'
        ? smsConnection.nonSecretConfig.pending_destination
        : undefined;
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
      // Rotation/repair re-credentials the EXISTING row (Arch §3.8.7 rule B):
      // reconnect stages it without dropping the live status, and the new
      // details are verified with Twilio before the row cuts over — a bad
      // paste leaves the number and the current setup exactly as they were.
      if (smsConnection && (needsCredentialRefresh || rotatingTwilio)) {
        await reconnect.mutateAsync({ connectionId: smsConnection.connectionId });
        await submitCredentials.mutateAsync({
          connectionId: smsConnection.connectionId,
          fields: twilioValues,
        });
        setTwilioValues({});
        setRotatingTwilio(false);
        return;
      }
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

  /** The number is only cleared from the field once the write is confirmed — a
   *  cleared input is the admin's only record of what they typed (P1-4). */
  const submitNumber = async () => {
    if (!phoneValid) return;
    const number = phoneNumber.trim();
    const ok = await channelAction.run(async () => {
      await startConnection.mutateAsync({
        connectionType: 'sms_sender',
        provider: 'twilio',
        phoneNumber: number,
      });
      return `${number} is on file. Voice answers on it now; SMS starts once its carrier registration verifies.`;
    }, 'We could not save that number. It has not been added — please check it and try again.');
    // Both the field and the editing state survive a failure: collapsing back to
    // the old number would hide what they typed and imply the change took.
    if (ok) {
      setPhoneNumber('');
      setChangingNumber(false);
    }
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
    // A toggle that silently fails snaps back on the next refetch with no
    // explanation, which reads as the UI ignoring the click (P1-4).
    void channelAction.run(
      async () => {
        const nextChannels = luciel.channels.map((c) => (c.id === id ? { ...c, enabled } : c));
        await updateChannels.mutateAsync(nextChannels);

        // Cascade: disabling a channel force-disables its dependent send tool (Arch §3.3).
        const dependentToolId = enabled ? undefined : CHANNEL_TOOL_CASCADE[id];
        if (dependentToolId) {
          const nextTools = luciel.tools.map((t) =>
            t.id === dependentToolId ? { ...t, enabled: false } : t,
          );
          await updateTools.mutateAsync(nextTools);
          // The tool's product label, never the raw wire id ("Send SMS", not
          // "send sms") — the one de-snaked enum that had leaked into a toast.
          return `${channelLabel[id]} is off, and ${toolMeta[dependentToolId].label} was switched off with it.`;
        }
        return `${channelLabel[id]} is ${enabled ? 'on' : 'off'}.`;
      },
      `We could not turn ${channelLabel[id]} ${enabled ? 'on' : 'off'}. Nothing was changed — please try again.`,
    );
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
    smsConfirmedRef.current = true; // the close that follows is a success, not a dismissal
    setSmsModalOpen(false);
    setSmsAckChecked(false);
  };

  return (
    <Card>
      <CardTitle>Channels your Luciel uses</CardTitle>
      <CardDescription>
        Pick how customers reach your Luciel. The website widget is on by default. For SMS and
        Voice, your business brings its own phone number — one number backs both. Connect your
        Twilio account below and name the number to turn them on.
      </CardDescription>
      {channelAction.busy && (
        <p className="mt-vm-3 text-vm-1 text-vm-text-muted" role="status">
          Saving…
        </p>
      )}
      {channelAction.notice && !channelAction.busy && (
        <Banner className="mt-vm-3" tone={channelAction.notice.tone}>
          {channelAction.notice.text}
        </Banner>
      )}
      <ul className="mt-vm-4 divide-y divide-vm-border">
        {luciel.channels.map((c) => {
          const isPhoneChannel = c.id === 'sms' || c.id === 'voice';
          const surfaces = MESSAGING_SURFACES[c.id];
          // A messaging row's status comes from the connection control, which
          // knows authorized-without-a-destination is not live (contract §2).
          const showControl = Boolean(surfaces) && c.enabled;
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
                {/* SMS and Voice run on the ONE shared BYO number, so each
                    enabled row derives its chip from that shared state — an
                    enabled row with no visible status leaves "is this live?"
                    unanswered at the toggle (honest connection states). */}
                {c.enabled && isPhoneChannel ? (
                  numberStatus === 'not_operable_hosting_required' ? (
                    <StatusChip
                      kind="action_needed"
                      detail="this number isn't in your Twilio account yet"
                    />
                  ) : needsCredentialRefresh ? (
                    /* expired → "Reconnect needed", error → "Action needed";
                       either way the fix is the same credential form below. */
                    <StatusChip
                      kind={chipKind(numberStatus) ?? 'action_needed'}
                      detail="update your Twilio credentials"
                    />
                  ) : phonePending && c.id === 'voice' ? (
                    /* 10DLC carrier registration gates TEXTING only — calls
                       already work at pending (live-caught 2026-08-18: the
                       shared chip made Voice claim it wasn't ready while it
                       was answering calls). Presentation-only split: the wire
                       status stays one value for the one shared number. */
                    <span className="inline-flex items-center gap-vm-2">
                      <StatusChip kind="connected" />
                      <span className="text-vm-0 text-vm-text-muted">
                        Calls work now; texting waits on carrier registration.
                      </span>
                    </span>
                  ) : phonePending ? (
                    <StatusChip kind="action_needed" detail="complete carrier registration" />
                  ) : needsTwilio ? (
                    <StatusChip kind="action_needed" detail="connect your Twilio account" />
                  ) : needsNumber ? (
                    <StatusChip kind="action_needed" detail="add your number" />
                  ) : (
                    <StatusChip kind="connected" />
                  )
                ) : (
                  chip && c.enabled && <StatusChip kind={chip} />
                )}
              </div>
              {/* Off + a saved connection: disabling never disconnects (Arch
                  §3.8.7), but the connect surface only renders while on — say
                  the connection survives so the owner knows re-enabling needs
                  no re-setup (or that a reconnect is waiting). */}
              {!c.enabled && offRowConnectionNote(c.connectionStatus) && (
                <p className="mt-vm-1 text-vm-0 text-vm-text-muted" role="note">
                  {offRowConnectionNote(c.connectionStatus)}
                </p>
              )}
              {showControl && surfaces && (
                <div className="mt-vm-3 grid gap-vm-4 pl-[3.5rem]">
                  {surfaces.map((surface) => (
                    <div key={surface.provider + surface.channels.join()}>
                      <ConnectionControl
                        connectionType={surface.connectionType}
                        label={surface.label}
                        purpose={surface.purpose}
                        connection={connectionFor(surface.connectionType)}
                        provider={surface.provider}
                        prerequisite={surface.prerequisite}
                        destinationField={{
                          ...surface.destination,
                          channels: surface.channels,
                        }}
                        unavailableReason={surface.unavailableReason}
                      />
                      <p className="mt-vm-2 text-vm-0 text-vm-text-muted" role="note">
                        {surface.note}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {/* The shared BYO phone setup renders INSIDE the first enabled
                  phone row, so the fields sit under the toggle that revealed
                  them instead of after the whole list. */}
              {c.id === phonePanelHost && (
                <div className="mt-vm-3 pl-[3.5rem]">
                  <PhoneNumberPanel
                    phonePending={phonePending}
                    needsTwilio={needsTwilio}
                    connectionDetail={smsConnection?.statusDetail}
                    credentialRefresh={needsCredentialRefresh}
                    rotating={rotatingTwilio}
                    onStartRotate={() => setRotatingTwilio(true)}
                    onCancelRotate={() => {
                      setRotatingTwilio(false);
                      setTwilioValues({});
                    }}
                    numberConfigured={numberConfigured}
                    designatedNumber={designatedNumber}
                    changingNumber={changingNumber}
                    onStartChange={() => setChangingNumber(true)}
                    onCancelChange={() => {
                      setChangingNumber(false);
                      setPhoneNumber('');
                    }}
                    phoneNumber={phoneNumber}
                    onPhoneNumberChange={setPhoneNumber}
                    phoneValid={phoneValid}
                    saving={channelAction.busy}
                    onSubmitNumber={() => void submitNumber()}
                    smsEnabled={Boolean(smsChannel?.enabled)}
                    twilioUnavailable={twilioUnavailable}
                    twilioFields={twilioFields}
                    twilioValues={twilioValues}
                    onTwilioValuesChange={setTwilioValues}
                    twilioNotice={twilioNotice}
                    providersError={smsProviders.isError}
                    twilioSubmitting={
                      connect.isPending || reconnect.isPending || submitCredentials.isPending
                    }
                    onSubmitTwilio={() => void submitTwilio()}
                    reverify={reverifySmsNumber}
                  />
                </div>
              )}
              {/* The other enabled phone row points at the one that hosts the
                  panel, so neither row reads as missing its setup. */}
              {isPhoneChannel &&
                c.enabled &&
                phonePanelHost !== null &&
                c.id !== phonePanelHost && (
                  <p className="mt-vm-3 pl-[3.5rem] text-vm-0 text-vm-text-muted" role="note">
                    SMS and Voice share one business number — set it up under{' '}
                    {phonePanelHost === 'sms' ? 'SMS' : 'Voice'}.
                  </p>
                )}
              {/* Luciel's work address is part of the Email channel, so it is set up
                  in this row and nowhere else (Decision #4). It stays reachable while
                  the channel is off — the address can be provisioned first — but sits
                  behind a disclosure then, so an off row does not open a full setup
                  panel the owner has not asked for. */}
              {c.id === 'email' &&
                (c.enabled ? (
                  <div className="mt-vm-3 pl-[3.5rem]">
                    <EmailChannelProvisioning emailChannelEnabled />
                  </div>
                ) : (
                  <details className="mt-vm-3 pl-[3.5rem]">
                    <summary className="cursor-pointer text-vm-1 text-vm-text-muted underline underline-offset-2">
                      Set up Luciel&apos;s email address (works before the channel is on)
                    </summary>
                    <div className="mt-vm-3">
                      <EmailChannelProvisioning emailChannelEnabled={false} />
                    </div>
                  </details>
                ))}
            </li>
          );
        })}
      </ul>

      {/* SMS hard gate — carrier registration + consent responsibility (Legal §A2/§A6). */}
      <Modal
        open={smsModalOpen}
        onOpenChange={(o) => {
          setSmsModalOpen(o);
          if (!o) {
            setSmsAckChecked(false);
            // Dismissing without acknowledging previously said NOTHING — the
            // toggle just snapped back, which read as "it won't let me enable
            // SMS" (live-caught 2026-08-18). Say why it stayed off.
            if (!smsConfirmedRef.current) {
              channelAction.setNotice({
                tone: 'info',
                text: 'SMS stays off — enabling it requires the carrier-registration acknowledgment.',
              });
            }
            smsConfirmedRef.current = false;
          }
        }}
        title="Enable SMS — carrier registration and consent"
        description="SMS is sent in your business's name, not ours. Please read this before turning it on."
        confirmLabel="Acknowledge and enable SMS"
        confirmPendingLabel="Enabling SMS…"
        confirmDisabled={!smsAckChecked}
        onConfirm={confirmSmsAck}
      >
        <div className="space-y-vm-3 text-vm-1">
          <p>
            <strong>You register with the carriers, not us.</strong> If your number isn&apos;t
            already carrier-registered, you complete the required A2P 10DLC Brand and Campaign
            registration yourself, in your own carrier account. VantageMind provides the guidance
            and verifies your number&apos;s status, but does not perform, submit, or operate the
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
            <strong>Consent and opt-out are yours.</strong> You are responsible for the lawfulness
            of your opt-in and for honoring opt-out — the consent and opt-out obligations of CASL in
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
        confirmPendingLabel="Enabling Voice…"
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
          <p>
            When you designate your number, Luciel automatically points its call, messaging, and
            call-status webhooks at the platform using your Twilio credentials — no console setup
            needed. If that ever fails, the exact addresses to set manually appear on the phone
            number panel.
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

/**
 * Props for the shared BYO phone panel. State stays in the pillar, which
 * derives the per-row SMS/Voice chips from the same values — so the panel and
 * the row chips can never disagree about the number's state.
 */
interface PhoneNumberPanelProps {
  phonePending: boolean;
  needsTwilio: boolean;
  /** The saved credential stopped working — same form, repair copy. */
  credentialRefresh: boolean;
  /** Owner-initiated rotation on a HEALTHY row — same form, rotate copy. */
  rotating: boolean;
  onStartRotate: () => void;
  onCancelRotate: () => void;
  numberConfigured: boolean;
  designatedNumber?: string;
  changingNumber: boolean;
  onStartChange: () => void;
  onCancelChange: () => void;
  phoneNumber: string;
  onPhoneNumberChange: (value: string) => void;
  phoneValid: boolean;
  saving: boolean;
  onSubmitNumber: () => void;
  smsEnabled: boolean;
  twilioUnavailable: boolean;
  twilioFields: ProviderCredentialField[];
  twilioValues: Record<string, string>;
  onTwilioValuesChange: (values: Record<string, string>) => void;
  twilioNotice: string | null;
  providersError: boolean;
  twilioSubmitting: boolean;
  onSubmitTwilio: () => void;
  reverify: ReturnType<typeof useLucielMutations>['reverifySmsNumber'];
  /** The connection row's served detail — carries the manual webhook URLs when auto-config failed. */
  connectionDetail?: string | null;
}

/**
 * The ONE shared business-number setup for SMS & Voice (Arch §3.1.4/§3.1.6,
 * Decision #48), rendered inline inside the first enabled phone row. The
 * number's status is carried by the chips beside the SMS and Voice toggles,
 * so the panel opens straight on the step the owner is being asked for.
 */
function PhoneNumberPanel({
  connectionDetail,
  phonePending,
  needsTwilio,
  credentialRefresh,
  rotating,
  onStartRotate,
  onCancelRotate,
  numberConfigured,
  designatedNumber,
  changingNumber,
  onStartChange,
  onCancelChange,
  phoneNumber,
  onPhoneNumberChange,
  phoneValid,
  saving,
  onSubmitNumber,
  smsEnabled,
  twilioUnavailable,
  twilioFields,
  twilioValues,
  onTwilioValuesChange,
  twilioNotice,
  providersError,
  twilioSubmitting,
  onSubmitTwilio,
  reverify,
}: PhoneNumberPanelProps) {
  return (
    <div className="rounded-vm-card border border-vm-border p-vm-4">
      <span className="text-vm-2 font-label">Your business phone number (SMS &amp; Voice)</span>
      {phonePending ? (
        <div className="mt-vm-2 space-y-vm-3 text-vm-1 text-vm-text-muted">
          <p>
            Your number is on file and answering phone calls. Texting waits on its A2P 10DLC
            carrier registration, which you complete yourself, in your own carrier account, in
            your business&apos;s name. VantageMind guides and verifies but never registers on your
            behalf, and no shared or platform number is used.
          </p>
          <p>
            Luciel pointed your number&apos;s call and messaging webhooks at the platform
            automatically, using your Twilio credentials — if that ever fails, the exact addresses
            to set in your Twilio Console appear right here.
          </p>
          <p>
            Nothing checks the carrier registration in the background. When you&apos;ve finished
            registering, use Re-verify and we&apos;ll read your number&apos;s current status.
          </p>
          <div className="flex flex-wrap items-center gap-vm-3">
            <Button
              variant="secondary"
              onClick={() => reverify.mutate()}
              disabled={reverify.isPending}
            >
              {reverify.isPending ? 'Re-verifying…' : 'Re-verify'}
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
          {reverify.data?.statusDetail && <p>{reverify.data.statusDetail}</p>}
          {connectionDetail?.includes("couldn't point your number") && (
            <p className="text-vm-warning">{connectionDetail}</p>
          )}
          {reverify.isError && (
            <p className="text-vm-danger">
              We couldn&apos;t reach the carrier just now. Your number is unchanged — try Re-verify
              again in a moment.
            </p>
          )}
        </div>
      ) : needsTwilio || credentialRefresh || rotating ? (
        /* The ONE Twilio credential form, three doors in (Arch §3.1.4 +
           §3.8.7 B): first connect, repair after the saved credential died,
           or an owner-initiated rotation on a healthy row. The fields are
           whatever the registry advertises, so a provider that starts asking
           for one more thing needs no frontend change. */
        <div className="mt-vm-3">
          <p className="mb-vm-3 text-vm-1 text-vm-text-muted">
            {credentialRefresh
              ? 'Twilio stopped accepting the saved credentials — this usually means the Auth Token or API Key was rotated or revoked in your Twilio Console. Enter the current details and we verify them with Twilio; your number and everything else stay exactly as they are.'
              : rotating
                ? 'Rotating your Twilio credentials? Paste the new details from your Twilio Console. Your current setup keeps working until the new details verify — nothing goes offline while you do this.'
                : 'Connect your Twilio account so Luciel can text and call from your own business number — your number stays yours and your carrier costs are billed by Twilio directly.'}
          </p>
          {providersError && (
            <Banner tone="warning">
              We could not load the Twilio form just now. Reload the page to try again.
            </Banner>
          )}
          {twilioNotice && <Banner tone="warning">{twilioNotice}</Banner>}
          {/* Honest-disabled, the same rule the shared control applies: the
              registry says no flow can be started, so there is no button to
              press (contract §1). */}
          {twilioUnavailable && (
            <p className="text-vm-1">
              Not available yet — we&apos;re finishing the Twilio connection. We&apos;ll switch this
              on as soon as it&apos;s ready; there is nothing for you to do.
            </p>
          )}
          {!twilioUnavailable && twilioFields.length > 0 && (
            <>
              <CredentialFields
                idPrefix="twilio"
                fields={twilioFields}
                values={twilioValues}
                onChange={onTwilioValuesChange}
              />
              <p className="mt-vm-2 text-vm-0 text-vm-text-muted">
                Give either your Auth Token or an API Key SID and Secret — whichever your Twilio
                account uses. Find both in the Twilio Console under Account Info.
              </p>
              <div className="mt-vm-3 flex flex-wrap items-center gap-vm-2">
                <Button
                  variant="primary"
                  onClick={onSubmitTwilio}
                  disabled={
                    twilioSubmitting || !credentialFieldsComplete(twilioFields, twilioValues)
                  }
                >
                  {twilioSubmitting
                    ? 'Verifying…'
                    : credentialRefresh || rotating
                      ? 'Verify and save'
                      : 'Connect Twilio account'}
                </Button>
                {rotating && (
                  <Button variant="ghost" onClick={onCancelRotate} disabled={twilioSubmitting}>
                    Keep current credentials
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      ) : numberConfigured && !changingNumber ? (
        /* Step two is done: show the designated number back instead of
           asking for one that is already on file (Arch §3.1.4). Changing it
           is the same field, revealed on demand — the switch-account
           pattern the shared control uses. */
        <div className="mt-vm-3 flex flex-wrap items-center justify-between gap-vm-3">
          <p className="text-vm-1 text-vm-text-muted">
            {designatedNumber ? (
              <>
                Luciel texts and calls from{' '}
                <span className="font-label text-vm-text">{designatedNumber}</span>
              </>
            ) : (
              'Luciel texts and calls from your designated business number'
            )}{' '}
            — your own number on your own Twilio account.
          </p>
          <div className="flex flex-wrap items-center gap-vm-2">
            <Button variant="ghost" onClick={onStartChange}>
              Change number
            </Button>
            {/* Credential rotation without a teardown (Arch §3.8.7 B): owners
                who rotate their Auth Token in the Twilio Console update it here
                in place — no disconnect, no number re-entry, no downtime. */}
            <Button variant="ghost" onClick={onStartRotate}>
              Update Twilio credentials
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-vm-3">
          <p className="mb-vm-3 text-vm-1 text-vm-text-muted">
            Your Twilio account is connected. Tell us which of its numbers Luciel uses, in E.164
            format (e.g. +14155551234). Your Luciel sends and receives on this number; the platform
            never provisions one for you.
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
                    onChange={(e) => onPhoneNumberChange(e.target.value)}
                    placeholder="+14155551234"
                  />
                )}
              </Field>
            </div>
            <Button
              variant="primary"
              onClick={onSubmitNumber}
              disabled={!phoneValid || saving}
              className="mb-vm-4"
            >
              {saving ? 'Saving…' : changingNumber ? 'Save number' : 'Add number'}
            </Button>
            {changingNumber && (
              <Button variant="ghost" onClick={onCancelChange} className="mb-vm-4">
                Keep this number
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Durable SMS disclosure — the enablement modal is one-off, this is not
          (Legal §A2/§A6, Arch §3.4.2). */}
      {smsEnabled && (
        <p className="mt-vm-4 border-t border-vm-border pt-vm-3 text-vm-0 text-vm-text-muted">
          On SMS you are the sender of record: carrier registration and fees are yours, and so is
          lawful opt-in and honoring opt-out under CASL and, where applicable, the TCPA. The
          platform honors STOP and HELP automatically at the channel layer, and the first outbound
          message to a recipient carries an AI-identity and STOP notice.
        </p>
      )}
    </div>
  );
}
