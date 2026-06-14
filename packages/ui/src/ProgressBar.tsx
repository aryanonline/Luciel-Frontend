import { cn } from './cn';

/**
 * ProgressBar — accessible meter for the budget bar / knowledge quota.
 * Uses role="progressbar" with aria-valuenow/min/max. The visible label is
 * always rendered alongside (color is not the only signal).
 */
export interface ProgressBarProps {
  value: number;
  max: number;
  label: string;
  /** Tone for the fill — defaults to accent; warning when near/at cap. */
  tone?: 'accent' | 'warning' | 'danger';
  className?: string;
}

const toneClass: Record<NonNullable<ProgressBarProps['tone']>, string> = {
  accent: 'bg-vm-accent',
  warning: 'bg-vm-warning',
  danger: 'bg-vm-danger',
};

export function ProgressBar({ value, max, label, tone = 'accent', className }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={className}>
      <div className="mb-vm-1 text-vm-1 text-vm-text-muted">{label}</div>
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
        className="h-2 w-full overflow-hidden rounded-vm-pill bg-vm-surface"
      >
        <div
          className={cn('h-full rounded-vm-pill', toneClass[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
