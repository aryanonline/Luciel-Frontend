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
