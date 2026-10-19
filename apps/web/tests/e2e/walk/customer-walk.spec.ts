import type { Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { stubConsent, stubStripe } from '../support/provider-stubs';
import { NEEDS, Walk, clearSecrets, fillSecret, walkTarget } from './walk-kit';

/**
 * The customer-style walk (round 7 WP-12). In order, what a customer does: sign in,
 * read the Today card, set every Configure pillar (personality, escalation, team
 * availability, channels with the D9 widget-off state, tools, knowledge), install
 * the widget (Embed + the website allowlist + a first answer), work Conversations
 * (take over, reply, an ended session, the evidence panel, a flag) and Leads
 * (archive, un-archive, prune, erase, Send to CRM, the backfill offer, edit), read
 * Analytics and the Audit log, manage Billing, then Pause/Resume, Delete/Restore and
 * Close/Reopen/Re-export.
 *
 * The SAME spec runs against the mock (`walk` project) and a deployed environment
 * (`live-walk`, dispatch-only, E2E_LIVE_WRITE=1). On live it writes only to the walk
 * account's own tenant and skips — with the reason, visibly — every step that needs
 * an owner asset or a provider consent. Every mutation is followed by a reload: what
 * the page shows afterwards came back from the server, not from component state.
 *
 * The report carries, as annotations, the time to the first grounded answer and each
 * pillar's completion time.
 */

const target = walkTarget();

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

/** A value that differs on every run, so a live reload check proves a real write. */
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

/**
 * The card (section) whose title is `title`. Matched by CSS, not by role: while a
 * dialog is open Radix hides the rest of the page from the accessibility tree, and a
 * role-based locator would lose the card behind it.
 */
const card = (page: Page, title: string) =>
  page
    .locator('div')
    .filter({ has: page.locator(`h3:text-is(${JSON.stringify(title)})`) })
    .last();

/**
 * Live only: a walk cut short (a failure, a cancelled run) can leave the walk account
 * closed, its Luciel paused or deleted. Put it back to an open account with an active
 * Luciel before walking — each repair is recorded in the report — so one bad run does
 * not fail every run after it. Nothing outside the walk account is touched.
 */
async function recoverWalkAccount(w: Walk) {
  const page = w.page;
  await test.step('live: start from an open account with an active Luciel', async () => {
    if (new URL(page.url()).pathname === '/account-closed') {
      await page.getByRole('button', { name: 'Reopen my account' }).click();
      await expect(page.getByRole('heading', { name: 'Your account is open again' })).toBeVisible({
        timeout: 30_000,
      });
      w.note('recovered', 'an earlier walk left the account closed — reopened it');
    }
    await page.goto('/dashboard/account');
    // Loaded, not loading: a serving Luciel says so, a deleted one shows its grace banner.
    await expect(
      page
        .getByText('Your Luciel is still running.')
        .or(page.getByText(/is deleted and in its 30-day grace window/))
        .first(),
    ).toBeVisible({ timeout: 30_000 });
    const restore = page.getByRole('button', { name: 'Restore my Luciel' });
    if (await restore.isVisible()) {
      await restore.click();
      await expect(page.getByText('Your Luciel is still running.')).toBeVisible({
        timeout: 30_000,
      });
      w.note('recovered', 'an earlier walk left the Luciel deleted — restored it');
    }
    const resume = page.getByRole('button', { name: 'Resume my Luciel' });
    if (await resume.isVisible()) {
      await resume.click();
      await expect(page.getByRole('button', { name: 'Pause my Luciel' })).toBeVisible({
        timeout: 30_000,
      });
      w.note('recovered', 'an earlier walk left the Luciel paused — resumed it');
    }
    await page.goto('/dashboard');
  });
}

test('a customer walks the whole dashboard', async ({ page, baseURL }, info) => {
  test.skip(
    target.live && (!target.email || !target.password),
    'live walk: set E2E_LIVE=1, E2E_LIVE_WRITE=1, E2E_BASE_URL, E2E_EMAIL and E2E_PASSWORD',
  );
  // The mock walk takes ~7 minutes locally (every mutation is failed once, slowed
  // once and reloaded); a slow CI runner gets headroom.
  test.setTimeout(target.live ? 30 * 60_000 : 15 * 60_000);
  const origin = baseURL ?? 'http://localhost:3000';
  const w = new Walk(page, info, target);
  if (!w.live) {
    await stubStripe(page, origin);
    await stubConsent(page, origin);
  }

  // ── Sign in ──────────────────────────────────────────────────────────────────
  await w.pillar('Sign in', async () => {
    await page.goto('/login');
    const email = page.getByLabel('Email');
    const password = page.getByLabel('Password');
    if (w.live) {
      await fillSecret(email, target.email);
      await fillSecret(password, target.password);
    } else {
      await email.fill(target.email);
      await password.fill(target.password);
      // The error leg: a failure that is not a wrong password says what it is.
      await w.control.failNext('auth.login');
      await page.getByRole('button', { name: 'Log in' }).click();
      await expect(
        page.getByText('Something went wrong on our side while signing you in.'),
      ).toBeVisible();
      await w.control.slow(1500);
    }
    try {
      await page.getByRole('button', { name: 'Log in' }).click();
      if (!w.live) await expect(page.getByRole('button', { name: 'Signing in…' })).toBeVisible();
      await page.waitForURL(/\/(dashboard|account-closed)(\?.*)?$/, { timeout: 45_000 });
    } catch (err) {
      await clearSecrets(page);
      throw err;
    } finally {
      if (!w.live) await w.control.slow(0);
    }
    await page.reload();
    if (w.live) await recoverWalkAccount(w);
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  // ── Today card ──────────────────────────────────────────────────────────────
  await w.pillar('Today card', async () => {
    const today = page.getByTestId('today-card');
    await expect(page.getByTestId('identity-line')).toContainText('is on duty around the clock');
    await expect(today.getByText('What I need from you')).toBeVisible();
    await expect(page.getByTestId('day-yesterday')).toBeVisible();

    const business = w.live ? `VantageMind walk ${stamp}` : 'Sarah Chen Consulting';
    await w.mutate('business name in greetings', {
      method: 'luciel.updateBusinessName',
      act: async () => {
        if (await today.getByLabel('Business name in greetings').isHidden()) {
          await today.getByRole('button', { name: /Set your business name|Change/ }).click();
        }
        await today.getByLabel('Business name in greetings').fill(business);
        await today.getByRole('button', { name: 'Save name' }).click();
      },
      pending: today.getByRole('button', { name: 'Saving…' }),
      error: () => expect(today.getByText('Internal Server Error')).toBeVisible(),
      success: () =>
        expect(
          today.getByText(`now introduces itself as an AI assistant for ${business}`),
        ).toBeVisible(),
      reload: () =>
        expect(page.getByTestId('today-card').getByText(business, { exact: true })).toBeVisible(),
    });

    const brief = page.getByRole('switch', { name: 'Morning brief by email' });
    const wasOn = (await brief.getAttribute('aria-checked')) === 'true';
    for (const next of [!wasOn, wasOn]) {
      await w.mutate(`morning brief ${next ? 'on' : 'off'}`, {
        method: 'luciel.updateDailyBrief',
        act: () => brief.click(),
        error: () => expect(today.getByText('Internal Server Error')).toBeVisible(),
        success: () =>
          expect(
            today.getByText(
              next ? /^Morning brief on/ : 'Morning brief off. You can turn it back on any time.',
            ),
          ).toBeVisible(),
        reload: () => expect(brief).toHaveAttribute('aria-checked', String(next)),
      });
    }
  });

  // ── Configure: Personality (preset + business context) ───────────────────────
  await w.pillar('Configure: Personality', async () => {
    await page.goto('/dashboard/configure');
    const pillar = card(page, 'Personality');
    const preset = pillar.getByLabel('Preset');
    const context = pillar.getByLabel(
      'Anything specific about your business this Luciel should know?',
    );
    const current = await preset.inputValue();
    const next = current === 'professional_advisor' ? 'friendly_expert' : 'professional_advisor';
    const about = `Walk ${stamp}: answers questions about bookings, pricing and opening hours.`;
    await w.mutate('preset and business context', {
      method: 'luciel.updatePersonality',
      act: async () => {
        await preset.selectOption(next);
        await context.fill(about);
        await pillar.getByRole('button', { name: 'Save personality' }).click();
      },
      pending: pillar.getByRole('button', { name: 'Saving…' }),
      error: async () => {
        await expect(pillar.getByText('Internal Server Error')).toBeVisible();
        // A failed save keeps the edit and says the Luciel still sounds as before.
        await expect(pillar.getByText('Unsaved changes — your Luciel still sounds')).toBeVisible();
        await expect(context).toHaveValue(about);
      },
      success: () =>
        expect(pillar.getByText(/^Saved\. New conversations use this voice/)).toBeVisible(),
      reload: async () => {
        await expect(preset).toHaveValue(next);
        await expect(context).toHaveValue(about);
      },
    });
  });

  // ── Configure: Escalation contacts (email + SMS, the confirmation code UI) ───
  await w.pillar('Configure: Escalation', async () => {
    const pillar = card(page, 'Escalation contact');
    await expect(
      pillar.getByText('Luciel will reach you when a lead asks for a real person'),
    ).toBeVisible();

    await w.step(
      'a backup email contact enters its confirmation loop',
      async () => {
        await w.mutate('save a backup email', {
          method: 'luciel.updateEscalation',
          act: async () => {
            await pillar.getByLabel('Backup email (optional)').fill('walk.backup@example.com');
            await pillar.getByRole('button', { name: 'Save escalation settings' }).click();
          },
          pending: pillar.getByRole('button', { name: 'Saving…' }),
          error: async () => {
            await expect(pillar.getByText('Internal Server Error')).toBeVisible();
            await expect(
              pillar.getByText('Unsaved changes — escalations still go to'),
            ).toBeVisible();
          },
          success: () =>
            expect(pillar.getByText(/^Saved\. New conversations escalate/)).toBeVisible(),
          reload: async () => {
            await expect(pillar.getByText('Backup email: walk.backup@example.com')).toBeVisible();
            // Never a false "Confirmed": the address has not clicked its link yet.
            await expect(
              pillar.getByText(
                'walk.backup@example.com — Confirmation sent — waiting for the click',
              ),
            ).toBeVisible();
          },
        });
        await w.mutate('resend the confirmation email', {
          method: 'luciel.resendContactConfirmation',
          act: () =>
            pillar
              .getByRole('listitem')
              .filter({ hasText: 'walk.backup@example.com — Confirmation' })
              .getByRole('button', { name: 'Resend confirmation' })
              .click(),
          error: () => expect(pillar.getByText('Internal Server Error')).toBeVisible(),
          success: () =>
            expect(
              pillar.getByText('Confirmation email sent to walk.backup@example.com.'),
            ).toBeVisible(),
          reload: () =>
            expect(
              pillar.getByText(
                'walk.backup@example.com — Confirmation sent — waiting for the click',
              ),
            ).toBeVisible(),
        });
      },
      NEEDS.mailbox,
    );

    await w.step(
      'an SMS contact, and the confirmation code it is owed',
      async () => {
        await w.mutate('save a primary SMS number', {
          method: 'luciel.updateEscalation',
          act: async () => {
            await pillar.getByLabel('Primary SMS (optional)').fill('+1 604 555 0123');
            await pillar.getByRole('button', { name: 'Save escalation settings' }).click();
          },
          error: () => expect(pillar.getByText('Internal Server Error')).toBeVisible(),
          success: () =>
            expect(pillar.getByText(/^Saved\. New conversations escalate/)).toBeVisible(),
          reload: async () => {
            await expect(pillar.getByText('Primary SMS: +16045550123')).toBeVisible();
            await expect(
              pillar.getByText(
                '+16045550123 (primary) — Unconfirmed — escalations are copied to you until confirmed',
              ),
            ).toBeVisible();
            // No number of the tenant's own to send the code from yet — said, not hidden.
            await expect(
              pillar.getByText(/^No code could be sent: connect an SMS number/),
            ).toBeVisible();
          },
        });

        const dialog = page.getByRole('dialog', { name: 'Enter the confirmation code' });
        await pillar.getByRole('button', { name: 'Enter code' }).click();
        await dialog.getByLabel('Code').fill('12');
        await dialog.getByRole('button', { name: 'Confirm number' }).click();
        await expect(dialog.getByText('Enter the 6-digit code from the text.')).toBeVisible();
        await dialog.getByLabel('Code').fill('123456');
        await dialog.getByRole('button', { name: 'Confirm number' }).click();
        // No code was ever sent, so none can be right — the refusal stays in the dialog.
        await expect(
          dialog.getByText('There is no code waiting for this number. Resend one first.'),
        ).toBeVisible();
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await page.reload();
        await expect(pillar.getByText(/\+16045550123 \(primary\) — Unconfirmed/)).toBeVisible();
      },
      NEEDS.twilioNumber,
    );
  });

  // ── Configure: Team availability ─────────────────────────────────────────────
  await w.pillar('Configure: Team availability', async () => {
    const pillar = card(page, 'Team availability (optional)');
    const toggle = pillar.getByRole('switch', {
      name: 'Tell customers when your team is reachable',
    });
    const monday = pillar.getByLabel('Monday reachable');
    const mondayTo = pillar.getByLabel('Monday to');
    let endsAt: string | null = null;
    await w.mutate('Monday hours, in the owner’s timezone', {
      method: 'luciel.updateTeamAvailability',
      act: async () => {
        if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
        await pillar.getByLabel('Your timezone').selectOption('America/Vancouver');
        if (!(await monday.isChecked())) await monday.check();
        // Chosen once, from what was served: a retry after the failure keeps it.
        endsAt ??= (await mondayTo.inputValue()) === '18:00' ? '17:30' : '18:00';
        await mondayTo.fill(endsAt);
        await pillar.getByRole('button', { name: 'Save team availability' }).click();
      },
      pending: pillar.getByRole('button', { name: 'Saving…' }),
      error: async () => {
        await expect(pillar.getByText('Internal Server Error')).toBeVisible();
        await expect(pillar.getByRole('button', { name: 'Discard changes' })).toBeVisible();
      },
      success: () =>
        expect(pillar.getByText(/^Saved\. Luciel keeps answering around the clock/)).toBeVisible(),
      reload: async () => {
        await expect(toggle).toHaveAttribute('aria-checked', 'true');
        await expect(pillar.getByLabel('Your timezone')).toHaveValue('America/Vancouver');
        await expect(mondayTo).toHaveValue(endsAt ?? '');
      },
    });
    // The copy is about PEOPLE: nothing here may say the Luciel keeps hours.
    await expect(pillar.getByText(/answers customers around the clock/)).toBeVisible();
  });

  // ── Configure: Channels (incl. the D9 widget-off state) ──────────────────────
  await w.pillar('Configure: Channels', async () => {
    const pillar = card(page, 'Channels your Luciel uses');
    const widget = pillar.getByRole('switch', { name: 'Enable Website chat widget' });
    await w.mutate('turn Website chat off (D9)', {
      method: 'luciel.updateChannels',
      act: () => widget.click(),
      pending: pillar.getByRole('status').filter({ hasText: 'Saving…' }),
      error: async () => {
        await expect(pillar.getByText('Internal Server Error')).toBeVisible();
        await expect(widget).toHaveAttribute('aria-checked', 'true');
      },
      success: () =>
        expect(
          pillar.getByText('Website chat widget is off — the widget renders nothing on your site'),
        ).toBeVisible(),
      reload: async () => {
        await expect(widget).toHaveAttribute('aria-checked', 'false');
        await expect(page.getByTestId('widget-off-note')).toBeVisible();
      },
    });
    await test.step('Embed says the widget is off, and offers no test of a widget that renders nothing', async () => {
      await page.goto('/dashboard/embed');
      await expect(page.getByTestId('embed-widget-off')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Test it here' })).toHaveCount(0);
      await page.goto('/dashboard/configure');
    });
    await w.mutate('turn Website chat back on', {
      act: () => widget.click(),
      success: () => expect(pillar.getByText('Website chat widget is on.')).toBeVisible(),
      reload: () => expect(widget).toHaveAttribute('aria-checked', 'true'),
    });

    await w.step(
      'SMS: acknowledge, connect Twilio, add the number, attest',
      async () => {
        const sms = pillar.getByRole('switch', { name: 'Enable SMS' });
        await sms.click();
        const ack = page.getByRole('dialog', {
          name: 'Enable SMS — carrier registration and consent',
        });
        await ack.getByRole('checkbox').check();
        await ack.getByRole('button', { name: 'Acknowledge and enable SMS' }).click();
        await expect(ack).toBeHidden();
        await expect(pillar.getByText('Action needed: connect your Twilio account')).toBeVisible();
        await page.reload();
        await expect(sms).toHaveAttribute('aria-checked', 'true');

        // The customer's own Twilio keys (test values; the mock verifies nothing).
        await pillar.getByRole('button', { name: 'Use API keys instead' }).click();
        await pillar.getByLabel('Twilio Account SID').fill('AC00000000000000000000000000000001');
        await pillar.getByLabel('Twilio Auth Token').fill('test-auth-token');
        await pillar.getByRole('button', { name: 'Connect Twilio account' }).click();
        // An account on file is not live: the number is still owed (no false Connected).
        await expect(pillar.getByText('Action needed: add your number')).toBeVisible();
        await page.reload();
        await expect(pillar.getByText('Action needed: add your number')).toBeVisible();

        await pillar.getByLabel('Business phone number').fill('+15005550006');
        await pillar.getByRole('button', { name: 'Add number' }).click();
        await expect(
          pillar.getByText('Action needed: complete carrier registration').first(),
        ).toBeVisible();
        await page.reload();
        await expect(
          pillar.getByText('Action needed: complete carrier registration').first(),
        ).toBeVisible();

        await pillar.getByRole('button', { name: 'My carrier registration is approved' }).click();
        const attest = page.getByRole('dialog', { name: 'Turn on texting — your attestation' });
        await attest.getByRole('button', { name: 'I attest — turn on texting' }).click();
        await expect(attest).toBeHidden();
        await page.reload();
        await expect(pillar.getByText('Action needed: complete carrier registration')).toHaveCount(
          0,
        );
      },
      NEEDS.twilioNumber,
    );

    await w.step(
      'with a number connected, the escalation code goes out and confirms',
      async () => {
        const escalation = card(page, 'Escalation contact');
        const row = escalation.getByRole('listitem').filter({ hasText: '+16045550123 (primary)' });
        await w.mutate('resend the SMS code', {
          act: () => row.getByRole('button', { name: 'Resend code' }).click(),
          success: () =>
            expect(escalation.getByText('A new code was texted to +16045550123.')).toBeVisible(),
          reload: () =>
            expect(row.getByText(/A 6-digit code was texted to this number/)).toBeVisible(),
        });
        const dialog = page.getByRole('dialog', { name: 'Enter the confirmation code' });
        await w.mutate('enter the code', {
          act: async () => {
            await row.getByRole('button', { name: 'Enter code' }).click();
            await dialog.getByLabel('Code').fill('123456');
            await dialog.getByRole('button', { name: 'Confirm number' }).click();
          },
          success: () =>
            expect(
              escalation.getByText(
                '+16045550123 is confirmed — escalations now go to it directly.',
              ),
            ).toBeVisible(),
          reload: () =>
            expect(escalation.getByText('+16045550123 (primary) — Confirmed')).toBeVisible(),
        });
      },
      NEEDS.twilioNumber,
    );

    await w.step(
      'WhatsApp: a provider the platform cannot sign in to yet is "Not available yet"',
      async () => {
        await page.goto('/dashboard');
        const meta = page.getByRole('listitem').filter({ hasText: 'Meta sign-in' });
        await expect(meta.getByText('Not available yet')).toBeVisible();
        await expect(meta.getByText('Connected', { exact: true })).toHaveCount(0);
        await page.goto('/dashboard/configure');
      },
      NEEDS.meta,
    );
  });

  // ── Configure: Tools ─────────────────────────────────────────────────────────
  await w.pillar('Configure: Tools', async () => {
    const pillar = card(page, 'Tools your Luciel can use');
    await expect(
      pillar.getByText('Every Luciel does these. There is nothing to enable'),
    ).toBeVisible();
    const callback = pillar.getByRole('switch', { name: 'Enable Schedule a callback' });
    const wasOn = (await callback.getAttribute('aria-checked')) === 'true';
    for (const next of [!wasOn, wasOn]) {
      await w.mutate(`Schedule a callback ${next ? 'on' : 'off'}`, {
        method: 'luciel.updateTools',
        act: () => callback.click(),
        pending: pillar.getByRole('status').filter({ hasText: 'Saving…' }),
        error: () => expect(pillar.getByText('Internal Server Error')).toBeVisible(),
        success: () =>
          expect(pillar.getByText(`Schedule a callback is ${next ? 'on' : 'off'}.`)).toBeVisible(),
        reload: () => expect(callback).toHaveAttribute('aria-checked', String(next)),
      });
    }

    await w.step(
      'reconnect the CRM: a declined consent changes nothing, an allowed one connects',
      async () => {
        const crm = pillar
          .getByRole('listitem')
          .filter({ hasText: 'Push leads to my CRM' })
          .first();
        await expect(crm.getByText('Reconnect needed')).toBeVisible();
        await crm.getByRole('button', { name: 'Connect HubSpot' }).click();
        await page.waitForURL(/accounts\.example\.com/);
        await page.getByRole('link', { name: 'Decline' }).click();
        await page.waitForURL(/\/dashboard\/configure/);
        await expect(
          page.getByText('We could not connect HubSpot. The consent screen was declined'),
        ).toBeVisible();
        await expect(crm.getByText('Reconnect needed')).toBeVisible();
        await page.reload();
        await expect(crm.getByText('Reconnect needed')).toBeVisible();

        await crm.getByRole('button', { name: 'Connect HubSpot' }).click();
        await page.waitForURL(/accounts\.example\.com/);
        await page.getByRole('link', { name: 'Allow' }).click();
        await page.waitForURL(/\/dashboard\/configure/);
        await expect(page.getByText('HubSpot is connected.')).toBeVisible();
        await expect(crm.getByText('Connected', { exact: true })).toBeVisible();
        await page.reload();
        await expect(crm.getByText('Connected', { exact: true })).toBeVisible();
      },
      NEEDS.crm,
    );

    await w.step(
      'appointment scheduling: the calendar sign-in is not available yet, and says so',
      async () => {
        const scheduling = pillar
          .getByRole('listitem')
          .filter({ hasText: 'Appointment scheduling' })
          .first();
        // Partly on, and its calendar is a provider the platform cannot sign in to yet:
        // both said — the chip is "Not available yet", never Connected.
        await expect(
          scheduling.getByText('Only part of this is switched on right now'),
        ).toBeVisible();
        await scheduling.getByText('Manage connection').click();
        await expect(
          scheduling.getByText('Not available yet', { exact: true }).first(),
        ).toBeVisible();
        await expect(scheduling.getByText('Connected', { exact: true })).toHaveCount(0);
      },
      NEEDS.calendar,
    );
  });

  // ── Configure: Knowledge (upload / paste / CSV / crawl; re-sync, reconnect,
  //    disconnect, swap) ─────────────────────────────────────────────────────────
  let firstGroundedFrom = 0;
  /** The first Test-it-here answer: question → answer, and since sign-in / knowledge. */
  let firstAnswer: { asked: number; fromSignIn: number; fromKnowledge: number } | null = null;
  const walkSources: string[] = [];
  await w.pillar('Configure: Knowledge', async () => {
    const pillar = card(page, 'Knowledge base');
    const sources = pillar.locator('ul').first();
    const upload = async (button: string, name: string, body: string, mimeType: string) => {
      const chooser = page.waitForEvent('filechooser');
      await pillar.getByRole('button', { name: button }).click();
      await (await chooser).setFiles({ name, mimeType, buffer: Buffer.from(body) });
    };

    const fileName = w.live ? `walk-hours-${Date.now()}.txt` : 'opening-hours.txt';
    await w.mutate('upload a file', {
      method: 'knowledge.uploadFile',
      act: () =>
        upload(
          'Upload files',
          fileName,
          'We are open Monday to Friday, 9am to 5pm. Weekend appointments by request.',
          'text/plain',
        ),
      pending: pillar.getByText('Working on it…'),
      error: () =>
        expect(
          pillar.getByText(`Nothing was added. ${fileName} (Internal Server Error)`),
        ).toBeVisible(),
      success: () =>
        expect(pillar.getByText('Added 1 of 1 file to your knowledge base.')).toBeVisible(),
      reload: () => expect(sources.getByText(fileName, { exact: true })).toBeVisible(),
    });
    walkSources.push(fileName);

    const pasteName = w.live ? `Walk cancellation policy ${stamp}` : 'Cancellation policy';
    const paste = page.getByRole('dialog', { name: 'Paste text' });
    await w.mutate('paste text', {
      method: 'knowledge.pasteText',
      act: async () => {
        if (await paste.isHidden())
          await pillar.getByRole('button', { name: 'Paste text' }).click();
        await paste.getByLabel('Name this').fill(pasteName);
        await paste
          .getByLabel('Text')
          .fill('Cancel up to 24 hours before an appointment at no charge.');
        await paste.getByRole('button', { name: 'Add to knowledge' }).click();
      },
      pending: paste.getByRole('button', { name: 'Adding…' }),
      error: async () => {
        // The dialog stays open with everything still typed (F169).
        await expect(paste.getByText('Internal Server Error')).toBeVisible();
        await expect(paste.getByLabel('Name this')).toHaveValue(pasteName);
      },
      success: () =>
        expect(pillar.getByText(`Added “${pasteName}” to your knowledge base.`)).toBeVisible(),
      reload: () => expect(sources.getByText(pasteName, { exact: true })).toBeVisible(),
    });
    walkSources.push(pasteName);

    const csvName = w.live ? `walk-services-${Date.now()}.csv` : 'services.csv';
    await w.mutate('import a CSV', {
      method: 'knowledge.importCsv',
      act: () =>
        upload(
          'Import CSV',
          csvName,
          'service,price\nStarter engagement,899\nQuarterly review,450\n',
          'text/csv',
        ),
      error: () =>
        expect(
          pillar.getByText(`Nothing was added. ${csvName} (Internal Server Error)`),
        ).toBeVisible(),
      success: () =>
        expect(
          pillar.getByText(/^Added 1 of 1 file to your knowledge base\. Its 2 rows/),
        ).toBeVisible(),
      reload: () => expect(sources.getByText(csvName, { exact: true })).toBeVisible(),
    });
    walkSources.push(csvName);

    // On live the walk crawls the product's own site (never a third party's).
    const crawlUrl = w.live ? `${origin}/` : 'https://sarahchen.com/services';
    const crawl = page.getByRole('dialog', { name: 'Crawl a website' });
    const connected = pillar.getByRole('list', { name: 'Connected sources' });
    const crawlRow = connected.getByRole('listitem').filter({ hasText: crawlUrl });
    await w.mutate('crawl a website', {
      method: 'knowledge.startCrawl',
      act: async () => {
        if (await crawl.isHidden())
          await pillar.getByRole('button', { name: 'Crawl a website' }).click();
        await crawl.getByRole('checkbox').check();
        await crawl.getByLabel('Page address').fill(crawlUrl);
        await crawl.getByRole('button', { name: 'Crawl this site' }).click();
      },
      pending: crawl.getByRole('button', { name: 'Crawling…' }),
      error: () => expect(crawl.getByText('Internal Server Error')).toBeVisible(),
      success: () => expect(pillar.getByText(`Crawled ${crawlUrl} —`)).toBeVisible(),
      reload: async () => {
        await expect(crawlRow).toBeVisible();
        await expect(crawlRow.getByRole('button', { name: 'Remove crawl' })).toBeVisible();
      },
    });

    await w.mutate('re-sync the crawl', {
      method: 'knowledge.syncConnection',
      act: () => crawlRow.getByRole('button', { name: 'Re-sync' }).click(),
      error: () => expect(pillar.getByText('Internal Server Error')).toBeVisible(),
      success: () =>
        expect(pillar.getByText(/^Synced .* — \d+ added, \d+ removed\./)).toBeVisible(),
      reload: () => expect(crawlRow.getByText(/last synced (?!never)/)).toBeVisible(),
    });

    await w.step(
      'a grant the provider revoked: the re-sync fails honestly, then a reconnect restores it',
      async () => {
        const drive = connected.getByRole('listitem').filter({ hasText: 'Google Drive' });
        await expect(drive.getByText('Connected', { exact: true })).toBeVisible();
        await w.control.revokeKnowledgeGrant('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
        await drive.getByRole('button', { name: 'Re-sync' }).click();
        await expect(
          pillar.getByText(
            'Sync unavailable: the provider refused the stored credential — reconnect it.',
          ),
        ).toBeVisible();
        // The chip follows the SERVED status: no false Connected after the refusal.
        await expect(drive.getByText('Connected', { exact: true })).toHaveCount(0);
        await page.reload();
        await expect(drive.getByText('Action needed')).toBeVisible();

        await drive.getByRole('button', { name: 'Reconnect' }).click();
        await page.waitForURL(/accounts\.example\.com/);
        await page.getByRole('link', { name: 'Allow' }).click();
        await page.waitForURL(/\/dashboard\/configure/);
        await expect(page.getByText('Google Drive is connected.')).toBeVisible();
        await expect(drive.getByText('Connected', { exact: true })).toBeVisible();
        await page.reload();
        await expect(drive.getByText('Connected', { exact: true })).toBeVisible();
      },
      NEEDS.knowledgeOauth,
    );

    const stop = page.getByRole('dialog', { name: /^Stop crawling/ });
    await w.mutate('remove the crawl (disconnect)', {
      method: 'connections.disconnect',
      act: async () => {
        if (await stop.isHidden())
          await crawlRow.getByRole('button', { name: 'Remove crawl' }).click();
        await stop.getByRole('button', { name: 'Remove crawl' }).click();
      },
      pending: stop.getByRole('button', { name: 'Working…' }),
      error: async () => {
        await expect(pillar.getByText('Internal Server Error')).toBeVisible();
        await expect(stop).toBeVisible();
      },
      success: () =>
        expect(
          pillar.getByText(/is no longer crawled\. Its pages stay in your knowledge/),
        ).toBeVisible(),
      reload: async () => {
        await expect(crawlRow.getByRole('button', { name: 'Re-sync' })).toHaveCount(0);
        await expect(crawlRow.getByText('Connected', { exact: true })).toHaveCount(0);
      },
    });

    await w.step(
      'swap the Drive account from the Overview (proven before cutover)',
      async () => {
        await page.goto('/dashboard');
        const row = page
          .getByRole('listitem')
          .filter({ hasText: 'Knowledge source · Google Drive' });
        await expect(
          page.getByText('Your current connection stays live until the new one is verified.'),
        ).toBeVisible();
        await row.getByRole('button', { name: 'Change connected account' }).click();
        await page.waitForURL(/accounts\.example\.com/);
        await page.getByRole('link', { name: 'Allow' }).click();
        await page.waitForURL(/\/dashboard\/configure/);
        await expect(page.getByText('Google Drive is connected.')).toBeVisible();
        await page.goto('/dashboard');
        await expect(row.getByText('Connected', { exact: true })).toBeVisible();
      },
      NEEDS.knowledgeOauth,
    );
    firstGroundedFrom = w.elapsed();
  });

  // ── Embed + the website allowlist + the first grounded answer ────────────────
  await w.pillar('Embed', async () => {
    await page.goto('/dashboard/embed');
    await expect(page.getByText(/embed\.vantagemind\.ai\/v1\/luciel\.js/)).toBeVisible();
    await page.getByRole('button', { name: 'Copy' }).click();
    await expect(page.getByRole('button', { name: /Copied/ })).toBeVisible();

    const allow = card(page, 'Websites that may load this chat');
    const site = w.live ? 'https://walk.example.com' : 'https://sarahchen.com';
    await w.mutate('a path is refused by the server, and said', {
      act: async () => {
        await allow.getByLabel('Website address').fill(`${site}/contact`);
        await allow.getByRole('button', { name: 'Add website' }).click();
      },
      success: () =>
        expect(allow.getByText(/is not a website address — use the form/)).toBeVisible(),
      reload: () => expect(allow.getByText(`${site}/contact`)).toHaveCount(0),
    });
    await w.mutate('allow the owner’s website', {
      method: 'luciel.updateAllowedOrigins',
      act: async () => {
        await allow.getByLabel('Website address').fill(site);
        await allow.getByRole('button', { name: 'Add website' }).click();
      },
      pending: allow.getByRole('button', { name: 'Saving…' }),
      error: () => expect(allow.getByText('Internal Server Error')).toBeVisible(),
      success: () => expect(allow.getByText(`${site} can load your chat.`)).toBeVisible(),
      reload: () =>
        expect(page.getByRole('list', { name: 'Allowed websites' })).toContainText(site),
    });
    await w.mutate('remove it again', {
      act: () => allow.getByRole('button', { name: `Remove ${site}` }).click(),
      success: () =>
        expect(
          allow.getByText(
            /The list is empty again — any website can load your chat\.|can no longer load your chat\./,
          ),
        ).toBeVisible(),
      reload: () =>
        expect(page.getByRole('list', { name: 'Allowed websites' }).getByText(site)).toHaveCount(0),
    });

    await test.step('Test it here: the first answer', async () => {
      await page.getByRole('button', { name: 'Test it here' }).click();
      const message = page.getByLabel('Type your message');
      await message.fill(
        w.live
          ? 'Hi, I am Walk Tester (walk-lead@example.com). What are your opening hours?'
          : 'What are your opening hours?',
      );
      const asked = Date.now();
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      const announced = page.getByLabel('Conversation').locator('[aria-live="polite"]');
      await expect(announced).toHaveText(/\S/, { timeout: 90_000 });
      firstAnswer = {
        asked: Date.now() - asked,
        fromSignIn: w.elapsed(),
        fromKnowledge: w.elapsed() - firstGroundedFrom,
      };
      w.time('first-answer', 'Test it here: question → answer', firstAnswer.asked);
      // Whether that answer was GROUNDED is read from its evidence on the
      // Conversations page (the widget reply carries no attribution) — the
      // grounded-answer time is recorded there, and only if it was.
    });

    await w.step(
      'rotate the embed key',
      async () => {
        const before = await page.locator('pre code').innerText();
        const rotate = page.getByRole('dialog', { name: 'Rotate your embed key?' });
        await w.mutate('rotate the embed key', {
          method: 'luciel.rotateEmbedKey',
          act: async () => {
            if (await rotate.isHidden())
              await page.getByRole('button', { name: 'Rotate embed key' }).click();
            await rotate.getByRole('button', { name: 'Rotate key' }).click();
          },
          pending: rotate.getByRole('button', { name: 'Rotating…' }),
          error: () => expect(rotate.getByText('Internal Server Error')).toBeVisible(),
          success: () => expect(page.getByText('New embed key issued.')).toBeVisible(),
          reload: () => expect(page.locator('pre code')).not.toHaveText(before),
        });
      },
      'rotating cuts off the tenant’s installed snippet — walked on the mock only',
    );
  });

  // ── Conversations ────────────────────────────────────────────────────────────
  await w.pillar('Conversations', async () => {
    await page.goto('/dashboard/conversations');
    const list = card(page, 'Recent').locator('ul').first();
    await w.listStates({
      method: 'conversations.list',
      loading: page.getByText('Loading conversations…'),
      error: page.getByText('We could not load your conversations.'),
      retry: page.getByRole('button', { name: 'Try again' }),
      ready: () => expect(list.getByRole('listitem').first()).toBeVisible(),
    });

    // The mock's seeded widget conversation; on live, the one Test it here just made.
    const row = w.live
      ? list.getByRole('listitem').filter({ hasText: 'Website chat widget' }).first()
      : list.getByRole('listitem').filter({ hasText: '#88888888' });
    const openRow = () => row.locator('button').first().click();

    await test.step('the evidence panel: what backed each answer, in three honest states', async () => {
      await openRow();
      await expect(page.getByText('Loading the transcript…')).toHaveCount(0, { timeout: 20_000 });
      const evidence = page.getByText(
        /^(Knowledge used:|Source attribution isn't available yet\.|No knowledge source backed this answer\.|Your knowledge couldn't be searched)/,
      );
      await expect(evidence.first()).toBeVisible({ timeout: 20_000 });
      await test.step('time to the first grounded answer (the report)', async () => {
        // Live: the open row is the conversation Test it here just had, and its
        // evidence says whether the answer drew on the knowledge the walk added.
        // Mock: the preview's reply is canned, so the seeded answer's evidence
        // (has_sources) stands in — the label says so.
        const grounded = await page
          .getByText(/^Knowledge used:/)
          .first()
          .isVisible();
        if (!firstAnswer) return;
        if (grounded) {
          const how = w.live ? 'Test it here' : 'mock: canned preview reply, seeded evidence';
          w.time(
            'time-to-first-grounded-answer',
            `sign-in → knowledge in place → first grounded answer (${how})`,
            firstAnswer.fromSignIn,
          );
          w.time(
            'knowledge-to-first-grounded-answer',
            `knowledge pillar done → first grounded answer (${how})`,
            firstAnswer.fromKnowledge,
          );
        } else {
          const state = (await evidence.first().innerText()).split('\n')[0];
          w.note(
            'first-answer-not-grounded',
            `the first answer drew on no knowledge source (evidence: ${state}) — no grounded-answer time`,
          );
        }
      });
      if (!w.live) {
        await expect(page.getByText('Knowledge used: Services brochure.pdf')).toBeVisible();
        await expect(page.getByText('Backed by your knowledge')).toBeVisible();
        await expect(
          page.getByText('Not scored — a fixed message, not a knowledge answer'),
        ).toBeVisible();
        await page.getByRole('button', { name: 'Show the exact text' }).click();
        await expect(page.getByText('Starter engagement is $899.')).toBeVisible();
      }
    });

    await w.mutate('flag an answer', {
      method: 'conversations.flagAnswer',
      act: () => page.getByRole('button', { name: 'Flag this answer' }).last().click(),
      pending: page.getByRole('button', { name: 'Flagging…' }),
      error: () =>
        expect(page.getByText('We could not flag that answer. Please try again.')).toBeVisible(),
      success: () =>
        expect(
          page.getByText(/^Flagged\. Fix the source in your knowledge base/).first(),
        ).toBeVisible(),
      reload: async () => {
        await openRow();
        await expect(
          page.getByText(/^Flagged\. Fix the source in your knowledge base/).first(),
        ).toBeVisible();
      },
    });

    await w.mutate('take over', {
      method: 'conversations.takeOver',
      act: () => row.getByRole('button', { name: 'Take over' }).click(),
      pending: row.getByRole('button', { name: 'Taking over…' }),
      error: () =>
        expect(
          page.getByText('We could not take over that conversation. Luciel is still answering it.'),
        ).toBeVisible(),
      success: () => expect(row.getByRole('button', { name: 'Hand back' })).toBeVisible(),
      reload: () => expect(row.getByRole('button', { name: 'Hand back' })).toBeVisible(),
    });

    const reply = `Walk reply ${stamp} — a person here, happy to help.`;
    await w.mutate('reply as a person', {
      method: 'conversations.sendMessage',
      act: async () => {
        await openRow();
        await page
          .getByLabel('You are replying as yourself — Luciel is not answering this conversation.')
          .fill(reply);
        await page.getByRole('button', { name: 'Send reply' }).click();
      },
      pending: page.getByRole('button', { name: 'Sending…' }),
      error: () =>
        expect(page.getByText('We could not send that reply. Please try again.')).toBeVisible(),
      // Polling, never "instant": the widget picks a human reply up on its next fetch.
      success: () =>
        expect(
          page.getByText(/^Sent — the visitor will see this on their next refresh/),
        ).toBeVisible(),
      reload: async () => {
        await openRow();
        await expect(page.getByText(reply)).toBeVisible();
        await expect(page.getByTestId('delivery-outcome').last()).toContainText(
          'picked up by polling, not pushed',
        );
      },
    });

    await w.step(
      'the visitor ends the session mid-takeover: the reply is refused in the server’s words',
      async () => {
        await openRow();
        await w.control.endSession('88888888-8888-4888-8888-888888888888');
        await page
          .getByLabel('You are replying as yourself — Luciel is not answering this conversation.')
          .fill('Are you still there?');
        await page.getByRole('button', { name: 'Send reply' }).click();
        await expect(
          page.getByText(
            'This conversation has ended, so there is nothing to take over or reply into (session_ended).',
          ),
        ).toBeVisible();
        await expect(row.getByText(/^Ended /).first()).toBeVisible();
        await page.reload();
        await expect(row.getByText('Ended — nothing to take over')).toBeVisible();
      },
      NEEDS.mockControl,
    );

    if (w.live) {
      await w.mutate('hand back', {
        act: () => row.getByRole('button', { name: 'Hand back' }).click(),
        success: () => expect(row.getByRole('button', { name: 'Take over' })).toBeVisible(),
        reload: () => expect(row.getByRole('button', { name: 'Take over' })).toBeVisible(),
      });
    }

    const ended = list
      .getByRole('listitem')
      .filter({ hasText: 'Ended — nothing to take over' })
      .first();
    await w.stepIf(
      'an ended session offers nothing to take over and says why',
      async () => (await ended.count()) === 0,
      'no ended conversation in this tenant yet',
      async () => {
        await expect(ended.getByRole('button', { name: 'Take over' })).toHaveCount(0);
        await ended.locator('button').first().click();
        await expect(page.getByText(/can't be taken over or replied into/)).toBeVisible();
        await expect(
          page.getByLabel(
            'You are replying as yourself — Luciel is not answering this conversation.',
          ),
        ).toHaveCount(0);
      },
    );
  });

  // ── Leads ────────────────────────────────────────────────────────────────────
  await w.pillar('Leads', async () => {
    await page.goto('/dashboard/leads');
    const leads = card(page, 'All leads').locator('ul').first();
    await w.listStates({
      method: 'leads.list',
      loading: page.getByText('Loading your leads…'),
      error: page.getByText('We could not load your leads.'),
      retry: page.getByRole('button', { name: 'Try again' }),
      ready: () => expect(page.getByText(/^Show archived leads \(\d+\)$/)).toBeVisible(),
    });
    const showArchived = page.getByRole('checkbox', { name: /Show archived leads/ });

    if (w.live) {
      // Only a lead the walk itself produced is ever changed on a live tenant.
      const mine = leads.getByRole('listitem').filter({ hasText: 'walk-lead@example.com' }).first();
      await showArchived.check();
      await w.stepIf(
        'the walk’s own lead: archive, un-archive, edit, erase',
        async () => (await mine.count()) === 0,
        'no walk-owned lead was captured from the Test it here message — nothing of the tenant’s is touched',
        async () => {
          await w.mutate('archive', {
            act: () => mine.getByRole('button', { name: 'Archive', exact: true }).click(),
            success: () => expect(mine.getByText('archived (kept)')).toBeVisible(),
            reload: async () => {
              await showArchived.check();
              await expect(mine.getByText('archived (kept)')).toBeVisible();
            },
          });
          await w.mutate('un-archive', {
            act: async () => {
              await showArchived.check();
              await mine.getByRole('button', { name: /^Un-archive/ }).click();
            },
            success: () => expect(mine.getByText('archived (kept)')).toHaveCount(0),
            reload: async () => {
              await showArchived.check();
              await expect(mine.getByText('archived (kept)')).toHaveCount(0);
            },
          });
          const editName = `Walk Tester ${stamp}`;
          const edit = page.getByRole('dialog', { name: 'Edit lead' });
          await w.mutate('edit', {
            act: async () => {
              await mine.getByRole('button', { name: /^Edit / }).click();
              await edit.getByLabel('Name').fill(editName);
              await edit.getByRole('button', { name: 'Save changes' }).click();
            },
            success: () => expect(page.getByText(`${editName} was updated.`)).toBeVisible(),
            reload: () => expect(leads.getByText(editName)).toBeVisible(),
          });
          const erase = page.getByRole('dialog', { name: "Erase this lead's data?" });
          await w.mutate('erase (the walk’s own lead — cleanup)', {
            act: async () => {
              await leads
                .getByRole('listitem')
                .filter({ hasText: editName })
                .getByRole('button', { name: /^Erase / })
                .click();
              await erase.getByRole('button', { name: 'Erase permanently' }).click();
            },
            success: () => expect(erase).toBeHidden(),
            reload: () => expect(leads.getByText(editName)).toHaveCount(0),
          });
        },
      );
      await w.step(
        'prune, Send to CRM and the backfill offer',
        async () => undefined,
        `${NEEDS.crm}; pruning needs a second walk-owned lead`,
      );
      return;
    }

    const jordan = leads.getByRole('listitem').filter({ hasText: 'Jordan P.' });
    const priya = leads.getByRole('listitem').filter({ hasText: 'Priya S.' });
    const sam = leads.getByRole('listitem').filter({ hasText: 'Sam R.' });

    await test.step('the backfill offer: the lead captured before the CRM was connected', async () => {
      const offer = page.getByText('Send your 1 earlier lead to HubSpot?');
      await expect(offer).toBeVisible();
      await w.mutate('send the earlier lead to HubSpot', {
        method: 'leads.backfillCrm',
        act: () => page.getByRole('button', { name: 'Send 1 to HubSpot' }).click(),
        pending: page.getByRole('button', { name: 'Sending…' }),
        error: () =>
          expect(
            page.getByText(
              'We could not send your leads just now. Nothing changed — please try again.',
            ),
          ).toBeVisible(),
        success: () => expect(page.getByText('1 lead is now in HubSpot.')).toBeVisible(),
        reload: async () => {
          await expect(jordan.getByText('in your CRM')).toBeVisible();
          await expect(page.getByText('Send your 1 earlier lead to HubSpot?')).toHaveCount(0);
        },
      });
    });

    await w.mutate('un-archive', {
      method: 'leads.unarchive',
      act: async () => {
        await showArchived.check();
        await sam.getByRole('button', { name: 'Un-archive Sam R.' }).click();
      },
      // The button keeps its aria-label ("Un-archive Sam R."); the pending word is its text.
      pending: sam.getByText('Un-archiving…'),
      error: () =>
        expect(
          page.getByText('We could not un-archive that lead. It is still archived'),
        ).toBeVisible(),
      success: () => expect(sam.getByText('archived (kept)')).toHaveCount(0),
      reload: async () => {
        await expect(sam).toBeVisible();
        await expect(page.getByText('Show archived leads (0)')).toBeVisible();
      },
    });

    await w.mutate(
      'Send to CRM is refused, in the server’s words, without an email the CRM accepts',
      {
        act: () => sam.getByRole('button', { name: 'Send to CRM' }).click(),
        success: () =>
          expect(
            page.getByText(
              'The push was not attempted: this lead has no email address your CRM accepts.',
            ),
          ).toBeVisible(),
        reload: () => expect(sam.getByText(/^Never sent to your CRM/)).toBeVisible(),
      },
    );

    const edit = page.getByRole('dialog', { name: 'Edit lead' });
    await w.mutate('edit: give the lead an email', {
      method: 'leads.update',
      act: async () => {
        if (await edit.isHidden()) await sam.getByRole('button', { name: 'Edit Sam R.' }).click();
        await edit.getByLabel('Email').fill('sam.r@example.com');
        await edit.getByRole('button', { name: 'Save changes' }).click();
      },
      pending: edit.getByRole('button', { name: 'Saving…' }),
      error: async () => {
        await expect(
          edit.getByText(/We could not save those changes|Internal Server Error/),
        ).toBeVisible();
        await expect(edit.getByLabel('Email')).toHaveValue('sam.r@example.com');
      },
      success: () => expect(page.getByText('Sam R. was updated.')).toBeVisible(),
      reload: () => expect(sam.getByText('also: sam.r@example.com')).toBeVisible(),
    });

    await w.mutate('Send to CRM', {
      method: 'leads.retryCrmPush',
      act: () => sam.getByRole('button', { name: 'Send to CRM' }).click(),
      pending: sam.getByRole('button', { name: 'Sending…' }),
      error: () => expect(page.getByText('Internal Server Error')).toBeVisible(),
      success: () => expect(page.getByText('Sam R. is now in your CRM.')).toBeVisible(),
      reload: () => expect(sam.getByText('in your CRM')).toBeVisible(),
    });

    await w.mutate('archive', {
      method: 'leads.archive',
      act: () => jordan.getByRole('button', { name: 'Archive', exact: true }).click(),
      pending: jordan.getByRole('button', { name: 'Archiving…' }),
      error: () =>
        expect(page.getByText('We could not archive that lead. It is unchanged')).toBeVisible(),
      success: () => expect(jordan).toHaveCount(0),
      reload: async () => {
        await expect(jordan).toHaveCount(0);
        await expect(page.getByText('Show archived leads (1)')).toBeVisible();
      },
    });

    const prune = page.getByRole('dialog', { name: 'Prune this lead?' });
    await w.mutate('prune', {
      method: 'leads.prune',
      act: async () => {
        if (await prune.isHidden()) {
          await page.getByRole('checkbox', { name: 'Select Priya S.' }).check();
          await page.getByRole('button', { name: 'Prune 1 selected' }).click();
        }
        await prune.getByRole('button', { name: 'Prune permanently' }).click();
      },
      pending: prune.getByRole('button', { name: 'Pruning…' }),
      error: async () => {
        await expect(prune.getByText('Internal Server Error')).toBeVisible();
        await expect(prune).toBeVisible();
      },
      success: () => expect(prune).toBeHidden(),
      reload: () => expect(priya).toHaveCount(0),
    });

    const erase = page.getByRole('dialog', { name: "Erase this lead's data?" });
    await w.mutate('erase', {
      method: 'leads.prune',
      act: async () => {
        if (await erase.isHidden())
          await sam.getByRole('button', { name: "Erase Sam R.'s data" }).click();
        await erase.getByRole('button', { name: 'Erase permanently' }).click();
      },
      pending: erase.getByRole('button', { name: 'Erasing…' }),
      error: async () => {
        await expect(erase.getByText('Internal Server Error')).toBeVisible();
        await expect(erase).toBeVisible();
      },
      success: () => expect(erase).toBeHidden(),
      reload: async () => {
        await expect(sam).toHaveCount(0);
        // Only the archived lead is left: the empty active view says so honestly.
        await expect(
          page.getByText(
            'All 1 of your leads are archived. Tick “Show archived leads” to see them.',
          ),
        ).toBeVisible();
      },
    });
  });

  // ── Analytics ────────────────────────────────────────────────────────────────
  await w.pillar('Analytics', async () => {
    await page.goto('/dashboard/analytics');
    await w.listStates({
      method: 'analytics.overview',
      loading: page.getByText('Loading your analytics…'),
      error: page.getByText('We could not load your analytics, so no figures are shown'),
      retry: page.getByRole('button', { name: 'Try again' }),
      ready: () => expect(page.getByText('Conversations (period)')).toBeVisible(),
    });
    await expect(page.getByText('Conversations (period)')).toBeVisible();
    await expect(page.getByText('We could not load your analytics')).toHaveCount(0);
  });

  // ── Audit log ────────────────────────────────────────────────────────────────
  await w.pillar('Audit', async () => {
    await page.goto('/dashboard/audit');
    await w.listStates({
      method: 'analytics.auditLog',
      loading: page.getByText('Loading your activity…'),
      error: page.getByText('We could not load your audit log.'),
      retry: page.getByRole('button', { name: 'Try again' }),
      ready: () => expect(page.getByText('Luciel configured').first()).toBeVisible(),
    });
    // The walk's own writes are on the record — written by the server, not the page.
    await expect(page.getByText('Luciel configured').first()).toBeVisible();
    if (!w.live) {
      for (const label of [
        'Answer flagged',
        'Takeover started',
        'Lead archived',
        'Lead details corrected',
        'Lead permanently deleted',
        'Earlier leads sent to your CRM',
      ]) {
        await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
      }
    }
  });

  // ── Knowledge cleanup: the walk deletes what it added ────────────────────────
  // On live this is what keeps repeated walks from filling the walk tenant's
  // knowledge quota; the crawl's pages (named by their URL, all under the product's
  // own origin) go too. Only sources the walk itself created are ever deleted.
  await w.pillar('Knowledge cleanup', async () => {
    await page.goto('/dashboard/configure');
    const pillar = card(page, 'Knowledge base');
    const sources = pillar.locator('ul').first();
    await expect(sources.getByText(walkSources[0] ?? '', { exact: true })).toBeVisible();
    const crawled = w.live
      ? (await sources.getByRole('listitem').allInnerTexts())
          .map((text) => text.split('\n')[0]?.trim() ?? '')
          .filter((name) => name.startsWith(`${origin}/`))
      : [];
    const del = page.getByRole('dialog', { name: 'Delete this knowledge source?' });
    for (const [i, name] of [...walkSources, ...crawled].entries()) {
      const row = sources
        .getByRole('listitem')
        .filter({ has: page.getByText(name, { exact: true }) });
      await w.mutate(`delete “${name}”`, {
        // The error leg once: the dialog stays open and says why.
        method: i === 0 ? 'knowledge.deleteSource' : undefined,
        act: async () => {
          if (await del.isHidden()) await row.getByRole('button', { name: 'Delete' }).click();
          await del.getByRole('button', { name: 'Delete source' }).click();
        },
        pending: i === 0 ? del.getByRole('button', { name: 'Deleting…' }) : undefined,
        error: async () => {
          await expect(del.getByText('Internal Server Error')).toBeVisible();
          await expect(del).toBeVisible();
        },
        success: () =>
          expect(
            pillar.getByText(`Deleted “${name}” — Luciel no longer answers from it.`),
          ).toBeVisible(),
        reload: async () => {
          // The served list (rows, or the honest empty line) — not its loading state.
          await expect(
            sources
              .getByRole('listitem')
              .filter({ hasNotText: /Loading your sources…|We could not load/ })
              .first(),
          ).toBeVisible();
          await expect(sources.getByText(name, { exact: true })).toHaveCount(0);
        },
      });
    }
  });

  // ── Billing: add a card via Checkout, update it, remove it ───────────────────
  await w.pillar('Billing', async () => {
    await page.goto('/dashboard/billing');
    await expect(page.getByText('This billing period')).toBeVisible();
    await w.step(
      'add a card through Checkout, replace it in the portal, remove it',
      async () => {
        await w.mutate('add a card (Checkout)', {
          method: 'billing.startCheckout',
          act: async () => {
            await page.getByRole('button', { name: 'Add payment method' }).click();
          },
          pending: page.getByRole('button', { name: 'Opening secure checkout…' }),
          error: () =>
            expect(
              page.getByText('We could not open secure checkout just now. Please try again.'),
            ).toBeVisible(),
          success: async () => {
            await page.waitForURL(/checkout\.stripe\.com/);
            await page.getByRole('link', { name: 'Save card' }).click();
            await page.waitForURL(/\/dashboard\/billing\?checkout=success/);
            await expect(page.getByText('Your card was saved.')).toBeVisible();
          },
          reload: () => expect(page.getByText(/VISA ending 4242/)).toBeVisible(),
        });
        await w.mutate('update the payment method (Billing Portal)', {
          method: 'billing.startPortal',
          act: () => page.getByRole('button', { name: 'Update payment method' }).click(),
          pending: page.getByRole('button', { name: 'Opening your billing portal…' }),
          error: () =>
            expect(page.getByText('We could not open your billing portal just now.')).toBeVisible(),
          success: async () => {
            await page.waitForURL(/billing\.stripe\.com/);
            await page.getByRole('link', { name: 'Replace card' }).click();
            await page.waitForURL(/\/dashboard\/billing/);
            await expect(page.getByText(/MASTERCARD ending 4444/)).toBeVisible();
          },
          reload: () => expect(page.getByText(/MASTERCARD ending 4444/)).toBeVisible(),
        });
        const remove = page.getByRole('dialog', { name: 'Remove your payment method?' });
        await w.mutate('remove the payment method', {
          method: 'billing.removePaymentMethod',
          act: async () => {
            if (await remove.isHidden()) {
              await page.getByRole('button', { name: 'Remove payment method' }).click();
            }
            await remove.getByRole('button', { name: 'Remove card' }).click();
          },
          pending: remove.getByRole('button', { name: 'Removing…' }),
          error: async () => {
            await expect(remove.getByText('Internal Server Error')).toBeVisible();
            await expect(remove).toBeVisible();
          },
          success: () => expect(remove).toBeHidden(),
          reload: () =>
            expect(page.getByText('No card on file — your Luciel is capped')).toBeVisible(),
        });
      },
      NEEDS.card,
    );
  });

  // ── Pause / Resume ───────────────────────────────────────────────────────────
  await w.pillar('Pause/Resume', async () => {
    await page.goto('/dashboard/account');
    const pause = page.getByRole('dialog', { name: 'Pause your Luciel?' });
    await w.mutate('pause', {
      method: 'luciel.pause',
      act: async () => {
        if (await pause.isHidden())
          await page.getByRole('button', { name: 'Pause my Luciel' }).click();
        await pause.getByRole('button', { name: 'Pause', exact: true }).click();
      },
      pending: pause.getByRole('button', { name: 'Pausing…' }),
      error: async () => {
        await expect(pause.getByText('Internal Server Error')).toBeVisible();
        await expect(pause).toBeVisible();
      },
      success: () => expect(page.getByRole('button', { name: 'Resume my Luciel' })).toBeVisible(),
      reload: () => expect(page.getByRole('button', { name: 'Resume my Luciel' })).toBeVisible(),
    });
    // Only a LOADED, serving Luciel shows this line — "Pause my Luciel" alone also
    // renders while the state is still loading, so it proves nothing on its own.
    const serving = page.getByText('Your Luciel is still running.');
    await w.mutate('resume', {
      method: 'luciel.resume',
      act: () => page.getByRole('button', { name: 'Resume my Luciel' }).click(),
      pending: page.getByRole('button', { name: 'Resuming…' }),
      error: () =>
        expect(page.getByText('We could not resume your Luciel. It is still paused')).toBeVisible(),
      success: async () => {
        await expect(page.getByRole('button', { name: 'Pause my Luciel' })).toBeVisible();
        await expect(serving).toBeVisible();
      },
      reload: async () => {
        await expect(serving).toBeVisible();
        await expect(page.getByRole('button', { name: 'Pause my Luciel' })).toBeEnabled();
      },
    });
  });

  // ── Delete / Restore ─────────────────────────────────────────────────────────
  await w.pillar('Delete/Restore', async () => {
    const del = page.getByRole('dialog', { name: 'Delete your Luciel?' });
    await w.mutate('delete the Luciel (30-day grace)', {
      method: 'luciel.delete',
      act: async () => {
        if (await del.isHidden())
          await page.getByRole('button', { name: 'Delete my Luciel' }).click();
        await del.getByRole('button', { name: 'Delete Luciel' }).click();
      },
      pending: del.getByRole('button', { name: 'Deleting…' }),
      error: async () => {
        await expect(del.getByText('Internal Server Error')).toBeVisible();
        await expect(del).toBeVisible();
      },
      success: () => expect(page.getByRole('button', { name: 'Restore my Luciel' })).toBeVisible(),
      reload: async () => {
        await expect(page.getByText(/is deleted and in its 30-day grace window/)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Pause my Luciel' })).toBeDisabled();
      },
    });
    await w.mutate('restore it', {
      method: 'luciel.restore',
      act: () => page.getByRole('button', { name: 'Restore my Luciel' }).click(),
      pending: page.getByRole('button', { name: 'Restoring…' }),
      error: () =>
        expect(
          page.getByText('We could not restore your Luciel. It is still deleted'),
        ).toBeVisible(),
      // Not "the Restore button is gone": while the call is in flight it reads
      // "Restoring…", so that would pass before the server answered — and the reload
      // that follows would cut the restore off.
      success: async () => {
        await expect(page.getByText(/is deleted and in its 30-day grace window/)).toHaveCount(0);
        await expect(page.getByText('Your Luciel is still running.')).toBeVisible();
      },
      reload: async () => {
        await expect(page.getByText('Your Luciel is still running.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Delete my Luciel' })).toBeEnabled();
      },
    });
  });

  // ── Close / Reopen / Re-export ───────────────────────────────────────────────
  await w.pillar('Close/Reopen/Re-export', async () => {
    const exportDialog = page.getByRole('dialog', { name: 'Download all your data' });
    await w.mutate('export first', {
      method: 'account.requestExport',
      act: async () => {
        if (await exportDialog.isHidden()) {
          await page.getByRole('button', { name: 'Download all my data' }).click();
        }
        await exportDialog.getByRole('button', { name: 'Prepare my export' }).click();
      },
      pending: exportDialog.getByRole('button', { name: 'Preparing…' }),
      error: async () => {
        await expect(exportDialog.getByText('Internal Server Error')).toBeVisible();
        await expect(exportDialog).toBeVisible();
      },
      success: async () => {
        await expect(exportDialog.getByText('Your export is ready.')).toBeVisible();
        await expect(
          exportDialog.getByRole('link', { name: 'Download your export' }),
        ).toBeVisible();
        await exportDialog.getByRole('button', { name: 'Done' }).click();
      },
      reload: () => expect(page.getByRole('heading', { name: 'Manage account' })).toBeVisible(),
    });

    const close = page.getByRole('dialog', { name: 'Close your account?' });
    await w.mutate('close the account (the Luciel is deleted first)', {
      method: 'account.close',
      act: async () => {
        if (await close.isHidden())
          await page.getByRole('button', { name: 'Close my account' }).click();
        await close.getByRole('button', { name: 'Delete my Luciel and close account' }).click();
      },
      pending: close.getByRole('button', { name: 'Closing…' }),
      error: async () => {
        await expect(close.getByText('Internal Server Error')).toBeVisible();
        await expect(close).toBeVisible();
      },
      success: async () => {
        await page.waitForURL((url) => url.pathname === '/');
        await page.goto('/dashboard');
        await page.waitForURL(/\/account-closed$/);
      },
      reload: () =>
        expect(page.getByRole('heading', { name: 'Your account is closed' })).toBeVisible(),
    });

    await w.mutate('re-export from the closed account', {
      method: 'account.requestExport',
      act: () =>
        page
          .getByRole('button', { name: /^(Download my data again|Prepare another export)$/ })
          .click(),
      pending: page.getByRole('button', { name: 'Preparing…' }),
      error: () => expect(page.getByText('Internal Server Error')).toBeVisible(),
      success: () => expect(page.getByText('Your export is ready.')).toBeVisible(),
      reload: () =>
        expect(page.getByRole('heading', { name: 'Your account is closed' })).toBeVisible(),
    });

    await w.mutate('reopen', {
      method: 'account.reopen',
      act: () => page.getByRole('button', { name: 'Reopen my account' }).click(),
      pending: page.getByRole('button', { name: 'Reopening…' }),
      error: () => expect(page.getByText('Internal Server Error')).toBeVisible(),
      success: async () => {
        await expect(
          page.getByRole('heading', { name: 'Your account is open again' }),
        ).toBeVisible();
        await expect(page.getByText('Your Luciel is back and answering again.')).toBeVisible();
      },
      reload: async () => {
        await page.waitForURL(/\/dashboard$/);
        await expect(page.getByRole('main').getByText('Active', { exact: true })).toBeVisible();
      },
    });
  });

  w.time('walk-total', 'the whole walk', w.elapsed());
});
