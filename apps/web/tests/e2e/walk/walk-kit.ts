import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect, mockControl } from '../support/fixtures';

/**
 * The customer walk's toolkit (round 7 WP-12). ONE spec walks the dashboard the way
 * a customer does; it runs against the mock (`walk` project) and, unchanged, against
 * a deployed environment (`live-walk`, dispatch-only). The mode decides three things:
 *
 *  - the error leg: on the mock every mutation is first made to FAIL (an injected
 *    500) and the page must say so and keep the owner's input; live cannot inject;
 *  - the pending leg: on the mock the call is slowed so the pending label is
 *    asserted; live is not slowed;
 *  - owner assets and provider consents: live skips those steps, each with the
 *    reason, visibly (a skipped step in the report, an annotation, a console line).
 *
 * Every mutation, in both modes, is followed by a reload-after-mutation check.
 */

export interface WalkTarget {
  live: boolean;
  /** Credentials: test values on the mock; GitHub secrets on live (never typed by a person). */
  email: string;
  password: string;
}

export function walkTarget(): WalkTarget {
  const live = process.env.E2E_LIVE === '1';
  return live
    ? {
        live,
        email: process.env.E2E_EMAIL ?? '',
        password: process.env.E2E_PASSWORD ?? '',
      }
    : { live, email: 'owner@example.test', password: 'mock-password' };
}

/** Why live skips a step: an owner asset or a provider consent it would need. */
export const NEEDS = {
  twilioNumber: 'needs an owner asset: a Twilio account and business number to text from',
  mailbox: 'needs an owner asset: a mailbox to receive the confirmation link',
  meta: 'needs a provider consent: a Meta (WhatsApp / Messenger) sign-in',
  crm: 'needs a provider consent: a CRM sign-in (HubSpot / Salesforce)',
  calendar: 'needs a provider consent: a calendar sign-in (Google Calendar / Calendly)',
  knowledgeOauth: 'needs a provider consent: a Google Drive / Notion sign-in',
  card: 'needs an owner asset: a real card (Stripe Checkout / the Billing Portal)',
  mockControl:
    'needs the mock control surface (a fault, a revoked grant or a visitor ending a session cannot be staged on a live tenant)',
} as const;

export interface Mutation {
  /** "namespace.method" the mock fails for the error leg (omit: no error leg). */
  method?: string;
  /** The action — run once for the error leg (mock) and once for real. */
  act: () => Promise<void>;
  /** What the page shows while the write is in flight (asserted on the mock). */
  pending?: Locator;
  /** What the page shows after the injected failure (input kept, reason said). */
  error?: () => Promise<void>;
  /** Run between the error leg and the real attempt (e.g. reopen a dialog). */
  beforeRetry?: () => Promise<void>;
  /** What the page shows when it worked. */
  success: () => Promise<void>;
  /** What must still be true after a full reload — it came from the server. */
  reload: () => Promise<void>;
}

export class Walk {
  readonly control: ReturnType<typeof mockControl>;
  private readonly started = Date.now();

