import { describe, it, expect } from 'vitest';
import * as widgetEntry from '../widget';
import { createWidgetClient } from '../widget';

/**
 * Plane-separation guard (Space Instructions §1, §6.3): the widget entrypoint
 * must expose ZERO admin surface. This is a coarse scaffold-level check — the
 * real enforcement is the bundle-analysis gate in CI (see DEFINITION_OF_DONE)
 * — but it catches an accidental admin re-export at the source level early.
 */
describe('widget entrypoint contains no admin surface', () => {
  it('does not export the admin client factory or admin types', () => {
    const exported = Object.keys(widgetEntry);
    expect(exported).not.toContain('createLucielClient');
    expect(exported).not.toContain('chipForConnection');
    // It DOES export the data-plane widget client factory.
    expect(exported).toContain('createWidgetClient');
  });

  it('the mock widget client delivers the AI-identity disclosure + powered-by chrome', async () => {
    const client = createWidgetClient({ adapter: 'mock' });
    const boot = await client.bootstrap('vm_live_demo');
    // AI-identity disclosure is present and cannot be absent (Arch §3.4.16).
    expect(boot.openingMessage.toLowerCase()).toContain('ai assistant');
    expect(boot.aiAssistantLabel).toBe('AI assistant');
    // Powered-by VantageMind present on all accounts (Arch §3.4.17).
    expect(boot.poweredByVantageMind).toBe(true);
  });

  it('at_cap render state returns a graceful, no-LLM-style reply (Arch §3.4.1b)', async () => {
    const client = createWidgetClient({ adapter: 'mock', mock: { renderState: 'at_cap' } });
    const res = await client.send('vm_live_demo', { text: 'hello' });
    expect(res.renderState).toBe('at_cap');
    expect(res.reply.text.toLowerCase()).toContain('capacity');
  });
});
