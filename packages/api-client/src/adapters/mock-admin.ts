import type { LucielApiClient } from '../client';
import { LucielApiError } from '../schemas';
import type {
  Account,
  Luciel,
  BillingInfo,
  Connection,
  EmailProvisioning,
  KnowledgeSource,
  KnowledgeSyncConnection,
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

/** 50 MB per file (Vision §3.3) — the same limit the backend enforces. */
const PER_FILE_MAX_BYTES = 50_000_000;

/**
 * Stand-in consent host for OAuth starts. The UI only hands the browser to a
 * known provider host, and accepts this one only while running on the mock.
 */
export const MOCK_AUTHORIZE_ORIGIN = 'https://accounts.example.com';

export function createMockAdminClient(options: MockAdminOptions = {}): LucielApiClient {
  const latency = options.latencyMs ?? 0;

  // Mutable in-memory state, seeded from the deterministic fixtures.
  const state = {
    scenario: options.scenario ?? 'verified',
    account: clone(seed.seedAccount),
    luciel: clone(seed.seedLuciel) as Luciel | null,
    billing: clone(seed.seedBilling),
    connections: clone(seed.seedConnections),
    emailProvisioning: clone(seed.seedEmailProvisioning) as EmailProvisioning | null,
    knowledge: clone(seed.seedKnowledge),
    syncConnections: [] as KnowledgeSyncConnection[],
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
        state.luciel.tools = clone(tools);
        return ok(state.luciel);
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
    },

    connections: {
      async list() {
        guardVerified();
        return ok(state.connections);
      },
      async start(connectionType, _provider, opts) {
        guardVerified();
        // BYO SMS/Voice number (Arch §3.1.4/§3.1.6, Decision #48): the tenant supplies
        // their OWN E.164 number — no OAuth redirect. A supplied number enters carrier
        // registration (pending_carrier_registration); with no number the sender stays
        // 'unconfigured' → "Action needed: add your number". SMS + Voice share one number.
        if (connectionType === 'sms_sender') {
          if (opts?.phoneNumber && state.luciel) {
            for (const ch of state.luciel.channels) {
              if (ch.id === 'sms' || ch.id === 'voice') {
                ch.connectionStatus = 'pending_carrier_registration';
              }
            }
          }
          return ok({});
        }
        return ok({ authorizeUrl: `${MOCK_AUTHORIZE_ORIGIN}/oauth/authorize?state=${nextId()}` });
      },
      async reconnect(connectionId) {
        guardVerified();
        const c = state.connections.find((x) => x.connectionId === connectionId);
        if (c) c.status = 'connected';
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
      async disconnect(connectionId) {
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
        if (req.mode === 'own_domain') {
          // Own-domain inbound needs DNS/MX verification → not live yet.
          const emailAddress = req.emailAddress ?? 'hello@yourdomain.com';
          const domain = emailAddress.split('@')[1] ?? 'yourdomain.com';
          state.emailProvisioning = {
            mode: 'own_domain',
            emailAddress,
            status: 'pending_email_routing',
            dnsRecords: [
              { type: 'MX', host: domain, value: 'inbound.vantagemind.ai', priority: 10 },
              {
                type: 'TXT',
                host: domain,
                value: 'v=spf1 include:mail.vantagemind.ai ~all',
              },
              { type: 'CNAME', host: `vm._domainkey.${domain}`, value: 'dkim.vantagemind.ai' },
            ],
          };
        } else {
          // VM-subdomain fallback: zero DNS, live immediately.
          state.emailProvisioning = {
            mode: 'vm_subdomain',
            emailAddress: 'sarahchen.reply.vantagemind.ai',
            status: 'connected',
          };
        }
        return ok(state.emailProvisioning);
      },
      async swap(connectionId, _provider) {
        guardVerified();
        // Proven-before-cutover (Arch §3.8.7 B, Decision #39): the current
        // connection stays LIVE (status unchanged) until the replacement
        // health-checks. We only kick off the new connect flow here.
        void state.connections.find((x) => x.connectionId === connectionId);
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
          sourceChunks: [
            {
              sourceId: seed.seedKnowledge[0]!.sourceId,
              sourceName: 'Services brochure.pdf',
              text: 'Starter engagement is $899.',
            },
          ],
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
  };
}