  constructor(
    readonly page: Page,
    readonly info: TestInfo,
    readonly target: WalkTarget,
  ) {
    this.control = mockControl(page);
    // A client-side exception leaves Next's 'Application error' page and nothing
    // else: no trace on live, no console in the report. Say what the page threw
    // (live walk run 5, 2026-10-25, failed on exactly that with no diagnosis).
    page.on('pageerror', (err) => this.note('pageerror', `${err.name}: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') this.note('console-error', msg.text().slice(0, 500));
    });
  }

  get live() {
    return this.target.live;
  }

  /** Milliseconds since the walk began (the customer opened the login page). */
  elapsed() {
    return Date.now() - this.started;
  }

  /** Record a timing in the report (an annotation) and on the console. */
  time(type: string, label: string, ms: number) {
    const description = `${label}: ${ms} ms`;
    this.info.annotations.push({ type, description });
    console.log(`[walk] ${type} — ${description}`);
  }

  /** Record something the walk did that a reader of the report should know. */
  note(type: string, description: string) {
    this.info.annotations.push({ type, description });
    console.log(`[walk] ${type} — ${description}`);
  }

  /** A pillar of the walk, timed: its completion time lands in the report. */
  async pillar(name: string, body: () => Promise<void>) {
    const t0 = Date.now();
    await test.step(name, body);
    this.time('pillar-time', name, Date.now() - t0);
  }

  /**
   * A step live must skip (owner asset / provider consent / mock-only control). The
   * mock walks it; live records a skipped step with the reason — in the report, as
   * an annotation and on the console — and moves on.
   */
  async step(title: string, body: () => Promise<void>, liveSkip?: string) {
    await test.step(title, async (step) => {
      if (this.live && liveSkip) {
        this.info.annotations.push({ type: 'skipped-step', description: `${title} — ${liveSkip}` });
        console.log(`[walk] SKIPPED on live: ${title} — ${liveSkip}`);
        step.skip(true, liveSkip);
        return;
      }
      await body();
    });
  }

  /**
   * A step whose need is only known at run time (e.g. the tenant has no ended
   * conversation yet): skipped with the reason, visibly, when `condition` holds.
   */
  async stepIf(
    title: string,
    skipWhen: () => Promise<boolean>,
    reason: string,
    body: () => Promise<void>,
  ) {
    await test.step(title, async (step) => {
      if (await skipWhen()) {
        this.info.annotations.push({ type: 'skipped-step', description: `${title} — ${reason}` });
        console.log(`[walk] SKIPPED: ${title} — ${reason}`);
        step.skip(true, reason);
        return;
      }
      await body();
    });
  }

  /** Mock-only: the page as an owner sees it while a read is slow, then failing. */
  async listStates(opts: {
    method: string;
    loading: Locator;
    error: Locator;
    retry: Locator;
    ready: () => Promise<void>;
  }) {
    if (this.live) return;
    await test.step('loading, then a failed read, then a retry', async () => {
      await this.control.slow(2000);
      await this.page.reload();
      await expect(opts.loading).toBeVisible();
      await this.control.slow(0);
      await opts.ready();
      // Three failures exhaust the query's retries, so the error branch is what shows.
      await this.control.failNext(opts.method, 3);
      await this.page.reload();
      await expect(opts.error).toBeVisible({ timeout: 15_000 });
      await opts.retry.click();
      await opts.ready();
    });
  }

  /**
   * One mutation, the honest way: (mock) fail it and see the reason with the input
   * kept; (mock) see it pending; see it succeed; reload and see it again.
   */
  async mutate(title: string, m: Mutation) {
    await test.step(title, async () => {
      if (!this.live && m.method && m.error) {
        await this.control.failNext(m.method);
        await m.act();
        await m.error();
        await m.beforeRetry?.();
      }
      const slowed = !this.live && Boolean(m.pending);
      if (slowed) await this.control.slow(1500);
      try {
        await m.act();
        if (slowed && m.pending) await expect(m.pending).toBeVisible();
      } finally {
        if (slowed) await this.control.slow(0);
      }
      await m.success();
    });
    await test.step(`reload — ${title} came back from the server`, async () => {
      await this.page.reload();
      await m.reload();
    });
  }
}

/**
 * Type a credential without it reaching the report: Playwright titles a `fill` step
 * with its value, `evaluate` is titled "Evaluate" with no arguments. The value is set
 * through the native setter and announced with an `input` event, which is what the
 * form library listens to.
 */
export async function fillSecret(field: Locator, value: string) {
  await field.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

/** Clear credential fields so a failure snapshot never holds what was typed. */
export async function clearSecrets(page: Page) {
  await page
    .locator('input[type="password"], input[type="email"]')
    .evaluateAll((els) => {
      for (const el of els as HTMLInputElement[]) el.value = '';
    })
    .catch(() => undefined);
}
