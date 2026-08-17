import type {
  Account,
  CapabilityGroup,
  Luciel,
  BillingInfo,
  Connection,
  ConnectionProviders,
  EmailProvisioning,
  KnowledgeSource,
  ConversationSummary,
  Lead,
  EscalationEvent,
  AnalyticsOverview,
  AuditEvent,
} from '../schemas';

/**
 * Deterministic seed data for the mockAdapter. The mock must reproduce the
 * STATES the UI has to handle (Space Instructions §7), not just happy paths:
 * verified/unverified, healthy/expired connections, free-cap vs PAYG,
 * paused/grace/deleted, at-cap, 401 mid-session. These seeds give the dashboard
 * something realistic to render; scenario toggles live in mock-admin.ts.
 */

export const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
export const USER_ID = '22222222-2222-4222-8222-222222222222';
export const INSTANCE_ID = '33333333-3333-4333-8333-333333333333';

export const seedAccount: Account = {
  adminId: ADMIN_ID,
  userId: USER_ID,
  email: 'sarah@sarahchen.com',
  state: 'verified',
  createdAt: '2026-01-15T14:00:00Z',
  emailVerified: true,
  hasCompletedFirstRun: true,
  hasLuciel: true,
};

export const seedLuciel: Luciel = {
  instanceId: INSTANCE_ID,
  name: "Sarah's Front-Desk Assistant",
  websiteUrl: 'sarahchen.com',
  state: 'active',
  embedKeyPublicId: 'vm_live_a8f3c2',
  channels: [
    { id: 'widget', enabled: true },
    { id: 'email', enabled: false },
    { id: 'sms', enabled: false, connectionStatus: 'unconfigured' },
    { id: 'voice', enabled: false, connectionStatus: 'unconfigured' },
    { id: 'whatsapp', enabled: false },
    { id: 'messenger', enabled: false },
    { id: 'instagram', enabled: false },
  ],
  tools: [
    // Healthy connection example:
    { id: 'book_appointment', enabled: true, connectionStatus: 'connected' },
    { id: 'check_availability', enabled: true, connectionStatus: 'connected' },
    // Same calendar connection, off until the owner turns the capability on —
    // the mixed state a served capability list has to render correctly.
    { id: 'reschedule_appointment', enabled: false, connectionStatus: 'connected' },
    { id: 'cancel_appointment', enabled: false, connectionStatus: 'connected' },
    // Expired connection example → "Reconnect needed" chip (Arch §3.8.4):
    { id: 'push_to_crm', enabled: true, connectionStatus: 'expired' },
    // Enabled but unconfigured → "Action needed: connect [X]":
    { id: 'send_email', enabled: true, connectionStatus: 'unconfigured' },
    { id: 'send_sms', enabled: false },
    { id: 'lookup_record', enabled: false },
    { id: 'schedule_callback', enabled: false },
    { id: 'bring_your_own_webhook', enabled: false },
  ],
  escalation: {
    primaryEmail: 'sarah@sarahchen.com',
    preferredChannel: 'email',
  },
  personality: {
    preset: 'warm_concierge',
    businessContext: 'I specialize in first-time clients and small-business owners in Markham.',
  },
  // Auto-prune is opt-in — off until the Admin sets it (Arch §3.4.10a).
  leadRetentionDays: null,
};

export const seedBilling: BillingInfo = {
  budget: {
    billingState: 'free_cap',
    dunningState: 'none',
    conversationsThisPeriod: 38,
    freeAllowance: 50,
    billedThisPeriod: 0,
    periodResetsAt: '2026-07-15T14:00:00Z',
    atCap: false,
  },
};

