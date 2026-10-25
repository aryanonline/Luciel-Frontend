import { accountClosedDetail, type Session } from '@luciel/api-client';

/**
 * The closed-account reduced page (round 7 WP-5 / owner decision D5). A closed
 * account still signs in; for 30 days it may read its status, reopen, and
 * re-request its export — every other admin route answers the typed 403
 * `account_closed`. Every guard routes such an owner HERE, never to /login: the
 * session is fine, the account is closed.
 */
export const ACCOUNT_CLOSED_PATH = '/account-closed';

/**
 * Closing the account signs the owner out (live walk run 7, 2026-10-25): the server
 * bumps the session epoch, so the very next call made with the old cookie answers
 * 401. The documented journey is "closing signs you out; for 30 days you can sign in
 * again" — so the account page sends the owner to the login page with this reason,
 * and signing in lands on the reduced page above.
 */
export const ACCOUNT_CLOSED_REASON = 'account_closed';
export const ACCOUNT_CLOSED_LOGIN_PATH = `/login?reason=${ACCOUNT_CLOSED_REASON}`;

/**
 * Set the moment the server confirms a closure made in THIS page, cleared by the next
 * successful sign-in. While it is set, a 401 is the closure's own sign-out, not an
 * expired session: the dashboard guard then sends the owner to the same
 * {@link ACCOUNT_CLOSED_LOGIN_PATH} the account page navigates to, so a session read
 * that lands between the close and that navigation can never win with "your session
 * expired". Module state on purpose: it lives exactly as long as this page does.
 */
let closedHere = false;
export const markSignedOutByClosure = (): void => {
  closedHere = true;
};
export const signedOutByClosure = (): boolean => closedHere;
export const clearSignedOutByClosure = (): void => {
  closedHere = false;
};

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
