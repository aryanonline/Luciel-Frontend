import type { LucielApiClient, PageOptions } from '../client';
import {
  LucielApiError,
  ACCOUNT_CLOSED,
  VOICE_DISCLOSURE_INTRO_MAX,
  personalityForWrite,
} from '../schemas';
import type {
  Account,
  ApiErrorCode,
  AuditEvent,
  AddonToolId,
  ChannelId,
  Luciel,
  BillingInfo,
  Connection,
  ConnectionType,
  EmailProvisioning,
  KnowledgeSource,
  KnowledgeSyncConnection,
  KnowledgeSyncProvider,
  KnowledgeScope,
  KnowledgeScopeKind,
  MetaChannel,
  ScopeCandidate,
  Message,
  EmployeeStatus,
  EscalationContactHealth,
  Lead,
  NeverAttemptedReason,
} from '../schemas';
import * as seed from './mock-data';

/**
 * In-memory, deterministic mockAdapter for the admin client (Space Instructions
 * §7). It models the realistic states the UI must handle and exposes a small
 * `scenario` hook so a story/test can flip into edge states:
 *   - 'unverified'      → me()/gated calls throw verification_required
 *   - 'expired_session' → calls throw unauthorized (401 mid-session)
 *   - 'free_cap'        → default
 *   - 'at_cap'          → budget.atCap = true (free 50 hit, no card)
 *   - 'payg'            → payment method on file
 *   - 'paused'          → Luciel paused
 *   - 'grace'           → Luciel in 30-day grace window
 *   - 'closed'          → account closed 3 days ago, inside its 30-day reopen
 *                         window (D5): every admin route refuses with the typed
 *                         403 `account_closed`; status/reopen/export still answer
 *   - 'closed_window_passed' → closed 31 days ago: even the reduced surface refuses
 *   - 'knowledge_states' → knowledge in every round-7 state: the Drive grant is
 *                         revoked at the provider while its row still says
 *                         connected (a re-sync flips it to error and pauses its
 *                         sources), a Notion source paused 3 days ago (still
 *                         answering), a HubSpot KB source paused 9 days ago (no
 *                         longer answering), a crawled page removed at its origin
 *   - 'escalation_sms'  → SMS escalation contacts in every confirmation state (round
 *                         7 WP-4b): primary has a live code (enter 123456), backup's
 *                         code expired, the after-hours number is confirmed
 *
 * No network. Returned objects are clones so callers can't mutate seed state.
 */
export type MockScenario =
  | 'verified'
  | 'unverified'
  | 'fresh' // verified, but no Luciel yet → routes to first-run
  | 'expired_session'
  | 'at_cap'
  | 'payg'
  | 'paused'
  | 'grace'
  | 'closed'
  | 'closed_window_passed'
  | 'escalation_sms'
  | 'knowledge_states';

/**
 * channels/voice_adapter.py `build_disclosure`: the owner's intro (if any) then the
 * mandatory facts, which no setting removes. The mock composes the served preview
 * the same way.
 */
const VOICE_AI_IDENTITY_FACT =
  "You're speaking with an AI assistant, not a human, and this call is handled by an automated system.";
const VOICE_RECORDING_FACT = 'This call may be recorded and transcribed.';
const VOICE_CONSENT_TAIL = "If you'd prefer a person, just say so at any time.";
const buildVoiceDisclosure = (intro: string | null | undefined) =>
  [(intro ?? '').trim(), VOICE_AI_IDENTITY_FACT, VOICE_RECORDING_FACT, VOICE_CONSENT_TAIL]
    .filter(Boolean)
    .join(' ');

/** The backend's chunk preview page (knowledge/service.py CHUNK_PREVIEW_PAGE). */
const CHUNK_PREVIEW_PAGE = 20;
/** connections/health `_DEAD_CREDENTIAL_DETAIL` (round 7 WP-4c #7). */
const DEAD_CREDENTIAL_DETAIL = 'knowledge sync could not use the stored credential — reconnect';

/**
 * The mock's SMS confirmation code (round 7 WP-4b). The backend mints a random one
 * and texts it; the mock has no phone, so every code it "sends" is this one.
 */
export const MOCK_SMS_CODE = '123456';
/** contact_confirmation: CODE_TTL, RESEND_COOLDOWN, MAX_CODE_ATTEMPTS. */
const SMS_CODE_TTL_MS = 15 * 60 * 1000;
const SMS_RESEND_COOLDOWN_MS = 5 * 60 * 1000;
const SMS_MAX_ATTEMPTS = 5;
/** rate_limit `escalation_test_sms`: burst 3 per 600 s for code entries. */
const SMS_CONFIRM_BURST = 3;
const SMS_CONFIRM_WINDOW_MS = 600 * 1000;
const normalizeNumber = (value: string) => value.replace(/[\s\-.()]/g, '');
const looksLikeNumber = (value: string) => {
  const raw = value.trim();
  return raw.startsWith('+') || /^\d+$/.test(raw.replace(/ /g, ''));
};

interface SmsConfirmationRow {
  code: string | null;
  expiresAt: number | null;
  attempts: number;
  confirmedAt: string | null;
  lastSentAt: number | null;
}

/** The D5 reopen window: 30 days from closure (close_purge.reopen_deadline). */
const REOPEN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface MockAdminOptions {
  scenario?: MockScenario;
  /** Artificial latency (ms) so loading states are exercisable. */
  latencyMs?: number;
  /**
   * The browser runtime (round 7 WP-12). `'browser'` reads the page's own
   * location / cookies / sessionStorage; a {@link MockRuntime} object injects
   * them (unit tests). Absent — every unit test — the client is a fresh,
   * in-memory store with the scenario fixed at construction, exactly as before.
   */
  runtime?: 'browser' | MockRuntime;
}

/**
 * What the mock reads from, and writes to, the page it runs in (round 7 WP-12).
 *
 *  - The SCENARIO is chosen at runtime, never at build time: `?mock_scenario=<name>`
 *    (which also sets the cookie, so the choice survives navigation) or the
 *    `luciel_mock_scenario` cookie. Neither present → the build's default.
 *  - The STORE persists in sessionStorage after every call, so a reload reads back
 *    what a mutation wrote: the mock is the server, and a page that only kept a
 *    change in component state shows the served value again after a reload.
 *    A different scenario (or `?mock_reset=1`) starts from that scenario's seed.
 *  - The SESSION cookie is modelled: login sets the presence cookie the middleware
 *    gates on, logout clears it (the real backend's Set-Cookie, for a mock that has
 *    no server to send one).
 *  - Provider round-trips land the way the backend lands them: a consent screen
 *    (stubbed by the e2e suite) returns to `/dashboard/configure?status=connected
 *    &connectionId=…`, and the attempt that minted the URL is redeemed — the
 *    callback the backend runs before its 303. Stripe Checkout returns with
 *    `?checkout=success` (the backend's success_url) and the open session is
 *    completed — the webhook the backend would have received first. The Billing
 *    Portal returns to a bare `/dashboard/billing`, so the stub says what happened
 *    there with `mock_stripe=portal_card_updated`.
 *  - A control surface (`window.__lucielMock`) lets an e2e walk inject a failure
 *    into the next call, slow the next calls down so a pending state is visible,
 *    end a conversation mid-takeover, or revoke a knowledge grant at the provider.
 */
export interface MockRuntime {
  /** The page's `location.search`. */
  search: string;
  /** The page's `location.pathname`. */
  pathname?: string;
  /** Reads `document.cookie`. */
  readCookie: () => string;
  /** Writes one `document.cookie` assignment. */
  writeCookie: (cookie: string) => void;
  /** Where the store persists (sessionStorage); null = in-memory only. */
  storage: MockStorage | null;
  /** Installs the e2e control surface (on `window.__lucielMock` in a browser). */
  installControl?: (control: MockControl) => void;
}

export type MockStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The e2e control surface (round 7 WP-12). Mock-only; the http adapter has none. */
export interface MockControl {
  /** The scenario this store was seeded from. */
  scenario: () => MockScenario;
  /** The next `times` calls to `method` ("leads.archive") fail with a typed error. */
  failNext: (method: string, times?: number, code?: ApiErrorCode) => void;
  /** Extra latency (ms) on every call from now on, across reloads — 0 turns it off. */
  setExtraLatency: (ms: number) => void;
  /** The visitor's side ended this conversation (§3.4.8) while the page still shows it open. */
  endSession: (sessionId: string) => void;
  /** The provider revoked this knowledge grant; the row still says connected until a sync. */
  revokeKnowledgeGrant: (connectionId: string) => void;
  /** Drop the persisted store; the next page load starts from the scenario's seed. */
  reset: () => void;
}

/** `?mock_scenario=<name>` selects a scenario for this tab (and sets the cookie). */
export const MOCK_SCENARIO_PARAM = 'mock_scenario';
/** The cookie the mock reads its scenario from (set by the e2e projects, or the param). */
export const MOCK_SCENARIO_COOKIE = 'luciel_mock_scenario';
/** `?mock_reset=1` drops the persisted store. */
export const MOCK_RESET_PARAM = 'mock_reset';
/** The sessionStorage key the store persists under. */
export const MOCK_STORE_KEY = 'luciel.mock.store.v1';
/** The session-presence cookie (middleware.ts / app/config.py session_cookie_name). */
const SESSION_COOKIE = 'luciel_session';
/** The Billing Portal stub says what the owner did there (the real return URL is bare). */
const MOCK_STRIPE_PARAM = 'mock_stripe';

export const MOCK_SCENARIOS: readonly MockScenario[] = [
  'verified',
  'unverified',
  'fresh',
  'expired_session',
  'at_cap',
  'payg',
  'paused',
  'grace',
  'closed',
  'closed_window_passed',
  'escalation_sms',
  'knowledge_states',
];

const isScenario = (value: string | null | undefined): value is MockScenario =>
  typeof value === 'string' && (MOCK_SCENARIOS as readonly string[]).includes(value);