export const seedConnections: Connection[] = [
  // `providerAvailable` deliberately omitted (Harmony wave 2, item 6a
  // regression guard: FE-H#7): this row exercises the FALLBACK path — the
  // backend hasn't attached `providerAvailable` here, so Overview must fall
  // back to deriving availability from the separate providers-registry fetch
  // (`seedConnectionProviders` marks every `calendar` provider `configured:
  // false`), and still correctly hide "Change connected account" for this
  // `connected`-but-registry-disabled row.
  {
    connectionId: '44444444-4444-4444-8444-444444444444',
    connectionType: 'calendar',
    provider: 'google_calendar',
    displayName: 'Google Calendar',
    status: 'connected',
    createdAt: '2026-02-01T10:00:00Z',
    lastHealthCheckAt: '2026-06-14T16:00:00Z',
  },
  {
    connectionId: '55555555-5555-4555-8555-555555555555',
    connectionType: 'crm',
    provider: 'hubspot',
    displayName: 'HubSpot',
    providerAvailable: true,
    status: 'expired',
    statusDetail: 'OAuth refresh token expired — reconnect in dashboard',
    createdAt: '2026-02-01T10:05:00Z',
    lastHealthCheckAt: '2026-06-14T16:00:00Z',
  },
  // A connected knowledge source, so the scope picker (Decision #9) has
  // something to narrow: unscoped by default = Luciel reads the whole Drive.
  {
    connectionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    connectionType: 'knowledge_source',
    provider: 'google_drive',
    displayName: 'Google Drive',
    providerAvailable: true,
    status: 'connected',
    createdAt: '2026-02-01T10:10:00Z',
    lastHealthCheckAt: '2026-06-14T16:00:00Z',
  },
  // Never connected, and `providerAvailable: false` on the row itself
  // (Harmony wave 2, item 6a fixture; backend contract: `ConnectionOut.
  // providerAvailable`) — Overview must show the non-actionable "Not
  // available yet" chip here, NOT "Action needed" — there is no OAuth app on
  // this environment for the owner to click through. `displayName` is
  // deliberately omitted here so the row also exercises the label-fallback
  // path (derive from the separate providers-registry fetch) alongside the
  // chip's payload-driven path, both at once.
  {
    connectionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    connectionType: 'channel_auth',
    provider: 'meta',
    providerAvailable: false,
    status: 'unconfigured',
    createdAt: '2026-02-01T10:15:00Z',
    lastHealthCheckAt: null,
  },
  // Harmony wave 2, item 6 `displayName` fixture (backend contract item 4,
  // the "Email sending · Ses" bug): `provider` stays the wire code `ses`,
  // but the served label is the catalog's human name. Overview must render
  // "Amazon SES", never a titlecased "Ses".
  {
    connectionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    connectionType: 'email_sender',
    provider: 'ses',
    displayName: 'Amazon SES',
    providerAvailable: true,
    status: 'connected',
    createdAt: '2026-02-01T10:20:00Z',
    lastHealthCheckAt: '2026-06-14T16:00:00Z',
  },
];

/**
 * The provider registry the mock serves for GET /connections/providers
 * (contract §1). Each connection type offers ONLY its own providers, and the
 * `configured` flags mirror what dev actually holds today, so the UI is
 * exercised against the two states it must render honestly: a provider the
 * platform has no OAuth app for (`configured: false` → a disabled "Not
 * available yet" row, never a connect button that dead-ends) and a
 * `credential_form` provider taking the customer's OWN credential, which is
 * always available because the platform is not in that path.
 */
