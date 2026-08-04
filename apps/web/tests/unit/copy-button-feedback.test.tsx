import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import EmbedPage from '@/app/(app)/dashboard/embed/page';

/**
 * Harmony wave 2, item 5 (owner walkthrough on dev, verified live twice: the
 * button's text stayed exactly "Copy" after a click).
 *
 * Investigation (see register/frontend_gaps.md, "Harmony wave 2" for the full
 * writeup): the wave-1 fix (36d4087) is the ACTUAL component this page
 * renders — there is no other Copy button anywhere in the codebase, and a
 * real production build + real click in a real browser (Playwright, both with
 * and without a granted Clipboard permission) confirms the underlying state
 * update genuinely happens: the button's raw DOM textContent does flip to
 * "✓ Copied" and revert to "Copy" 2s later, exactly on schedule. The defect
 * was the SIGNAL, not the state: `variant="primary"` never changed, so the
 * only visible difference between the two states was a tiny glyph plus a
 * five-letter text swap in an otherwise identical, identically-colored
 * button — easy to miss on a quick glance, which reads exactly like "no state
 * change" to someone verifying it live. This suite pins the real component's
 * real click path, including the two failure surfaces item 5 explicitly
 * calls out: no Clipboard API at all, and a Clipboard API that rejects.
 * Feedback must appear on success ONLY.
 */
describe('Harmony wave 2, item 5: Copy button gives an unmistakable success signal', () => {
  afterEach(() => {
    // Clipboard is not configurable by default in some jsdom versions; guard
    // the delete so a re-run never throws on a non-configurable descriptor.
    try {
      // @ts-expect-error - test cleanup, deliberately reaching into navigator
      delete (navigator as any).clipboard;
    } catch {
      /* noop */
    }
  });

  it('on a successful copy: swaps to a checkmark + "Copied" AND to the success color treatment, announces it, then reverts after ~2s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderWithQuery(<EmbedPage />);
    const copyButton = await screen.findByRole('button', { name: /^Copy$/i });

    // Before the click: primary (accent) treatment, not the success colors.
    expect(copyButton.className).toContain('bg-vm-accent');
    expect(copyButton.className).not.toContain('text-vm-success');

    fireEvent.click(copyButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('data-key')));

    // The SAME button element (not a re-query) must now read "Copied" — this
    // is the literal DOM node a real click path would touch, matching how
    // the live regression was verified ("the dashboard's DOM after click").
    await waitFor(() => expect(copyButton).toHaveTextContent(/Copied/i));
    expect(copyButton.querySelector('[aria-hidden="true"]')).toHaveTextContent('✓');

    // The unmistakable-signal fix: color treatment actually changes too, not
    // just the label — matching StatusChip's "connected" success treatment
    // rather than staying the same accent-colored button.
    expect(copyButton.className).toContain('text-vm-success');
    expect(copyButton.className).not.toContain('bg-vm-accent');

    // Announced to assistive tech via an explicit aria-live polite region.
    const announcement = screen.getByText(/Snippet copied to clipboard\./i);
    expect(announcement).toHaveAttribute('aria-live', 'polite');
    expect(announcement).toHaveAttribute('role', 'status');

    // No failure banner on a successful copy.
    expect(screen.queryByText(/browser blocked the copy/i)).not.toBeInTheDocument();

    // Reverts to "Copy" and the accent treatment ~2s later, still the same
    // DOM node.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    await waitFor(() => expect(copyButton).toHaveTextContent(/^Copy$/));
    expect(copyButton.className).toContain('bg-vm-accent');
    expect(copyButton.className).not.toContain('text-vm-success');
    expect(screen.queryByText(/Snippet copied to clipboard\./i)).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it('when the Clipboard API does not exist at all: shows NO "Copied" feedback, surfaces the manual-copy banner, and never throws', async () => {
    // navigator.clipboard is entirely absent — the real condition item 5
    // calls out ("clipboard API absence"), distinct from a present-but-
    // rejecting API. Accessing `.writeText` on `undefined` throws
    // synchronously inside the same try/catch the async path uses.
    expect((navigator as any).clipboard).toBeUndefined();

    renderWithQuery(<EmbedPage />);
    const copyButton = await screen.findByRole('button', { name: /^Copy$/i });

    fireEvent.click(copyButton);

    await waitFor(() =>
      expect(screen.getByText(/browser blocked the copy/i)).toBeInTheDocument(),
    );

    // Never claims success when there was none.
    expect(copyButton).not.toHaveTextContent(/Copied/i);
    expect(copyButton.className).not.toContain('text-vm-success');
    expect(screen.queryByText(/Snippet copied to clipboard\./i)).not.toBeInTheDocument();
  });

  it('when the Clipboard API exists but rejects (permission denied): shows NO "Copied" feedback, surfaces the manual-copy banner', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    Object.assign(navigator, { clipboard: { writeText } });

    renderWithQuery(<EmbedPage />);
    const copyButton = await screen.findByRole('button', { name: /^Copy$/i });

    fireEvent.click(copyButton);
    await waitFor(() => expect(writeText).toHaveBeenCalled());

    await waitFor(() =>
      expect(screen.getByText(/browser blocked the copy/i)).toBeInTheDocument(),
    );
    expect(copyButton).not.toHaveTextContent(/Copied/i);
    expect(copyButton.className).not.toContain('text-vm-success');
    expect(screen.queryByText(/Snippet copied to clipboard\./i)).not.toBeInTheDocument();
  });

  it('a later successful click clears an earlier failure banner and shows real feedback', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('blocked')).mockResolvedValueOnce(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderWithQuery(<EmbedPage />);
    const copyButton = await screen.findByRole('button', { name: /^Copy$/i });

    fireEvent.click(copyButton);
    await waitFor(() => expect(screen.getByText(/browser blocked the copy/i)).toBeInTheDocument());

    fireEvent.click(copyButton);
    await waitFor(() => expect(copyButton).toHaveTextContent(/Copied/i));
    expect(screen.queryByText(/browser blocked the copy/i)).not.toBeInTheDocument();
  });
});
