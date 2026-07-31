'use client';

import { Card, CardTitle, CardDescription, Toggle, StatusChip, Banner } from '@luciel/ui';
import type {
  Luciel,
  AddonTool,
  AddonToolId,
  CapabilityGroup,
  ChannelId,
  Connection,
  ConnectionType,
} from '@luciel/api-client';
import { useCapabilities, useConnections, useLucielMutations } from '@/lib/hooks';
import { useActionNotice } from '@/lib/use-action-notice';
import { ConnectionControl } from './connection-control';
import { toolMeta, chipKind, channelLabel } from './labels';

/**
 * Tools pillar (Vision §3.2, Customer Journey §4.2). Two clearly-separated bands:
 *
 *  1. Always-on cognition band — NON-INTERACTIVE, no toggles. Rendered as a
 *     labeled band with the line "Every Luciel does these. There is nothing to
 *     enable" (Customer Journey §4.2).
 *  2. Add-on tools — a checklist. Switching on a tool that reaches an external
 *     system reveals an inline connection control (no separate Connections
 *     pillar — Vision §3, Arch §3.8.1). Two gates: a tool is usable only when
 *     enabled AND its connection is healthy (Arch §3.8.7).
 *
 * What the owner sees is a CAPABILITY, not our tool ids (Decision #8, contract
 * §3). `GET /luciel/capabilities` groups tool ids under one owner-facing label,
 * so "Appointment scheduling" is a single toggle plus a single connect
 * affordance for its `connectionType` — read-before-write and move/cancel are
 * mechanics of that capability, not four separate decisions. The membership is
 * SERVED: nothing here names a scheduling tool id, which is how the backend can
 * add another one without a frontend change. Tools no group claims keep their
 * individual toggles.
 *
 * Channel guards (Arch §3.3 / Decision §43): send_sms requires the SMS channel
 * enabled; send_email requires the Email channel enabled. Enabling the tool when
 * its channel is off is BLOCKED — the toggle is disabled with explanatory copy.
 * Disabling a channel cascades: its dependent send tool is force-disabled (see
 * channels-pillar.tsx cascadeDisableTools).
 */

/** Maps each send tool → the channel it depends on (Arch §3.3 / Decision §43). */
const TOOL_CHANNEL_DEPENDENCY: Partial<Record<AddonToolId, ChannelId>> = {
  send_sms: 'sms',
  send_email: 'email',
};

/**
 * Which connection an UNGROUPED tool reaches through (Arch §3.8.1). Grouped
 * tools take their connection type from the capability instead. The provider is
 * NOT named here — that choice comes from the served registry (Decision #6);
 * `fallbackProvider` is only for the types the registry offers no choice for.
 *
 * `send_email` is deliberately absent: it sends from Luciel's work address, and
 * that address has ONE home, beside the Email channel (Decision #4). A connect
 * affordance here would be a second one that could disagree with it.
 */
const TOOL_CONNECTION: Partial<
  Record<AddonToolId, { connectionType: ConnectionType; fallbackProvider?: string }>
> = {
  lookup_record: { connectionType: 'record_source' },
  push_to_crm: { connectionType: 'crm' },
  bring_your_own_webhook: { connectionType: 'outbound_webhook', fallbackProvider: 'webhook' },
};

/**
 * What connecting THIS kind of account actually buys the owner, in their words.
 * "Connect account" tells them nothing about what they are agreeing to, and the
 * same generic line under every capability is how a calendar prompt ends up
 * under a CRM. `unavailableReason` is the plain reason behind an honest-disabled
 * panel when the platform cannot start any flow for the type yet (contract §1).
 */
const CONNECTION_COPY: Partial<
  Record<ConnectionType, { connectLabel?: string; purpose: string; unavailableReason?: string }>
> = {
  calendar: {
    connectLabel: 'your calendar',
    purpose:
      'Luciel offers and books real times on your own calendar, and reads what is already there first — so it never offers a slot you are busy in.',
    unavailableReason: "we're finishing the calendar sign-in",
  },
  crm: {
    connectLabel: 'your CRM',
    purpose:
      'Every lead Luciel captures is written into your own CRM, so your pipeline stays where your team already works.',
  },
  record_source: {
    connectLabel: 'your record system',
    purpose:
      'Luciel looks answers up in your own system at the moment it is asked, so what a customer is told matches your records.',
  },
  outbound_webhook: {
    connectLabel: 'your endpoint',
    purpose:
      'Luciel posts what it captures to an endpoint you run, so you can wire it into whatever you already use.',
  },
};