export const seedConnectionProviders: ConnectionProviders[] = [
  {
    connectionType: 'calendar',
    providers: [
      {
        provider: 'google_calendar',
        displayName: 'Google Calendar',
        authKind: 'oauth',
        helpText: 'Offer and book real times from your Google Calendar.',
        configured: false,
        credentialFields: [],
        scopeKind: null,
      },
      {
        provider: 'calendly',
        displayName: 'Calendly',
        authKind: 'oauth',
        helpText: 'Offer and book times from your Calendly availability.',
        configured: false,
        credentialFields: [],
        scopeKind: null,
      },
    ],
  },
  {
    // ONE Facebook grant authorizes WhatsApp and Messenger; each channel then
    // names its own destination (contract §2). Instagram is NOT on this grant —
    // Facebook rejects the instagram_* scopes and fails the whole dialog, so it
    // has its own client and its own connection type below.
    connectionType: 'channel_auth',
    providers: [
      {
        // Just "Meta": each channel row carries its own channel name, so the
        // provider label no longer enumerates the surfaces it powers.
        provider: 'meta',
        displayName: 'Meta',
        authKind: 'oauth',
        helpText:
          'One sign-in to your Meta Business account covers WhatsApp and Facebook Messenger.',
        configured: false,
        credentialFields: [],
        scopeKind: null,
      },
    ],
  },
  {
    connectionType: 'instagram_auth',
    providers: [
      {
        provider: 'instagram',
        displayName: 'Instagram',
        authKind: 'oauth',
        helpText: 'Sign in to the Instagram professional account Luciel answers DMs on.',
        configured: false,
        credentialFields: [],
        scopeKind: null,
      },
    ],
  },
  {
    connectionType: 'crm',
    providers: [
      {
        provider: 'hubspot',
        displayName: 'HubSpot',
        authKind: 'oauth',
        helpText: 'Write captured leads into your HubSpot contacts.',
        configured: true,
        credentialFields: [],
        scopeKind: null,
      },
      {
        provider: 'salesforce',
        displayName: 'Salesforce',
        authKind: 'oauth',
        helpText: 'Write captured leads into your Salesforce org.',
        configured: true,
        credentialFields: [],
        scopeKind: null,
      },
      {
        provider: 'custom_webhook',
        displayName: 'Custom webhook',
        authKind: 'credential_form',
        helpText: 'Post captured leads to your own endpoint instead of a CRM.',
        configured: true,
        credentialFields: [
          { name: 'url', label: 'Webhook URL', secret: false, required: true },
          { name: 'signingSecret', label: 'Signing secret', secret: true, required: false },
        ],
        scopeKind: null,
      },
    ],
  },
  {
    connectionType: 'knowledge_source',
    providers: [
      {
        provider: 'google_drive',
        displayName: 'Google Drive',
        authKind: 'oauth',
        helpText: 'Keep answers in step with the documents in your Drive.',
        configured: true,
        credentialFields: [],
        scopeKind: 'drive_folders',
      },
      {
        provider: 'notion',
        displayName: 'Notion',
        authKind: 'oauth',
        helpText: 'Keep answers in step with your Notion pages and databases.',
        configured: false,
        credentialFields: [],
        scopeKind: 'notion_pages',
      },
    ],
  },
  {
    connectionType: 'record_source',
    providers: [
      {
        provider: 'live_connector',
        displayName: 'Live connector',
        authKind: 'credential_form',
        helpText: 'Look records up in your own system, live, at answer time.',
        configured: true,
        credentialFields: [
          { name: 'baseUrl', label: 'Base URL', secret: false, required: true },
          { name: 'apiKey', label: 'API key', secret: true, required: true },
        ],
        scopeKind: null,
      },
      {
        provider: 'csv',
        displayName: 'CSV file',
        authKind: 'credential_form',
        helpText: 'Look records up in a CSV you upload under Knowledge.',
        configured: true,
        credentialFields: [],
        scopeKind: null,
      },
    ],
  },
  {
    // BYO email sender (§3.1.6a, owner decision 2026-08-10 Outlook-first): the
    // customer's own Outlook mailbox as the address Luciel answers from —
    // connect, verify, bind, then live; it never silently replaces a working
    // sender. `configured: true` here so the whole flow is walkable on the
    // mock; on a real environment it is false until the platform's Azure app
    // is registered (the honest dark state).
    connectionType: 'email_sender',
    providers: [
      {
        provider: 'outlook',
        displayName: 'Outlook mailbox',
        authKind: 'oauth',
        helpText:
          'Connect the work mailbox Luciel answers from — replies come from your own address. Sent mail lands in your own Sent folder.',
        configured: true,
        credentialFields: [],
        scopeKind: null,
      },
    ],
  },
  {
    // BYO: the CUSTOMER's own Twilio account (§3.1.4). The platform is never in
    // the telephony billing path, so this is always available — nothing here is
    // gated on a platform OAuth app.
    connectionType: 'sms_sender',
    providers: [
      {
        provider: 'twilio',
        displayName: 'Your Twilio account',
        authKind: 'credential_form',
        helpText: 'Luciel texts and calls from your own business number, on your own Twilio account.',
        configured: true,
        credentialFields: [
          { name: 'accountSid', label: 'Twilio Account SID (AC…)', secret: false, required: true },
          { name: 'authToken', label: 'Twilio Auth Token', secret: true, required: false },
          { name: 'apiKeySid', label: 'API Key SID (SK…)', secret: false, required: false },
          { name: 'apiKeySecret', label: 'API Key Secret', secret: true, required: false },
        ],
        scopeKind: null,
      },
    ],
  },
];

/**
 * The capability grouping the mock serves for GET /admin/luciel/capabilities
 * (contract §3). All four scheduling tools ride the ONE calendar connection.
 */
export const seedCapabilities: CapabilityGroup[] = [
  {
    capability: 'scheduling',
    label: 'Appointment scheduling',
    helpText:
      'Luciel can offer open times, book an appointment, and move or cancel one it already booked — all on the calendar you connect here.',
    toolIds: [
      'check_availability',
      'book_appointment',
      'reschedule_appointment',
      'cancel_appointment',
    ],
    connectionType: 'calendar',
  },
];

// Email address not provisioned yet → the Email channel in Configure shows the
// own-domain vs VM-subdomain choice (Arch §3.1.6a, Decision #49; Decision #4 put
// it there and only there, not on the embed tab). provisionEmail() flips this
// to `pending_email_routing` (own-domain) or `connected` (VM-subdomain).
export const seedEmailProvisioning: EmailProvisioning | null = null;

