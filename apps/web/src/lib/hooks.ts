'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type {
  ChannelConfig,
  AddonTool,
  EscalationContact,
  PersonalityConfig,
  CreateLucielRequest,
  ConnectionType,
} from '@luciel/api-client';

/**
 * Thin TanStack Query hooks over the typed client. Components import these (or
 * `api`) — never an adapter. Query keys are centralized so mutations can
 * invalidate precisely.
 */
export const qk = {
  session: ['session'] as const,
  luciel: ['luciel'] as const,
  billing: ['billing'] as const,
  connections: ['connections'] as const,
  knowledge: ['knowledge'] as const,
  quota: ['quota'] as const,
  conversations: ['conversations'] as const,
  escalations: ['escalations'] as const,
  leads: ['leads'] as const,
  analytics: ['analytics'] as const,
  audit: ['audit'] as const,
};

export const useSession = () =>
  useQuery({ queryKey: qk.session, queryFn: () => api.auth.me(), retry: false });
export const useLuciel = () => useQuery({ queryKey: qk.luciel, queryFn: () => api.luciel.get() });
export const useBilling = () =>
  useQuery({ queryKey: qk.billing, queryFn: () => api.billing.get() });
export const useConnections = () =>
  useQuery({ queryKey: qk.connections, queryFn: () => api.connections.list() });
export const useKnowledge = () =>
  useQuery({ queryKey: qk.knowledge, queryFn: () => api.knowledge.listSources() });
export const useQuota = () =>
  useQuery({ queryKey: qk.quota, queryFn: () => api.knowledge.quota() });
export const useConversations = () =>
  useQuery({ queryKey: qk.conversations, queryFn: () => api.conversations.list() });
export const useEscalations = () =>
  useQuery({ queryKey: qk.escalations, queryFn: () => api.conversations.listEscalations() });
export const useLeads = () => useQuery({ queryKey: qk.leads, queryFn: () => api.leads.list() });
export const useAnalytics = () =>
  useQuery({ queryKey: qk.analytics, queryFn: () => api.analytics.overview() });
export const useAudit = () =>
  useQuery({ queryKey: qk.audit, queryFn: () => api.analytics.auditLog() });

/**
 * Swap a connected account, proven-before-cutover (Arch §3.8.7 B, Decision #39):
 * the current connection stays live until the replacement health-checks.
 */
export function useSwapConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { connectionId: string; provider: string }) =>
      api.connections.swap(args.connectionId, args.provider),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.connections }),
  });
}

/** Mutations that invalidate the Luciel after writing a pillar. */
export function useLucielMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.luciel });
  return {
    create: useMutation({
      mutationFn: (req: CreateLucielRequest) => api.luciel.create(req),
      onSuccess: () => {
        invalidate();
        qc.invalidateQueries({ queryKey: qk.session });
      },
    }),
    updateChannels: useMutation({
      mutationFn: (c: ChannelConfig[]) => api.luciel.updateChannels(c),
      onSuccess: invalidate,
    }),
    updateTools: useMutation({
      mutationFn: (t: AddonTool[]) => api.luciel.updateTools(t),
      onSuccess: invalidate,
    }),
    updateEscalation: useMutation({
      mutationFn: (e: EscalationContact) => api.luciel.updateEscalation(e),
      onSuccess: invalidate,
    }),
    updatePersonality: useMutation({
      mutationFn: (p: PersonalityConfig) => api.luciel.updatePersonality(p),
      onSuccess: invalidate,
    }),
    acknowledgeVoiceConsent: useMutation({
      mutationFn: () => api.luciel.acknowledgeVoiceConsent(),
      onSuccess: invalidate,
    }),
    // BYO SMS/Voice number connect (Arch §3.1.4/§3.1.6, Decision #48). Additive
    // phoneNumber; invalidates both Luciel (channel status) and connections.
    startConnection: useMutation({
      mutationFn: (args: { connectionType: ConnectionType; provider: string; phoneNumber?: string }) =>
        api.connections.start(args.connectionType, args.provider, {
          phoneNumber: args.phoneNumber,
        }),
      onSuccess: () => {
        invalidate();
        qc.invalidateQueries({ queryKey: qk.connections });
      },
    }),
    pause: useMutation({ mutationFn: () => api.luciel.pause(), onSuccess: invalidate }),
    resume: useMutation({ mutationFn: () => api.luciel.resume(), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: () => api.luciel.delete(), onSuccess: invalidate }),
    restore: useMutation({ mutationFn: () => api.luciel.restore(), onSuccess: invalidate }),
  };
}
