import { cn } from './cn';

/**
 * StatusChip — the connection-state chip (Space Instructions §4, §5; Arch
 * §3.8.1). Three customer-facing states. AA rule: color is paired with a text
 * label AND an icon — NEVER color alone. The pill radius is the locked token.
 *
 * Icons here are simple inline glyphs (no icon dependency yet); they carry
 * aria-hidden because the text label is the accessible name.
 */
export type ChipKind = 'connected' | 'action_needed' | 'reconnect_needed';

const config: Record<ChipKind, { label: string; cls: string; glyph: string }> = {
  connected: {
    label: 'Connected',
    cls: 'bg-vm-surface text-vm-success border border-vm-border',
    glyph: '✓',
  },
  action_needed: {
    label: 'Action needed',
    cls: 'bg-vm-surface text-vm-warning border border-vm-border',
    glyph: '!',
  },
  reconnect_needed: {
    label: 'Reconnect needed',
    cls: 'bg-vm-surface text-vm-danger border border-vm-border',
    glyph: '↻',
  },
};

export interface StatusChipProps {
  kind: ChipKind;
  /** Optional context appended to the label, e.g. "connect Google Calendar". */
  detail?: string;
  className?: string;
}

export function StatusChip({ kind, detail, className }: StatusChipProps) {
  const c = config[kind];
  const label = detail ? `${c.label}: ${detail}` : c.label;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-vm-1 rounded-vm-pill px-vm-3 py-vm-1 text-vm-0 font-label',
        c.cls,
        className,
      )}
    >
      <span aria-hidden="true">{c.glyph}</span>
      <span>{label}</span>
    </span>
  );
}