export const seedKnowledge: KnowledgeSource[] = [
  {
    sourceId: '66666666-6666-4666-8666-666666666666',
    name: 'Services brochure.pdf',
    origin: 'upload',
    ingestionStatus: 'ready',
    sizeBytes: 2_000_000,
    lastUpdatedAt: '2026-01-16T09:00:00Z',
  },
  {
    sourceId: '77777777-7777-4777-8777-777777777777',
    name: 'Google Drive — Service playbooks',
    origin: 'google_drive',
    ingestionStatus: 'ready',
    sizeBytes: 5_400_000,
    lastUpdatedAt: '2026-06-13T08:00:00Z',
    lastSyncedAt: '2026-06-14T06:00:00Z',
    syncStatus: 'synced',
  },
];

export const seedConversations: ConversationSummary[] = [
  {
    sessionId: '88888888-8888-4888-8888-888888888888',
    leadId: '99999999-9999-4999-8999-999999999999',
    channel: 'widget',
    mode: 'ai',
    startedAt: '2026-06-13T23:42:00Z',
    lastMessageAt: '2026-06-13T23:47:00Z',
    summary: 'New-client inquiry; requested 9 AM callback. High-value lead.',
  },
];

export const seedLeads: Lead[] = [
  {
    leadId: '99999999-9999-4999-8999-999999999999',
    name: 'Jordan P.',
    contactIdentifier: '416-555-0143',
    intent: 'Intro call request — small business launch',
    state: 'active',
    lastActivityAt: '2026-06-13T23:47:00Z',
    createdAt: '2026-06-13T23:42:00Z',
  },
];

export const seedEscalations: EscalationEvent[] = [
  {
    escalationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sessionId: '88888888-8888-4888-8888-888888888888',
    leadId: '99999999-9999-4999-8999-999999999999',
    signal: 'high_value_lead',
    gate: 'outcome',
    firedAt: '2026-06-13T23:45:00Z',
    scoreOrConfidence: 0.91,
  },
];

export const seedAnalytics: AnalyticsOverview = {
  conversationsThisPeriod: 38,
  conversationsTotal: 312,
  leadsThisPeriod: 12,
  appointmentsBooked: 7,
  appointmentsBookedNote: null,
  responseTimeP50Seconds: 45,
  responseTimeP95Seconds: 240,
  responseTimeNote: null,
  escalationsBySignal: [
    { signal: 'high_value_lead', count: 5 },
    { signal: 'cannot_answer', count: 2 },
    { signal: 'strong_negative_sentiment', count: 1 },
    { signal: 'explicit_human_request', count: 3 },
  ],
  channelMix: [
    { channel: 'widget', fraction: 0.8 },
    { channel: 'email', fraction: 0.2 },
  ],
  budgetUtilization: 0.76,
  busiestTimes: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
  topKnowledgeSources: [],
  // Mirrors the server's honest gap note verbatim (mock models states, it does
  // not invent claims — the retrieval-frequency store is not built).
  topKnowledgeSourcesNote: "Knowledge source usage isn't tracked yet — coming soon.",
  conversionByChannel: [
    { channel: 'widget', conversations: 30, leads: 10, conversionRate: 0.33 },
    { channel: 'email', conversations: 8, leads: 2, conversionRate: 0.25 },
  ],
  conversionBySourceNote: "Conversion by source isn't available yet — coming soon.",
  conversionByServiceNote: "Conversion by service isn't available yet — coming soon.",
};

/** The honest EMPTY analytics state (new/quiet account): real zeros where the
 * store is real, nulls + plain-language notes where there is nothing to
 * measure yet. Exercised by the analytics page tests so the empty branches are
 * covered, not just the happy path. */
export const seedAnalyticsEmpty: AnalyticsOverview = {
  conversationsThisPeriod: 0,
  conversationsTotal: 0,
  leadsThisPeriod: 0,
  appointmentsBooked: 0,
  appointmentsBookedNote: null,
  responseTimeP50Seconds: null,
  responseTimeP95Seconds: null,
  responseTimeNote: 'Shows up once Luciel has replied to customers this billing period.',
  escalationsBySignal: [],
  channelMix: [],
  budgetUtilization: 0,
  busiestTimes: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
  topKnowledgeSources: [],
  topKnowledgeSourcesNote: "Knowledge source usage isn't tracked yet — coming soon.",
  conversionByChannel: [],
  conversionBySourceNote: "Conversion by source isn't available yet — coming soon.",
  conversionByServiceNote: "Conversion by service isn't available yet — coming soon.",
};

export const seedAudit: AuditEvent[] = [
  {
    eventId: 'evt-1',
    eventType: 'instance_configured',
    at: '2026-06-10T12:00:00Z',
    detail: 'personality preset changed',
    actorUserId: USER_ID,
  },
  {
    eventId: 'evt-2',
    eventType: 'connection_status_changed',
    at: '2026-06-14T16:00:00Z',
    detail: 'hubspot crm: connected → expired',
  },
];
