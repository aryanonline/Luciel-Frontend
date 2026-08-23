import type { LucielApiClient } from '../client';
import { LucielApiError } from '../schemas';
import type {
  Account,
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
  | 'grace';

export interface MockAdminOptions {
  scenario?: MockScenario;
  /** Artificial latency (ms) so loading states are exercisable. */
  latencyMs?: number;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

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

export function createMockAdminClient(options: MockAdminOptions = {}): LucielApiClient {
  const latency = options.latencyMs ?? 0;

  // Mutable in-memory state, seeded from the deterministic fixtures.
  const state = {
    scenario: options.scenario ?? 'verified',
    account: clone(seed.seedAccount),
    luciel: clone(seed.seedLuciel) as Luciel | null,
    billing: clone(seed.seedBilling),
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
  };

  // Apply scenario-derived state up front.
  if (state.scenario === 'unverified') {
    state.account.state = 'unverified';
    state.account.emailVerified = false;
    state.account.hasCompletedFirstRun = false;
    state.account.hasLuciel = false;
    state.luciel = null;
  }
  if (state.scenario === 'fresh') {
    state.account.hasCompletedFirstRun = false;
    state.account.hasLuciel = false;
    state.luciel = null;
  }
  if (state.scenario === 'at_cap') {
    state.billing.budget.atCap = true;
    state.billing.budget.conversationsThisPeriod = 50;
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

  const delay = () => (latency ? new Promise((r) => setTimeout(r, latency)) : Promise.resolve());

  /** Guards that model the cross-cutting states the UI must handle (§7). */
  const guardSession = () => {
    if (state.scenario === 'expired_session') {
      throw new LucielApiError({ code: 'unauthorized', message: 'Session expired.' });
    }
  };
  const guardVerified = () => {
    guardSession();
    if (state.account.state === 'unverified') {
      throw new LucielApiError({
        code: 'verification_required',
        message: 'Please verify your email to continue.',
      });
    }
  };

  const ok = async <T>(value: T): Promise<T> => {
    await delay();
    return clone(value);
  };

  /** Drives the mock contact form's anti-spam rate limit. */
  let contactSubmissions = 0;

  // Deterministic ids for anything the mock creates at runtime.
  let seq = 0;
  const nextId = () => `aaaaaaaa-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

  const addSource = (
    name: string,
    origin: KnowledgeSource['origin'],
    sizeBytes: number,
    syncStatus?: KnowledgeSource['syncStatus'],
  ): KnowledgeSource => {
    const now = new Date().toISOString();
    const source: KnowledgeSource = {
      sourceId: nextId(),
      name,
      origin,
      ingestionStatus: 'ready',
      sizeBytes,
      lastUpdatedAt: now,
      ...(syncStatus ? { syncStatus, lastSyncedAt: now } : {}),
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
    return connection;
  };

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

  return {
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
        state.account.hasLuciel = true;
        state.account.hasCompletedFirstRun = true;
        return clone(state.luciel);
      },
      async updateChannels(channels) {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        state.luciel.channels = clone(channels);
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
        return ok(state.luciel);
      },
      async capabilities() {
        guardVerified();
        return ok(seed.seedCapabilities);
      },
      async updateEscalation(contact) {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        state.luciel.escalation = clone(contact);
        return ok(state.luciel);
      },
      async updatePersonality(config) {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        state.luciel.personality = clone(config);
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
        state.luciel.state = 'paused';
        return ok(state.luciel);
      },
      async resume() {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        state.luciel.state = 'active';
        return ok(state.luciel);
      },
      async delete() {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        state.luciel.state = 'luciel_grace_window';
        state.luciel.graceWindowStartedAt = new Date().toISOString();
        return ok(state.luciel);
      },
      async restore() {
        guardVerified();
        if (!state.luciel) throw new LucielApiError({ code: 'not_found', message: 'No Luciel.' });
        // Restore returns ACTIVE, not paused (Arch §3.6.4).
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
        return ok([
          { chunkId: 'chunk-1', sourceId, ordinal: 0, text: 'Sample chunk preview text.' },
        ]);
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
        state.knowledge = state.knowledge.filter((s) => s.sourceId !== sourceId);
        await delay();
      },
      async resyncSource(sourceId) {
        guardVerified();
        const s = state.knowledge.find((k) => k.sourceId === sourceId);
        if (!s) throw new LucielApiError({ code: 'not_found', message: 'Source not found.' });
        s.lastSyncedAt = new Date().toISOString();
        s.syncStatus = 'synced';
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
          authorize_url: configured
            ? `${MOCK_AUTHORIZE_ORIGIN}/o/oauth2/v2/auth?provider=${provider}&state=${nextId()}`
            : `https://${provider}.invalid/authorize`,
          oauth_state_jti: nextId(),
        });
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
      async syncConnection(connectionId) {
        guardVerified();
        const c = state.syncConnections.find((x) => x.connectionId === connectionId);
        if (!c) throw new LucielApiError({ code: 'not_found', message: 'Connection not found.' });
        if (c.status !== 'connected') {
          throw new LucielApiError({
            code: 'conflict',
            message: 'Sync unavailable: this connection is not authorized yet.',
          });
        }
        const urls = (c.nonSecretConfig?.crawlUrls as string[] | undefined) ?? [];
        const added = urls.map((u) => {
          addSource(u, 'website_crawl', 40_000, 'synced');
          return u;
        });
        return ok({ added, updated: [], removed: [] });
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
        if (option?.authKind === 'credential_form') {
          return ok({ requiresClientForm: true });
        }
        return ok({ authorizeUrl: `${MOCK_AUTHORIZE_ORIGIN}/oauth/authorize?state=${nextId()}` });
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
        return ok({ authorizeUrl: `${MOCK_AUTHORIZE_ORIGIN}/oauth/authorize?state=${nextId()}` });
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
      async uploadRecordSourceCsv(file) {
        guardVerified();
        // Replace-on-upload, mirroring the backend: rows REPLACE the previous
        // table and the record_source connection flips to connected with the
        // honest row count in its detail.
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        const records = Math.max(0, lines.length - 1); // minus the header row
        const columns = (lines[0] ?? '').split(',').map((c) => c.trim()).filter(Boolean);
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
      async disconnect(connectionId) {
        guardVerified();
        const c = state.connections.find((x: Connection) => x.connectionId === connectionId);
        if (!c) throw new LucielApiError({ code: 'not_found', message: 'Connection not found.' });
        // Fail-safe: the credential is destroyed and the row lands on the
        // RECONNECTABLE not_connected, not terminal revoked (contract §1).
        c.status = 'not_connected';
        c.statusDetail = 'disconnected_by_admin';
        c.lastHealthCheckAt = null;
        delete c.nonSecretConfig;

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
        return ok({ authorizeUrl: `${MOCK_AUTHORIZE_ORIGIN}/oauth/authorize?state=${nextId()}` });
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
        if (!option || option.authKind !== 'credential_form') {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'This connection is completed with a sign-in, not typed details.',
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
      async revoke(connectionId) {
        guardVerified();
        const c = state.connections.find((x: Connection) => x.connectionId === connectionId);
        if (c) c.status = 'revoked';
        await delay();
      },
      async getEmailProvisioning() {
        guardVerified();
        return ok(state.emailProvisioning);
      },
      async provisionEmail(req) {
        guardVerified();
        // c22 (owner decision 2026-08-18): email is BYO-mailbox ONLY — both retired
        // platform modes answer the same actionable refusal the backend serves.
        // The mock mirrors the refusal so the UI can never re-grow the old paths
        // against a permissive fake.
        void req;
        throw new LucielApiError({
          code: 'validation_error',
          message:
            'Platform email addresses are no longer offered — connect your own mailbox ' +
            'instead (Configure → Channels → Email → Connect Outlook mailbox).',
        });
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
        return ok({ authorizeUrl: `${MOCK_AUTHORIZE_ORIGIN}/oauth/authorize?state=${nextId()}` });
      },
    },

    conversations: {
      async list() {
        guardVerified();
        return ok(state.conversations);
      },
      async getMessages(sessionId) {
        guardVerified();
        const transcript: Message[] = [
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
        if (c) c.mode = 'human_controlled';
        if (!c) throw new LucielApiError({ code: 'not_found', message: 'Session not found.' });
        return ok(c);
      },
      async handBack(sessionId) {
        guardVerified();
        const c = state.conversations.find((x) => x.sessionId === sessionId);
        if (c) c.mode = 'ai';
        if (!c) throw new LucielApiError({ code: 'not_found', message: 'Session not found.' });
        return ok(c);
      },
      async sendMessage(sessionId, text) {
        guardVerified();
        const c = state.conversations.find((x) => x.sessionId === sessionId);
        if (!c) throw new LucielApiError({ code: 'not_found', message: 'Session not found.' });
        if (c.mode !== 'human_controlled') {
          throw new LucielApiError({
            code: 'validation_error',
            message: 'Take over the conversation before replying.',
          });
        }
        const message: Message = {
          messageId: nextId(),
          role: 'human_agent',
          text,
          at: new Date().toISOString(),
        };
        (state.humanReplies[sessionId] ??= []).push(message);
        c.lastMessageAt = message.at;
        // The widget has no push transport: the reply is persisted and the
        // visitor picks it up on their next history fetch (contract §1).
        const delivered = c.channel !== 'widget';
        return ok({
          message,
          delivered,
          deliveryDetail: delivered ? null : ('widget_poll_only' as const),
        });
      },
      async getAnswerEvidence(_sessionId, messageId) {
        guardVerified();
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
          flaggedByAdmin: false,
        });
      },
      async flagAnswer() {
        guardVerified();
        await delay();
      },
      async listEscalations() {
        guardVerified();
        return ok(state.escalations);
      },
    },

    leads: {
      async list() {
        guardVerified();
        return ok(state.leads);
      },
      async erase(leadId) {
        guardVerified();
        state.leads = state.leads.filter((l) => l.leadId !== leadId);
        await delay();
      },
      async prune(leadIds) {
        guardVerified();
        state.leads = state.leads.filter((l) => !leadIds.includes(l.leadId));
        await delay();
      },
      async archive(leadId) {
        guardVerified();
        const l = state.leads.find((x) => x.leadId === leadId);
        if (!l) throw new LucielApiError({ code: 'not_found', message: 'Lead not found.' });
        l.state = 'archived';
        return ok(l);
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
        return ok({ url: 'https://checkout.stripe.com/mock-session' });
      },
      async removePaymentMethod() {
        guardVerified();
        state.billing.budget.billingState = 'free_cap';
        delete state.billing.paymentMethod;
        return ok(state.billing as BillingInfo);
      },
    },

    analytics: {
      async overview() {
        guardVerified();
        return ok(state.analytics);
      },
      async auditLog() {
        guardVerified();
        return ok(state.audit);
      },
    },

    account: {
      async requestExport() {
        guardVerified();
        return ok({ ok: true });
      },
      async close() {
        guardVerified();
        state.account.state = 'closed';
        state.luciel = null;
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
        contactSubmissions += 1;
        if (contactSubmissions > 3) {
          throw new LucielApiError({
            code: 'rate_limited',
            message: 'Too many messages just now. Please try again in a few minutes.',
          });
        }
        return ok({ ok: true });
      },
    },
  };
}
