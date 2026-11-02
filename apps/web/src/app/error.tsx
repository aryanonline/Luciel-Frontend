'use client';

import { ErrorScreen, type ErrorScreenProps } from '@/components/error-screen';

/**
 * Catches an error in any page or nested layout, the dashboard's included (this
 * boundary sits under the root layout). A failure in the root layout itself lands
 * in global-error.tsx.
 */
export default function ErrorPage(props: ErrorScreenProps) {
  return <ErrorScreen {...props} />;
}
