'use client';

import * as React from 'react';
import { Banner, Button, Field, Input, Modal, StatusChip } from '@luciel/ui';
import {
  LucielApiError,
  type AddonToolId,
  type ChannelId,
  type Connection,
  type ConnectionStatus,
  type ConnectionType,
  type MetaChannel,
} from '@luciel/api-client';
import {
  useConnectionLifecycle,
  useConnectionProviders,
  useSwapConnection,
  type StartedConnectFlow,
} from '@/lib/hooks';
import { authorizeOrExplain } from '@/lib/oauth-connect';
import type { ActionNotice } from '@/lib/use-action-notice';
import { CredentialFields, credentialFieldsComplete } from './credential-fields';
import { channelLabel, chipKind, toolMeta } from './labels';
import { boundDestination } from './messaging-surfaces';

/**
 * THE connection control (Decisions #5 + #6). Every external connection — each
 * tool's and each channel's — gets the same lifecycle on the same surface:
 *
 *   choose a provider → Connect → (Connected / Action needed / Reconnect needed)
 *   → Switch account or provider → Disconnect
 *
 * Three things are deliberately NOT per-vendor here. The provider CHOICES come
 * from `GET /connections/providers` for THIS connection type and no other — a
 * CRM picker never offers a calendar. The status comes from the connection row,
 * because only the provider round-trip can make a connection real (Arch §3.8.7).
 * And a provider the platform cannot start a flow for (`configured: false`)
 * renders as a disabled "Not available yet" row with a plain reason: a connect
 * button that redirects into a broken OAuth is worse than no button at all.
 */

export interface ConnectionControlProps {
  connectionType: ConnectionType;
  /** Owner-facing name of what is being connected, e.g. "a calendar", "WhatsApp". */
  label: string;
  /**
   * One purpose-built sentence in the customer's words: what this connection
   * lets Luciel do, and that it runs on THEIR account. Generic "Connect
   * [account]" tells the owner nothing about what they are agreeing to.
   */
  purpose?: string;
  /** The row backing this connection today, if there is one. */
  connection?: Connection;
  /**
   * Pins the provider instead of letting the owner pick — a messaging surface
   * implies its provider. The pinned option is still read from the registry, so
   * `configured: false`, or the registry not carrying it, still disables it.
   */
  provider?: string;
  /**
   * What the owner must already have before the provider's sign-in can succeed.
   * Shown only before it has, since a prerequisite met is not news — and a
   * prerequisite discovered halfway through someone else's consent screen is
   * the failure this exists to prevent.
   */
  prerequisite?: string;
  /** Used when the registry offers no choice for this type (email sender, webhook). */
  fallbackProvider?: string;
  /**
   * Collect the destination this surface answers on once connected (contract
   * §2). `channels` names which of the grant's channels this row binds, so
   * binding one never unbinds another.
   */
  destinationField?: { label: string; hint: string; channels?: MetaChannel[] };
  /** Plain reason shown when nothing here can be connected yet (honest-disabled). */
  unavailableReason?: string;
  /** Server-derived hold-off reason from the dependent tool (read-only, contract §3). */
  disabledReason?: string | null;
}

/** Chip detail per raw status, so "Action needed" always says what to do. */
function chipDetail(status: ConnectionStatus | undefined, label: string): string | undefined {
  switch (status) {
    case undefined:
    case 'unconfigured':
    case 'not_connected':
    // `revoked` is terminal — the credential is gone, so the honest action is a
    // fresh connect. The detail previously said "reconnect …" beside a button
    // that said (and did) "Connect …": the chip and the button now agree.
    case 'revoked':
      return `connect ${label}`;
    case 'error':
      return `${label} is having trouble`;
    // Downgrade grace (billing): the backend refuses a connect on a dormant row
    // until a payment method is added, so the honest ask is the card — never a
    // Connect button that would be refused.
    case 'dormant':
      return 'paused until a payment method is added';
    default:
      return undefined;
  }
}

/**
 * The served `statusDetail` for a NOT-live row (round 5, contract item 3):
 * the backend's own words about why, rendered as a muted note. Two exceptions
 * never render: the internal `reconnect_pending:` staged-swap marker, and the
 * raw `*_disconnected` enums the disabledReason block already translates.
 * A sentence (contains a space) renders verbatim; a lone snake_case token is
 * de-snaked so a wire enum never reaches the owner as-is.
 */
