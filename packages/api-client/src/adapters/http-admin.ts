import type { LucielApiClient } from '../client';
import { createTransport, type TransportOptions } from './transport';

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
      updateEscalation: (contact) => t.put('/api/v1/admin/luciel/escalation', contact),
      updatePersonality: (config) => t.put('/api/v1/admin/luciel/personality', config),
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
    },
    connections: {
      list: () => t.get('/api/v1/admin/connections'),
      start: (connectionType, provider) =>
        t.post('/api/v1/admin/connections', { connectionType, provider }),
      reconnect: (connectionId) => t.post(`/api/v1/admin/connections/${connectionId}/reconnect`),
      disconnect: (connectionId) => t.del(`/api/v1/admin/connections/${connectionId}`),
    },
    conversations: {
      list: () => t.get('/api/v1/dashboard/conversations'),
      getMessages: (sessionId) => t.get(`/api/v1/dashboard/conversations/${sessionId}/messages`),
      takeOver: (sessionId) => t.post(`/api/v1/dashboard/conversations/${sessionId}/take-over`),
      handBack: (sessionId) => t.post(`/api/v1/dashboard/conversations/${sessionId}/hand-back`),
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
    },
    billing: {
      get: () => t.get('/api/v1/billing'),
      startCheckout: () => t.post('/api/v1/billing/checkout'),
      removePaymentMethod: () => t.del('/api/v1/billing/payment-method'),
    },
    analytics: {
      overview: () => t.get('/api/v1/admin/usage/overview'),
      auditLog: () => t.get('/api/v1/admin/usage/audit-log'),
    },
    account: {
      requestExport: () => t.post('/api/v1/admin/account/export'),
      close: () => t.post('/api/v1/admin/account/close'),
    },
  };
}