const readCookieValue = (cookies: string, name: string): string | null => {
  for (const part of cookies.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
};

/**
 * Which scenario the page asked for: the query parameter first (it is the
 * explicit "start this scenario" and is remembered in the cookie), then the
 * cookie. Null when neither names a known scenario.
 */
export function resolveMockScenario(
  search: string,
  cookies: string,
): { scenario: MockScenario | null; fromQuery: boolean } {
  const fromQuery = new URLSearchParams(search).get(MOCK_SCENARIO_PARAM);
  if (isScenario(fromQuery)) return { scenario: fromQuery, fromQuery: true };
  const fromCookie = readCookieValue(cookies, MOCK_SCENARIO_COOKIE);
  return { scenario: isScenario(fromCookie) ? fromCookie : null, fromQuery: false };
}

/** The page's own location, cookies and sessionStorage — every access guarded. */
function browserRuntime(): MockRuntime | undefined {
  const g = globalThis as unknown as {
    document?: { cookie: string };
    location?: { search: string; pathname: string };
    sessionStorage?: MockStorage;
    __lucielMock?: MockControl;
  };
  if (!g.document || !g.location) return undefined;
  let storage: MockStorage | null = null;
  try {
    storage = g.sessionStorage ?? null;
  } catch {
    storage = null; // blocked storage: the store lives in memory for this page
  }
  return {
    search: g.location.search,
    pathname: g.location.pathname,
    readCookie: () => {
      try {
        return g.document?.cookie ?? '';
      } catch {
        return '';
      }
    },
    writeCookie: (cookie) => {
      try {
        if (g.document) g.document.cookie = cookie;
      } catch {
        /* cookies blocked: nothing to model */
      }
    },
    storage,
    installControl: (control) => {
      g.__lucielMock = control;
    },
  };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Bumped whenever the persisted state's shape changes; an older store is ignored. */
const STORE_VERSION = 2;

/** The persisted store, or null when absent, unreadable or from another version. */
function readStore(storage: MockStorage): { seededScenario: MockScenario; state: object } | null {
  try {
    const raw = storage.getItem(MOCK_STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: number; seededScenario?: string; state?: object };
    if (parsed.v !== STORE_VERSION || !isScenario(parsed.seededScenario) || !parsed.state) {
      return null;
    }
    return { seededScenario: parsed.seededScenario, state: parsed.state };
  } catch {
    return null;
  }
}

/** Mirrors the backend's lead export columns so mock ↔ http downloads match. */
function toCsv(rows: Record<string, string>[]): string {
  const [first] = rows;
  if (!first) return '';
  const columns = Object.keys(first);
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [
    columns.join(','),
    ...rows.map((r) => columns.map((c) => cell(r[c] ?? '')).join(',')),
  ].join('\n');
}

/** 50 MB per file (Vision §3.3) — the same limit the backend enforces. */
const PER_FILE_MAX_BYTES = 50_000_000;

/** Leads per CRM backfill call (the backend's CRM_BACKFILL_BATCH). */
const CRM_BACKFILL_BATCH = 100;

/**
 * The backend's typed refusal for a take-over / reply on an ENDED session (round 7
 * WP-3b item 4; dashboard.py `_session_ended`): 409 → `conflict`, with the wire
 * word `session_ended` in the message so the page can name the state.
 */
const sessionEnded = () =>
  new LucielApiError({
    code: 'conflict',
    message:
      'This conversation has ended, so there is nothing to take over or reply into (session_ended).',
  });

/**
 * Stand-in consent host for OAuth starts. The UI only hands the browser to a
 * known provider host, and accepts this one only while running on the mock.
 */
export const MOCK_AUTHORIZE_ORIGIN = 'https://accounts.example.com';

/** Which providers offer a selectable knowledge scope (Decision #9). */
const SCOPE_KINDS: Partial<Record<KnowledgeSyncProvider, KnowledgeScopeKind>> = {
  google_drive: 'drive_folders',
  notion: 'notion_pages',
};

/** The served human label of a knowledge connection row (connections registry). */
const KNOWLEDGE_DISPLAY_NAME: Partial<Record<KnowledgeSyncProvider, string>> = {
  google_drive: 'Google Drive',
  notion: 'Notion',
  hubspot: 'HubSpot knowledge base',
  salesforce: 'Salesforce knowledge base',
  website_crawl: 'Website crawl',
};

/** What the owner may pick, per provider. Absent ⇒ nothing to narrow (409). */
const SCOPE_CANDIDATES: Partial<Record<KnowledgeSyncProvider, ScopeCandidate[]>> = {
  google_drive: [
    { id: '1AbC_folderId', name: 'Public FAQ', kind: 'folder' },
    { id: '1XyZ_folderId', name: 'Pricing', kind: 'folder' },
    { id: '1QrS_folderId', name: 'Service playbooks', kind: 'folder' },
  ],
  notion: [
    { id: 'notion-page-1', name: 'Client onboarding', kind: 'page' },
    { id: 'notion-db-1', name: 'Services database', kind: 'database' },
  ],
};

/**
 * What a disconnect takes down with it (contract §1). Scheduling is NOT listed
 * here: its members are derived from the served capability groups, so the mock
 * cannot drift from the grouping the UI renders.
 */
const TOOLS_BY_CONNECTION_TYPE: Partial<Record<ConnectionType, AddonToolId[]>> = {
  crm: ['push_to_crm'],
  record_source: ['lookup_record'],
  email_sender: ['send_email'],
  outbound_webhook: ['bring_your_own_webhook'],
};

/**
 * WhatsApp and Messenger both ride the ONE Facebook grant (Arch §3.1.2), so
 * that grant going away takes both channels down; Instagram rides its own
 * Business Login grant and only Instagram goes with it.
 */
const CHANNELS_BY_CONNECTION_TYPE: Partial<Record<ConnectionType, ChannelId[]>> = {
  sms_sender: ['sms', 'voice'],
  email_sender: ['email'],
  channel_auth: ['whatsapp', 'messenger'],
  instagram_auth: ['instagram'],
};

/**
 * What a BYO Twilio account with no designated number reports (contract §1a).
 * It is an actionable next step in the same flow, not a failure.
 */
const ACTION_ADD_NUMBER =
  'Action needed: add your number. Your Twilio account is connected; tell us which of its numbers Luciel uses.';

/**
 * The Today card's dormant need, word for word as the server composes it
 * (app/employee/status.py, round 7 WP-3a): a dormant channel or tool is a billing
 * state, so the need links to Billing — never to a Connect that would refuse.
 */
const DORMANT_STATUS_DETAIL = 'paused until a card is on file';
const DORMANT_NEED_DETAIL = 'Add a card on the Billing page and it resumes.';
const BILLING_HREF = '/dashboard/billing';
const CHANNEL_NEED_LABEL: Record<ChannelId, string> = {
  widget: 'Website chat',
  email: 'Email',
  sms: 'Text messages',
  voice: 'Phone calls',
  whatsapp: 'WhatsApp',
  messenger: 'Messenger',
  instagram: 'Instagram',
};

/** Which UI channel each per-channel destination belongs to (contract §2). */
const CHANNEL_BY_META_CHANNEL: Record<MetaChannel, ChannelId> = {
  whatsapp: 'whatsapp',
  instagram: 'instagram',
  messenger: 'messenger',
};

const toolsForConnectionType = (connectionType: ConnectionType): AddonToolId[] => [
  ...seed.seedCapabilities
    .filter((c) => c.connectionType === connectionType)
    .flatMap((c) => c.toolIds),
  ...(TOOLS_BY_CONNECTION_TYPE[connectionType] ?? []),
];

const channelsForConnection = (connection: Connection): ChannelId[] =>
  CHANNELS_BY_CONNECTION_TYPE[connection.connectionType] ?? [];

/** The server's paging, mirrored: offset/limit over the newest-first list. */
const pageOf = <T>(rows: T[], page?: PageOptions): T[] => {
  const offset = page?.offset ?? 0;
  const limit = page?.limit ?? rows.length;
  return rows.slice(offset, offset + limit);
};

/** A consent URL minted for a connection, waiting for its provider round-trip. */
interface OauthAttempt {
  provider: string;
  /** Which completion the backend's callback would run for it. */
  kind: 'connection' | 'knowledge';
}

export function createMockAdminClient(options: MockAdminOptions = {}): LucielApiClient {
  const latency = options.latencyMs ?? 0;

  // Round 7 WP-12: in a browser the scenario is chosen at RUNTIME — the query
  // parameter (remembered in the cookie) or the cookie — never by the build.
  const runtime = options.runtime === 'browser' ? browserRuntime() : options.runtime;
  const chosen = runtime
    ? resolveMockScenario(runtime.search, runtime.readCookie())
    : { scenario: null, fromQuery: false };
  if (runtime && chosen.fromQuery && chosen.scenario) {
    runtime.writeCookie(`${MOCK_SCENARIO_COOKIE}=${chosen.scenario}; path=/; SameSite=Lax`);
  }
  const seededScenario: MockScenario = chosen.scenario ?? options.scenario ?? 'verified';

  // Mutable in-memory state, seeded from the deterministic fixtures.
  const state = {
    scenario: seededScenario as MockScenario,
    account: clone(seed.seedAccount),
    luciel: clone(seed.seedLuciel) as Luciel | null,
    billing: clone(seed.seedBilling),
    deletedKnowledge: [] as KnowledgeSource[],
    connections: clone(seed.seedConnections),
    /**
     * Provider staged by `swap()` per connection id (Arch §3.8.7 B, Decision
     * #39): the row keeps serving on its CURRENT provider until the
     * replacement's OAuth callback completes, and only then cuts over.
     */
    stagedSwaps: {} as Record<string, string>,
    emailProvisioning: clone(seed.seedEmailProvisioning) as EmailProvisioning | null,
    knowledge: clone(seed.seedKnowledge),
    syncConnections: [] as KnowledgeSyncConnection[],
    knowledgeScopes: {} as Record<string, KnowledgeScope>,
    conversations: clone(seed.seedConversations),
    /** Admin takeover replies, per session, so the transcript stays coherent. */
    humanReplies: {} as Record<string, Message[]>,
    leads: clone(seed.seedLeads),
    escalations: clone(seed.seedEscalations),
    analytics: clone(seed.seedAnalytics),
    audit: clone(seed.seedAudit),
    /**
     * The closure on record (D5): when it happened and the Luciel as it was before
     * the closure deleted it (null when there was none, or it was already deleted —
     * that deletion stays the owner's and reopening does not undo it).
     */
    closure: null as null | { closedAt: string; lucielBefore: Luciel | null },
    /**
     * The closure bumped the session epoch (cascade.close_account): the session the
     * owner closed with is revoked, so every call answers 401 until a new sign-in.
     */
    sessionRevoked: false,
    /** SMS escalation-contact confirmations by normalized number (round 7 WP-4b). */
    smsConfirmations: {} as Record<string, SmsConfirmationRow>,
    /** Recent code entries — the per-tenant rate limit on the confirm route. */
    smsConfirmEntries: [] as number[],
    /** Who tombstoned each deleted source (knowledge_sources.deleted_by). */
    tombstoneBy: {} as Record<string, 'owner' | 'origin'>,
    /** Knowledge grants the provider has revoked while the row still says connected. */
    revokedGrants: [] as string[],
    /** Synced sources whose item is gone at the origin (the next sync tombstones them). */
    removedAtOrigin: [] as string[],
    /** The deterministic id counter — part of the store so a reload never reuses an id. */
    seq: 0,
    /** Drives the mock contact form's anti-spam rate limit. */
    contactSubmissions: 0,
    /** `${sessionId}:${messageId}` the owner flagged (messages.flagged_by_admin_at). */
    flaggedAnswers: [] as string[],
    /** Consent URLs minted and not yet redeemed, by connection id (browser runtime). */
    oauthAttempts: {} as Record<string, OauthAttempt>,
    /** The Stripe session the owner was last sent to (browser runtime). */
    pendingStripe: null as null | 'checkout' | 'portal',
    /** Failures the e2e control injected, by "namespace.method" (browser runtime). */
    faults: {} as Record<string, { times: number; code: ApiErrorCode }>,
    /** Extra latency (ms) the e2e control adds to every call — persisted, so a slow
     *  read can be shown on the page load that follows (browser runtime). */
    extraLatency: 0,
  };

  // The served, read-only voice disclosure preview (settled contract, round 7).
  if (state.luciel) {
    state.luciel.personality = {
      ...state.luciel.personality,
      voiceDisclosurePreview: buildVoiceDisclosure(state.luciel.personality.voiceDisclosureIntro),
    };
  }

  // Apply scenario-derived state up front.
  if (state.scenario === 'unverified') {
    state.account.state = 'unverified';
    state.account.emailVerified = false;
    state.account.hasCompletedFirstRun = false;
    state.account.hasLuciel = false;
    state.luciel = null;
  }
  if (state.scenario === 'fresh') {
    // A brand-new account (round 7 WP-12): verified, no Luciel, and nothing it
    // could have produced yet — no knowledge, conversations, leads, connections,
    // analytics or history. Every collection page renders its honest EMPTY branch.
    state.account.hasCompletedFirstRun = false;
    state.account.hasLuciel = false;
    state.luciel = null;
    state.connections = [];
    state.knowledge = [];
    state.conversations = [];
    state.leads = [];
    state.escalations = [];
    state.audit = [];
    state.analytics = clone(seed.seedAnalyticsEmpty);
    state.billing.budget.conversationsThisPeriod = 0;
  }
  if (state.scenario === 'at_cap') {
    state.billing.budget.atCap = true;
    state.billing.budget.conversationsThisPeriod = 50;
    // The free 50 are used and a visitor is mid-conversation (round 7 WP-12): the
    // session that started at the cap is listed, unsummarised, still open.
    const started = new Date(Date.now() - 4 * 60 * 1000).toISOString();
    state.conversations.unshift({
      sessionId: '55555555-5555-4555-8555-000000000050',
      channel: 'widget',
      mode: 'ai',
      startedAt: started,
      lastMessageAt: new Date(Date.now() - 60 * 1000).toISOString(),
      countedForBilling: true,
    });
  }
  if (state.scenario === 'payg') {
    state.billing.budget.billingState = 'payg_enabled';
    state.billing.budget.conversationsThisPeriod = 240;
    state.billing.budget.billedThisPeriod = 190;
    // 190 billed = 90 into the 100–200 block → ~90% of the way to the next block.
    state.billing.budget.nearNextBlock = true;
    state.billing.paymentMethod = { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2028 };
  }
  if (state.scenario === 'paused' && state.luciel) state.luciel.state = 'paused';
  if (state.scenario === 'grace' && state.luciel) {
    state.luciel.state = 'luciel_grace_window';
    state.luciel.graceWindowStartedAt = '2026-06-10T12:00:00Z';
  }
  if (state.scenario === 'escalation_sms' && state.luciel) {
    const now = Date.now();
    state.luciel.channels = state.luciel.channels.map((c) =>
      c.id === 'sms' ? { ...c, enabled: true, connectionStatus: 'connected' } : c,
    );
    state.luciel.escalation = {
      ...state.luciel.escalation,
      primarySms: '+16045550101',
      secondarySms: '+16045550102',
    };
    state.luciel.teamAvailability = {
      enabled: true,
      weekly: [{ day: 0, start: '09:00', end: '17:00' }],
      closures: [],
      afterHours: { escalation: { channel: 'sms', contactSms: '+16045550103' } },
    };
    state.luciel.timezone = 'America/Vancouver';
    state.smsConfirmations = {
      // A live code, sent six minutes ago (outside the resend cooldown).
      '+16045550101': {
        code: MOCK_SMS_CODE,
        expiresAt: now + 9 * 60 * 1000,
        attempts: 0,
        confirmedAt: null,
        lastSentAt: now - 6 * 60 * 1000,
      },
      // The code went out twenty minutes ago and has expired.
      '+16045550102': {
        code: MOCK_SMS_CODE,
        expiresAt: now - 5 * 60 * 1000,
        attempts: 0,
        confirmedAt: null,
        lastSentAt: now - 20 * 60 * 1000,
      },
      '+16045550103': {
        code: null,
        expiresAt: null,
        attempts: 0,
        confirmedAt: '2026-10-01T15:00:00Z',
        lastSentAt: null,
      },
    };
  }
  if (state.scenario === 'knowledge_states') {
    const now = Date.now();
    const drive = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const notion = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const hubspotKb = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const crawl = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    state.revokedGrants = [drive];
    state.knowledge = state.knowledge.map((k) =>
      k.origin === 'google_drive' ? { ...k, connectionId: drive } : k,
    );
    state.connections.push(
      {
        connectionId: notion,
        connectionType: 'knowledge_source',
        provider: 'notion',
        displayName: 'Notion',
        providerAvailable: true,
        status: 'error',
        statusDetail: DEAD_CREDENTIAL_DETAIL,
        createdAt: '2026-02-01T10:12:00Z',
      },
      {
        connectionId: hubspotKb,
        connectionType: 'knowledge_source',
        provider: 'hubspot',
        displayName: 'HubSpot knowledge base',
        providerAvailable: true,
        status: 'expired',
        statusDetail: DEAD_CREDENTIAL_DETAIL,
        createdAt: '2026-02-01T10:14:00Z',
      },
      {
        connectionId: crawl,
        connectionType: 'knowledge_source',
        provider: 'website_crawl',
        displayName: 'Website crawl',
        providerAvailable: true,
        status: 'connected',
        nonSecretConfig: { crawl_urls: ['https://sarahchen.com'] },
        createdAt: '2026-02-01T10:16:00Z',
      },
    );
    state.knowledge.push(
      {
        sourceId: 'abababab-0000-4000-8000-000000000001',
        name: 'Notion — Client onboarding',
        origin: 'notion',
        ingestionStatus: 'ready',
        sizeBytes: 800_000,
        lastUpdatedAt: '2026-09-30T08:00:00Z',
        lastSyncedAt: '2026-10-10T06:00:00Z',
        syncStatus: 'paused_reconnect_needed',
        connectionId: notion,
        usedByQuestions7d: 4,
        pausedSince: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        sourceId: 'abababab-0000-4000-8000-000000000002',
        name: 'HubSpot KB — Returns policy',
        origin: 'crm_kb',
        ingestionStatus: 'ready',
        sizeBytes: 300_000,
        lastUpdatedAt: '2026-09-20T08:00:00Z',
        lastSyncedAt: '2026-10-01T06:00:00Z',
        syncStatus: 'paused_reconnect_needed',
        connectionId: hubspotKb,
        usedByQuestions7d: 0,
        pausedSince: new Date(now - 9 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        sourceId: 'abababab-0000-4000-8000-000000000003',
        name: 'sarahchen.com/old-pricing',
        origin: 'website_crawl',
        ingestionStatus: 'ready',
        sizeBytes: 40_000,
        lastUpdatedAt: '2026-10-01T08:00:00Z',
        lastSyncedAt: '2026-10-12T06:00:00Z',
        syncStatus: 'synced',
        connectionId: crawl,
        usedByQuestions7d: 1,
      },
    );
    state.removedAtOrigin = ['abababab-0000-4000-8000-000000000003'];
  }
  if (state.scenario === 'closed' || state.scenario === 'closed_window_passed') {
    // Relative to now, never a hard-coded date: the window is a wall-clock fact.
    const ago = state.scenario === 'closed' ? 3 : 31;
    const closedAt = new Date(Date.now() - ago * DAY_MS).toISOString();
    state.closure = { closedAt, lucielBefore: state.luciel ? clone(state.luciel) : null };
    state.account.state = 'closed';
    if (state.luciel) {
      state.luciel.state = 'luciel_grace_window';
      state.luciel.graceWindowStartedAt = closedAt;
    }
  }

  // Round 7 WP-12: the persisted store wins over the seed when it was seeded from
  // the same scenario — that is what a reload reads back. `?mock_reset=1` or a
  // different scenario starts over.
  const resetRequested =
    runtime !== undefined && new URLSearchParams(runtime.search).get(MOCK_RESET_PARAM) === '1';
  if (runtime?.storage) {
    if (resetRequested) {
      try {
        runtime.storage.removeItem(MOCK_STORE_KEY);
      } catch {
        /* blocked storage: nothing persisted to drop */
      }
    } else {
      const stored = readStore(runtime.storage);
      if (stored && stored.seededScenario === seededScenario) Object.assign(state, stored.state);
    }
  }
  /** Set by the control's reset(): the next page load starts from the seed. */
  let storeDropped = false;
  const persist = () => {
    if (!runtime?.storage || storeDropped) return;
    try {
      runtime.storage.setItem(
        MOCK_STORE_KEY,
        JSON.stringify({ v: STORE_VERSION, seededScenario, state }),
      );
    } catch {
      /* blocked or full storage: this page keeps its in-memory store */
    }
  };

  const delay = () => (latency ? new Promise((r) => setTimeout(r, latency)) : Promise.resolve());

  /** Guards that model the cross-cutting states the UI must handle (§7). */
  const guardSession = () => {
    if (state.scenario === 'expired_session') {
      throw new LucielApiError({ code: 'unauthorized', message: 'Session expired.' });
    }
    // deps.current_session_subject: the cookie's epoch no longer matches the
    // account's — the plain 401 the http adapter maps, not the closed-account 403.
    if (state.sessionRevoked) {
      throw new LucielApiError({ code: 'unauthorized', message: 'Session revoked.' });
    }
  };
  /** The closure's reopen deadline (null when no closure instant is on record). */
  const reopenUntil = (): string | null =>
    state.closure
      ? new Date(new Date(state.closure.closedAt).getTime() + REOPEN_WINDOW_MS).toISOString()
      : null;
  const insideReopenWindow = () => {
    const until = reopenUntil();
    return until !== null && Date.now() < new Date(until).getTime();
  };
  /**
   * The backend's typed 403 for a closed account (errors.py `account_closed`): a
   * 403 maps to `unauthorized`, and the `reason` word + `detail` instants are what
   * tell it apart from an expired session.
   */
  const accountClosed = () =>
    new LucielApiError({
      code: 'unauthorized',
      message: 'Account closed.',
      reason: ACCOUNT_CLOSED,
      detail: { closedAt: state.closure?.closedAt ?? null, reopenUntil: reopenUntil() },
    });
  const guardVerified = () => {
    guardSession();
    if (state.account.state === 'unverified') {
      throw new LucielApiError({
        code: 'verification_required',
        message: 'Please verify your email to continue.',
      });
    }
    // deps.current_admin: every admin route refuses a closed account (D5).
    if (state.account.state === 'closed') throw accountClosed();
  };
  /**
   * deps.current_account_owner: the D5 reduced surface — open, or closed and still
   * inside the 30-day window. Past it, the same typed refusal.
   */
  const guardAccountOwner = () => {
    guardSession();
    if (state.account.state === 'unverified') {
      throw new LucielApiError({
        code: 'verification_required',
        message: 'Please verify your email to continue.',
      });
    }
    if (state.account.state === 'closed' && !insideReopenWindow()) throw accountClosed();
  };

  const ok = async <T>(value: T): Promise<T> => {
    await delay();
    return clone(value);
  };

  // Deterministic ids for anything the mock creates at runtime.
  const nextId = () => `aaaaaaaa-0000-4000-8000-${String(++state.seq).padStart(12, '0')}`;

  /**
   * The audit row the backend writes for the same action (app/audit/events.py
   * types), newest first — so the Audit log shows what the owner just did.
   */
  const audit = (eventType: string, detail?: string) => {
    const row: AuditEvent = {
      eventId: `evt-${nextId()}`,
      eventType,
      at: new Date().toISOString(),
      ...(detail ? { detail } : {}),
      actorUserId: state.account.userId,
    };
    state.audit.unshift(row);
  };

  /**
   * A consent URL for the stand-in host, carrying the provider and connection the
   * backend would have bound into its signed state — the e2e consent stub reads
   * them to send the browser back the way the backend's callback does.
   */
  const mintAuthorizeUrl = (
    connectionId: string,
    provider: string,
    kind: OauthAttempt['kind'],
    path = '/oauth/authorize',
  ) => {
    state.oauthAttempts[connectionId] = { provider, kind };
    const query = new URLSearchParams({
      provider,
      connection_id: connectionId,
      state: nextId(),
    });
    return `${MOCK_AUTHORIZE_ORIGIN}${path}?${query.toString()}`;
  };

  const addSource = (
    name: string,
    origin: KnowledgeSource['origin'],
    sizeBytes: number,
    syncStatus?: KnowledgeSource['syncStatus'],
    connectionId?: string,
  ): KnowledgeSource => {
    const now = new Date().toISOString();
    const source: KnowledgeSource = {
      sourceId: nextId(),
      name,
      origin,
      ingestionStatus: 'ready',
      sizeBytes,
      lastUpdatedAt: now,
      // A just-added source has served no answers yet — a real zero (C14).
      usedByQuestions7d: 0,
      ...(syncStatus ? { syncStatus, lastSyncedAt: now } : {}),
      ...(connectionId ? { connectionId } : {}),
    };
    state.knowledge.push(source);
    return source;
  };

  const addSyncConnection = (
    provider: KnowledgeSyncConnection['provider'],
    status: KnowledgeSyncConnection['status'],
    nonSecretConfig?: Record<string, unknown>,
  ): KnowledgeSyncConnection => {
    const connection: KnowledgeSyncConnection = {
      connectionId: nextId(),
      provider,
      status,
      ...(nonSecretConfig ? { nonSecretConfig } : {}),
    };
    state.syncConnections.push(connection);
    // The backend's knowledge connection IS a connections row (GET /connections
    // lists it, which is what "Connected sources" renders): the same id, the same
    // status, the crawl targets under the served `crawl_urls` key.
    const crawl = nonSecretConfig?.crawlUrls;
    state.connections.push({
      connectionId: connection.connectionId,
      connectionType: 'knowledge_source',
      provider,
      displayName: KNOWLEDGE_DISPLAY_NAME[provider] ?? provider,
      providerAvailable: true,
      status,
      ...(Array.isArray(crawl) ? { nonSecretConfig: { crawl_urls: crawl } } : {}),
      createdAt: new Date().toISOString(),
    });
    return connection;
  };
  /** Keep a knowledge sync connection and its connections row saying the same thing. */
  const setKnowledgeStatus = (connectionId: string, status: Connection['status']) => {
    const sync = state.syncConnections.find((x) => x.connectionId === connectionId);
    if (sync) sync.status = status;
    const row = state.connections.find((x) => x.connectionId === connectionId);
    if (row) row.status = status;
  };

  // --- Knowledge sync truth (round 7 WP-4c) ---------------------------------------
  /**
   * knowledge.py `_flag_dead_credential`: the provider refused the stored grant. The
   * connection's sources pause (the D10 clock starts once per incident) and a row
   * that said connected is marked broken — so the chip follows the SERVED status.
   */
  const flagDeadCredential = (connectionId: string) => {
    const now = new Date().toISOString();
    for (const k of state.knowledge) {
      if (k.connectionId === connectionId) {
        k.syncStatus = 'paused_reconnect_needed';
        k.pausedSince ??= now;
      }
    }
    const conn = state.connections.find((c) => c.connectionId === connectionId);
    if (conn && conn.status === 'connected') {
      conn.status = 'error';
      conn.statusDetail = DEAD_CREDENTIAL_DETAIL;
    }
  };
  const syncUnavailable = () =>
    new LucielApiError({
      code: 'conflict',
      message: 'Sync unavailable: the provider refused the stored credential — reconnect it.',
    });
  /** sync.py: an item gone at its origin becomes an ORIGIN tombstone (never restorable). */
  const tombstoneAtOrigin = (sourceId: string) => {
    const gone = state.knowledge.find((k) => k.sourceId === sourceId);
    if (!gone) return;
    state.knowledge = state.knowledge.filter((k) => k.sourceId !== sourceId);
    state.deletedKnowledge.push(gone);
    state.tombstoneBy[sourceId] = 'origin';
    state.removedAtOrigin = state.removedAtOrigin.filter((id) => id !== sourceId);
  };

  // --- SMS escalation-contact confirmation (round 7 WP-4b) ----------------------
  /** Whether a number is connected to send a code from (resolve_sms_number). */
  const smsSenderConnected = () => {
    const sms = state.luciel?.channels.find((c) => c.id === 'sms');
    return Boolean(
      sms?.connectionStatus &&
      !['unconfigured', 'not_connected', 'revoked'].includes(sms.connectionStatus),
    );
  };
  /** luciel._configured_contacts: the pillar slots plus the after-hours contact. */
  const configuredContacts = (): { channel: 'email' | 'sms'; role: string; value: string }[] => {
    if (!state.luciel) return [];
    const esc = state.luciel.escalation;
    const out: { channel: 'email' | 'sms'; role: string; value: string }[] = [];
    if (esc.primaryEmail) out.push({ channel: 'email', role: 'primary', value: esc.primaryEmail });
    if (esc.secondaryEmail)
      out.push({ channel: 'email', role: 'secondary', value: esc.secondaryEmail });
    if (esc.primarySms) out.push({ channel: 'sms', role: 'primary', value: esc.primarySms });
    if (esc.secondarySms) out.push({ channel: 'sms', role: 'secondary', value: esc.secondarySms });
    const after = state.luciel.teamAvailability?.afterHours?.escalation;
    if (after?.channel === 'sms' && after.contactSms) {
      out.push({ channel: 'sms', role: 'after_hours', value: after.contactSms });
    } else if (after?.channel === 'email' && after.contactEmail) {
      out.push({ channel: 'email', role: 'after_hours', value: after.contactEmail });
    }
    return out;
  };
  /** contact_confirmation.begin_sms_confirmation, with the mock's fixed code. */
  const beginSmsConfirmation = (number: string, force: boolean): string => {
    const key = normalizeNumber(number);
    const now = Date.now();
    const row = (state.smsConfirmations[key] ??= {
      code: null,
      expiresAt: null,
      attempts: 0,
      confirmedAt: null,
      lastSentAt: null,
    });
    if (row.confirmedAt) return 'already_confirmed';
    if (row.lastSentAt !== null && now - row.lastSentAt < SMS_RESEND_COOLDOWN_MS) return 'cooldown';
    const live =
      row.code !== null &&
      row.expiresAt !== null &&
      row.expiresAt > now &&
      row.attempts < SMS_MAX_ATTEMPTS;
    if (!force && live) return 'pending';
    if (!smsSenderConnected()) return 'sms_channel_not_provisioned';
    row.code = MOCK_SMS_CODE;
    row.expiresAt = now + SMS_CODE_TTL_MS;
    row.lastSentAt = now;
    row.attempts = 0;
    return 'sent';
  };
  /**
   * luciel._contact_health: every configured contact with its deliverability truth.
   * Email states are kept as they were (the link loop owns them); a newly saved email
   * starts pending. SMS states derive from the confirmation rows and the clock.
   */
  const refreshContactHealth = () => {
    if (!state.luciel) return;
    const previous = state.luciel.escalationContactHealth;
    const now = Date.now();
    const sender = smsSenderConnected();
    state.luciel.escalationContactHealth = configuredContacts().map(
      ({ channel, role, value }): EscalationContactHealth => {
        if (channel === 'email') {
          const before = previous.find(
            (h) =>
              (h.channel ?? 'email') === 'email' && h.address.toLowerCase() === value.toLowerCase(),
          );
          return {
            address: value,
            state: before?.state ?? 'pending_confirmation',
            verifiedAt: before?.verifiedAt ?? null,
            lastBouncedAt: before?.lastBouncedAt ?? null,
            channel,
            role: role as EscalationContactHealth['role'],
            detail: before?.state === 'bouncing' ? (before.detail ?? null) : null,
          };
        }
        const row = state.smsConfirmations[normalizeNumber(value)];
        const smsState: EscalationContactHealth['state'] = row?.confirmedAt
          ? 'verified'
          : row?.code && row.expiresAt !== null && row.expiresAt > now
            ? 'pending_confirmation'
            : 'unverified';
        return {
          address: value,
          state: smsState,
          verifiedAt: row?.confirmedAt ?? null,
          lastBouncedAt: null,
          channel,
          role: role as EscalationContactHealth['role'],
          detail: smsState !== 'verified' && !sender ? 'sms_channel_not_provisioned' : null,
        };
      },
    );
  };
  /** A save kicks the code to every configured, unproven number (_kick_sms_confirmation). */
  const kickSmsConfirmations = () => {
    for (const c of configuredContacts()) {
      if (c.channel === 'sms') beginSmsConfirmation(c.value, false);
    }
  };
  // The seeded SMS scenario's health is derived like any other (after the helpers exist).
  if (state.scenario === 'escalation_sms') refreshContactHealth();

  /**
   * The tenant's CURRENT ability to push a lead (round 7 WP-3c item 5), read the
   * way the backend's _CrmPosture reads it: the CRM row's status and whether the
   * Push to CRM tool is on. The reason a never-pushed lead shows is exactly the
   * reason the next push would be refused for.
   */
  const crmPosture = () => {
    const row = state.connections.find((c) => c.connectionType === 'crm' && c.status !== 'revoked');
    const toolOn = state.luciel?.tools.some((t) => t.id === 'push_to_crm' && t.enabled) ?? false;
    const status = row?.status ?? null;
    return {
      provider: row?.provider ?? null,
      status,
      toolOn,
      canPush: toolOn && status === 'connected',
    };
  };
  /** The identifier the CRM accepts: an email, or a phone for a custom webhook. */
  const crmKeyFor = (l: Lead, provider: string | null): string | null => {
    const email =
      l.email ??
      (l.contactIdentifier && l.contactIdentifier.includes('@') ? l.contactIdentifier : null);
    if (email) return email;
    if (provider === 'custom_webhook' && l.phone) return l.phone;
    return null;
  };
  const neverAttemptedReason = (l: Lead): NeverAttemptedReason => {
    const posture = crmPosture();
    if (posture.status !== 'connected') {
      return posture.status === 'dormant' ? 'dormant' : 'crm_not_connected';
    }
    if (!posture.toolOn) return 'tool_off';
    if (crmKeyFor(l, posture.provider) === null) return 'no_crm_key';
    return 'not_yet_pushed';
  };
  /** The ONE lead wire builder: every lead response carries the derived state. */
  const withCrmPosture = (l: Lead): Lead =>
    l.crmStatus === 'synced' || l.crmStatus === 'failed'
      ? l
      : { ...l, crmStatus: 'never_attempted', crmDetail: neverAttemptedReason(l) };

  /** A knowledge sync connection is either one created here or a seeded row. */
  const syncProviderOf = (connectionId: string): KnowledgeSyncProvider => {
    const sync = state.syncConnections.find((x) => x.connectionId === connectionId);
    if (sync) return sync.provider;
    const conn = state.connections.find((x: Connection) => x.connectionId === connectionId);
    if (conn?.connectionType === 'knowledge_source') {
      return conn.provider as KnowledgeSyncProvider;
    }
    throw new LucielApiError({ code: 'not_found', message: 'Connection not found.' });
  };

  const client: LucielApiClient = {
    auth: {
      async signup() {
        await delay();
        return {
          account: clone({
            ...state.account,
            state: 'unverified',
            emailVerified: false,
          }) as Account,
          emailDeliveryDegraded: false,
        };
      },
      async login() {
        await delay();
        // A sign-in is a NEW session: whatever expired before (a stale cookie, a
        // password reset that revoked every session) no longer applies.
        if (state.scenario === 'expired_session') state.scenario = 'verified';
        // ...and a session a closure revoked: the new one carries the bumped epoch.
        // A closed account signs in (D5); the session says closed and the login
        // page routes it to the reduced page.
        state.sessionRevoked = false;
        // The backend's Set-Cookie, modelled: the presence cookie the middleware
        // gates the dashboard on (browser runtime only — it has no httpOnly flag).
        runtime?.writeCookie(`${SESSION_COOKIE}=mock-session; path=/; SameSite=Lax`);
        const next =
          state.account.state === 'unverified'
            ? ('verify_wall' as const)
            : state.account.hasCompletedFirstRun
              ? ('dashboard' as const)
              : ('first_run' as const);
        return { account: clone(state.account), nextRoute: next };
      },
      async logout() {
        await delay();
        runtime?.writeCookie(
          `${SESSION_COOKIE}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`,
        );
      },
      async me() {
        guardSession();
        await delay();
        const next =
          state.account.state === 'unverified'
            ? ('verify_wall' as const)
            : state.account.hasLuciel
              ? ('dashboard' as const)
              : ('first_run' as const);
        // Legal §A5/§A10 dashboard notices ride on the session payload. None in
        // the steady state — a notice exists only while a reduction or material
        // change is inside its notice window.
        return { account: clone(state.account), nextRoute: next, notices: [] };
      },
      async verifyEmail() {
        await delay();
        state.account.state = 'verified';
        state.account.emailVerified = true;
        return { account: clone(state.account), nextRoute: 'first_run' };
      },
      async resendVerification() {
        await delay();
        return { ok: true, emailDeliveryDegraded: false };
      },
      async forgotPassword() {
        await delay();
        return { ok: true };
      },
      async resetPassword() {
        await delay();
        // Reset revokes all sessions (Arch §3.7.1a) — model by flipping to expired.
        state.scenario = 'expired_session';
        return { ok: true };
      },
    },

    luciel: {
      async get() {
        guardVerified();
        // SMS confirmation states move with the clock (a code expires).
        if (state.luciel?.escalationContactHealth.some((h) => h.channel === 'sms')) {
          refreshContactHealth();
        }
        return ok(state.luciel);
      },
      async create(req) {
        guardVerified();
        await delay();
        state.luciel = {
          ...clone(seed.seedLuciel),
          name: req.name,
          websiteUrl: req.websiteUrl,
        };
        state.luciel.personality = {
          ...state.luciel.personality,
          voiceDisclosurePreview: buildVoiceDisclosure(null),
        };
        state.account.hasLuciel = true;
        state.account.hasCompletedFirstRun = true;
        audit('instance_created', req.name);
        return clone(state.luciel);
      },
      async updateChannels(channels) {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        state.luciel.channels = clone(channels);
        audit('instance_configured', 'channels changed');
        return ok(state.luciel);
      },
      async updateTools(tools) {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        // `disabledReason` is server-derived: accepted on the way in, then ignored
        // and re-derived, exactly as the backend does (contract §3).
        const previous = state.luciel.tools;
        state.luciel.tools = clone(tools).map((t) => {
          const before = previous.find((p) => p.id === t.id);
          return {
            ...t,
            ...(before?.connectionStatus ? { connectionStatus: before.connectionStatus } : {}),
            disabledReason: before?.disabledReason ?? null,
          };
        });
        audit('instance_configured', 'tools changed');
        return ok(state.luciel);
      },
      async capabilities() {
        guardVerified();
        return ok(seed.seedCapabilities);
      },
      async rotateEmbedKey() {
        guardVerified();
        if (!state.luciel)
          throw new LucielApiError({ code: 'not_found', message: 'No Luciel yet.' });
        await delay();
        state.luciel = {
          ...state.luciel,
          embedKeyPublicId: `vm_live_${Math.random().toString(16).slice(2, 14)}`,
        };
        audit('embed_key_rotated');
        return ok(state.luciel);
      },
      async updateEscalation(contact) {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        // E.164 at save time, mirroring the backend (2026-09-05 audit F084): formatting
        // is forgiven, anything else is refused — an extension cannot receive a text.
        const e164 = (value: string | undefined) => {
          if (!value) return undefined;
          const cleaned = value.replace(/[\s\-.()]/g, '');
          if (!/^\+[1-9]\d{7,14}$/.test(cleaned)) {
            throw new LucielApiError({
              code: 'validation_error',
              message:
                'Enter the number in international format, e.g. +16045551234 (country code first, digits only).',
            });
          }
          return cleaned;
        };
        state.luciel.escalation = clone({
          ...contact,
          primarySms: e164(contact.primarySms),
          secondarySms: e164(contact.secondarySms),
        });
        // Round 5B item 13, mirroring the backend's save hook: a newly saved
        // email contact enters the confirmation loop; an already-verified one
        // keeps its state. Health is server-owned and never rides in the PUT.
        // A newly saved email restarts its loop; a verified one keeps its state. Round
        // 7 WP-4b: a saved number is texted its 6-digit code the same way.
        const kept = state.luciel.escalationContactHealth.filter(
          (h) => (h.channel ?? 'email') !== 'email' || h.state === 'verified',
        );
        state.luciel.escalationContactHealth = kept;
        kickSmsConfirmations();
        refreshContactHealth();
        audit('instance_configured', 'escalation contacts changed');
        return ok(state.luciel);
      },
      async confirmSmsContact(number, code) {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        // The StrictWireModel's pattern answers first (422, the converted body).
        if (!/^[0-9]{6}$/.test(code)) {
          throw new LucielApiError({
            code: 'validation_error',
            message: "code: String should match pattern '^[0-9]{6}$'",
          });
        }
        const now = Date.now();
        state.smsConfirmEntries = state.smsConfirmEntries.filter(
          (t) => now - t < SMS_CONFIRM_WINDOW_MS,
        );
        if (state.smsConfirmEntries.length >= SMS_CONFIRM_BURST) {
          throw new LucielApiError({
            code: 'rate_limited',
            message: 'Too many code entries. Please wait a few minutes.',
            retryAfterSeconds: 60,
          });
        }
        state.smsConfirmEntries.push(now);
        const key = normalizeNumber(number);
        const configured = configuredContacts()
          .filter((c) => c.channel === 'sms')
          .map((c) => normalizeNumber(c.value));
        if (!key || !configured.includes(key)) {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'That number is not currently configured as an escalation contact.',
          });
        }
        // contact_confirmation.confirm_sms_code, outcome for outcome.
        const row = state.smsConfirmations[key];
        let outcome: string;
        if (!row) outcome = 'no_pending';
        else if (row.confirmedAt) outcome = 'already_confirmed';
        else if (row.code === null || row.expiresAt === null) outcome = 'no_pending';
        else if (row.expiresAt <= now) outcome = 'expired';
        else if (row.attempts >= SMS_MAX_ATTEMPTS) outcome = 'locked';
        else if (code !== row.code) {
          row.attempts += 1;
          outcome = row.attempts >= SMS_MAX_ATTEMPTS ? 'locked' : 'wrong_code';
        } else {
          row.confirmedAt = new Date(now).toISOString();
          row.code = null;
          row.expiresAt = null;
          outcome = 'confirmed';
        }
        refreshContactHealth();
        return ok({ outcome, luciel: state.luciel });
      },
      async sendTestEscalationSms(which) {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        const number =
          which === 'primary'
            ? state.luciel.escalation.primarySms
            : state.luciel.escalation.secondarySms;
        if (!number) {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'No SMS contact is saved in that slot yet.',
          });
        }
        // The text goes out through the tenant's OWN number (BYO): without an SMS
        // channel it is honestly undeliverable, never a pretend green.
        const smsOn = state.luciel.channels.some((c) => c.id === 'sms' && c.enabled);
        return { delivered: smsOn, detail: smsOn ? null : 'channel_not_provisioned' };
      },
      async resendContactConfirmation(address) {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        if (looksLikeNumber(address)) {
          // Round 7 WP-4b: a number gets a fresh code (the backend's SMS branch).
          const configured = configuredContacts()
            .filter((c) => c.channel === 'sms')
            .map((c) => normalizeNumber(c.value));
          if (!configured.includes(normalizeNumber(address))) {
            throw new LucielApiError({
              code: 'validation_error',
              message: 'That number is not currently configured as an escalation contact.',
            });
          }
          const outcome = beginSmsConfirmation(address, true);
          const refusal: Record<string, string> = {
            cooldown: 'A code was sent moments ago — give it a few minutes, then retry.',
            already_confirmed: 'That number is already confirmed.',
            sms_channel_not_provisioned:
              'Connect an SMS number under Configure → Channels first — the confirmation code is sent from your own number.',
          };
          if (outcome !== 'sent') {
            throw new LucielApiError({
              code: 'validation_error',
              message: refusal[outcome] ?? `The code could not be sent (${outcome}).`,
            });
          }
          refreshContactHealth();
          return ok(state.luciel);
        }
        const entry = state.luciel.escalationContactHealth.find((h) => h.address === address);
        if (!entry) {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'That address is not currently configured as an escalation contact.',
          });
        }
        // Re-minting restarts the loop — a bouncing address goes back to pending
        // until the recipient clicks the fresh link (re-verifying un-suppresses).
        if (entry.state !== 'verified') entry.state = 'pending_confirmation';
        return ok(state.luciel);
      },
      async updatePersonality(config) {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        // What reaches the server after the HTTP adapter's transform: the read-only
        // preview never rides in the strict PUT.
        const written = personalityForWrite(config);
        const intro = written.voiceDisclosureIntro;
        if (typeof intro === 'string' && intro.length > VOICE_DISCLOSURE_INTRO_MAX) {
          throw new LucielApiError({
            code: 'validation_error',
            message: `voiceDisclosureIntro: String should have at most ${VOICE_DISCLOSURE_INTRO_MAX} characters`,
          });
        }
        const cleaned = typeof intro === 'string' ? intro.trim() : intro;
        state.luciel.personality = {
          ...clone(written),
          ...(cleaned !== undefined ? { voiceDisclosureIntro: cleaned || null } : {}),
          voiceDisclosurePreview: buildVoiceDisclosure(cleaned),
        };
        audit('instance_configured', 'personality changed');
        return ok(state.luciel);
      },
      async updateLeadRetention(days) {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        if (days !== null && (!Number.isInteger(days) || days < 1)) {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'Retention window must be a whole number of days, at least 1.',
          });
        }
        state.luciel.leadRetentionDays = days;
        return ok(state.luciel);
      },
      async updateAllowedOrigins(origins) {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        // The server's rule, modelled: scheme://host[:port] only, at most ten.
        const normalised: string[] = [];
        for (const raw of origins) {
          let url: URL;
          try {
            url = new URL(raw.trim());
          } catch {
            throw new LucielApiError({
              code: 'validation_error',
              message: `'${raw}' is not a website address — use the form https://www.example.com (no path or query).`,
            });
          }
          const bareOrigin =
            (url.protocol === 'https:' || url.protocol === 'http:') &&
            (url.pathname === '/' || url.pathname === '') &&
            !url.search &&
            !url.hash &&
            !url.username;
          if (!bareOrigin) {
            throw new LucielApiError({
              code: 'validation_error',
              message: `'${raw}' is not a website address — use the form https://www.example.com (no path or query).`,
            });
          }
          if (!normalised.includes(url.origin)) normalised.push(url.origin);
        }
        if (normalised.length > 10) {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'At most ten websites can be listed.',
          });
        }
        state.luciel.allowedOrigins = normalised.length ? normalised : null;
        audit('instance_configured', 'allowed websites changed');
        return ok(state.luciel);
      },
      async updateTeamAvailability(req) {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        // The server's rules, modelled: a timezone when on, 24-hour HH:MM windows with
        // length, and someone on the other end of an after-hours rule.
        const tz = req.timezone?.trim() || null;
        if (req.enabled && !tz) {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'Choose your timezone before turning this on.',
          });
        }
        const hhmm = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;
        for (const w of req.weekly ?? []) {
          if (!hhmm.test(w.start) || !hhmm.test(w.end)) {
            throw new LucielApiError({
              code: 'validation_error',
              message: 'Use a 24-hour time like 09:00 or 17:30.',
            });
          }
          if (w.start === w.end) {
            throw new LucielApiError({
              code: 'validation_error',
              message: 'A window has to end after it starts.',
            });
          }
        }
        const esc = req.afterHours?.escalation;
        if (esc?.channel === 'sms' && !esc.contactSms) {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'Add the number the after-hours text should go to.',
          });
        }
        if (esc?.channel === 'email' && !esc.contactEmail) {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'Add the address the after-hours email should go to.',
          });
        }
        state.luciel.timezone = tz;
        state.luciel.teamAvailability = clone({
          enabled: req.enabled ?? false,
          weekly: req.weekly ?? [],
          closures: req.closures ?? [],
          afterHours: req.afterHours ?? null,
        });
        // Round 7 WP-4b: the after-hours contact is confirmed like any other — a
        // saved number is texted its code, and the health list names it.
        kickSmsConfirmations();
        refreshContactHealth();
        audit('instance_configured', 'team availability changed');
        return ok(state.luciel);
      },
      async status() {
        guardVerified();
        if (!state.luciel) return ok(null);
        // Derived from the mock's own state the way the server derives it from rows:
        // the identity from the Luciel, the budget from billing, needs from what is
        // not connected. The counts are the seed's.
        const budget = state.billing.budget;
        const needs: EmployeeStatus['needs'] = [];
        const escalation = state.luciel.escalation;
        if (!escalation.primaryEmail && !escalation.primarySms) {
          needs.push({
            code: 'no_escalation_contact',
            severity: 'attention',
            title: 'No escalation contact',
            detail:
              'Hand-offs only reach your account email. Add a contact under Configure → Escalation.',
            href: '/dashboard/configure',
          });
        }
        if (state.luciel.teamAvailability?.enabled !== true) {
          needs.push({
            code: 'team_availability_unset',
            severity: 'info',
            title: 'Tell customers when your team is reachable (optional)',
            detail:
              'Luciel answers around the clock either way; this only makes follow-up promises exact.',
            href: '/dashboard/configure',
          });
        }
        if (!state.luciel.allowedOrigins?.length) {
          needs.push({
            code: 'allowed_origins_unset',
            severity: 'info',
            title: 'Name the websites that may load your chat',
            detail: 'Right now any page that copies your embed key can use it.',
            href: '/dashboard/embed',
          });
        }
        // Round 7 WP-3a: dormant is a BILLING state — the credential is intact and
        // Connect would refuse — so the need sends the owner to Billing, with the
        // server's own words (app/employee/status.py DORMANT_NEED_DETAIL/BILLING_HREF).
        for (const c of state.luciel.channels) {
          if (c.enabled && c.connectionStatus === 'dormant') {
            needs.push({
              code: `channel_dormant:${c.id}`,
              severity: 'attention',
              title: `${CHANNEL_NEED_LABEL[c.id]}: ${DORMANT_STATUS_DETAIL}`,
              detail: DORMANT_NEED_DETAIL,
              href: BILLING_HREF,
            });
          }
        }
        for (const t of state.luciel.tools) {
          if (t.enabled && t.connectionStatus === 'dormant') {
            needs.push({
              code: `tool_dormant:${t.id}`,
              severity: 'attention',
              title: `${t.id.replace(/_/g, ' ')}: ${DORMANT_STATUS_DETAIL}`,
              detail: DORMANT_NEED_DETAIL,
              href: BILLING_HREF,
            });
          }
        }
        const capabilities: EmployeeStatus['capabilities'] = state.luciel.channels.map((c) => ({
          id: c.id,
          kind: 'channel' as const,
          label: c.id === 'widget' ? 'Website chat' : c.id,
          state: !c.enabled
            ? ('off' as const)
            : c.id === 'widget' || c.connectionStatus === 'connected'
              ? ('ready' as const)
              : ('attention' as const),
          detail: c.id === 'widget' && c.enabled ? 'on your website' : null,
        }));
        return ok({
          assistantName: state.luciel.name,
          businessShortName: state.luciel.businessShortName ?? null,
          onDuty: 'around the clock',
          conversationsUsed: budget.conversationsThisPeriod,
          freeAllowance: budget.freeAllowance,
          freeRemaining: Math.max(budget.freeAllowance - budget.conversationsThisPeriod, 0),
          billedBlocks: budget.accruedBlocks ?? 0,
          billable: budget.billable ?? true,
          periodResetsAt: budget.periodResetsAt,
          timezone: state.luciel.timezone ?? null,
          teamReachableNow: state.luciel.teamAvailability?.enabled ? true : null,
          nextReachable: null,
          capabilities,
          needs,
          yesterday: seed.seedDayCounts.yesterday,
          today: seed.seedDayCounts.today,
          dailyBriefEnabled: state.luciel.dailyBriefEnabled ?? true,
        } satisfies EmployeeStatus);
      },
      async updateDailyBrief(enabled) {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        state.luciel.dailyBriefEnabled = enabled;
        return ok(state.luciel);
      },
      async updateBusinessName(name) {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        const cleaned = (name ?? '').trim();
        if (cleaned.length > 80) {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'Keep the business name under 80 characters.',
          });
        }
        state.luciel.businessShortName = cleaned || null;
        return ok(state.luciel);
      },
      async withdrawVoiceConsent() {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        state.luciel.channels = state.luciel.channels.map((c) => {
          if (c.id !== 'voice') return c;
          const { voiceConsentAcknowledgedAt: _gone, ...rest } = c;
          return { ...rest, enabled: false };
        });
        return ok(state.luciel);
      },
      async withdrawSmsComplianceAck() {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        state.luciel.channels = state.luciel.channels.map((c) => {
          if (c.id !== 'sms') return c;
          const { smsComplianceAcknowledgedAt: _gone, ...rest } = c;
          return { ...rest, enabled: false };
        });
        // F163: the dependent send tool goes off with the channel, server-side.
        state.luciel.tools = state.luciel.tools.map((t) =>
          t.id === 'send_sms' && t.enabled
            ? { ...t, enabled: false, disabledReason: 'sms_channel_disabled' }
            : t,
        );
        return ok(state.luciel);
      },
      async acknowledgeVoiceConsent() {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        const voice = state.luciel.channels.find((c) => c.id === 'voice');
        if (voice) voice.voiceConsentAcknowledgedAt = new Date().toISOString();
        return ok(state.luciel);
      },
      async pause() {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        audit('lifecycle_transition', `${state.luciel.state} → paused`);
        state.luciel.state = 'paused';
        return ok(state.luciel);
      },
      async resume() {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        audit('lifecycle_transition', `${state.luciel.state} → active`);
        state.luciel.state = 'active';
        return ok(state.luciel);
      },
      async delete() {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        audit('lifecycle_transition', `${state.luciel.state} → luciel_grace_window`);
        state.luciel.state = 'luciel_grace_window';
        state.luciel.graceWindowStartedAt = new Date().toISOString();
        return ok(state.luciel);
      },
      async restore() {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        // Restore returns ACTIVE, not paused (Arch §3.6.4).
        audit('lifecycle_transition', `${state.luciel.state} → active (restored)`);
        state.luciel.state = 'active';
        delete state.luciel.graceWindowStartedAt;
        return ok(state.luciel);
      },
    },

    knowledge: {
      async listSources() {
        guardVerified();
        return ok(state.knowledge);
      },
      async getChunks(sourceId) {
        guardVerified();
        // KnowledgeChunkPageOut (round 7 WP-4c #6): the first page WITH the real
        // count. The mock sizes a source at ~60 KB per piece so a larger file has
        // more pieces than one page holds.
        const source = state.knowledge.find((k) => k.sourceId === sourceId);
        if (!source) throw new LucielApiError({ code: 'not_found', message: 'Source not found.' });
        const total = Math.max(1, Math.round(source.sizeBytes / 60_000));
        const chunks = Array.from({ length: Math.min(total, CHUNK_PREVIEW_PAGE) }, (_, i) => ({
          chunkId: `c0c0c0c0-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
          sourceId,
          ordinal: i,
          text: `Piece ${i + 1} of “${source.name}”: sample chunk preview text.`,
        }));
        return ok({ chunks, totalChunks: total, pageSize: CHUNK_PREVIEW_PAGE });
      },
      async quota() {
        guardVerified();
        return ok({
          usedBytes: state.knowledge.reduce((n, s) => n + s.sizeBytes, 0),
          totalBytes: 5_000_000_000,
          perFileMaxBytes: PER_FILE_MAX_BYTES,
        });
      },
      async deleteSource(sourceId) {
        guardVerified();
        const gone = state.knowledge.find((s) => s.sourceId === sourceId);
        state.knowledge = state.knowledge.filter((s) => s.sourceId !== sourceId);
        // Tombstoned, not destroyed: the 30-day undo window (Arch §3.2.2).
        if (gone) {
          state.deletedKnowledge.push(gone);
          state.tombstoneBy[sourceId] = 'owner';
          audit('knowledge_source_deleted', gone.name);
        }
        await delay();
      },
      async restoreSource(sourceId) {
        guardVerified();
        const idx = state.deletedKnowledge.findIndex((s) => s.sourceId === sourceId);
        if (idx < 0) {
          throw new LucielApiError({
            code: 'not_found',
            message: 'Nothing to restore: the source is not in its undo window.',
          });
        }
        const back = state.deletedKnowledge[idx];
        if (!back) {
          throw new LucielApiError({ code: 'not_found', message: 'Source not found.' });
        }
        // Round 7 WP-4c #9: gone at its origin — nothing here can bring it back.
        if (state.tombstoneBy[sourceId] === 'origin') {
          const origin = back.origin === 'crm_kb' ? 'crm_kb' : back.origin;
          throw new LucielApiError({
            code: 'conflict',
            message: `${back.name} was removed at its sync source (${origin}) and cannot be restored here. Re-add it at the source and sync again.`,
          });
        }
        delete state.tombstoneBy[sourceId];
        state.deletedKnowledge.splice(idx, 1);
        state.knowledge.push(back);
        audit('knowledge_source_restored', back.name);
        return ok(back);
      },
      async resyncSource(sourceId) {
        guardVerified();
        const s = state.knowledge.find((k) => k.sourceId === sourceId);
        if (!s) throw new LucielApiError({ code: 'not_found', message: 'Source not found.' });
        // knowledge.py resync_source, round 7: a revoked grant pauses the sources and
        // marks the connection broken BEFORE the 409; an item gone at its origin is
        // tombstoned by the sync and the route answers an honest 404.
        if (s.connectionId && state.revokedGrants.includes(s.connectionId)) {
          flagDeadCredential(s.connectionId);
          throw syncUnavailable();
        }
        if (state.removedAtOrigin.includes(sourceId)) {
          tombstoneAtOrigin(sourceId);
          throw new LucielApiError({
            code: 'not_found',
            message: 'Source no longer exists at the sync origin.',
          });
        }
        s.lastSyncedAt = new Date().toISOString();
        s.syncStatus = 'synced';
        return ok(s);
      },
      async renameSource(sourceId, name) {
        guardVerified();
        const s = state.knowledge.find((k) => k.sourceId === sourceId);
        if (!s) throw new LucielApiError({ code: 'not_found', message: 'Source not found.' });
        const trimmed = name.trim();
        if (!trimmed) {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'Give the source a name.',
          });
        }
        s.name = trimmed;
        s.lastUpdatedAt = new Date().toISOString();
        return ok(s);
      },
      async replaceSource(sourceId, file) {
        guardVerified();
        const s = state.knowledge.find((k) => k.sourceId === sourceId);
        if (!s) throw new LucielApiError({ code: 'not_found', message: 'Source not found.' });
        if (file.size > PER_FILE_MAX_BYTES) {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'Knowledge quota: file exceeds the 50 MB per-file limit.',
          });
        }
        s.sizeBytes = file.size;
        s.ingestionStatus = 'ready';
        s.lastUpdatedAt = new Date().toISOString();
        return ok(s);
      },
      async uploadFile(file, name) {
        guardVerified();
        if (file.size > PER_FILE_MAX_BYTES) {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'Knowledge quota: file exceeds the 50 MB per-file limit.',
          });
        }
        return ok(addSource(name, file.name.endsWith('.csv') ? 'csv' : 'upload', file.size));
      },
      async pasteText(req) {
        guardVerified();
        return ok(addSource(req.name, 'paste', req.text.length));
      },
      async importCsv(file, name) {
        guardVerified();
        if (file.size > PER_FILE_MAX_BYTES) {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'Knowledge quota: file exceeds the 50 MB per-file limit.',
          });
        }
        return ok(addSource(name, 'csv', file.size));
      },
      async startSyncConnection(provider) {
        guardVerified();
        // OAuth-class providers start unconfigured — nothing syncs until the
        // account is authorized (Arch §3.8.4 lifecycle starts at unconfigured).
        // Providers with no registered OAuth client do not fail: they come back
        // with a placeholder URL the UI must not follow, plus an honest detail.
        const configured =
          provider === 'google_drive' || provider === 'hubspot' || provider === 'salesforce';
        const connection = addSyncConnection(provider, 'unconfigured', {
          oauth_state_jti: nextId(),
        });
        connection.nonSecretConfig = {
          ...connection.nonSecretConfig,
          authorize_url: configured
            ? mintAuthorizeUrl(connection.connectionId, provider, 'knowledge', '/o/oauth2/v2/auth')
            : `https://${provider}.invalid/authorize`,
        };
        if (!configured) {
          connection.statusDetail =
            "Action needed: this provider's OAuth client is not configured yet";
        }
        return ok(connection);
      },
      async startCrawl(crawlUrls) {
        guardVerified();
        return ok(addSyncConnection('website_crawl', 'connected', { crawlUrls }));
      },
      async syncConnection(connectionId, opts) {
        guardVerified();
        const c = state.syncConnections.find((x) => x.connectionId === connectionId);
        // The mock models the shrink refusal (F107) so the UI's confirm path is
        // exercisable: a crawl re-synced after its pages were removed at the source.
        if (c && c.nonSecretConfig?.mockShrink && !opts?.confirmShrink) {
          throw new LucielApiError({
            code: 'conflict',
            message:
              'The source now reports 1 item(s) where 4 are synced, so nothing was removed. If you did remove them at the source, sync again and confirm the shrink.',
          });
        }
        if (!c) {
          // A knowledge connection listed under /connections (the seeded Drive, or
          // a row the scenario adds) syncs too — with the same round-7 truths.
          const row = state.connections.find(
            (x) => x.connectionId === connectionId && x.connectionType === 'knowledge_source',
          );
          if (!row) {
            throw new LucielApiError({ code: 'not_found', message: 'Connection not found.' });
          }
          if (state.revokedGrants.includes(connectionId) || row.status !== 'connected') {
            flagDeadCredential(connectionId);
            throw syncUnavailable();
          }
          const removed = state.knowledge
            .filter(
              (k) => k.connectionId === connectionId && state.removedAtOrigin.includes(k.sourceId),
            )
            .map((k) => k.name);
          for (const k of [...state.knowledge]) {
            if (k.connectionId === connectionId && state.removedAtOrigin.includes(k.sourceId)) {
              tombstoneAtOrigin(k.sourceId);
            }
          }
          const now = new Date().toISOString();
          for (const k of state.knowledge) {
            if (k.connectionId === connectionId) {
              k.lastSyncedAt = now;
              k.syncStatus = 'synced';
            }
          }
          return ok({ added: [], updated: [], removed });
        }
        if (state.revokedGrants.includes(connectionId) && c.status === 'connected') {
          flagDeadCredential(connectionId);
          setKnowledgeStatus(connectionId, 'error');
          throw syncUnavailable();
        }
        if (c.status !== 'connected') {
          throw new LucielApiError({
            code: 'conflict',
            message: 'Sync unavailable: this connection is not authorized yet.',
          });
        }
        // A re-sync is idempotent: a page already synced is refreshed, never added twice.
        const urls = (c.nonSecretConfig?.crawlUrls as string[] | undefined) ?? [];
        const now = new Date().toISOString();
        const added: string[] = [];
        const updated: string[] = [];
        for (const u of urls) {
          const existing = state.knowledge.find(
            (k) => k.connectionId === connectionId && k.name === u,
          );
          if (existing) {
            existing.lastSyncedAt = now;
            existing.syncStatus = 'synced';
            updated.push(u);
          } else {
            addSource(u, 'website_crawl', 40_000, 'synced', connectionId);
            added.push(u);
          }
        }
        return ok({ added, updated, removed: [] });
      },
      async getScope(connectionId) {
        guardVerified();
        const provider = syncProviderOf(connectionId);
        // Unscoped is the default: the WHOLE account is read.
        return ok(
          state.knowledgeScopes[connectionId] ?? {
            connectionId,
            provider,
            scopeKind: SCOPE_KINDS[provider] ?? null,
            selections: [],
            wholeAccount: true,
          },
        );
      },
      async listScopeCandidates(connectionId) {
        guardVerified();
        const provider = syncProviderOf(connectionId);
        const candidates = SCOPE_CANDIDATES[provider];
        if (!candidates) {
          throw new LucielApiError({
            code: 'conflict',
            message: `Scope unavailable: ${provider} has nothing to narrow.`,
          });
        }
        return ok(candidates);
      },
      async saveScope(connectionId, selections) {
        guardVerified();
        const provider = syncProviderOf(connectionId);
        const scopeKind = SCOPE_KINDS[provider];
        if (!scopeKind) {
          throw new LucielApiError({
            code: 'validation_error',
            message: `'${provider}' has no selectable scope.`,
          });
        }
        const scope: KnowledgeScope = {
          connectionId,
          provider,
          scopeKind,
          selections: selections.map((s) => ({ id: s.id, name: s.name, kind: 'selected' })),
          // Empty selections = back to the whole account (contract §4).
          wholeAccount: selections.length === 0,
        };
        state.knowledgeScopes[connectionId] = scope;
        return ok(scope);
      },
    },

    connections: {
      async list() {
        guardVerified();
        return ok(state.connections);
      },
      async listProviders(connectionType) {
        guardVerified();
        return ok(
          connectionType
            ? seed.seedConnectionProviders.filter((p) => p.connectionType === connectionType)
            : seed.seedConnectionProviders,
        );
      },
      async start(connectionType, provider, opts) {
        guardVerified();
        // One active connection per type (§3.8.2): the row is created here so the
        // OAuth callback (or the credentials POST) has an id, exactly as the
        // backend does.
        const existing = state.connections.find((x) => x.connectionType === connectionType);
        const row: Connection = existing ?? {
          connectionId: nextId(),
          connectionType,
          provider,
          status: 'unconfigured',
          createdAt: new Date().toISOString(),
        };
        if (existing) {
          existing.provider = provider;
          if (existing.status !== 'connected') existing.statusDetail = null;
        } else {
          state.connections.push(row);
        }

        // BYO SMS/Voice (Arch §3.1.4/§3.1.6, Decision #48) is two steps on ONE
        // row: the customer's own Twilio credential first, then the number they
        // designate. Neither is an OAuth redirect, and an account with no
        // designated number cannot text anyone, so it stays 'unconfigured' with
        // an actionable next step rather than reading as connected.
        if (connectionType === 'sms_sender') {
          if (!opts?.phoneNumber) {
            row.statusDetail = ACTION_ADD_NUMBER;
            return ok({ requiresClientForm: true, statusDetail: row.statusDetail });
          }
          row.status = 'pending_carrier_registration';
          row.statusDetail = null;
          row.nonSecretConfig = {
            ...(row.nonSecretConfig ?? {}),
            destination: opts.phoneNumber,
          };
          if (state.luciel) {
            for (const ch of state.luciel.channels) {
              if (ch.id === 'sms' || ch.id === 'voice') {
                ch.connectionStatus = 'pending_carrier_registration';
              }
            }
          }
          return ok({});
        }

        const option = seed.seedConnectionProviders
          .find((p) => p.connectionType === connectionType)
          ?.providers.find((p) => p.provider === provider);
        // A provider the platform has no OAuth app for cannot start a flow —
        // the honest answer, never a URL that dead-ends (contract §1).
        if (option && !option.configured) {
          row.statusDetail = `Action needed: ${option.displayName} is not available yet.`;
          return ok({ authorizeUrl: null, statusDetail: row.statusDetail });
        }
        // A provisioned resource (the CSV record source) has no sign-in either; the
        // backend answers the same `requiresClientForm` a credential form gets, and
        // the credential POST that would follow is refused (submitCredentials below).
        // The UI must never get this far — it says where the upload happens instead.
        if (option?.authKind === 'credential_form' || option?.authKind === 'provisioned') {
          return ok({ requiresClientForm: true });
        }
        return ok({ authorizeUrl: mintAuthorizeUrl(row.connectionId, provider, 'connection') });
      },
      async reconnect(connectionId) {
        guardVerified();
        // Re-auth is a real provider round-trip: the row only becomes `connected`
        // when the callback redeems the code (Arch §3.8.7), never here.
        const c = state.connections.find((x) => x.connectionId === connectionId);
        if (!c) throw new LucielApiError({ code: 'not_found', message: 'Connection not found.' });
        // A credential_form provider (Twilio) has no consent screen to send the
        // owner to — the backend answers `requiresClientForm` and the new details
        // arrive via submitCredentials, verified before the row cuts over.
        const option = seed.seedConnectionProviders
          .find((p) => p.connectionType === c.connectionType)
          ?.providers.find((p) => p.provider === c.provider);
        if (option?.authKind === 'credential_form') {
          return ok({ requiresClientForm: true });
        }
        return ok({ authorizeUrl: mintAuthorizeUrl(c.connectionId, c.provider, 'connection') });
      },
      async reverifySms() {
        guardVerified();
        // Models the tenant having completed their own A2P 10DLC Brand+Campaign
        // registration (Legal §A2): re-reading the carrier status now clears the
        // pending state. SMS and Voice share the one number (Arch §3.1.4).
        const sender = state.connections.find((x) => x.connectionType === 'sms_sender');
        if (sender) sender.status = 'connected';
        if (state.luciel) {
          for (const ch of state.luciel.channels) {
            if (ch.connectionStatus === 'pending_carrier_registration') {
              ch.connectionStatus = 'connected';
            }
          }
        }
        return ok({ status: 'connected' as const, statusDetail: null });
      },
      async attestSmsRegistration() {
        guardVerified();
        // Round 5B item 10: the OWNER attests their A2P 10DLC registration is
        // approved (or does not apply to their recipients) — texting enables on
        // their word, never on a fabricated verification. Mirrors the backend:
        // 404 with no sms row, 422 (validation_error) when the row isn't ready.
        const sender = state.connections.find(
          (x) => x.connectionType === 'sms_sender' && x.status !== 'revoked',
        );
        if (!sender) {
          throw new LucielApiError({
            code: 'not_found',
            message: 'No SMS number connection to attest for.',
          });
        }
        const cfg = (sender.nonSecretConfig ?? {}) as Record<string, unknown>;
        if (!cfg.destination) {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'Add and verify your number first — attestation applies to a working number.',
          });
        }
        if (sender.status !== 'pending_carrier_registration' && sender.status !== 'connected') {
          throw new LucielApiError({
            code: 'validation_error',
            message:
              'This connection needs repair first (re-verify the number or fix its ' +
              'credentials), then attest.',
          });
        }
        sender.status = 'connected';
        sender.statusDetail =
          'Texting is enabled on your attestation that your A2P 10DLC carrier registration ' +
          'is approved (or does not apply to your recipients). VantageMind cannot verify ' +
          'campaign approval on your behalf. Re-verify still checks that the number remains ' +
          'operable on your account.';
        sender.nonSecretConfig = {
          ...cfg,
          carrier_registration_attested_at: new Date().toISOString(),
        };
        if (state.luciel) {
          for (const ch of state.luciel.channels) {
            if (ch.connectionStatus === 'pending_carrier_registration') {
              ch.connectionStatus = 'connected';
            }
          }
        }
        return ok({ status: 'connected' as const, statusDetail: sender.statusDetail });
      },
      async reverifyEmail() {
        guardVerified();
        // Mirrors the backend (§3.1.6a): re-run the MX probe against the
        // CURRENTLY provisioned address. Only own_domain has a DNS step; the
        // mock models the probe passing, so pending_email_routing clears.
        // vm_subdomain / byo_mailbox rows are returned unchanged.
        if (!state.emailProvisioning) {
          throw new LucielApiError({
            code: 'not_found',
            message: 'No email address provisioned to re-verify.',
          });
        }
        if (
          state.emailProvisioning.mode === 'own_domain' &&
          state.emailProvisioning.status === 'pending_email_routing'
        ) {
          state.emailProvisioning.status = 'connected';
          const row = state.connections.find((x) => x.connectionType === 'email_sender');
          if (row && row.status === 'pending_email_routing') row.status = 'connected';
        }
        return ok({ status: state.emailProvisioning.status, statusDetail: null });
      },
      async listTwilioNumbers(connectionId) {
        guardVerified();
        // Mirrors the backend (C9): a deterministic two-number fixture once
        // credentials are on file; null (fall back to manual entry) before —
        // listing is a convenience that never blocks designate.
        const c = state.connections.find(
          (x) => x.connectionId === connectionId && x.connectionType === 'sms_sender',
        );
        if (!c) throw new LucielApiError({ code: 'not_found', message: 'Connection not found.' });
        const hasCredentials = Boolean(
          (c.nonSecretConfig as Record<string, unknown> | undefined)?.accountSid,
        );
        if (!hasCredentials) return ok({ numbers: null });
        return ok({
          numbers: [
            { phoneNumber: '+15005550006', friendlyName: 'Test line' },
            { phoneNumber: '+15005550007', friendlyName: 'Second test line' },
          ],
        });
      },
      async listCalendlyEventTypes(connectionId) {
        guardVerified();
        const c = state.connections.find(
          (x) => x.connectionId === connectionId && x.connectionType === 'calendar',
        );
        if (!c) throw new LucielApiError({ code: 'not_found', message: 'Connection not found.' });
        if (c.provider !== 'calendly') {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'There are no settings to change here.',
          });
        }
        const chosen = (c.nonSecretConfig as Record<string, unknown> | undefined)?.eventTypeUri;
        return ok({
          eventTypes: seed.seedCalendlyEventTypes,
          chosenUri: typeof chosen === 'string' && chosen ? chosen : null,
        });
      },
      async updateSettings(connectionId, req) {
        guardVerified();
        const c = state.connections.find(
          (x) => x.connectionId === connectionId && x.connectionType === 'calendar',
        );
        if (!c) throw new LucielApiError({ code: 'not_found', message: 'Connection not found.' });
        if (c.provider !== 'calendly') {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'There are no settings to change here.',
          });
        }
        const type = seed.seedCalendlyEventTypes.find((t) => t.uri === req.eventTypeUri);
        if (!type) {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'That event type is not one your Calendly account offers.',
          });
        }
        c.nonSecretConfig = {
          ...((c.nonSecretConfig ?? {}) as Record<string, unknown>),
          eventTypeUri: type.uri,
          eventTypeName: type.name,
        };
        return ok(clone(c));
      },
      async uploadRecordSourceCsv(file) {
        guardVerified();
        // Replace-on-upload, mirroring the backend: rows REPLACE the previous
        // table and the record_source connection flips to connected with the
        // honest row count in its detail.
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        const records = Math.max(0, lines.length - 1); // minus the header row
        const columns = (lines[0] ?? '')
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean);
        let row = state.connections.find((x) => x.connectionType === 'record_source');
        if (!row) {
          row = {
            connectionId: nextId(),
            connectionType: 'record_source',
            provider: 'csv',
            displayName: 'CSV records',
            providerAvailable: true,
            status: 'connected',
            createdAt: new Date().toISOString(),
          };
          state.connections.push(row);
        }
        row.status = 'connected';
        row.statusDetail = `${records} records on file`;
        return ok({ records, columns });
      },
      async completeOauth(connectionId, _code, oauthState) {
        guardVerified();
        // State is mandatory and single-use; without it the attempt is gone and
        // the caller must restart the connect flow, not retry (contract §3).
        if (!oauthState) {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'This connection attempt has expired. Start the connection again.',
          });
        }
        const c = state.connections.find((x) => x.connectionId === connectionId);
        if (c) c.status = 'connected';
        const sync = state.syncConnections.find((x) => x.connectionId === connectionId);
        if (sync) {
          sync.status = 'connected';
          sync.statusDetail = null;
          // Redeeming clears the pending attempt — that is what makes it single-use.
          if (sync.nonSecretConfig) delete sync.nonSecretConfig.oauth_state_jti;
        }
        return ok(
          sync ?? {
            connectionId,
            provider: 'google_drive' as const,
            status: 'connected' as const,
          },
        );
      },
      async completeConnectionOauth(connectionId, _code, oauthState) {
        guardVerified();
        if (!oauthState) {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'This connection attempt has expired. Start the connection again.',
          });
        }
        const c = state.connections.find((x) => x.connectionId === connectionId);
        if (!c) throw new LucielApiError({ code: 'not_found', message: 'Connection not found.' });
        // A swap only cuts over HERE, on success — until this point the row
        // kept serving on its previous provider (Arch §3.8.7 B).
        const staged = state.stagedSwaps[connectionId];
        if (staged) {
          c.provider = staged;
          delete state.stagedSwaps[connectionId];
        }
        c.status = 'connected';
        c.statusDetail = null;
        c.lastHealthCheckAt = new Date().toISOString();
        // A knowledge grant redeemed afresh replaces the one the provider revoked;
        // its sources resume on the next sync (round 7 WP-4c).
        if (c.connectionType === 'knowledge_source') {
          state.revokedGrants = state.revokedGrants.filter((id) => id !== connectionId);
          setKnowledgeStatus(connectionId, 'connected');
          for (const k of state.knowledge) {
            if (k.connectionId === connectionId && k.syncStatus === 'paused_reconnect_needed') {
              k.syncStatus = 'synced';
              delete k.pausedSince;
            }
          }
        }
        // One-click Twilio (C10): the post-exchange verifier binds WHOSE account
        // authorized — and §3.1.4 honesty holds on this path too: with no
        // designated number the row lands on "add your number", never a false
        // Connected (the backend contract this mock mirrors).
        if (c.connectionType === 'sms_sender' && c.provider === 'twilio') {
          c.nonSecretConfig = {
            ...(c.nonSecretConfig ?? {}),
            accountSid: 'AC00000000000000000000000000000042',
            accountName: 'Your Twilio account',
            mode: 'oauth',
          };
          const cfg = c.nonSecretConfig;
          if (!cfg.destination && !cfg.pending_destination) {
            c.status = 'unconfigured';
            c.statusDetail =
              'Action needed: add your number. Your Twilio account is connected — designate ' +
              'the number Luciel should text from to bring the channel live.';
          }
        }
        // BYO mailbox live (§3.1.6a): the verified Outlook mailbox becomes the
        // send+receive address, and the one email-provisioning read reports it
        // so Configure's email panel and this row cannot disagree.
        if (c.connectionType === 'email_sender' && c.provider === 'outlook') {
          const address = 'you@your-company.example';
          c.displayName = 'Outlook mailbox';
          c.nonSecretConfig = {
            ...(c.nonSecretConfig ?? {}),
            address,
            destination: address,
            mode: 'byo_mailbox',
          };
          state.emailProvisioning = {
            mode: 'byo_mailbox',
            emailAddress: address,
            status: 'connected',
            dnsRecords: null,
          };
        }
        // A connected Meta channel is not a working one until its destination is
        // bound (contract §2), so nothing flips the channel live here.
        return ok(c);
      },
      async removeSmsNumber() {
        guardVerified();
        const sender = state.connections.find(
          (x) => x.connectionType === 'sms_sender' && x.status !== 'revoked',
        );
        if (!sender) throw new LucielApiError({ code: 'not_found', message: 'No SMS connection.' });
        const cfg = { ...((sender.nonSecretConfig ?? {}) as Record<string, unknown>) };
        if (!cfg.destination && !cfg.pending_destination) {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'There is no number on file to remove.',
          });
        }
        delete cfg.destination;
        delete cfg.pending_destination;
        delete cfg.carrier_registration_attested_at;
        delete cfg.carrier_registration_attested_by;
        sender.nonSecretConfig = cfg;
        sender.status = 'unconfigured';
        sender.statusDetail = 'Add your number to text and call.';
        if (state.luciel) {
          for (const ch of state.luciel.channels) {
            if (ch.id === 'sms' || ch.id === 'voice') ch.connectionStatus = 'unconfigured';
          }
        }
        await delay();
        return ok(clone(sender));
      },
      async withdrawSmsAttestation() {
        guardVerified();
        const sender = state.connections.find(
          (x) => x.connectionType === 'sms_sender' && x.status !== 'revoked',
        );
        if (!sender) {
          throw new LucielApiError({ code: 'not_found', message: 'No SMS number connection.' });
        }
        const cfg = { ...((sender.nonSecretConfig ?? {}) as Record<string, unknown>) };
        if (cfg.carrier_registration_attested_at) {
          delete cfg.carrier_registration_attested_at;
          delete cfg.carrier_registration_attested_by;
          sender.nonSecretConfig = cfg;
          if (cfg.destination && sender.status === 'connected') {
            sender.status = 'pending_carrier_registration';
            if (state.luciel) {
              for (const ch of state.luciel.channels) {
                if (ch.id === 'sms' || ch.id === 'voice') {
                  ch.connectionStatus = 'pending_carrier_registration';
                }
              }
            }
          }
        }
        await delay();
        return ok(clone(sender));
      },
      async clearRecordSourceCsv() {
        guardVerified();
        const row = state.connections.find(
          (x) => x.connectionType === 'record_source' && x.status !== 'revoked',
        );
        if (!row) throw new LucielApiError({ code: 'not_found', message: 'No records on file.' });
        const result = await this.disconnect(row.connectionId);
        result.connection.statusDetail = 'No records on file';
        row.statusDetail = 'No records on file';
        return result;
      },
      async rotateSmsCapability() {
        guardVerified();
        const sms = state.connections.find((c) => c.connectionType === 'sms_sender');
        if (!sms) throw new LucielApiError({ code: 'not_found', message: 'No SMS connection.' });
        await delay();
        return ok(sms);
      },
      async disconnect(connectionId) {
        guardVerified();
        const c = state.connections.find((x: Connection) => x.connectionId === connectionId);
        if (!c) throw new LucielApiError({ code: 'not_found', message: 'Connection not found.' });
        // Fail-safe: the credential is destroyed and the row lands on the
        // RECONNECTABLE not_connected, not terminal revoked (contract §1).
        audit(
          'connection_status_changed',
          `${c.provider} ${c.connectionType}: ${c.status} → not_connected`,
        );
        const crawlTargets = c.nonSecretConfig?.crawl_urls;
        c.status = 'not_connected';
        c.statusDetail = 'disconnected_by_admin';
        c.lastHealthCheckAt = null;
        delete c.nonSecretConfig;
        // A knowledge connection's sync row says the same (no further pulls); a
        // crawl keeps naming its targets so the row still says what it crawled.
        setKnowledgeStatus(connectionId, 'not_connected');
        if (Array.isArray(crawlTargets)) c.nonSecretConfig = { crawl_urls: crawlTargets };

        const disabledTools: string[] = [];
        const disabledChannels: string[] = [];
        if (state.luciel) {
          const toolIds = toolsForConnectionType(c.connectionType);
          for (const t of state.luciel.tools) {
            if (!toolIds.includes(t.id)) continue;
            // Only what this disconnect actually took down is reported back.
            if (t.enabled) disabledTools.push(t.id);
            t.enabled = false;
            t.connectionStatus = 'not_connected';
            t.disabledReason = `connection_disconnected:${c.connectionType}`;
          }
          const channelIds = channelsForConnection(c);
          for (const ch of state.luciel.channels) {
            if (!channelIds.includes(ch.id)) continue;
            if (ch.enabled) disabledChannels.push(ch.id);
            ch.enabled = false;
            ch.connectionStatus = 'not_connected';
          }
        }
        await delay();
        return { connection: clone(c), secretDeleted: true, disabledTools, disabledChannels };
      },
      async switchAccount(connectionId, provider) {
        guardVerified();
        const c = state.connections.find((x) => x.connectionId === connectionId);
        if (!c) throw new LucielApiError({ code: 'not_found', message: 'Connection not found.' });
        if (provider) {
          const offered = seed.seedConnectionProviders
            .find((p) => p.connectionType === c.connectionType)
            ?.providers.some((p) => p.provider === provider);
          if (!offered) {
            throw new LucielApiError({
              code: 'validation_error',
              message: `'${provider}' is not a provider we offer for ${c.connectionType}.`,
            });
          }
          c.provider = provider;
        }
        // Disconnect FIRST so nothing keeps serving from the account being left
        // behind, then hand back a fresh connect flow (contract §1).
        c.status = 'not_connected';
        c.statusDetail = 'switch_started';
        delete c.nonSecretConfig;
        return ok({ authorizeUrl: mintAuthorizeUrl(c.connectionId, c.provider, 'connection') });
      },
      async bindDestination(connectionId, destination, channel) {
        guardVerified();
        const c = state.connections.find((x) => x.connectionId === connectionId);
        if (!c) throw new LucielApiError({ code: 'not_found', message: 'Connection not found.' });
        if (c.connectionType !== 'channel_auth') {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'A destination is not bound here.',
          });
        }
        const value = destination.trim();
        if (!value || value.length > 128) {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'Enter the id Luciel should answer on (1–128 characters).',
          });
        }
        if (channel) {
          // Per-channel: one Meta grant serves three channels, so binding one
          // never unbinds another (contract §2).
          const destinations = {
            ...((c.nonSecretConfig?.destinations as Record<string, string> | undefined) ?? {}),
            [channel]: value,
          };
          c.nonSecretConfig = { ...(c.nonSecretConfig ?? {}), destinations };
        } else {
          c.nonSecretConfig = { ...(c.nonSecretConfig ?? {}), destination: value };
        }
        const uiChannel = channel ? CHANNEL_BY_META_CHANNEL[channel] : undefined;
        if (state.luciel && uiChannel) {
          const ch = state.luciel.channels.find((x) => x.id === uiChannel);
          if (ch) ch.connectionStatus = c.status;
        }
        return ok(c);
      },
      async submitCredentials(connectionId, fields) {
        guardVerified();
        const c = state.connections.find((x) => x.connectionId === connectionId);
        if (!c) throw new LucielApiError({ code: 'not_found', message: 'Connection not found.' });
        const option = seed.seedConnectionProviders
          .find((p) => p.connectionType === c.connectionType)
          ?.providers.find((p) => p.provider === c.provider);
        // connections/service.py `_takes_form`: a credential-form provider, OR an
        // OAuth-primary one that keeps its form as the explicit fallback (Twilio, C10 —
        // "Use API keys instead"). The mock refused the fallback, so that path was
        // unwalkable on the mock (round 7 WP-12, caught by the customer walk).
        const takesForm =
          option !== undefined &&
          (option.authKind === 'credential_form' ||
            (option.authKind === 'oauth' && option.credentialFields.length > 0));
        if (!option || !takesForm) {
          throw new LucielApiError({
            code: 'validation_error',
            // The backend's own refusal wording for a provider that takes no form (a
            // provisioned resource such as the CSV record source, or an OAuth provider).
            message: `Provider '${c.provider}' does not take a credential form.`,
          });
        }
        for (const field of option.credentialFields) {
          if (field.required && !fields[field.name]?.trim()) {
            throw new LucielApiError({
              code: 'validation_error',
              message: `${field.label} is required.`,
            });
          }
        }
        // The customer's own Twilio needs an Account SID plus EITHER an auth
        // token OR an API key pair — neither is a 422 (contract §1a).
        if (c.provider === 'twilio' && !fields.authToken?.trim() && !fields.apiKeySecret?.trim()) {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'Add either your Auth Token or an API Key SID and secret.',
          });
        }
        // Secret fields go to the vault and are never echoed back (§3.8.3);
        // only the non-secret ones are readable afterwards.
        const nonSecret: Record<string, string> = {};
        for (const field of option.credentialFields) {
          const value = fields[field.name]?.trim();
          if (!field.secret && value) nonSecret[field.name] = value;
        }
        c.nonSecretConfig = { ...(c.nonSecretConfig ?? {}), ...nonSecret };
        if (c.connectionType === 'sms_sender' && !c.nonSecretConfig?.destination) {
          // An account with no designated number cannot text anyone yet.
          c.status = 'unconfigured';
          c.statusDetail = ACTION_ADD_NUMBER;
        } else {
          // Fresh non-phone connect, or a credential ROTATION on a row that
          // already has its number: the new details verified, so the row is
          // healthy again and the designated number is untouched (§3.8.7 B).
          c.status = 'connected';
          c.statusDetail = null;
          c.lastHealthCheckAt = new Date().toISOString();
          if (c.connectionType === 'sms_sender' && state.luciel) {
            for (const id of ['sms', 'voice'] as const) {
              const ch = state.luciel.channels.find((x) => x.id === id);
              if (ch && ch.connectionStatus) ch.connectionStatus = 'connected';
            }
          }
        }
        return ok(c);
      },
      async getEmailProvisioning() {
        guardVerified();
        return ok(state.emailProvisioning);
      },
      async swap(connectionId, provider) {
        guardVerified();
        // Proven-before-cutover (Arch §3.8.7 B, Decision #39): the current
        // connection stays LIVE (status unchanged) until the replacement
        // health-checks. The replacement provider is only STAGED here; the
        // cutover happens when its OAuth callback completes — on any failure
        // the current row is untouched.
        const c = state.connections.find((x) => x.connectionId === connectionId);
        if (!c) throw new LucielApiError({ code: 'not_found', message: 'Connection not found.' });
        const option = seed.seedConnectionProviders
          .find((p) => p.connectionType === c.connectionType)
          ?.providers.find((p) => p.provider === provider);
        // Same honesty as start(): a provider the platform holds no OAuth app
        // for cannot begin a flow — say so, never a URL that dead-ends. The
        // working sender is untouched (contract §1, Arch §3.1.6a).
        if (option && !option.configured) {
          return ok({
            authorizeUrl: null,
            statusDetail: `Action needed: ${option.displayName} is not available yet.`,
          });
        }
        state.stagedSwaps[connectionId] = provider;
        return ok({ authorizeUrl: mintAuthorizeUrl(connectionId, provider, 'connection') });
      },
    },

    conversations: {
      async list(page) {
        guardVerified();
        return ok(pageOf(state.conversations, page));
      },
      async getMessages(sessionId) {
        guardVerified();
        const transcript: Message[] = [
          // The persisted opening greeting — a deterministic code-composed row
          // whose evidence is scoringStatus 'not_applicable' (#5c), so the UI's
          // fixed-message badge path is exercisable in mock mode.
          {
            messageId: 'm0',
            role: 'luciel',
            text: "Hi! I'm an AI assistant for this business. How can I help?",
            at: '2026-06-13T23:41:50Z',
          },
          {
            messageId: 'm1',
            role: 'lead',
            text: 'Are you taking new clients?',
            at: '2026-06-13T23:42:00Z',
          },
          {
            messageId: 'm2',
            role: 'luciel',
            text: "Hi — I'm Sarah's AI assistant. Yes, she has openings this month.",
            at: '2026-06-13T23:42:30Z',
          },
          ...(state.humanReplies[sessionId] ?? []),
        ];
        return ok(transcript);
      },
      async takeOver(sessionId) {
        guardVerified();
        const c = state.conversations.find((x) => x.sessionId === sessionId);
        if (!c) throw new LucielApiError({ code: 'not_found', message: 'Session not found.' });
        // Round 7 WP-3b item 4: an ended session is refused before anything changes.
        if (c.endedAt) throw sessionEnded();
        if (c.mode !== 'human_controlled') audit('human_takeover_started', 'admin_initiated');
        c.mode = 'human_controlled';
        return ok(c);
      },
      async handBack(sessionId) {
        guardVerified();
        const c = state.conversations.find((x) => x.sessionId === sessionId);
        if (!c) throw new LucielApiError({ code: 'not_found', message: 'Session not found.' });
        if (c.mode === 'human_controlled') audit('human_takeover_ended');
        c.mode = 'ai';
        return ok(c);
      },
      async sendMessage(sessionId, text) {
        guardVerified();
        const c = state.conversations.find((x) => x.sessionId === sessionId);
        if (!c) throw new LucielApiError({ code: 'not_found', message: 'Session not found.' });
        if (c.endedAt) throw sessionEnded();
        if (c.mode !== 'human_controlled') {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'Take over the conversation before replying.',
          });
        }
        // The outcome the backend persists on the row (round 7 WP-3b item 5), so
        // the transcript replays it on reopen: the widget has no push transport
        // (queued — the visitor picks it up on their next history fetch); a
        // session with no lead this channel can deliver to fails honestly
        // (item 1, no_recipient_for_channel); everything else is accepted by the
        // provider (delivered).
        const now = new Date().toISOString();
        const outcome: Pick<Message, 'deliveryStatus' | 'deliveryDetail' | 'deliveredAt'> =
          c.channel === 'widget'
            ? { deliveryStatus: 'queued', deliveryDetail: 'widget_poll_only', deliveredAt: null }
            : !c.leadId
              ? {
                  deliveryStatus: 'failed',
                  deliveryDetail: 'no_recipient_for_channel',
                  deliveredAt: null,
                }
              : { deliveryStatus: 'delivered', deliveryDetail: null, deliveredAt: now };
        const message: Message = {
          messageId: nextId(),
          role: 'human_agent',
          text,
          at: now,
          ...outcome,
        };
        (state.humanReplies[sessionId] ??= []).push(message);
        c.lastMessageAt = message.at;
        audit('human_agent_message_sent');
        return ok({
          message,
          delivered: outcome.deliveryStatus === 'delivered',
          deliveryDetail: outcome.deliveryDetail ?? null,
        });
      },
      async getAnswerEvidence(sessionId, messageId) {
        guardVerified();
        // messages.flagged_by_admin_at, read back (round 7 WP-4c #8): the owner
        // flagged an answer, reloaded, and must see it still flagged.
        const flaggedByAdmin = state.flaggedAnswers.includes(`${sessionId}:${messageId}`);
        if (messageId === 'm0') {
          // The greeting: composed in code, never a knowledge answer — scoring
          // does not apply and no attribution was captured (#5c).
          return ok({
            messageId,
            groundingScore: null,
            scoringStatus: 'not_applicable' as const,
            sourceChunks: [],
            attributionStatus: 'attribution_unavailable' as const,
            flaggedByAdmin,
          });
        }
        return ok({
          messageId,
          groundingScore: 0.82,
          scoringStatus: 'scored' as const,
          sourceChunks: [
            {
              sourceId: seed.seedKnowledge[0]!.sourceId,
              sourceName: 'Services brochure.pdf',
              text: 'Starter engagement is $899.',
            },
          ],
          attributionStatus: 'has_sources' as const,
          flaggedByAdmin,
        });
      },
      async flagAnswer(sessionId, messageId) {
        guardVerified();
        // Idempotent, like the backend: flagging twice keeps the first flag.
        const key = `${sessionId}:${messageId}`;
        if (!state.flaggedAnswers.includes(key)) {
          state.flaggedAnswers.push(key);
          audit('answer_flagged_by_admin');
        }
        await delay();
      },
      async listEscalations(page) {
        guardVerified();
        return ok(pageOf(state.escalations, page));
      },
    },

    leads: {
      async list(page) {
        guardVerified();
        // Round 7 WP-3c item 5: a never-pushed lead's reason is derived from the
        // CURRENT posture at read time, exactly as the backend's _lead_out does.
        return ok(pageOf(state.leads.map(withCrmPosture), page));
      },
      async erase(leadId) {
        guardVerified();
        if (state.leads.some((l) => l.leadId === leadId)) audit('lead_erasure');
        state.leads = state.leads.filter((l) => l.leadId !== leadId);
        await delay();
      },
      async prune(leadIds) {
        guardVerified();
        const gone = state.leads.filter((l) => leadIds.includes(l.leadId)).length;
        if (gone) audit('lead_pruned', `${gone} deleted (owner)`);
        state.leads = state.leads.filter((l) => !leadIds.includes(l.leadId));
        await delay();
      },
      async archive(leadId) {
        guardVerified();
        const l = state.leads.find((x) => x.leadId === leadId);
        if (!l) throw new LucielApiError({ code: 'not_found', message: 'Lead not found.' });
        if (l.state !== 'archived') audit('lead_archived');
        l.state = 'archived';
        l.lastActivityAt = new Date().toISOString();
        return ok(withCrmPosture(l));
      },
      async unarchive(leadId) {
        guardVerified();
        const l = state.leads.find((x) => x.leadId === leadId);
        if (!l) throw new LucielApiError({ code: 'not_found', message: 'Lead not found.' });
        // Idempotent (round 7 WP-3c item 6): an active lead comes back untouched.
        if (l.state === 'archived') {
          l.state = 'active';
          l.lastActivityAt = new Date().toISOString();
          audit('lead_reactivated');
        }
        return ok(withCrmPosture(l));
      },
      async update(leadId, patch) {
        guardVerified();
        const l = state.leads.find((x) => x.leadId === leadId);
        if (!l) throw new LucielApiError({ code: 'not_found', message: 'Lead not found.' });
        // The backend's rules (round 7 WP-3c item 6), modelled: an omitted field
        // is left alone, an explicit null clears it; email is case-folded and
        // must look like one; phone must read as E.164; a value another lead
        // already owns is a conflict, never a silent merge.
        const owned = (field: 'email' | 'phone', value: string) =>
          state.leads.some((o) => o.leadId !== leadId && o[field] === value);
        let changed = false;
        if (patch.name !== undefined) {
          const name = (patch.name ?? '').trim() || undefined;
          if (name !== l.name) {
            l.name = name;
            changed = true;
          }
        }
        if (patch.email !== undefined) {
          const raw = (patch.email ?? '').trim().toLowerCase();
          if (raw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
            throw new LucielApiError({
              code: 'validation_error',
              message: 'That is not a valid email address.',
            });
          }
          const email = raw || null;
          if (email !== (l.email ?? null)) {
            if (email && owned('email', email)) {
              throw new LucielApiError({
                code: 'conflict',
                message: 'That email address already belongs to another lead.',
              });
            }
            l.email = email;
            changed = true;
          }
        }
        if (patch.phone !== undefined) {
          const raw = (patch.phone ?? '').trim();
          const cleaned = raw.replace(/[\s\-.()]/g, '');
          if (raw && !/^\+[1-9]\d{7,14}$/.test(cleaned)) {
            throw new LucielApiError({
              code: 'validation_error',
              message: 'That phone number could not be read as an international (E.164) number.',
            });
          }
          const phone = raw ? cleaned : null;
          if (phone !== (l.phone ?? null)) {
            if (phone && owned('phone', phone)) {
              throw new LucielApiError({
                code: 'conflict',
                message: 'That phone number already belongs to another lead.',
              });
            }
            l.phone = phone;
            changed = true;
          }
        }
        if (changed) {
          l.lastActivityAt = new Date().toISOString();
          audit('lead_edited');
        }
        return ok(withCrmPosture(l));
      },
      async backfillCrm() {
        guardVerified();
        // Round 7 WP-3c item 5, as the backend does it: refuse (409) when the CRM
        // cannot be pushed to at all; otherwise push every never-attempted active
        // lead with a key the CRM accepts, one bounded batch per call.
        const posture = crmPosture();
        if (!posture.canPush) {
          if (posture.status === 'dormant') {
            throw new LucielApiError({
              code: 'conflict',
              message: 'Your CRM connection is dormant; add a payment method first.',
            });
          }
          if (posture.status !== 'connected') {
            throw new LucielApiError({
              code: 'conflict',
              message: 'No CRM is connected, so there is nothing to backfill into.',
            });
          }
          throw new LucielApiError({
            code: 'conflict',
            message: 'The Push to CRM tool is switched off.',
          });
        }
        const candidates = state.leads.filter(
          (l) => l.state === 'active' && l.crmStatus !== 'synced' && l.crmStatus !== 'failed',
        );
        const keyed = candidates.filter((l) => crmKeyFor(l, posture.provider) !== null);
        const skippedNoKey = candidates.length - keyed.length;
        const batch = keyed.slice(0, CRM_BACKFILL_BATCH);
        for (const l of batch) {
          l.crmStatus = 'synced';
          l.crmDetail = null;
          l.crmPushedAt = new Date().toISOString();
        }
        audit('crm_backfill_run', `${batch.length} sent`);
        await delay();
        return {
          attempted: batch.length,
          synced: batch.length,
          failed: 0,
          skippedNoKey,
          remaining: keyed.length - batch.length,
          refusedReason: null,
        };
      },
      async markOutcome(leadId, outcome) {
        guardVerified();
        const l = state.leads.find((x) => x.leadId === leadId);
        if (!l) throw new LucielApiError({ code: 'not_found', message: 'Lead not found.' });
        l.outcome = outcome;
        return ok(l);
      },
      async retryCrmPush(leadId) {
        guardVerified();
        const l = state.leads.find((x) => x.leadId === leadId);
        if (!l) throw new LucielApiError({ code: 'not_found', message: 'Lead not found.' });
        // Same broker gates as a capture push: a 409 says why nothing was attempted.
        const posture = crmPosture();
        if (!posture.canPush) {
          throw new LucielApiError({
            code: 'conflict',
            message:
              posture.status === 'dormant'
                ? 'The push was not attempted: your CRM connection is dormant until a card is on file.'
                : posture.status !== 'connected'
                  ? 'The push was not attempted: no CRM is connected.'
                  : 'The push was not attempted: the Push to CRM tool is switched off.',
          });
        }
        if (crmKeyFor(l, posture.provider) === null) {
          throw new LucielApiError({
            code: 'conflict',
            message: 'The push was not attempted: this lead has no email address your CRM accepts.',
          });
        }
        l.crmStatus = 'synced';
        l.crmDetail = null;
        l.crmPushedAt = new Date().toISOString();
        audit('crm_record_upserted');
        await delay();
        return ok(withCrmPosture(l));
      },
      async export(format) {
        guardVerified();
        const rows = state.leads.map((l) => ({
          leadId: l.leadId,
          name: l.name ?? '',
          contactIdentifier: l.contactIdentifier ?? '',
          intent: l.intent ?? '',
          state: l.state,
          lastActivityAt: l.lastActivityAt,
        }));
        const json = format === 'json';
        await delay();
        return {
          blob: new Blob([json ? JSON.stringify(rows, null, 2) : toCsv(rows)], {
            type: json ? 'application/json' : 'text/csv',
          }),
          filename: `leads.${format}`,
        };
      },
    },

    billing: {
      async get() {
        guardVerified();
        return ok(state.billing);
      },
      async startCheckout() {
        guardVerified();
        if (state.billing.paymentsAvailable === false) {
          throw new LucielApiError({
            code: 'service_unavailable',
            message: 'Card payments are not live in this deployment yet.',
          });
        }
        // The open Checkout session; the success return completes it (browser runtime).
        state.pendingStripe = 'checkout';
        audit('billing_checkout_started');
        return ok({ url: 'https://checkout.stripe.com/mock-session' });
      },
      async startPortal() {
        guardVerified();
        // Mirrors the backend (round 7 WP-1 #5): 503 while payments are not live,
        // 409 when there is no Stripe customer / card to update — Checkout adds
        // a first card; the portal only replaces one.
        if (state.billing.paymentsAvailable === false) {
          throw new LucielApiError({
            code: 'service_unavailable',
            message: 'Card payments are not live in this deployment yet.',
          });
        }
        if (!state.billing.paymentMethod) {
          throw new LucielApiError({
            code: 'conflict',
            message: 'No card on file to update — add a card first.',
          });
        }
        state.pendingStripe = 'portal';
        audit('billing_portal_session_created');
        return ok({ url: 'https://billing.stripe.com/mock-portal-session' });
      },
      async removePaymentMethod() {
        guardVerified();
        state.billing.budget.billingState = 'free_cap';
        delete state.billing.paymentMethod;
        // Past the free 50 with no card, new conversations stop at the cap.
        const budget = state.billing.budget;
        budget.atCap = budget.conversationsThisPeriod >= budget.freeAllowance;
        budget.nearNextBlock = false;
        audit('payment_method_removed', 'card removed (admin_removed)');
        return ok(state.billing as BillingInfo);
      },
    },

    analytics: {
      async overview() {
        guardVerified();
        return ok(state.analytics);
      },
      async auditLog(page) {
        guardVerified();
        return ok(pageOf(state.audit, page));
      },
    },

    account: {
      async status() {
        guardAccountOwner();
        if (state.account.state !== 'closed') {
          return ok({
            state: state.account.state,
            closedAt: null,
            reopenUntil: null,
            canReopen: false,
            lucielRestoredOnReopen: false,
          });
        }
        return ok({
          state: state.account.state,
          closedAt: state.closure?.closedAt ?? null,
          reopenUntil: reopenUntil(),
          canReopen: insideReopenWindow(),
          lucielRestoredOnReopen:
            state.closure?.lucielBefore != null && state.luciel?.state === 'luciel_grace_window',
        });
      },
      async reopen() {
        guardAccountOwner();
        await delay();
        if (state.account.state !== 'closed') {
          throw new LucielApiError({ code: 'conflict', message: 'This account is not closed.' });
        }
        const before = state.closure?.lucielBefore ?? null;
        const restored = before !== null && state.luciel?.state === 'luciel_grace_window';
        if (restored && state.luciel) {
          // Back to the state it had before the closure: active, or paused if paused.
          state.luciel.state = before.state === 'paused' ? 'paused' : 'active';
          delete state.luciel.graceWindowStartedAt;
        }
        state.account.state = 'verified';
        state.closure = null;
        audit(
          'account_reopened',
          restored ? `Luciel restored (${state.luciel?.state})` : undefined,
        );
        return clone({
          state: 'verified' as const,
          lucielRestored: restored,
          lucielState: restored ? (state.luciel?.state ?? null) : null,
          billingState: state.billing.budget.billingState,
        });
      },
      async requestExport() {
        // Also the D5 re-request: a closed account inside its window may ask again.
        guardAccountOwner();
        // The bundle's time-limited link comes back in the body as well as by email
        // (round 7 WP-10, item 12) — the mock hands back the same shape the backend
        // does, so the UI can show the link, the link's life and whether the email
        // carrying it actually left (round 7 WP-5).
        audit('data_export_requested');
        return ok({
          ok: true,
          downloadUrl: `${MOCK_AUTHORIZE_ORIGIN}/api/v1/admin/account/export/${nextId()}`,
          ttlDays: 7,
          emailOutcome: 'sent',
        });
      },
      async close(opts) {
        guardVerified();
        if (
          state.luciel &&
          (state.luciel.state === 'active' || state.luciel.state === 'paused') &&
          !opts?.confirmDeleteLuciel
        ) {
          throw new LucielApiError({
            code: 'conflict',
            message:
              'Your Luciel is still active. Delete it first, or confirm that closing the account deletes it.',
          });
        }
        // The closure deletes a Luciel still serving: it enters its grace window,
        // which is what a reopen inside the 30 days brings it back from (D5).
        const serving =
          state.luciel && (state.luciel.state === 'active' || state.luciel.state === 'paused');
        const closedAt = new Date().toISOString();
        state.closure = { closedAt, lucielBefore: serving ? clone(state.luciel) : null };
        if (serving && state.luciel) {
          state.luciel.state = 'luciel_grace_window';
          state.luciel.graceWindowStartedAt = closedAt;
        }
        state.account.state = 'closed';
        audit('account_closure_initiated');
        // Closing signs the owner out (cascade.close_account bumps the session
        // epoch): from here every call made with this session answers the typed
        // 401, exactly as the http adapter would see it, until the owner signs in
        // again. The live 204 sends no Set-Cookie, so the presence cookie stays.
        state.sessionRevoked = true;
        await delay();
      },
    },
    contact: {
      /**
       * Public and unauthenticated, so no session guard. Reproduces the two
       * refusals the form must render: a captcha the server rejects, and the
       * anti-spam rate limit after repeated sends.
       */
      async submit(req) {
        if (req.captchaToken === 'invalid') {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'That spam-protection challenge expired. Please try it again.',
          });
        }
        state.contactSubmissions += 1;
        if (state.contactSubmissions > 3) {
          throw new LucielApiError({
            code: 'rate_limited',
            message: 'Too many messages just now. Please try again in a few minutes.',
          });
        }
        return ok({ ok: true });
      },
    },
    escalationContact: {
      /**
       * Public and token-authorized (round 5B item 13) — no session guard, the
       * recipient is usually not the account owner. `expired` models the one
       * refusal the page must render distinctly from success.
       */
      async confirm(req) {
        await delay();
        if (!req.token || req.token === 'expired') {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'This confirmation link has expired — ask for a new one.',
          });
        }
        if (state.luciel) {
          for (const h of state.luciel.escalationContactHealth) {
            if (h.state === 'pending_confirmation') {
              h.state = 'verified';
              h.verifiedAt = '2026-08-25T12:00:00Z';
            }
          }
        }
        return { status: 'confirmed' };
      },
    },
  };

  if (!runtime) return client;

  // ---- Browser runtime (round 7 WP-12) ----------------------------------------
  /**
   * The provider round-trips this page load is the return of. The backend runs
   * the OAuth callback and receives the Stripe webhook BEFORE the browser lands
   * back here; the mock does the same work the moment the landing page loads.
   */
  const landing = new URLSearchParams(runtime.search);
  const landedConnection = landing.get('connectionId');
  const attempt = landedConnection ? state.oauthAttempts[landedConnection] : undefined;
  if (landedConnection && attempt) {
    delete state.oauthAttempts[landedConnection];
    if (landing.get('status') === 'connected') {
      // Runs synchronously up to its first await, so the row is redeemed before
      // any read this page makes.
      const redeem =
        attempt.kind === 'knowledge'
          ? client.connections.completeOauth(landedConnection, 'mock-code', 'mock-state')
          : client.connections.completeConnectionOauth(landedConnection, 'mock-code', 'mock-state');
      void redeem.catch(() => undefined);
    } else if (landing.get('status') === 'error') {
      // A declined or failed consent: nothing changes, and a staged swap is dropped.
      delete state.stagedSwaps[landedConnection];
    }
  }
  if (state.pendingStripe === 'checkout' && landing.has('checkout')) {
    if (landing.get('checkout') === 'success') {
      // checkout.session.completed → the card is on file, pay-as-you-go is on.
      const year = new Date().getUTCFullYear() + 3;
      state.billing.paymentMethod = { brand: 'visa', last4: '4242', expMonth: 12, expYear: year };
      state.billing.budget.billingState = 'payg_enabled';
      state.billing.budget.atCap = false;
      state.billing.budget.billable = true;
      audit('payment_method_added', 'visa card added');
    }
    state.pendingStripe = null;
  }
  if (state.pendingStripe === 'portal' && runtime.pathname === '/dashboard/billing') {
    if (landing.get(MOCK_STRIPE_PARAM) === 'portal_card_updated') {
      const year = new Date().getUTCFullYear() + 4;
      state.billing.paymentMethod = {
        brand: 'mastercard',
        last4: '4444',
        expMonth: 6,
        expYear: year,
      };
      audit('payment_method_added', 'mastercard card added');
    }
    state.pendingStripe = null;
  }
  persist();

  // Every call: an injected failure first, then the extra latency, then the real
  // work — and the store is written back whatever happened.
  const namespaces = client as unknown as Record<string, Record<string, unknown>>;
  for (const [nsName, ns] of Object.entries(namespaces)) {
    for (const [method, fn] of Object.entries(ns)) {
      if (typeof fn !== 'function') continue;
      const key = `${nsName}.${method}`;
      ns[method] = async (...args: unknown[]) => {
        try {
          if (state.extraLatency) await new Promise((r) => setTimeout(r, state.extraLatency));
          const fault = state.faults[key];
          if (fault && fault.times > 0) {
            fault.times -= 1;
            if (fault.times === 0) delete state.faults[key];
            await delay();
            throw new LucielApiError({ code: fault.code, message: 'Internal Server Error' });
          }
          return await (fn as (...a: unknown[]) => Promise<unknown>).apply(ns, args);
        } finally {
          persist();
        }
      };
    }
  }

  runtime.installControl?.({
    scenario: () => seededScenario,
    failNext: (method, times = 1, code = 'server_error') => {
      state.faults[method] = { times, code };
      persist();
    },
    setExtraLatency: (ms) => {
      state.extraLatency = Math.max(0, ms);
      persist();
    },
    endSession: (sessionId) => {
      const c = state.conversations.find((x) => x.sessionId === sessionId);
      if (c && !c.endedAt) c.endedAt = new Date().toISOString();
      persist();
    },
    revokeKnowledgeGrant: (connectionId) => {
      if (!state.revokedGrants.includes(connectionId)) state.revokedGrants.push(connectionId);
      persist();
    },
    reset: () => {
      storeDropped = true;
      try {
        runtime.storage?.removeItem(MOCK_STORE_KEY);
      } catch {
        /* nothing persisted */
      }
    },
  });
  return client;
}
