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
  type ProviderOption,
} from '@luciel/api-client';
import {
  useConnectionLifecycle,
  useConnectionProviders,
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
      return `connect ${label}`;
    case 'error':
      return `${label} is having trouble`;
    case 'revoked':
      return `reconnect ${label}`;
    default:
      return undefined;
  }
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
  const { connect, switchTo, reconnect, disconnect, bindDestination, submitCredentials } =
    useConnectionLifecycle();

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

  const metaChannels = destinationField?.channels ?? [];
  const unboundChannels = metaChannels.filter((c) => !boundDestination(connection, [c]));
  const destination = boundDestination(connection, metaChannels);
  // Contract §2 UI rule: connected without a destination is NOT live.
  const needsDestination = Boolean(destinationField) && status === 'connected' && !destination;
  const isLive = status === 'connected' && !needsDestination;
  const busy =
    connect.isPending ||
    switchTo.isPending ||
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
   */
  const runFlow = async (flow: Promise<StartedConnectFlow>) => {
    setNotice(null);
    try {
      const start = await flow;
      if (start.requiresClientForm || isCredentialForm) {
        const connectionId = start.connectionId ?? connection?.connectionId;
        if (!connectionId) {
          say('danger', `We could not start the connection for ${providerName}. Please try again.`);
          return;
        }
        await submitCredentials.mutateAsync({ connectionId, fields: credentials });
        setCredentials({});
        setSwitching(false);
        say('info', `${providerName} is connected. Your details are stored in the secrets vault.`);
        return;
      }
      const explanation = authorizeOrExplain({
        ...start,
        provider: selectedProvider ?? '',
        label: providerName,
        callbackKind: 'connection',
      });
      if (explanation) say('danger', explanation);
    } catch (err) {
      failed(err, `We could not connect ${providerName}. Please try again.`);
    }
  };

  const beginConnect = () => {
    if (!selectedProvider) return;
    // An existing row is re-credentialed in place: switch when the account or
    // provider is changing, reconnect when it is the same one expiring.
    if (connection && (boundElsewhere || switching)) {
      void runFlow(
        switchTo.mutateAsync({
          connectionId: connection.connectionId,
          provider: selectedProvider === connection.provider ? null : selectedProvider,
        }),
      );
      setSwitching(false);
      return;
    }
    if (connection && (status === 'expired' || status === 'error')) {
      void runFlow(reconnect.mutateAsync({ connectionId: connection.connectionId }));
      return;
    }
    void runFlow(connect.mutateAsync({ connectionType, provider: selectedProvider }));
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
    if (status === 'expired' || status === 'error') return `Reconnect ${providerName}`;
    return `Connect ${providerName}`;
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
        {needsDestination ? (
          <StatusChip kind="action_needed" detail="name the id Luciel answers on" />
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

      {/* Server-derived, read-only: why the dependent tool is being held off. */}
      {disabledReason && !isLive && (
        <p className="text-vm-0 text-vm-text-muted" role="note">
          {disabledReason.startsWith('connection_disconnected')
            ? `Luciel cannot use this until you connect ${label} again.`
            : `Held off by ${label}: ${disabledReason}.`}
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
      {(!isLive || switching) && nothingAvailable && (
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

      {/* Provider CHOICE (Decision #6) — shown while connecting or switching. */}
      {(!isLive || switching) && !nothingAvailable && !pinned && choices.length > 1 && (
        <fieldset className="rounded-vm-card border border-vm-border p-vm-3">
          <legend className="px-vm-1 text-vm-1 font-label">Choose how to connect {label}</legend>
          <div className="grid gap-vm-2">
            {choices.map((option) => (
              <ProviderChoice
                key={option.provider}
                option={option}
                name={`provider-${connectionType}`}
                checked={option.provider === selectedProvider}
                onSelect={() => {
                  setChosen(option.provider);
                  setCredentials({});
                }}
              />
            ))}
          </div>
        </fieldset>
      )}

      {/* credential_form providers collect the customer's own details instead of
          a sign-in, and those details are saved to this connection (§1a). */}
      {(!isLive || switching) && !nothingAvailable && isCredentialForm && !providedElsewhere && (
        <div className="rounded-vm-card border border-vm-border p-vm-3">
          <CredentialFields
            idPrefix={connectionType}
            fields={credentialFields}
            values={credentials}
            onChange={setCredentials}
          />
        </div>
      )}

      {(!isLive || switching) && !nothingAvailable && (
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
          {switching && (
            <Button variant="ghost" onClick={() => setSwitching(false)} disabled={busy}>
              Keep the current one
            </Button>
          )}
          {selectedOption?.configured === false && (
            <span className="text-vm-0 text-vm-text-muted">
              {providerName} isn&apos;t available yet — pick another option for now.
            </span>
          )}
          {selectedOption?.helpText && selectedOption.configured && !providedElsewhere && (
            <span className="text-vm-0 text-vm-text-muted">{selectedOption.helpText}</span>
          )}
        </div>
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

function ProviderChoice({
  option,
  name,
  checked,
  onSelect,
}: {
  option: ProviderOption;
  name: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <label className="flex items-start gap-vm-2 text-vm-1">
      <input
        type="radio"
        name={name}
        className="mt-1 h-4 w-4"
        checked={checked}
        disabled={!option.configured}
        onChange={onSelect}
      />
      <span>
        <span className={option.configured ? undefined : 'text-vm-text-muted'}>
          {option.displayName}
        </span>
        {!option.configured && <span className="text-vm-text-muted"> — not available yet</span>}
        <span className="block text-vm-0 text-vm-text-muted">{option.helpText}</span>
      </span>
    </label>
  );
}
