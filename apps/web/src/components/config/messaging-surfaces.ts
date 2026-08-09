import type {
  ChannelConfig,
  ChannelId,
  Connection,
  ConnectionType,
  MetaChannel,
} from '@luciel/api-client';

/**
 * The messaging surfaces a channel row offers, and how to read whether one of
 * them is actually live (contract §2).
 *
 * This lives outside the pillar because the consent landing needs the same
 * answer: authorization alone does not make a Meta surface live — until its id
 * is bound, inbound has nothing to route by — so a banner that says "connected"
 * on the way back from the consent screen contradicts the card underneath it.
 */

/**
 * One messaging surface: the grant it rides, the channel it binds within that
 * grant, and the id it answers on. The owner pastes the id — there is no asset
 * picker route, and which of their numbers, Pages or accounts Luciel should
 * answer on is not ours to guess.
 */
export interface MessagingSurface {
  label: string;
  connectionType: ConnectionType;
  provider: string;
  channels: MetaChannel[];
  purpose: string;
  destination: { label: string; hint: string };
  unavailableReason: string;
  /** What connecting this one does, and does not do, to the others. */
  note: string;
  /** What the owner must already have before the sign-in can succeed at all. */
  prerequisite?: string;
}

/**
 * The surface each channel row covers — one per row (Arch §3.1.2). WhatsApp and
 * Messenger are separate rows riding the ONE Meta grant: signing in on either
 * row authorizes both, but each still binds its own id before it answers —
 * authorization shared, liveness per-row.
 */
export const MESSAGING_SURFACES: Partial<Record<ChannelId, MessagingSurface[]>> = {
  whatsapp: [
    {
      label: 'WhatsApp',
      connectionType: 'channel_auth',
      provider: 'meta',
      channels: ['whatsapp'],
      purpose:
        'Luciel replies to people who message your business on WhatsApp, from your own WhatsApp Business number — the conversation stays in your Meta account.',
      destination: {
        label: 'WhatsApp phone number ID',
        hint: 'In Meta Business Suite → WhatsApp Manager → API Setup, the "Phone number ID" (digits, not the phone number itself).',
      },
      unavailableReason: 'Meta app not configured',
      note: 'This Meta sign-in is shared with Facebook Messenger — one sign-in covers both rows, and each names its own id.',
    },
  ],
  messenger: [
    {
      label: 'Facebook Messenger',
      connectionType: 'channel_auth',
      provider: 'meta',
      channels: ['messenger'],
      purpose:
        'Luciel replies to the Messenger conversations your Facebook Page receives, from your own Meta account.',
      destination: {
        label: 'Facebook Page ID',
        hint: 'In your Facebook Page settings → About → Page ID.',
      },
      unavailableReason: 'Meta app not configured',
      // Shared authorization is NOT shared liveness: the sign-in covers both
      // rows, but Messenger answers nothing until its own Page id is bound.
      note: 'Messenger uses the same Meta sign-in as WhatsApp — signing in on either row covers both. Messenger still needs its own Facebook Page ID below before it answers.',
    },
  ],
  instagram: [
    {
      label: 'Instagram',
      connectionType: 'instagram_auth',
      provider: 'instagram',
      channels: ['instagram'],
      purpose:
        'Luciel replies to the DMs your Instagram professional account receives, from your own account. Instagram signs you in itself, separately from Facebook.',
      destination: {
        label: 'Instagram professional account ID',
        hint: 'In Meta Business Suite, open the Instagram account and read its account ID (digits) — not the @handle.',
      },
      unavailableReason: 'Instagram sign-in not configured',
      note: 'Instagram has its own sign-in, so connecting it leaves WhatsApp and Messenger exactly as they are.',
      // Instagram's Business Login accepts professional (business or creator)
      // accounts only, and a personal one is pushed into converting partway
      // through the consent screen. Said here rather than discovered there.
      prerequisite:
        'Requires an Instagram professional account — business or creator, free to switch in the Instagram app. A personal account is asked to convert partway through the sign-in.',
    },
  ],
};

/**
 * The id this connection answers on for these channels, if one is bound. Meta
 * ids are per-channel so binding one never unbinds another; `destination` is the
 * pre-per-channel single-destination shape, still honored.
 */
export function boundDestination(
  connection: Connection | undefined,
  channels: MetaChannel[],
): string | undefined {
  const config = connection?.nonSecretConfig;
  const perChannel = (config?.destinations as Record<string, string> | undefined) ?? {};
  const legacy = typeof config?.destination === 'string' ? config.destination : undefined;
  if (channels.length === 0) return legacy;
  return channels.map((c) => perChannel[c]).find(Boolean) ?? legacy;
}

/** Whether a just-authorized provider has everything it needs to answer. */
export type MessagingReadiness =
  /** Nothing further is owed — either it is live, or it binds no destination. */
  | 'ready'
  /** Authorized, but a channel below is still asking which id to answer on. */
  | 'awaiting_destination'
  /** The reads behind the answer have not settled, so claim neither. */
  | 'unknown';

/**
 * What a provider's grant is worth right now, from the data the configure
 * screen already holds. Only enabled channels count: a surface the owner has
 * not switched on is not asking them for anything.
 */
export function messagingReadiness(
  provider: string,
  channels: ChannelConfig[] | undefined,
  connections: Connection[] | undefined,
): MessagingReadiness {
  const surfaces = Object.entries(MESSAGING_SURFACES).flatMap(([channelId, list]) =>
    (list ?? [])
      .filter((surface) => surface.provider === provider)
      .map((surface) => ({ channelId: channelId as ChannelId, surface })),
  );
  // A provider that binds no destination — a calendar, a CRM — is done the
  // moment it is authorized.
  if (surfaces.length === 0) return 'ready';
  if (!channels || !connections) return 'unknown';

  let live = false;
  for (const { channelId, surface } of surfaces) {
    if (!channels.some((c) => c.id === channelId && c.enabled)) continue;
    const row = connections.find(
      (c) => c.connectionType === surface.connectionType && c.provider === provider,
    );
    if (row?.status !== 'connected') return 'unknown';
    if (!boundDestination(row, surface.channels)) return 'awaiting_destination';
    live = true;
  }
  return live ? 'ready' : 'unknown';
}
