import type { LucielApiClient } from '../client';
import type { BillingInfo } from '../schemas';
import { createTransport, type TransportOptions } from './transport';

/** Ingest endpoints take `file` + `name` as multipart form fields. */
function formData(file: File, name: string): FormData {
  const form = new FormData();
  form.append('file', file);
  form.append('name', name);
  return form;
}

/**
 * Real httpAdapter for the admin client. Maps each interface method onto the
 * documented endpoint families (Arch §1.1). It is a thin, faithful mapping — the
 * SAME interface the mockAdapter implements, so swapping mock → http requires
 * ZERO component changes (Space Instructions §7).
 *
 * STATUS: endpoint PATHS below mirror the documented families; exact paths /
 * payload field names reconcile against the backend when it lands. Because all
 * UI depends only on the interface (not these paths), that reconciliation is
 * contained entirely within this file.
 */
export function createHttpAdminClient(opts: TransportOptions): LucielApiClient {
  const t = createTransport(opts);

  return {
    auth: {
      signup: (req) => t.post('/api/v1/auth/signup', req),
      login: (req) => t.post('/api/v1/auth/login', req),
      logout: () => t.post('/api/v1/auth/logout'),
      me: () => t.get('/api/v1/auth/me'),
      verifyEmail: (req) => t.post('/api/v1/auth/verify-email', req),
      resendVerification: () => t.post('/api/v1/auth/resend-verification'),
      forgotPassword: (req) => t.post('/api/v1/auth/forgot-password', req),
      resetPassword: (req) => t.post('/api/v1/auth/reset-password', req),
    },
    luciel: {
      get: () => t.get('/api/v1/admin/luciel'),
      create: (req) => t.post('/api/v1/admin/luciel', req),
      updateChannels: (channels) => t.put('/api/v1/admin/luciel/channels', { channels }),
      updateTools: (tools) => t.put('/api/v1/admin/luciel/tools', { tools }),
      capabilities: () => t.get('/api/v1/admin/luciel/capabilities'),
      updateEscalation: (contact) => t.put('/api/v1/admin/luciel/escalation', contact),
      resendContactConfirmation: (address) =>
        t.post('/api/v1/admin/luciel/escalation/resend-confirmation', { address }),
      updatePersonality: (config) => t.put('/api/v1/admin/luciel/personality', config),
      updateLeadRetention: (days) =>
        t.put('/api/v1/admin/luciel/lead-retention', { leadRetentionDays: days }),
      acknowledgeVoiceConsent: () => t.post('/api/v1/admin/luciel/voice-consent'),
      pause: () => t.post('/api/v1/admin/luciel/pause'),
      resume: () => t.post('/api/v1/admin/luciel/resume'),
      delete: () => t.post('/api/v1/admin/luciel/delete'),
      restore: () => t.post('/api/v1/admin/luciel/restore'),
    },
    knowledge: {
      listSources: () => t.get('/api/v1/admin/knowledge/sources'),
      getChunks: (sourceId) => t.get(`/api/v1/admin/knowledge/sources/${sourceId}/chunks`),
      quota: () => t.get('/api/v1/admin/knowledge/quota'),
      deleteSource: (sourceId) => t.del(`/api/v1/admin/knowledge/sources/${sourceId}`),
      resyncSource: (sourceId) => t.post(`/api/v1/admin/knowledge/sources/${sourceId}/resync`),
      uploadFile: (file, name) =>
        t.postForm('/api/v1/admin/knowledge/sources/upload', formData(file, name)),
      pasteText: (req) => t.post('/api/v1/admin/knowledge/sources/paste', req),
      importCsv: (file, name) =>
        t.postForm('/api/v1/admin/knowledge/sources/csv', formData(file, name)),
      startSyncConnection: (provider) =>
        t.post('/api/v1/admin/knowledge/sync-connections', { provider }),
      startCrawl: (crawlUrls) =>
        t.post('/api/v1/admin/knowledge/sync-connections', {
          provider: 'website_crawl',
          crawlUrls,
        }),
      syncConnection: (connectionId) =>
        t.post(`/api/v1/admin/knowledge/sync-connections/${connectionId}/sync`),
      getScope: (connectionId) =>
        t.get(`/api/v1/admin/knowledge/sync-connections/${connectionId}/scope`),
      listScopeCandidates: (connectionId) =>
        t.get(`/api/v1/admin/knowledge/sync-connections/${connectionId}/scope/candidates`),
      // `kind` is a server echo on read, so only id + name go back on write.
      saveScope: (connectionId, selections) =>
        t.put(`/api/v1/admin/knowledge/sync-connections/${connectionId}/scope`, {
          selections: selections.map(({ id, name }) => ({ id, name })),
        }),
    },
    connections: {
      list: () => t.get('/api/v1/admin/connections'),
      // snake_case is the parameter the backend declares (camelCase is an alias).
      // Sending the declared spelling is what keeps a pillar's picker to its own
      // providers instead of the whole catalog (contract §1).
      listProviders: (connectionType) =>
        t.get(
          connectionType
            ? `/api/v1/admin/connections/providers?connection_type=${encodeURIComponent(connectionType)}`
            : '/api/v1/admin/connections/providers',
        ),
      start: (connectionType, provider, opts) =>
        t.post('/api/v1/admin/connections', {
          connectionType,
          provider,
          // Additive: only sent for BYO SMS/Voice; omitted for OAuth flows (backend PR #32).
          ...(opts?.phoneNumber ? { phoneNumber: opts.phoneNumber } : {}),
        }),
      reconnect: (connectionId) => t.post(`/api/v1/admin/connections/${connectionId}/reconnect`),
      reverifySms: () => t.post('/api/v1/admin/connections/sms/reverify'),
      attestSmsRegistration: () => t.post('/api/v1/admin/connections/sms/attest-registration'),
      reverifyEmail: () => t.post('/api/v1/admin/connections/email/reverify'),
      listTwilioNumbers: (connectionId) =>
        t.get(`/api/v1/admin/connections/${connectionId}/twilio/numbers`),
      uploadRecordSourceCsv: (file) =>
        t.postForm('/api/v1/admin/connections/record-source/csv', formData(file, file.name)),
      completeOauth: (connectionId, code, state) =>
        t.post(`/api/v1/admin/knowledge/sync-connections/${connectionId}/oauth-callback`, {
          code,
          state,
        }),
      completeConnectionOauth: (connectionId, code, state) =>
        t.post(`/api/v1/admin/connections/${connectionId}/oauth-callback`, { code, state }),
      disconnect: (connectionId) =>
        t.post(`/api/v1/admin/connections/${connectionId}/disconnect`),
      switchAccount: (connectionId, provider) =>
        t.post(`/api/v1/admin/connections/${connectionId}/switch`, { provider: provider ?? null }),
      bindDestination: (connectionId, destination, channel) =>
        t.put(`/api/v1/admin/connections/${connectionId}/destination`, {
          destination,
          ...(channel ? { channel } : {}),
        }),
      submitCredentials: (connectionId, fields) =>
        t.post(`/api/v1/admin/connections/${connectionId}/credentials`, { fields }),
      revoke: (connectionId) => t.del(`/api/v1/admin/connections/${connectionId}`),
      getEmailProvisioning: () => t.get('/api/v1/admin/connections/email'),
      provisionEmail: (req) => t.post('/api/v1/admin/connections/email', req),
      swap: (connectionId, provider) =>
        t.post(`/api/v1/admin/connections/${connectionId}/swap`, { provider }),
    },
    conversations: {
      list: () => t.get('/api/v1/dashboard/conversations'),
      getMessages: (sessionId) => t.get(`/api/v1/dashboard/conversations/${sessionId}/messages`),
      takeOver: (sessionId) => t.post(`/api/v1/dashboard/conversations/${sessionId}/take-over`),
      handBack: (sessionId) => t.post(`/api/v1/dashboard/conversations/${sessionId}/hand-back`),
      sendMessage: (sessionId, text) =>
        t.post(`/api/v1/dashboard/conversations/${sessionId}/messages`, { text }),
      getAnswerEvidence: (sessionId, messageId) =>
        t.get(`/api/v1/dashboard/conversations/${sessionId}/messages/${messageId}/evidence`),
      flagAnswer: (sessionId, messageId) =>
        t.post(`/api/v1/dashboard/conversations/${sessionId}/messages/${messageId}/flag`),
      listEscalations: () => t.get('/api/v1/dashboard/escalations'),
    },
    leads: {
      list: () => t.get('/api/v1/dashboard/leads'),
      erase: (leadId) => t.del(`/api/v1/dashboard/leads/${leadId}`),
      prune: (leadIds) => t.post('/api/v1/dashboard/leads/prune', { leadIds }),
      archive: (leadId) => t.post(`/api/v1/dashboard/leads/${leadId}/archive`),
      markOutcome: (leadId, outcome) =>
        t.post(`/api/v1/dashboard/leads/${leadId}/outcome`, { outcome }),
      export: async (format) => {
        const file = await t.getFile(`/api/v1/dashboard/leads/export?format=${format}`);
        return { blob: file.blob, filename: file.filename ?? `leads.${format}` };
      },
    },
    billing: {
      get: () => t.get('/api/v1/billing'),
      startCheckout: () => t.post('/api/v1/billing/checkout'),
      removePaymentMethod: () => t.del<BillingInfo>('/api/v1/billing/payment-method'),
    },
    analytics: {
      overview: () => t.get('/api/v1/admin/usage/overview'),
      auditLog: () => t.get('/api/v1/admin/usage/audit-log'),
    },
    account: {
      requestExport: () => t.post('/api/v1/admin/account/export'),
      close: () => t.post('/api/v1/admin/account/close'),
    },
    contact: {
      submit: (req) => t.post('/api/v1/contact', req),
    },
    escalationContact: {
      // Public route — token-authorized, no session (round 5B item 13).
      confirm: (req) => t.post('/api/v1/escalation-contact/confirm', req),
    },
  };
}
