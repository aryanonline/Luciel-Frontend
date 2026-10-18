import * as React from 'react';
import { exportEmailOutcome, type AccountExportResult } from '@luciel/api-client';

/**
 * The export outcome, from the served result (round 7 WP-10 item 12; WP-5 item 4):
 * the link itself when the server returned one, how long it lives, and what
 * ACTUALLY happened to the email carrying it (`emailOutcome`). The backend used to
 * drop the mailer's answer, so the page said "we emailed it" over mail that never
 * left; now an email that did not go out is said plainly, and the link on this
 * page is named as the only copy. An older server that does not report the
 * outcome gets the least-claiming sentence ("we also tried"). Shared by the
 * account page's export dialog and the closed-account page's re-request (D5).
 */
export function ExportReady({ result }: { result: AccountExportResult }) {
  const days = result.ttlDays;
  const life = days === undefined ? '' : ` It works for ${days} day${days === 1 ? '' : 's'}.`;
  const outcome = exportEmailOutcome(result.emailOutcome);
  const hasLink = Boolean(result.downloadUrl);

  let emailLine: React.ReactNode;
  switch (outcome.kind) {
    case 'sent':
      emailLine = hasLink
        ? 'We also emailed this link to you.'
        : `We emailed the download link to you.${life}`;
      break;
    case 'recorded':
      emailLine = hasLink
        ? 'This environment does not send email, so the link above is the only copy — save it now.'
        : 'This environment does not send email, and no link came back. Please try again.';
      break;
    case 'no_sender':
      emailLine = hasLink
        ? 'We could not email this link — email sending is not set up yet — so the link above is the only copy. Save it now.'
        : 'We could not email the link — email sending is not set up yet — and no link came back. Please try again.';
      break;
    case 'failed':
      emailLine = (
        <>
          {hasLink
            ? 'The email carrying this link did not go out, so the link above is the only copy. Save it now.'
            : 'The email carrying the link did not go out, and no link came back. Please try again.'}
          {outcome.reason ? (
            <span className="block text-vm-0">Reference: {outcome.reason}</span>
          ) : null}
        </>
      );
      break;
    default:
      emailLine = hasLink
        ? 'We also tried to email this link to you.'
        : `We tried to email the download link to you.${life}`;
  }
  const emailFailed =
    outcome.kind === 'no_sender' || outcome.kind === 'failed' || outcome.kind === 'recorded';

  return (
    <div className="space-y-vm-2 text-vm-1" role="status">
      <p className="font-label">Your export is ready.</p>
      {result.downloadUrl ? (
        <p>
          <a
            href={result.downloadUrl}
            className="underline underline-offset-2"
            target="_blank"
            rel="noreferrer"
          >
            Download your export
          </a>
          {life}
        </p>
      ) : null}
      <p
        className={emailFailed ? 'text-vm-danger' : 'text-vm-text-muted'}
        data-email-outcome={outcome.kind}
      >
        {emailLine}
      </p>
    </div>
  );
}
