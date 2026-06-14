'use client';

import { WidgetPreview } from '@/components/widget-preview';

/**
 * "Test it here" preview host (Customer Journey §5). Simulates a customer's
 * website page with the widget injected, so the admin can try their Luciel.
 */
export default function EmbedPreviewPage() {
  return (
    <div className="mx-auto max-w-5xl px-vm-5 py-vm-8">
      <h1 className="font-heading text-vm-5">Test your Luciel</h1>
      <p className="mt-vm-1 text-vm-1 text-vm-text-muted">
        This simulates your website with the widget injected. Try asking a question.
      </p>
      <div className="mt-vm-6">
        <WidgetPreview embedKey="vm_live_demo" />
      </div>
    </div>
  );
}
