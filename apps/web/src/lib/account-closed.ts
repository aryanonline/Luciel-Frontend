import { accountClosedDetail, type Session } from '@luciel/api-client';

/**
 * The closed-account reduced page (round 7 WP-5 / owner decision D5). A closed
 * account still signs in; for 30 days it may read its status, reopen, and
 * re-request its export — every other admin route answers the typed 403
 * `account_closed`. Every guard routes such an owner HERE, never to /login: the
 * session is fine, the account is closed.
 */
export const ACCOUNT_CLOSED_PATH = '/account-closed';

/** The served session names a closed account (the login / me answer). */
export const sessionIsClosed = (session: Session | undefined | null): boolean =>
  session?.account.state === 'closed';

/** Any typed `account_closed` refusal from an admin route. */
export const isAccountClosedError = (error: unknown): boolean =>
  accountClosedDetail(error) !== null;

/** A served instant as a day the owner can read; the raw value when unparseable. */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { dateStyle: 'long' });
}
