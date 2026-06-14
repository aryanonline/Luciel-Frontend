import type {
  Account,
  Session,
  SignupRequest,
  LoginRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  VerifyEmailRequest,
  ResendVerificationResult,
  Luciel,
  CreateLucielRequest,
  ChannelConfig,
  AddonTool,
  EscalationContact,
  PersonalityConfig,
  KnowledgeSource,
  KnowledgeChunk,
  KnowledgeQuota,
  BillingInfo,
  CheckoutSession,
  Connection,
  StartConnectionResult,
  ConversationSummary,
  Message,
  AnswerEvidence,
  EscalationEvent,
  Lead,
  AnalyticsOverview,
  AuditEvent,
} from './schemas';

/**
 * THE typed admin/control-plane API client interface. UI (pages, hooks,
 * components) imports ONLY this — never an adapter, never the mock
 * (Space Instructions §7). Two adapters implement this interface (mock | http);
 * swapping them must require ZERO component changes.
 *
 * Method families mirror the documented endpoint surface (Arch §1.1):
 *   /api/v1/auth/*, /api/v1/admin/*, /api/v1/billing/*, /api/v1/dashboard/*,
 *   /api/v1/admin/connections/*, /api/v1/admin/usage/*.
 *
 * This interface lives in the CONTROL PLANE. The widget never imports it
 * (Space Instructions §1, §6.3); the widget uses WidgetApiClient (./widget).
 */
export interface LucielApiClient {
  auth: {
    signup(req: SignupRequest): Promise<{ account: Account }>;
    login(req: LoginRequest): Promise<Session>;
    logout(): Promise<void>;
    /** Returns the current session, or throws LucielApiError('unauthorized'). */
    me(): Promise<Session>;
    verifyEmail(req: VerifyEmailRequest): Promise<Session>;
    resendVerification(): Promise<ResendVerificationResult>;
    forgotPassword(req: ForgotPasswordRequest): Promise<{ ok: boolean }>;
    /** On success all sessions are revoked server-side (Arch §3.7.1a). */
    resetPassword(req: ResetPasswordRequest): Promise<{ ok: boolean }>;
  };

  luciel: {
    /** Returns null when account is empty (no Luciel yet). */
    get(): Promise<Luciel | null>;
    create(req: CreateLucielRequest): Promise<Luciel>;
    updateChannels(channels: ChannelConfig[]): Promise<Luciel>;
    updateTools(tools: AddonTool[]): Promise<Luciel>;
    updateEscalation(contact: EscalationContact): Promise<Luciel>;
    updatePersonality(config: PersonalityConfig): Promise<Luciel>;
    /** Voice-enable one-time consent ack — hard gate, logged (Arch §3.1.2). */
    acknowledgeVoiceConsent(): Promise<Luciel>;
    pause(): Promise<Luciel>;
    resume(): Promise<Luciel>;
    /** Delete Luciel — fused quiesce, 30-day grace (Arch §3.6.3). */
    delete(): Promise<Luciel>;
    /** Restore within grace window → returns ACTIVE, not paused (Arch §3.6.4). */
    restore(): Promise<Luciel>;
  };

  knowledge: {
    listSources(): Promise<KnowledgeSource[]>;
    getChunks(sourceId: string): Promise<KnowledgeChunk[]>;
    quota(): Promise<KnowledgeQuota>;
    deleteSource(sourceId: string): Promise<void>;
    resyncSource(sourceId: string): Promise<KnowledgeSource>;
  };

  connections: {
    list(): Promise<Connection[]>;
    start(
      connectionType: Connection['connectionType'],
      provider: string,
    ): Promise<StartConnectionResult>;
    /** Re-auth path for expired/error connections (Arch §3.8.7 B). */
    reconnect(connectionId: string): Promise<StartConnectionResult>;
    disconnect(connectionId: string): Promise<void>;
  };

  conversations: {
    list(): Promise<ConversationSummary[]>;
    getMessages(sessionId: string): Promise<Message[]>;
    /** Live takeover (Arch §3.4.12). */
    takeOver(sessionId: string): Promise<ConversationSummary>;
    handBack(sessionId: string): Promise<ConversationSummary>;
    /** Answer review — source chunks + grounding score (Arch §3.4.13). */
    getAnswerEvidence(sessionId: string, messageId: string): Promise<AnswerEvidence>;
    flagAnswer(sessionId: string, messageId: string): Promise<void>;
    listEscalations(): Promise<EscalationEvent[]>;
  };

  leads: {
    list(): Promise<Lead[]>;
    /** Per-lead erasure (data-subject rights, Arch §3.4.11). */
    erase(leadId: string): Promise<void>;
    /** Prune = permanent delete (Arch §3.4.10a). */
    prune(leadIds: string[]): Promise<void>;
    /** Archive = kept in cold storage, NOT deleted (Arch §3.4.10a). */
    archive(leadId: string): Promise<Lead>;
  };

  billing: {
    get(): Promise<BillingInfo>;
    /** Adding a card = Stripe Checkout, no charge at save (Customer Journey §6). */
    startCheckout(): Promise<CheckoutSession>;
    removePaymentMethod(): Promise<BillingInfo>;
  };

  analytics: {
    overview(): Promise<AnalyticsOverview>;
    auditLog(): Promise<AuditEvent[]>;
  };

  account: {
    /** Close account — requires Luciel deleted first; export-first (Arch §3.6.6). */
    requestExport(): Promise<{ ok: boolean }>;
    close(): Promise<void>;
  };
}
