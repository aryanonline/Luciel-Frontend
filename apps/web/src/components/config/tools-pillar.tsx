'use client';

import { Card, CardTitle, CardDescription, Toggle, StatusChip, Button } from '@luciel/ui';
import type { Luciel, AddonTool } from '@luciel/api-client';
import { useLucielMutations } from '@/lib/hooks';
import { toolMeta, chipKind } from './labels';

/**
 * Tools pillar (Vision §3.2, Customer Journey §4.2). Two clearly-separated bands:
 *
 *  1. Always-on cognition band — NON-INTERACTIVE, no toggles. Rendered as a
 *     labeled band with the line "Every Luciel does these. There is nothing to
 *     enable" (Customer Journey §4.2).
 *  2. Add-on tools — a checklist. Switching on a tool that reaches an external
 *     system reveals an inline "Connect [account]" affordance (no separate
 *     Connections pillar — Vision §3, Arch §3.8.1). Two gates: a tool is usable
 *     only when enabled AND its connection is healthy (Arch §3.8.7).
 */
const ALWAYS_ON = [
  'Capture leads into the dashboard',
  'Escalate to a real person when needed',
  'Hand off to a real person on request',
  'Summarize every conversation',
];

export function ToolsPillar({ luciel }: { luciel: Luciel }) {
  const { updateTools } = useLucielMutations();

  const setTool = (id: AddonTool['id'], patch: Partial<AddonTool>) => {
    const next = luciel.tools.map((t) => (t.id === id ? { ...t, ...patch } : t));
    updateTools.mutate(next);
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
      <ul className="mt-vm-3 divide-y divide-vm-border">
        {luciel.tools.map((t) => {
          const meta = toolMeta[t.id];
          const chip = chipKind(t.connectionStatus);
          const needsConnection = Boolean(meta.connectLabel);
          const notConnected = t.connectionStatus !== 'connected';
          return (
            <li key={t.id} className="py-vm-3">
              <div className="flex items-start justify-between gap-vm-3">
                <div className="flex items-start gap-vm-3">
                  <Toggle
                    checked={t.enabled}
                    onChange={(next) => setTool(t.id, { enabled: next })}
                    label={`Enable ${meta.label}`}
                  />
                  <div>
                    <div className="text-vm-2">{meta.label}</div>
                    <div className="text-vm-0 text-vm-text-muted">{meta.desc}</div>
                  </div>
                </div>
                {t.enabled && chip && <StatusChip kind={chip} />}
              </div>

              {/* Inline "Connect [account]" — appears within the pillar (§3, §3.8.1). */}
              {t.enabled && needsConnection && notConnected && (
                <div className="mt-vm-2 flex items-center gap-vm-3 pl-[3.5rem]">
                  <Button
                    variant="secondary"
                    onClick={() => setTool(t.id, { connectionStatus: 'connected' })}
                  >
                    {t.connectionStatus === 'expired'
                      ? `Reconnect ${meta.connectLabel}`
                      : `Connect ${meta.connectLabel}`}
                  </Button>
                  <span className="text-vm-0 text-vm-text-muted">
                    A tool is usable only when it&apos;s switched on AND its connection is healthy.
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
