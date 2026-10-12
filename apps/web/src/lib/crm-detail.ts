/**
 * 2026-09-05 audit F134: the backend's non-secret CRM push reason, in plain words.
 * Lives outside the page module because a Next.js App Router page may only export
 * the route contract (default + metadata), never helpers.
 */
/** The backend's non-secret reason → plain words. Unknown reasons are shown as-is
 *  (they are stable, non-secret tokens), never hidden behind a generic "failed". */
export function describeCrmDetail(detail: string | null | undefined): string {
  if (!detail) return 'the CRM did not accept the record';
  const reason = detail.replace(/^crm_error:\s*/, '');
  if (reason === 'crm_lead_key_not_owned') return 'the record key did not belong to this lead';
  if (reason === 'crm_key_not_email') return 'your CRM needs an email address for this lead';
  if (reason === 'crm_token_unavailable') return 'your CRM sign-in could not be renewed';
  if (/_http_4\d\d$/.test(reason))
    return `your CRM rejected the record (${reason.split('_').pop()})`;
  if (/_http_5\d\d$/.test(reason)) return 'your CRM was unavailable';
  if (reason.startsWith('crm_webhook_'))
    return `your webhook did not accept it (${reason.slice(12)})`;
  return reason.replace(/_/g, ' ');
}

/**
 * Round 7 WP-3c item 5: why a lead was NEVER sent (`crmStatus === 'never_attempted'`,
 * `crmDetail` = backend `NeverAttemptedReason`), in the owner's words. The reason is
 * derived server-side from the tenant's CURRENT posture, so it is exactly the reason
 * the next push would be refused for. An unknown token is de-snaked, never hidden.
 */
export function describeNeverAttempted(reason: string | null | undefined): string {
  switch (reason) {
    case 'crm_not_connected':
      return 'no CRM is connected';
    case 'dormant':
      return 'your CRM connection is dormant until a card is on file';
    case 'tool_off':
      return 'the Push to CRM tool is switched off';
    case 'no_crm_key':
      return 'this lead has no email address your CRM accepts';
    case 'not_yet_pushed':
      return 'it was captured before your CRM was connected';
    case null:
    case undefined:
    case '':
      return 'nothing has pushed it yet';
    default:
      return reason.replace(/_/g, ' ');
  }
}

/**
 * The reasons under which a never-sent lead CAN be sent now — the backfill
 * candidates (backend `backfill_crm`: every active lead with no push status, the
 * keyless ones counted as skipped). A tenant-level refusal (no CRM, dormant, tool
 * off) is not a candidate: offering to send it would be offering a 409.
 */
export function isBackfillCandidate(l: {
  state: 'active' | 'archived';
  crmStatus?: 'synced' | 'failed' | 'never_attempted' | null;
  crmDetail?: string | null;
}): boolean {
  if (l.state !== 'active' || l.crmStatus !== 'never_attempted') return false;
  return l.crmDetail === 'not_yet_pushed' || l.crmDetail === 'no_crm_key';
}