const ALWAYS_ON = [
  'Capture leads into the dashboard',
  'Escalate to a real person when needed',
  'Hand off to a real person on request',
  'Summarize every conversation',
];

export function ToolsPillar({ luciel }: { luciel: Luciel }) {
  const { updateTools } = useLucielMutations();
  const capabilities = useCapabilities();
  const connections = useConnections();

  const action = useActionNotice();

  const groups = capabilities.data ?? [];
  const groupedIds = new Set(groups.flatMap((g) => g.toolIds));
  const ungrouped = luciel.tools.filter((t) => !groupedIds.has(t.id));

  const connectionFor = (connectionType: ConnectionType | null): Connection | undefined =>
    connectionType
      ? connections.data?.find((c) => c.connectionType === connectionType)
      : undefined;

  /**
   * Returns true when the tool's required channel is enabled, or when the
   * tool has no channel dependency. Used to block the toggle (Arch §3.3).
   */
  const isChannelEnabled = (id: AddonToolId): boolean => {
    const requiredChannel = TOOL_CHANNEL_DEPENDENCY[id];
    if (!requiredChannel) return true;
    const ch = luciel.channels.find((c) => c.id === requiredChannel);
    return ch?.enabled === true;
  };

  /** One PUT of the FULL tools array, whatever the owner touched (contract §3). */
  const writeEnabled = (ids: AddonToolId[], enabled: boolean, what: string) => {
    const changing = new Set<AddonToolId>(ids);
    void action.run(
      async () => {
        await updateTools.mutateAsync(
          luciel.tools.map((t) => (changing.has(t.id) ? { ...t, enabled } : t)),
        );
        return `${what} is ${enabled ? 'on' : 'off'}.`;
      },
      `We could not turn ${what} ${enabled ? 'on' : 'off'}. Nothing was changed — please try again.`,
    );
  };

  const setTool = (id: AddonToolId, enabled: boolean) => {
    // Hard-block: cannot enable a send tool when its channel is off (Arch §3.3).
    if (enabled && !isChannelEnabled(id)) return;
    writeEnabled([id], enabled, toolMeta[id].label);
  };

  return (
    <Card>
      <CardTitle>Tools your Luciel can use</CardTitle>

      {/* Always-on cognition band — non-interactive (Customer Journey §4.2). */}
      <div className="mt-vm-4 rounded-vm-card border border-vm-border bg-vm-surface p-vm-4">
        <h4 className="text-vm-1 font-label">Built in — always on</h4>
        <ul className="mt-vm-2 grid gap-vm-1 text-vm-1 text-vm-text-muted sm:grid-cols-2">
          {ALWAYS_ON.map((t) => (
            <li key={t}>• {t}</li>
          ))}
        </ul>
        <p className="mt-vm-2 text-vm-0 text-vm-text-muted">
          Every Luciel does these. There is nothing to enable — it is how Luciel works.
        </p>
      </div>

      {/* Add-on tools checklist. */}
      <CardDescription className="mt-vm-5">
        Add-on tools — switch one on, then connect the account it works through.
      </CardDescription>

      {action.busy && (
        <p className="mt-vm-3 text-vm-1 text-vm-text-muted" role="status">
          Saving…
        </p>
      )}
      {action.notice && !action.busy && (
        <Banner className="mt-vm-3" tone={action.notice.tone}>
          {action.notice.text}
        </Banner>
      )}

      {/* Without the capability list we cannot tell a grouped tool from a
          standalone one, so falling back to an empty list would present every
          capability as a bare tool id with the wrong connect affordance. Say the
          list is missing instead of quietly showing a wrong one (P1-5). */}
      {capabilities.isPending ? (
        <p className="mt-vm-3 text-vm-1 text-vm-text-muted" role="status">
          Loading your tools…
        </p>
      ) : capabilities.isError ? (
        <Banner tone="danger" className="mt-vm-3">
          We could not load your tools, so they are not shown rather than shown wrong. Nothing has
          changed about what your Luciel can do.{' '}
          <button className="underline" onClick={() => void capabilities.refetch()}>
            Try again
          </button>
        </Banner>
      ) : (
      <ul className="mt-vm-3 divide-y divide-vm-border">
        {groups.map((group) => (
          <CapabilityRow
            key={group.capability}
            group={group}
            tools={luciel.tools.filter((t) => group.toolIds.includes(t.id))}
            connection={connectionFor(group.connectionType)}
            onToggle={(enabled) => writeEnabled(group.toolIds, enabled, group.label)}
          />
        ))}

        {ungrouped.map((t) => {
          const meta = toolMeta[t.id];
          const target = TOOL_CONNECTION[t.id];
          const channelDep = TOOL_CHANNEL_DEPENDENCY[t.id];
          const channelBlocked = channelDep !== undefined && !isChannelEnabled(t.id);
          const on = t.enabled && !channelBlocked;
          const chip = target ? null : chipKind(t.connectionStatus);
          return (
            <li key={t.id} className="py-vm-3">
              <div className="flex items-start justify-between gap-vm-3">
                <div className="flex items-start gap-vm-3">
                  <Toggle
                    checked={on}
                    onChange={(next) => setTool(t.id, next)}
                    label={`Enable ${meta.label}`}
                    disabled={channelBlocked}
                  />
                  <div>
                    <div className="text-vm-2">{meta.label}</div>
                    <div className="text-vm-0 text-vm-text-muted">{meta.desc}</div>
                    {/* Channel-dependency notice — shown only when the required channel is off. */}
                    {channelBlocked && channelDep && (
                      <p className="mt-vm-1 text-vm-0 text-vm-text-muted" role="note">
                        Enable the {channelLabel[channelDep]} channel to use {meta.label}.
                      </p>
                    )}
                    {/* Sends from Luciel's work address, which is set up in one
                        place only — beside the Email channel (Decision #4). */}
                    {on && t.id === 'send_email' && t.connectionStatus !== 'connected' && (
                      <p className="mt-vm-1 text-vm-0 text-vm-text-muted" role="note">
                        Luciel sends from its own work email — finish setting that address up with
                        the Email channel above.
                      </p>
                    )}
                  </div>
                </div>
                {/* A tool with a connection gets its chip from the control below. */}
                {on && chip && <StatusChip kind={chip} />}
              </div>

              {on && target && (
                <div className="mt-vm-3 pl-[3.5rem]">
                  <ConnectionControl
                    connectionType={target.connectionType}
                    label={meta.connectLabel ?? meta.label}
                    purpose={CONNECTION_COPY[target.connectionType]?.purpose}
                    connection={connectionFor(target.connectionType)}
                    fallbackProvider={target.fallbackProvider}
                    unavailableReason={CONNECTION_COPY[target.connectionType]?.unavailableReason}
                    disabledReason={t.disabledReason}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      )}
    </Card>
  );
}

/**
 * One capability = one toggle + one connect affordance (Decision #8). A group is
 * "on" only when every tool it names is on; a partly-enabled group says so
 * rather than claiming the whole capability, because the owner asked for the
 * capability and would otherwise be told cancelling works when it does not.
 */
function CapabilityRow({
  group,
  tools,
  connection,
  onToggle,
}: {
  group: CapabilityGroup;
  tools: AddonTool[];
  connection?: Connection;
  onToggle: (enabled: boolean) => void;
}) {
  const enabled = tools.length > 0 && tools.every((t) => t.enabled);
  const partial = !enabled && tools.some((t) => t.enabled);
  // Server-derived hold-off, read-only: whichever member the server flagged.
  const disabledReason = tools.find((t) => t.disabledReason)?.disabledReason ?? null;

  return (
    <li className="py-vm-3">
      <div className="flex items-start gap-vm-3">
        <Toggle
          checked={enabled}
          onChange={onToggle}
          label={`Enable ${group.label}`}
        />
        <div className="flex-1">
          <div className="text-vm-2">{group.label}</div>
          <div className="text-vm-0 text-vm-text-muted">{group.helpText}</div>
          {partial && (
            <p className="mt-vm-1 text-vm-0 text-vm-text-muted" role="note">
              Only part of this is switched on right now — turn it on to enable all of it.
            </p>
          )}
        </div>
      </div>

      {enabled && group.connectionType && (
        <div className="mt-vm-3 pl-[3.5rem]">
          <ConnectionControl
            connectionType={group.connectionType}
            label={CONNECTION_COPY[group.connectionType]?.connectLabel ?? group.label.toLowerCase()}
            purpose={CONNECTION_COPY[group.connectionType]?.purpose}
            connection={connection}
            unavailableReason={CONNECTION_COPY[group.connectionType]?.unavailableReason}
            disabledReason={disabledReason}
          />
        </div>
      )}
    </li>
  );
}
