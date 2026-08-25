'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type {
  ChannelConfig,
  AddonTool,
  Connection,
  DisconnectResult,
  EscalationContact,
  PersonalityConfig,
  CreateLucielRequest,
  ProvisionEmailRequest,
  ConnectionType,
  MetaChannel,
  StartConnectionResult,
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
  connectionProviders: (connectionType?: ConnectionType) =>
    ['connectionProviders', connectionType ?? 'all'] as const,
  capabilities: ['capabilities'] as const,
  emailProvisioning: ['emailProvisioning'] as const,
  knowledge: ['knowledge'] as const,
  chunks: (sourceId: string) => ['chunks', sourceId] as const,
  quota: ['quota'] as const,
  conversations: ['conversations'] as const,
  escalations: ['escalations'] as const,
  leads: ['leads'] as const,
  analytics: ['analytics'] as const,
  audit: ['audit'] as const,
  twilioNumbers: (connectionId: string) => ['twilioNumbers', connectionId] as const,
};

export const useSession = () =>
  useQuery({ queryKey: qk.session, queryFn: () => api.auth.me(), retry: false });
export const useLuciel = () => useQuery({ queryKey: qk.luciel, queryFn: () => api.luciel.get() });
export const useBilling = () =>
  useQuery({ queryKey: qk.billing, queryFn: () => api.billing.get() });
export const useConnections = () =>
  useQuery({ queryKey: qk.connections, queryFn: () => api.connections.list() });
/**
 * The provider CHOICES for a connection type (Decision #6). Served, not
 * hardcoded, so a customer on a different CRM is never stuck with our default.
 */
export const useConnectionProviders = (connectionType?: ConnectionType) =>
  useQuery({
    queryKey: qk.connectionProviders(connectionType),
    queryFn: () => api.connections.listProviders(connectionType),
  });
/**
 * The tenant's own Twilio numbers for the designate picker (C9). `numbers: null`
 * in the result = listing wasn't possible — render the manual E.164 field alone;
 * the picker is a convenience that never blocks designate.
 */
export const useTwilioNumbers = (connectionId?: string) =>
  useQuery({
    queryKey: qk.twilioNumbers(connectionId ?? ''),
    queryFn: () => api.connections.listTwilioNumbers(connectionId as string),
    enabled: Boolean(connectionId),
  });
/** Owner-facing capability groups — the source of the scheduling control (Decision #8). */
export const useCapabilities = () =>
  useQuery({ queryKey: qk.capabilities, queryFn: () => api.luciel.capabilities() });
export const useEmailProvisioning = () =>
  useQuery({
    queryKey: qk.emailProvisioning,
    queryFn: () => api.connections.getEmailProvisioning(),
  });
export const useKnowledge = () =>
  useQuery({ queryKey: qk.knowledge, queryFn: () => api.knowledge.listSources() });
export const useQuota = () =>
  useQuery({ queryKey: qk.quota, queryFn: () => api.knowledge.quota() });
/** Chunk preview (Arch §3.2.2) — only fetched while a source is open for viewing. */
export const useChunks = (sourceId: string | null) =>
  useQuery({
    queryKey: qk.chunks(sourceId ?? ''),
    queryFn: () => api.knowledge.getChunks(sourceId as string),
    enabled: sourceId !== null,
  });
export const useConversations = () =>
  useQuery({ queryKey: qk.conversations, queryFn: () => api.conversations.list() });
export const useEscalations = () =>
  useQuery({ queryKey: qk.escalations, queryFn: () => api.conversations.listEscalations() });
export const useLeads = () => useQuery({ queryKey: qk.leads, queryFn: () => api.leads.list() });
export const useAnalytics = () =>
  useQuery({ queryKey: qk.analytics, queryFn: () => api.analytics.overview() });
export const useAudit = () =>
  useQuery({ queryKey: qk.audit, queryFn: () => api.analytics.auditLog() });

/** Email-address provisioning (Arch §3.1.6a, Decision #49): own-domain / VM-subdomain. */
export function useProvisionEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: ProvisionEmailRequest) => api.connections.provisionEmail(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.emailProvisioning }),
  });
}

/**
 * Re-run the own-domain MX routing probe (Arch §3.1.6a). Stateless and
 * repeatable; with no background poller this is the only exit from
 * `pending_email_routing`, so the pending card offers it explicitly.
 */
export function useReverifyEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.connections.reverifyEmail(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.emailProvisioning });
      qc.invalidateQueries({ queryKey: qk.connections });
    },
  });
}

/**
 * The ONE connection lifecycle (Decision #5) every tool and channel shares:
 * connect → disconnect → switch account/provider → reconnect. Each mutation
 * invalidates the Luciel too, because a disconnect switches dependent tools and
 * channels off server-side and the pillars must show that immediately.
 *
 * `connect` and `switchTo` resolve the connection id the OAuth callback will
 * need: `POST /connections` answers with an authorize URL but no id, and there
 * is one active connection per type (§3.8.2), so the row is read back.
 */
