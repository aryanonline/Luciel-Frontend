import type { Luciel } from '@luciel/api-client';

/**
 * Owner decision D9 (round 7): the Website chat channel toggle is honoured. With it
 * off, the widget bootstrap answers renderState `channel_off` and the widget renders
 * NOTHING on the owner's site (no launcher, no error); a conversation already open
 * finishes. The dashboard says exactly that wherever the widget is presented as live.
 */
export const WIDGET_OFF_COPY =
  'Off — the widget renders nothing on your site; conversations already open finish.';

/** The served Website chat channel is switched off (absent = on, its default). */
export const widgetChannelOff = (luciel: Luciel | null | undefined): boolean =>
  luciel?.channels.find((c) => c.id === 'widget')?.enabled === false;
