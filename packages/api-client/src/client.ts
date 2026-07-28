import type {
  Session,
  SignupRequest,
  LoginRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  VerifyEmailRequest,
  SignupResult,
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
  PasteTextRequest,
  KnowledgeSyncProvider,
  KnowledgeSyncConnection,
  KnowledgeSyncResult,
  BillingInfo,
  CheckoutSession,
  Connection,
  StartConnectionResult,
  ReverifySmsResult,
  EmailProvisioning,
  ProvisionEmailRequest,
  ConversationSummary,
  Message,
  SendMessageResult,
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
    signup(req: SignupRequest): Promise<SignupResult>;
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
    /** Multipart upload — PDF/DOCX/TXT/CSV, parsed server-side (Arch §3.2.2). */
    uploadFile(file: File, name: string): Promise<KnowledgeSource>;
    pasteText(req: PasteTextRequest): Promise<KnowledgeSource>;
    /** Explicit CSV path: always lands as origin='csv' structured rows. */
    importCsv(file: File, name: string): Promise<KnowledgeSource>;
    /**
     * Create a live-sync connection (Arch §3.2.3). OAuth providers come back
     * `unconfigured` and do not sync until the account is authorized; the
     * authorize navigation is a separate flow.
     */
    startSyncConnection(provider: KnowledgeSyncProvider): Promise<KnowledgeSyncConnection>;
    /** Website crawl needs no authorization, so it is created ready to sync. */
    startCrawl(crawlUrls: string[]): Promise<KnowledgeSyncConnection>;
    /** Pull a sync connection now — this is what turns a crawl into sources. */
    syncConnection(connectionId: string): Promise<KnowledgeSyncResult>;
  };

  connections: {
    list(): Promise<Connection[]>;
    /**
     * Start a connect flow. `opts.phoneNumber` carries the tenant's OWN E.164
     * number for the BYO SMS/Voice sender (Arch §3.1.4/§3.1.6, Decision #48) —
     * ADDITIVE and optional, so existing OAuth/credential callers are unchanged.
     */
    start(
      connectionType: Connection['connectionType'],
      provider: string,
      opts?: { phoneNumber?: string },
    ): Promise<StartConnectionResult>;
    /** Re-auth path for expired/error connections (Arch §3.8.7 B). */
    reconnect(connectionId: string): Promise<StartConnectionResult>;
    /**
     * Re-read the BYO SMS/Voice number's A2P 10DLC status with the carrier
     * (Arch §3.1.6). Distinct from reconnect: no credential is involved. The
     * tenant completes Brand + Campaign registration themselves (Legal §A2) and
     * then triggers this; since there is no background poller, without it a
     * number stays at `pending_carrier_registration` indefinitely. Stateless
     * and repeatable.
     */
    reverifySms(): Promise<ReverifySmsResult>;
    /**
     * Complete an OAuth flow: exchange the provider's `code` for a token, which the
     * backend stores as a tenant-scoped secret_ref (Arch §3.2.3/§3.8.3). Called by
     * the OAuth callback landing page after the provider redirects back.
     *
     * `state` is MANDATORY and verified server-side — single-use, 10-minute TTL,
     * bound to (admin, instance, connection, provider). A `validation_error` here
     * means the attempt is gone: restart the connect flow, never retry this call.
     */
    completeOauth(
      connectionId: string,
      code: string,
      state: string,
    ): Promise<KnowledgeSyncConnection>;
    disconnect(connectionId: string): Promise<void>;
    /**
     * Email-address provisioning (Arch §3.1.6a, Decision #49). Returns the current
     * provisioning, or null if the admin has not provisioned an address yet.
     */
    getEmailProvisioning(): Promise<EmailProvisioning | null>;
    /** Provision the send+receive address: own-domain (DNS/MX) or VM-subdomain. */
    provisionEmail(req: ProvisionEmailRequest): Promise<EmailProvisioning>;
    /**
     * Swap a CONNECTED account for a new one, proven-before-cutover (Arch
     * §3.8.7 B, Decision #39): the current connection stays live until the new
     * one health-checks, then cuts over. Distinct from reconnect (same account,
     * re-auth). Returns the connect flow for the replacement.
     */
    swap(connectionId: string, provider: string): Promise<StartConnectionResult>;
  };

  conversations: {
    list(): Promise<ConversationSummary[]>;
    getMessages(sessionId: string): Promise<Message[]>;
    /** Live takeover (Arch §3.4.12). */
    takeOver(sessionId: string): Promise<ConversationSummary>;
    handBack(sessionId: string): Promise<ConversationSummary>;
    /**
     * Reply to the visitor as the human agent while the session is
     * `human_controlled` (Arch §3.4.12, §11.5–11.7). Text is 1–4000 chars.
     * Rejected with `validation_error` outside takeover — Luciel owns the reply
     * then, and interleaving would make the transcript lie about who is speaking.
     * A `delivered: false` result is NOT an error; read `deliveryDetail`.
     */
    sendMessage(sessionId: string, text: string): Promise<SendMessageResult>;
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
