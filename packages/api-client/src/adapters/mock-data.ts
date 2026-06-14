import type {
  Account,
  Luciel,
  BillingInfo,
  Connection,
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
    { id: 'instagram_messenger', enabled: false },
  ],
  tools: [
    // Healthy connection example:
    { id: 'book_appointment', enabled: true, connectionStatus: 'connected' },
    { id: 'check_availability', enabled: true, connectionStatus: 'connected' },
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
  {
    connectionId: '44444444-4444-4444-8444-444444444444',
    connectionType: 'calendar',
    provider: 'google_calendar',
    status: 'connected',
    createdAt: '2026-02-01T10:00:00Z',
    lastHealthCheckAt: '2026-06-14T16:00:00Z',
  },
  {
    connectionId: '55555555-5555-4555-8555-555555555555',
    connectionType: 'crm',
    provider: 'hubspot',
    status: 'expired',
    statusDetail: 'OAuth refresh token expired — reconnect in dashboard',
    createdAt: '2026-02-01T10:05:00Z',
    lastHealthCheckAt: '2026-06-14T16:00:00Z',
  },
];

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
  responseTimeP50Seconds: 45,
  responseTimeP95Seconds: 240,
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
