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
  TestSmsWhich,
  TestSmsResult,
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
  TenantNumbersResult,
  CalendlyEventTypes,
  ConnectionSettingsUpdate,
  RecordSourceCsvResult,
  EmailProvisioning,
  ConversationSummary,
  Message,
  SendMessageResult,
  AnswerEvidence,
  EscalationEvent,
  Lead,
  LeadOutcome,
  LeadExportFormat,
  LeadExportFile,
  AnalyticsOverview,
  AuditEvent,
  ContactRequest,
  ContactResult,
  TeamAvailabilityUpdate,
  EmployeeStatus,
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
/** Offset paging for the list endpoints (2026-09-05 audit WP7): the server caps
 *  `limit` at 500 and defaults to 200; omit both for the first page. */
export interface PageOptions {
  limit?: number;
  offset?: number;
}

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
    /**
     * Mint a fresh public embed key (2026-09-05 audit F142). The old key stops
     * working the moment this returns; every embedded site must update its snippet.
     */
    rotateEmbedKey(): Promise<Luciel>;
    /**
     * Re-send the confirmation email for one configured escalation contact
     * (round 5B item 13). Inside the 5-minute per-address cooldown the server
     * answers `validation_error` with a try-again-shortly message.
     */
    resendContactConfirmation(address: string): Promise<Luciel>;
    /**
     * Text a saved SMS escalation contact through the tenant's own number
     * (2026-09-05 audit F084) — the phone-side twin of the email confirmation
     * loop, and proof the number can send. `validation_error` when the slot
     * is empty; `rate_limited` after a handful in a row.
     */
    sendTestEscalationSms(which: TestSmsWhich): Promise<TestSmsResult>;
    updatePersonality(config: PersonalityConfig): Promise<Luciel>;
    /**
     * Set (`days` ≥ 1) or clear (`null`) the lead auto-prune rule — the Admin's
     * own retention choice over their own data (Arch §3.4.10a, Legal §B5).
     */
    updateLeadRetention(days: number | null): Promise<Luciel>;
    /**
     * The websites the widget may load on (round 6 WP-I). An empty list turns the
     * restriction off. The server normalises each entry to `scheme://host[:port]`
     * and refuses paths, queries and non-http(s) schemes with a validation error.
     */
    updateAllowedOrigins(origins: string[]): Promise<Luciel>;
    /**
     * When the HUMAN team is reachable (round 6 WP-E). Luciel keeps answering around
     * the clock whatever is set; this shapes only the follow-up promise and where an
     * after-hours escalation goes. The server refuses a made-up timezone, a window
     * without length, and an after-hours rule with nobody on the other end.
     */
    updateTeamAvailability(req: TeamAvailabilityUpdate): Promise<Luciel>;
    /**
     * The employee's status (round 6 WP-F): what Luciel can do right now, needs
     * from the owner, and did yesterday/today — derived server-side from rows that
     * already exist. `null` when the account has no Luciel (same as `get`).
     */
    status(): Promise<EmployeeStatus | null>;
    /** Morning brief on/off (round 6 WP-F). */
    updateDailyBrief(enabled: boolean): Promise<Luciel>;
    /** The short name Luciel calls the business; `null` clears it (round 6 WP-F). */
    updateBusinessName(name: string | null): Promise<Luciel>;
    /** Withdraw the voice consent (round 6 WP-D): Voice goes off and asks again when re-enabled. */
    withdrawVoiceConsent(): Promise<Luciel>;
    /** Withdraw the SMS acknowledgement: SMS and Send SMS go off; re-enabling asks again. */
    withdrawSmsComplianceAck(): Promise<Luciel>;
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
    /** Tombstones the source; undo-able for 30 days via restoreSource (Arch §3.2.2). */
    deleteSource(sourceId: string): Promise<void>;
    /** Undo a delete inside its 30-day window. 404 once the window has closed. */
    restoreSource(sourceId: string): Promise<KnowledgeSource>;
    resyncSource(sourceId: string, opts?: { confirmShrink?: boolean }): Promise<KnowledgeSource>;
    /** Rename the display name only — chunks and embeddings are untouched (§3.2.2). */
    renameSource(sourceId: string, name: string): Promise<KnowledgeSource>;
    /** Swap the underlying file: same source row, chunks fully replaced (§3.2.2). */
    replaceSource(sourceId: string, file: File): Promise<KnowledgeSource>;
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
    /**
     * `confirmShrink` (2026-09-05 audit F107): a sync that would retire more than
     * half of what is synced is refused with a `conflict` until the owner confirms
     * the shrink is real — nothing is deleted on a broken read.
     */
    syncConnection(
      connectionId: string,
      opts?: { confirmShrink?: boolean },
    ): Promise<KnowledgeSyncResult>;
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
     * The OWNER attests their A2P 10DLC carrier registration is approved (round
     * 5B item 10) — the honest exit from `pending_carrier_registration`, since
     * the platform cannot verify campaign approval on their behalf. Texting
     * turns on on their word (audited server-side); senders whose recipients
     * aren't US-carrier-bound (e.g. Canada-only) may attest that 10DLC does not
     * apply. Idempotent. Throws `not_found` with no sms row and
     * `validation_error` (422) when the row isn't ready (no confirmed number,
     * or a credential/operability problem to repair first). The backend answers
     * the full connection row; the tolerant reverify result shape reads the
     * `status`/`statusDetail` the UI needs.
     */
    attestSmsRegistration(): Promise<ReverifySmsResult>;
    /**
     * Re-run the own-domain MX routing probe for the provisioned email address
     * (Arch §3.1.6a). Mirrors `reverifySms`: stateless and repeatable, with no
     * background poller — the tenant triggers this after publishing the DNS
     * records, and only a confirmed live result moves the address out of
     * `pending_email_routing`. Throws `not_found` when nothing is provisioned.
     * Same tolerant result shape as `reverifySms` (the backend serves the full
     * connection row).
     */
    reverifyEmail(): Promise<ReverifySmsResult>;
    /**
     * List the numbers in the tenant's OWN Twilio account for the designate
     * picker (C9). `numbers: null` means listing wasn't possible (no usable
     * credential yet, or the provider refused) — fall back to manual E.164
     * entry; this convenience never blocks the designate step.
     */
    listTwilioNumbers(connectionId: string): Promise<TenantNumbersResult>;
    /**
     * The owner's Calendly event types, with the one customers book marked (round 6
     * WP-H). `eventTypes: null` = the account could not be read right now.
     */
    listCalendlyEventTypes(connectionId: string): Promise<CalendlyEventTypes>;
    /**
     * Change a provider setting that is not a credential — today the Calendly event
     * type customers book. `validation_error` for a type the account does not offer,
     * or on a connection with no settings.
     */
    updateSettings(connectionId: string, req: ConnectionSettingsUpdate): Promise<Connection>;
    /**
     * Upload the CSV that backs the `lookup_record` tool (record_source
     * connection). Rows REPLACE the previous table; the connection flips to
     * connected with "N records on file". The Knowledge pillar calls this
     * alongside its knowledge ingest for CSV files, which is what makes the
     * tools-pillar copy "CSV lives under Knowledge" true (live-caught
     * 2026-08-17: this route previously had no frontend caller at all).
     */
    uploadRecordSourceCsv(file: File): Promise<RecordSourceCsvResult>;
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
    completeConnectionOauth(connectionId: string, code: string, state: string): Promise<Connection>;
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
    /**
     * Email-address provisioning (Arch §3.1.6a, Decision #49). Returns the current
     * provisioning, or null if the admin has not provisioned an address yet.
     */
    getEmailProvisioning(): Promise<EmailProvisioning | null>;
    /**
     * Swap a CONNECTED account for a new one, proven-before-cutover (Arch
     * §3.8.7 B, Decision #39): the current connection stays live until the new
     * one health-checks, then cuts over. Distinct from reconnect (same account,
     * re-auth). Returns the connect flow for the replacement.
     */
    swap(connectionId: string, provider: string): Promise<StartConnectionResult>;
    /**
     * Rotate the SMS webhook capability token and re-point the designated number's
     * webhooks at the new URL (2026-09-05 audit F142). Returns the SMS connection.
     */
    rotateSmsCapability(): Promise<Connection>;
    /**
     * Take the designated number off the Luciel, keeping the Twilio account (round 6
     * WP-D). The row returns to "add your number"; `validation_error` when none is on file.
     */
    removeSmsNumber(): Promise<Connection>;
    /** Withdraw the carrier-registration attestation: texting goes back behind the gate. */
    withdrawSmsAttestation(): Promise<Connection>;
    /**
     * Clear the CSV records behind Look up a record (round 6 WP-D): the record source is
     * handed back and the tool goes off — the result says so.
     */
    clearRecordSourceCsv(): Promise<DisconnectResult>;
  };

  conversations: {
    /** Newest first. Paged (2026-09-05 audit WP7): default 200, max 500 per call. */
    list(opts?: PageOptions): Promise<ConversationSummary[]>;
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
    listEscalations(opts?: PageOptions): Promise<EscalationEvent[]>;
  };

  leads: {
    /** Newest activity first. Paged (default 200, max 500 per call). */
    list(opts?: PageOptions): Promise<Lead[]>;
    /** Per-lead erasure (data-subject rights, Arch §3.4.11). */
    erase(leadId: string): Promise<void>;
    /** Prune = permanent delete (Arch §3.4.10a). */
    prune(leadIds: string[]): Promise<void>;
    /** Archive = kept in cold storage, NOT deleted (Arch §3.4.10a). */
    archive(leadId: string): Promise<Lead>;
    /**
     * Mark the lead's business outcome (Vision §7; C14) — what conversion
     * analytics group by. Reversible; audited server-side without lead PII.
     */
    markOutcome(leadId: string, outcome: LeadOutcome): Promise<Lead>;
    /**
     * Push the lead's current facts to the CRM again (2026-09-05 audit F134).
     * Same broker gates as a capture push; a 409 says why nothing was attempted.
     */
    retryCrmPush(leadId: string): Promise<Lead>;
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
    /** Newest first. Paged (2026-09-05 audit F170): default 200, max 500 per call. */
    auditLog(opts?: PageOptions): Promise<AuditEvent[]>;
  };

  account: {
    /** Close account — requires Luciel deleted first; export-first (Arch §3.6.6). */
    requestExport(): Promise<{ ok: boolean }>;
    /**
     * Round 6 WP-D (F156): while a Luciel is still active or paused the server refuses
     * (`conflict`) unless the caller confirms that closing deletes it.
     */
    close(opts?: { confirmDeleteLuciel?: boolean }): Promise<void>;
  };

  contact: {
    /**
     * Public marketing contact form — unauthenticated. The server verifies the
     * hCaptcha token and relays to an inbox whose address exists only there, so
     * it is never harvestable from the page source. `validation_error` (bad
     * captcha) and `rate_limited` are both expected outcomes to surface.
     */
    submit(req: ContactRequest): Promise<ContactResult>;
  };

  escalationContact: {
    /**
     * PUBLIC escalation-contact confirmation (round 5B item 13). The contact
     * may not be the account owner and has no session — the emailed single-use
     * token IS the authorization. An expired, replayed, or superseded link
     * answers `validation_error`; the page offers "ask the owner to re-send".
     */
    confirm(req: { token: string }): Promise<{ status: string }>;
  };
}