function statusDetailNote(detail: string | null | undefined): string | null {
  const trimmed = detail?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('reconnect_pending:')) return null;
  if (/^[a-z0-9]+(?:_[a-z0-9]+)*_disconnected$/.test(trimmed)) return null;
  if (trimmed.includes(' ')) return trimmed;
  const words = trimmed.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Human names for whatever a disconnect took down with it (contract §1). */
function disabledSummary(tools: string[], channels: string[]): string | null {
  const names = [
    ...tools.map((id) => toolMeta[id as AddonToolId]?.label ?? id),
    ...channels.map((id) => channelLabel[id as ChannelId] ?? id),
  ];
  if (names.length === 0) return null;
  return `Switched off too: ${names.join(', ')}. Turn them back on after you reconnect.`;
}

/**
 * The fixed CRM field mapping, disclosed after connect (Phase 6.5 — the Customer
 * Journey's "confirms the field mapping" beat). Read-only on purpose: honesty
 * about what is written, not a mapping editor.
 */
function crmMappingCopy(provider: string | undefined): string | null {
  if (provider === 'hubspot') {
    return (
      'What Luciel writes: one HubSpot contact per lead, keyed by the lead’s email. ' +
      'It records the facts captured in conversation (name, phone, what they asked for) ' +
      'and updates that same contact as new facts surface — never a duplicate, and it ' +
      'never reads your CRM. Erasing or pruning a lead here does not delete the record ' +
      'inside your CRM.'
    );
  }
  if (provider === 'salesforce') {
    return (
      'What Luciel writes: one Salesforce Lead per person, keyed by the lead’s email. ' +
      'A captured name and business fill Last Name and Company — Salesforce requires ' +
      'both at record creation, so a brand-new record without them says “Unknown” — ' +
      'later updates only touch facts that changed and never overwrite what you’ve ' +
      'edited in Salesforce. Phone and other facts ride along, and the same Lead is ' +
      'updated as new facts surface — never a duplicate, and it never reads your CRM. ' +
      'Erasing or pruning a lead here does not delete the record inside your CRM.'
    );
  }
  if (provider === 'custom_webhook') {
    return (
      'What Luciel sends: each captured lead’s stable key (their email) plus the facts ' +
      'from the conversation, delivered to your endpoint. The key is how your system ' +
      'recognizes the same lead again — deduping is your endpoint’s half of the contract. ' +
      'Erasing or pruning a lead here does not delete the record inside your CRM.'
    );
  }
  return null;
}

/**
 * WHOSE account is connected, in the provider's own words (round 6 WP-C): the
 * post-exchange verifier writes `connectedAs` — the Salesforce org, HubSpot
 * portal, Notion workspace, Google account, Meta user, mailbox — into the row's
 * non-secret config. Never derived here; absent means the verifier had nothing
 * to say (a legacy row, a credential form).
 */
