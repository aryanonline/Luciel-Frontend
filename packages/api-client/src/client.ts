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
  CapabilityGroup,
  EscalationContact,
  PersonalityConfig,
  KnowledgeSource,
  KnowledgeChunk,
  KnowledgeQuota,
  PasteTextRequest,
  KnowledgeSyncProvider,
  KnowledgeSyncConnection,
  KnowledgeSyncResult,
  KnowledgeScope,
  ScopeCandidate,
  ScopeSelection,
  BillingInfo,
  CheckoutSession,
  Connection,
  ConnectionProviders,
  ConnectionType,
  DisconnectResult,
  MetaChannel,
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
  LeadExportFormat,
  LeadExportFile,
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
    /**
     * The owner-facing capability groups (contract §3, Decision #8). Read-only.
     * Render the scheduling control from THIS, never from a hardcoded tool-id
     * list — a baked-in member list silently keeps rendering yesterday's tools.
     */
    capabilities(): Promise<CapabilityGroup[]>;
    updateEscalation(contact: EscalationContact): Promise<Luciel>;
    updatePersonality(config: PersonalityConfig): Promise<Luciel>;
    /**
     * Set (`days` ≥ 1) or clear (`null`) the lead auto-prune rule — the Admin's
     * own retention choice over their own data (Arch §3.4.10a, Legal §B5).
     */
    updateLeadRetention(days: number | null): Promise<Luciel>;
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
    /**
     * The scope in force for a sync connection (Decision #9). `wholeAccount:
     * true` is the default and means the WHOLE account is read; `scopeKind: null`
     * means this provider has no selectable scope, so hide the picker.
     */
    getScope(connectionId: string): Promise<KnowledgeScope>;
    /**
     * What the owner may pick — a live call to the provider. Throws `conflict`
     * when there is no token yet, the provider call fails, or there is nothing to
     * narrow; show that message rather than an empty "no folders found" list.
     */
    listScopeCandidates(connectionId: string): Promise<ScopeCandidate[]>;
    /** Empty `selections` clears the scope back to the whole account. */
    saveScope(connectionId: string, selections: ScopeSelection[]): Promise<KnowledgeScope>;
  };

  connections: {
    list(): Promise<Connection[]>;
    /**
     * The provider CHOICES to render per connection type (contract §1,
     * Decision #6). `configured: false` means the platform cannot start that
     * flow yet — render the option disabled, never hide it.
     */
    listProviders(connectionType?: ConnectionType): Promise<ConnectionProviders[]>;
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
    /**
     * Complete an OAuth flow for a NON-knowledge connection (contract §2). One
     * generic route serves every provider and every connection type. Same
     * single-use `state` rule as completeOauth, plus: a `conflict` here is
     * PERSISTED on the row, so re-read the connection and show its
     * `statusDetail` rather than leaving the reason in a toast.
     */
    completeConnectionOauth(
      connectionId: string,
      code: string,
      state: string,
    ): Promise<Connection>;
    /**
     * Hand a connection back (contract §1): the stored credential is destroyed
     * and the row returns to a reconnectable `not_connected`. The returned
     * `disabledTools` / `disabledChannels` are what went off as a consequence —
     * tell the owner at confirmation time ("Scheduling was switched off too").
     */
    disconnect(connectionId: string): Promise<DisconnectResult>;
    /**
     * "This account is wrong." Disconnect, THEN start a fresh connect flow, so
     * nothing keeps serving from the account being left behind. Omit `provider`
     * to switch accounts within the same provider. For re-credentialing an
     * account that currently WORKS use `swap` (proven-before-cutover) instead.
     */
    switchAccount(connectionId: string, provider?: string | null): Promise<StartConnectionResult>;
    /**
     * Bind the Meta destination this `channel_auth` connection answers on
     * (contract §2) — WhatsApp `phone_number_id` or Instagram/Messenger Page id.
     * A connected Meta channel without one is NOT live: inbound routing resolves
     * the tenant by this id alone, so messages are dropped as unresolvable.
     *
     * `channel` names which of the three channels the ONE Meta grant is being
     * pointed at, which is what lets WhatsApp stay bound while Messenger is
     * bound too. Omitted only by the single-destination senders.
     */
    bindDestination(
      connectionId: string,
      destination: string,
      channel?: MetaChannel,
    ): Promise<Connection>;
    /**
     * The non-OAuth half of a connect (contract §1a): the values for the
     * provider's advertised `credentialFields`. This is how the customer's OWN
     * account is attached — their Twilio, their webhook endpoint — so nothing
     * ever runs on platform credentials. Secret fields go to Secrets Manager and
     * are never echoed back.
     */
    submitCredentials(connectionId: string, fields: Record<string, string>): Promise<Connection>;
    /** Terminal teardown — drives the row to `revoked` (distinct from disconnect). */
    revoke(connectionId: string): Promise<void>;
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
    /**
     * Download this tenant's leads. Export exists so an Admin is never asked to
     * prune what they cannot first take with them (Legal §B5, §A7).
     */
    export(format: LeadExportFormat): Promise<LeadExportFile>;
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
