'use client';

import { WidgetPreview } from '@/components/widget-preview';

/**
 * PUBLIC sample widget (pre-auth marketing plane). This is a canned demo on a
 * demo key — deliberately the mock adapter, since this route is unauthenticated
 * and has no tenant. Admins test their OWN Luciel from the dashboard embed page,
 * which runs the same preview against their real embed key (Customer Journey §5).
 */
export default function EmbedPreviewPage() {
  return (
    <div className="mx-auto max-w-5xl px-vm-5 py-vm-8">
      <h1 className="font-heading text-vm-5">See a Luciel in action</h1>
      <p className="mt-vm-1 text-vm-1 text-vm-text-muted">
        A sample assistant on a sample business — this is what the widget looks like on your site.
        To try your own, open Embed &amp; launch in your dashboard.
      </p>
      <div className="mt-vm-6">
        <WidgetPreview embedKey="vm_live_demo" adapter="mock" />
      </div>
    </div>
  );
}