function connectedAs(connection: Connection | undefined): string | null {
  const value = connection?.nonSecretConfig?.connectedAs;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function ConnectionControl({
  connectionType,
  label,
  purpose,
  connection,
  provider,
  prerequisite,
  fallbackProvider,
  destinationField,
  unavailableReason,
  disabledReason,
}: ConnectionControlProps) {
  const providers = useConnectionProviders(connectionType);
  const { connect, reconnect, disconnect, bindDestination, submitCredentials } =
    useConnectionLifecycle();
  // Switching accounts/providers rides the proven-before-cutover SWAP (Arch
  // §3.8.7 B), the same flow Overview's "Change connected account" uses — the
  // live connection keeps serving until the replacement verifies. The old
  // switch endpoint disconnected FIRST, so abandoning the new provider's
  // consent screen left the tool dead until a manual reconnect (live-caught
  // on the 2026-08-23 dev walkthrough).
  const swap = useSwapConnection();

  // ONLY this connection type's providers, matched by type rather than taken
  // positionally: the first group in the response is not necessarily ours.
  const options =
    providers.data?.find((group) => group.connectionType === connectionType)?.providers ?? [];
  const pinned = provider ? options.find((o) => o.provider === provider) : undefined;
  const choices = pinned ? [pinned] : options;
  const connectable = choices.filter((o) => o.configured);
  // A pinned provider the registry does not carry at all cannot be started
  // either, so it is the same honest-disabled case as `configured: false` — not
  // a connect button that dead-ends on "Action needed" after the click. Waits
  // for the read to settle, so a loading registry does not read as unavailable.
  const pinnedMissing = Boolean(provider) && providers.isSuccess && !pinned;
  const nothingAvailable = connectable.length === 0 && (choices.length > 0 || pinnedMissing);

  const [chosen, setChosen] = React.useState<string | null>(null);
  /** Failures were rendered in the same calm info tone as successes, so "we
   *  could not connect" looked like "connected" (P2-8). */
  const [notice, setNotice] = React.useState<ActionNotice | null>(null);
  const say = (tone: ActionNotice['tone'], text: string) => setNotice({ tone, text });
  const [switching, setSwitching] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [credentials, setCredentials] = React.useState<Record<string, string>>({});
  const [destinationValue, setDestinationValue] = React.useState('');

  const selectedProvider =
    provider ??
    chosen ??
    connection?.provider ??
    connectable[0]?.provider ??
    choices[0]?.provider ??
    fallbackProvider;
  const selectedOption = choices.find((o) => o.provider === selectedProvider);
  const providerName = selectedOption?.displayName ?? label;
  // A credential_form provider with no fields is not connected from here at all
  // (CSV lives under Knowledge) — say where it happens instead of offering a
  // button that would be refused.
  const isCredentialForm = selectedOption?.authKind === 'credential_form';
  const credentialFields = selectedOption?.credentialFields ?? [];
  const providedElsewhere = isCredentialForm && credentialFields.length === 0;

  // A pinned provider that is not the one currently connected means this surface
  // is asking for a different grant than the row holds (an older Meta provider
  // id, say) — that transition is a switch.
  const boundElsewhere = Boolean(provider && connection && connection.provider !== provider);
  const status = boundElsewhere ? undefined : connection?.status;
  // Phase 4 (owner concern #8): ≥2 connectable providers render provider-named
  // connect buttons; the generic action row survives only for a chosen
  // credential form.
  const multiConnect = !pinned && connectable.length > 1;

  const metaChannels = destinationField?.channels ?? [];
  const unboundChannels = metaChannels.filter((c) => !boundDestination(connection, [c]));
  const destination = boundDestination(connection, metaChannels);
  // Contract §2 UI rule: connected without a destination is NOT live.
  const needsDestination = Boolean(destinationField) && status === 'connected' && !destination;
  const isLive = status === 'connected' && !needsDestination;
  // Downgrade grace: the backend refuses connects on a dormant row (validation
  // error naming the free allowance), so no connect/switch surface renders —
  // the chip's billing note is the honest action instead of a dead button.
  const isDormant = status === 'dormant';
  const offerConnect = (!isLive || switching) && !isDormant;
  const busy =
    connect.isPending ||
    swap.isPending ||
    reconnect.isPending ||
    disconnect.isPending ||
    submitCredentials.isPending;

  const failed = (err: unknown, fallbackMessage: string) =>
    say('danger', err instanceof LucielApiError ? err.message : fallbackMessage);

  /**
   * One connect action for both classes. An OAuth provider is handed to the
   * consent screen; a credential_form provider's details are sent to the row
   * the start just created, so the flow finishes here instead of dead-ending on
   * "we cannot store these yet".
   *
   * `flowProvider`/`flowName`/`flowIsCredentialForm` are passed EXPLICITLY (C9
   * follow-on, Phase 4): the provider-named connect buttons start a flow for the
   * option they name in the same click, so the flow must not read the selection
   * state that click has only just scheduled.
   */
  const runFlow = async (
    flow: Promise<StartedConnectFlow>,
    flowProvider: string,
    flowName: string,
    flowIsCredentialForm: boolean,
  ) => {
    setNotice(null);
    try {
      const start = await flow;
      if (start.requiresClientForm || flowIsCredentialForm) {
        const connectionId = start.connectionId ?? connection?.connectionId;
        if (!connectionId) {
          say('danger', `We could not start the connection for ${flowName}. Please try again.`);
          return;
        }
        await submitCredentials.mutateAsync({ connectionId, fields: credentials });
        setCredentials({});
        setSwitching(false);
        say('info', `${flowName} is connected. Your details are stored in the secrets vault.`);
        return;
      }
      const explanation = authorizeOrExplain({
        ...start,
        provider: flowProvider,
        label: flowName,
        callbackKind: 'connection',
      });
      if (explanation) say('danger', explanation);
    } catch (err) {
      failed(err, `We could not connect ${flowName}. Please try again.`);
    }
  };

  const beginConnectFor = (targetProvider: string) => {
    const targetOption = choices.find((o) => o.provider === targetProvider);
    const targetName = targetOption?.displayName ?? label;
    const targetIsCredentialForm = targetOption?.authKind === 'credential_form';
    // An existing row is re-credentialed in place: SWAP when the account or
    // provider is changing (staged alongside the live one; cutover only after
    // the replacement verifies), reconnect when it is the same one expiring.
    if (connection && (boundElsewhere || switching)) {
      const held = connection.connectionId;
      void runFlow(
        swap
          .mutateAsync({ connectionId: held, provider: targetProvider })
          .then((res) => ({ ...res, connectionId: held })),
        targetProvider,
        targetName,
        targetIsCredentialForm,
      );
      setSwitching(false);
      return;
    }
    if (connection && (status === 'expired' || status === 'error')) {
      void runFlow(
        reconnect.mutateAsync({ connectionId: connection.connectionId }),
        targetProvider,
        targetName,
        targetIsCredentialForm,
      );
      return;
    }
    void runFlow(
      connect.mutateAsync({ connectionType, provider: targetProvider }),
      targetProvider,
      targetName,
      targetIsCredentialForm,
    );
  };

  const beginConnect = () => {
    if (!selectedProvider) return;
    beginConnectFor(selectedProvider);
  };

  const confirmDisconnect = async () => {
    if (!connection) return;
    setNotice(null);
    try {
      const result = await disconnect.mutateAsync({ connectionId: connection.connectionId });
      const consequence = disabledSummary(result.disabledTools, result.disabledChannels);
      say(
        'info',
        [`${providerName} is disconnected and its saved credentials were deleted.`, consequence]
          .filter(Boolean)
          .join(' '),
      );
    } catch (err) {
      failed(err, `We could not disconnect ${providerName}. Please try again.`);
    } finally {
      setConfirmOpen(false);
    }
  };

  const saveDestination = async () => {
    if (!connection) return;
    setNotice(null);
    try {
      await bindDestination.mutateAsync({
        connectionId: connection.connectionId,
        destination: destinationValue.trim(),
        channels: unboundChannels.length > 0 ? unboundChannels : metaChannels,
      });
      setDestinationValue('');
    } catch (err) {
      failed(err, `We could not save that id for ${label}. Please try again.`);
    }
  };

  const connectLabel = () => {
    if (busy) return isCredentialForm ? 'Saving…' : 'Opening sign-in…';
    if (boundElsewhere || switching) return `Switch to ${providerName}`;
    // Connect/Reconnect name the CHANNEL the owner is lighting up ("Connect
    // WhatsApp"), not the vendor behind it ("Connect Meta") — the surface copy
    // below already explains that one Meta sign-in powers its sibling channel.
    // In the multi-provider credential sub-flow the button submits the CHOSEN
    // provider's details, so it names that provider (Phase 4).
    if (status === 'expired' || status === 'error') return `Reconnect ${label}`;
    return multiConnect ? `Connect ${providerName}` : `Connect ${label}`;
  };

  return (
    <div className="space-y-vm-3">
      {purpose && <p className="text-vm-1 text-vm-text-muted">{purpose}</p>}

      {prerequisite && status !== 'connected' && (
        <p className="text-vm-0 text-vm-text-muted" role="note">
          {prerequisite}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-vm-3">
        {needsDestination && destinationField ? (
          /* Name the surface's OWN id field: three Meta rows each owe a
             different id, and a generic "name the id" chip cannot tell the
             owner which of the three they are being asked for. */
          <StatusChip kind="action_needed" detail={`add the ${destinationField.label}`} />
        ) : (
          <StatusChip
            kind={chipKind(status) ?? 'action_needed'}
            detail={chipDetail(status, label)}
          />
        )}
        {isLive && (
          <>
            <Button variant="ghost" onClick={() => setSwitching(true)} disabled={busy || switching}>
              {choices.length > 1 ? 'Switch account or provider' : 'Switch account'}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmOpen(true)} disabled={busy}>
              Disconnect
            </Button>
          </>
        )}
      </div>

      {/* The server's own words about a not-live row (round 5, item 3):
          `statusDetail` renders as a muted note under the chip, minus the
          internal reconnect_pending marker and the `*_disconnected` enums the
          disabledReason note below already translates. */}
      {!isLive && statusDetailNote(connection?.statusDetail) && (
        <p className="text-vm-0 text-vm-text-muted" role="note">
          {statusDetailNote(connection?.statusDetail)}
        </p>
      )}

      {/* CRM field-mapping disclosure (Phase 6.5, Customer Journey "confirms
          the field mapping"): once connected, say exactly WHAT Luciel writes
          and how it dedupes — read-only, because the mapping is fixed. */}
      {connectionType === 'crm' && isLive && crmMappingCopy(connection?.provider) && (
        <p className="text-vm-0 text-vm-text-muted" role="note">
          {crmMappingCopy(connection?.provider)}
        </p>
      )}

      {/* Round 6 WP-C: the verifier's own account line, shown only while live — a
          stale identity under an error chip would read as a working connection. */}
      {isLive && connectedAs(connection) && (
        <p className="text-vm-0 text-vm-text-muted" role="note" data-testid="connected-as">
          Connected as {connectedAs(connection)}.
        </p>
      )}

      {/* Server-derived, read-only: why the dependent tool is being held off.
          The server writes `{connection_type}_disconnected` (service.py) — the
          old prefix match never fired, so the raw enum reached the owner
          ("Held off by your CRM: crm_disconnected", live-caught 2026-08-23).
          Unknown future reasons are de-snaked, never shown as wire enums. */}
      {disabledReason && !isLive && (
        <p className="text-vm-0 text-vm-text-muted" role="note">
          {disabledReason.endsWith('_disconnected')
            ? `Luciel cannot use this until you connect ${label} again.`
            : `Held off by ${label}: ${disabledReason.replace(/_/g, ' ')}.`}
        </p>
      )}

      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}

      {providers.isError && (
        <Banner tone="warning">
          We could not load the {label} options just now. Reload the page to try again.
        </Banner>
      )}

      {/* Honest-disabled: nothing here can be connected yet, so there is no
          connect button to press. The choices stay visible so the owner can see
          what this will offer (contract §1). */}
      {offerConnect && nothingAvailable && (
        <div className="rounded-vm-card border border-vm-border p-vm-3">
          <p className="text-vm-1">
            Not available yet
            {unavailableReason ? ` — ${unavailableReason}` : ''}. We&apos;ll switch this on as soon
            as it&apos;s ready — there is nothing for you to do.
          </p>
          <ul className="mt-vm-2 grid gap-vm-1 text-vm-0 text-vm-text-muted">
            {choices.map((option) => (
              <li key={option.provider}>
                {option.displayName} — {option.helpText}
              </li>
            ))}
          </ul>
          {switching && (
            <Button
              variant="ghost"
              className="mt-vm-2"
              onClick={() => setSwitching(false)}
              disabled={busy}
            >
              Keep the current one
            </Button>
          )}
        </div>
      )}

      {/* Provider CHOICE (Decision #6, reworked audit round 3 Phase 4 — owner
          concern #8): with TWO OR MORE connectable providers, each gets its OWN
          named connect button ("Connect Google Calendar", "Connect HubSpot") —
          no radio-then-generic-button two-step. An OAuth provider starts its
          sign-in on the click; a credential_form provider's click reveals its
          details form below. Not-yet-available options are listed quietly as
          information, never as disabled controls. */}
      {offerConnect && !nothingAvailable && !pinned && connectable.length > 1 && (
        <div className="rounded-vm-card border border-vm-border p-vm-3">
          {/* Proven-before-cutover reassurance (Arch §3.8.7 B): the switch is
              staged, so abandoning the new provider's sign-in costs nothing. */}
          {switching && (
            <p className="mb-vm-2 text-vm-0 text-vm-text-muted">
              Your current connection stays live until the new one is verified — backing out of
              the sign-in changes nothing.
            </p>
          )}
          <div className="grid gap-vm-2">
            {connectable.map((option) => (
              <div key={option.provider} className="flex flex-wrap items-center gap-vm-2">
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setChosen(option.provider);
                    setCredentials({});
                    if (option.authKind !== 'credential_form') {
                      beginConnectFor(option.provider);
                    }
                  }}
                >
                  {busy
                    ? 'Working…'
                    : boundElsewhere || switching
                      ? `Switch to ${option.displayName}`
                      : `Connect ${option.displayName}`}
                </Button>
                <span className="text-vm-0 text-vm-text-muted">{option.helpText}</span>
              </div>
            ))}
          </div>
          {choices.some((o) => !o.configured) && (
            <ul className="mt-vm-2 grid gap-vm-1 text-vm-0 text-vm-text-muted">
              {choices
                .filter((o) => !o.configured)
                .map((o) => (
                  <li key={o.provider}>
                    {o.displayName} — coming soon. {o.helpText}
                  </li>
                ))}
            </ul>
          )}
          {switching && (
            <Button
              variant="ghost"
              className="mt-vm-2"
              onClick={() => setSwitching(false)}
              disabled={busy}
            >
              Keep the current one
            </Button>
          )}
        </div>
      )}

      {/* credential_form providers collect the customer's own details instead of
          a sign-in, and those details are saved to this connection (§1a). With
          multiple connectable providers the form appears only after its named
          button was pressed (chosen), never as a default-open form. */}
      {offerConnect &&
        !nothingAvailable &&
        isCredentialForm &&
        !providedElsewhere &&
        (!multiConnect || chosen !== null) && (
          <div className="rounded-vm-card border border-vm-border p-vm-3">
            <CredentialFields
              idPrefix={connectionType}
              fields={credentialFields}
              values={credentials}
              onChange={setCredentials}
            />
          </div>
        )}

      {/* The single action row. With multiple connectable providers the named
          buttons above ARE the action, so this renders only to submit a chosen
          credential form. */}
      {offerConnect &&
        !nothingAvailable &&
        (!multiConnect || (chosen !== null && isCredentialForm && !providedElsewhere)) && (
          <div className="flex flex-wrap items-center gap-vm-2">
            {providedElsewhere ? (
              <span className="text-vm-1 text-vm-text-muted">{selectedOption?.helpText}</span>
            ) : (
              <Button
                variant="secondary"
                onClick={beginConnect}
                disabled={
                  busy ||
                  !selectedProvider ||
                  selectedOption?.configured === false ||
                  !credentialFieldsComplete(credentialFields, credentials)
                }
              >
                {connectLabel()}
              </Button>
            )}
            {switching && !multiConnect && (
              <Button variant="ghost" onClick={() => setSwitching(false)} disabled={busy}>
                Keep the current one
              </Button>
            )}
            {selectedOption?.configured === false && (
              <span className="text-vm-0 text-vm-text-muted">
                {providerName} isn&apos;t available yet — pick another option for now.
              </span>
            )}
            {selectedOption?.helpText &&
              selectedOption.configured &&
              !providedElsewhere &&
              !multiConnect && (
                <span className="text-vm-0 text-vm-text-muted">{selectedOption.helpText}</span>
              )}
          </div>
        )}

      {/* With a single connectable provider the radios are gone, but the owner
          should still see what else is on the way — as information, not as a
          disabled control pretending to be a choice. */}
      {offerConnect &&
        !nothingAvailable &&
        !pinned &&
        connectable.length === 1 &&
        choices.some((o) => !o.configured) && (
          <ul className="grid gap-vm-1 text-vm-0 text-vm-text-muted">
            {choices
              .filter((o) => !o.configured)
              .map((o) => (
                <li key={o.provider}>
                  {o.displayName} — coming soon. {o.helpText}
                </li>
              ))}
          </ul>
        )}

      {/* Destination step: connected is not live until this is bound (§2). */}
      {needsDestination && destinationField && (
        <div className="rounded-vm-card border border-vm-border p-vm-3">
          <p className="text-vm-1">
            {providerName} is authorized. Tell us which one {label} answers on — messages to any
            other one are dropped, because that id is how we route them to you.
          </p>
          <div className="mt-vm-3 flex items-end gap-vm-2">
            <div className="flex-1">
              <Field
                id={`${connectionType}-${metaChannels[0] ?? 'destination'}`}
                label={destinationField.label}
                hint={destinationField.hint}
              >
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    value={destinationValue}
                    onChange={(e) => setDestinationValue(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Button
              variant="primary"
              className="mb-vm-4"
              onClick={() => void saveDestination()}
              disabled={!destinationValue.trim() || bindDestination.isPending}
            >
              {bindDestination.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      )}

      {isLive && destination && (
        <p className="text-vm-0 text-vm-text-muted">
          Answering on <span className="font-label">{destination}</span>.
        </p>
      )}

      <Modal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Disconnect ${providerName}?`}
        description="We delete the saved credentials and hand the account back. Anything that runs on this connection stops until you connect again."
        confirmLabel={disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
        confirmVariant="danger"
        confirmDisabled={disconnect.isPending}
        onConfirm={() => void confirmDisconnect()}
      >
        <p className="text-vm-1">
          You can reconnect this later — the connection stays listed. Nothing about your leads or
          conversation history changes.
        </p>
      </Modal>
    </div>
  );
}