export function useConnectionLifecycle() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.connections });
    qc.invalidateQueries({ queryKey: qk.luciel });
  };
  const resolveId = async (connectionType: ConnectionType, provider: string) => {
    const rows = await api.connections.list();
    const match =
      rows.find((c) => c.connectionType === connectionType && c.provider === provider) ??
      rows.find((c) => c.connectionType === connectionType);
    return match?.connectionId;
  };
  return {
    connect: useMutation<
      StartedConnectFlow,
      Error,
      { connectionType: ConnectionType; provider: string }
    >({
      mutationFn: async ({ connectionType, provider }) => {
        const start = await api.connections.start(connectionType, provider);
        return { ...start, connectionId: await resolveId(connectionType, provider) };
      },
      onSuccess: invalidate,
    }),
    switchTo: useMutation<
      StartedConnectFlow,
      Error,
      { connectionId: string; provider?: string | null }
    >({
      mutationFn: async ({ connectionId, provider }) => ({
        ...(await api.connections.switchAccount(connectionId, provider ?? null)),
        connectionId,
      }),
      onSuccess: invalidate,
    }),
    reconnect: useMutation<StartedConnectFlow, Error, { connectionId: string }>({
      mutationFn: async ({ connectionId }) => ({
        ...(await api.connections.reconnect(connectionId)),
        connectionId,
      }),
      onSuccess: invalidate,
    }),
    disconnect: useMutation<DisconnectResult, Error, { connectionId: string }>({
      mutationFn: ({ connectionId }) => api.connections.disconnect(connectionId),
      onSuccess: invalidate,
    }),
    bindDestination: useMutation<
      Connection,
      Error,
      { connectionId: string; destination: string; channels?: MetaChannel[] }
    >({
      // A Meta grant can serve more than one channel from the same asset (an
      // Instagram account and its Page are the same Page id), so a row may bind
      // several — each named, so none unbinds another (contract §2).
      mutationFn: async ({ connectionId, destination, channels }) => {
        if (!channels || channels.length === 0) {
          return api.connections.bindDestination(connectionId, destination);
        }
        let last: Connection | undefined;
        for (const channel of channels) {
          last = await api.connections.bindDestination(connectionId, destination, channel);
        }
        return last as Connection;
      },
      onSuccess: invalidate,
    }),
    /**
     * The second half of a non-OAuth connect (contract §1a): the customer's own
     * credential for the row a `connect`/`switch` just started. A started row
     * with no credential is a dead end, so the two are always run together.
     */
    submitCredentials: useMutation<
      Connection,
      Error,
      { connectionId: string; fields: Record<string, string> }
    >({
      mutationFn: ({ connectionId, fields }) =>
        api.connections.submitCredentials(connectionId, fields),
      onSuccess: invalidate,
    }),
  };
}

/** A started connect/switch/reconnect flow, plus the id its callback completes. */
export type StartedConnectFlow = StartConnectionResult & { connectionId?: string };

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
    resendContactConfirmation: useMutation({
      mutationFn: (address: string) => api.luciel.resendContactConfirmation(address),
      onSuccess: invalidate,
    }),
    updatePersonality: useMutation({
      mutationFn: (p: PersonalityConfig) => api.luciel.updatePersonality(p),
      onSuccess: invalidate,
    }),
    updateLeadRetention: useMutation({
      mutationFn: (days: number | null) => api.luciel.updateLeadRetention(days),
      onSuccess: invalidate,
    }),
    acknowledgeVoiceConsent: useMutation({
      mutationFn: () => api.luciel.acknowledgeVoiceConsent(),
      onSuccess: invalidate,
    }),
    // Starts a connect flow. OAuth callers MUST use `mutateAsync` and hand the
    // returned `authorizeUrl` to `authorizeOrExplain` — an unconsumed result
    // leaves the admin on a page that silently did nothing (Arch §3.8.7).
    // `phoneNumber` is the additive BYO SMS/Voice path (Arch §3.1.4/§3.1.6,
    // Decision #48), which has no redirect. Invalidates Luciel + connections.
    startConnection: useMutation<
      StartConnectionResult,
      Error,
      { connectionType: ConnectionType; provider: string; phoneNumber?: string }
    >({
      mutationFn: (args) =>
        api.connections.start(args.connectionType, args.provider, {
          phoneNumber: args.phoneNumber,
        }),
      onSuccess: () => {
        invalidate();
        qc.invalidateQueries({ queryKey: qk.connections });
      },
    }),
    // On-demand A2P 10DLC re-verify of the BYO number (Arch §3.1.6). There is no
    // background poller, so this is the only thing that moves a number out of
    // pending_carrier_registration once the tenant has registered it themselves.
    reverifySmsNumber: useMutation({
      mutationFn: () => api.connections.reverifySms(),
      onSuccess: () => {
        invalidate();
        qc.invalidateQueries({ queryKey: qk.connections });
      },
    }),
    // The OWNER's attestation that their A2P 10DLC carrier registration is
    // approved (or does not apply to their recipients) — the other exit from
    // pending_carrier_registration. The platform cannot verify campaign
    // approval on their behalf; texting turns on on their word (audited).
    attestSmsRegistration: useMutation({
      mutationFn: () => api.connections.attestSmsRegistration(),
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
