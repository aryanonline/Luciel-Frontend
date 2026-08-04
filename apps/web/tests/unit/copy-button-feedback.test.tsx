import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import EmbedPage from '@/app/(app)/dashboard/embed/page';

/**
 * Harmony wave 2, item 5 (owner walkthrough on dev, verified live twice: the
 * button's text stayed exactly "Copy" after a click) — and its FOLLOW-UP
 * (verified live: textContent/className unchanged through 3s of polling in a
 * browser where `navigator.clipboard.writeText` is unavailable or rejects).
 *
 * See register/frontend_gaps.md, "Copy fallback + attention counter" for the
 * full writeup: 1ac6a30 made the SUCCESS state visually unmistakable
 * (variant swap + checkmark + aria-live announcement), but it only fires
 * feedback on clipboard SUCCESS. Any customer whose browser has no Clipboard
 * API at all (locked-down machine, non-HTTPS context, some embedded
 * webviews) or whose Clipboard API rejects (denied permission) got NO
 * feedback whatsoever — the button's DOM node was provably unchanged for as
 * long as it was polled, which reads exactly like "nothing happened" on a
 * real click.
 *
 * This suite pins the real component's real click path across three
 * surfaces: the Clipboard API succeeding (unchanged from before), the
 * Clipboard API being entirely absent but the legacy
 * `document.execCommand('copy')` fallback succeeding, and BOTH paths
 * failing outright (the true "couldn't copy" case), which must show a
 * failure message and select the on-page snippet text.
 */
describe('Harmony wave 2, item 5: Copy button gives an unmistakable success signal', () => {
  beforeEach(() => {
    // jsdom does not implement `document.execCommand` at all, so `vi.spyOn`
    // has nothing to wrap unless a stub exists first. Each test that cares
    // about the fallback path overrides this mock's return value.
    if (!('execCommand' in document)) {
      (document as any).execCommand = () => false;
    }
  });

  afterEach(() => {
    // Clipboard is not configurable by default in some jsdom versions; guard
    // the delete so a re-run never throws on a non-configurable descriptor.
    try {
      // @ts-expect-error - test cleanup, deliberately reaching into navigator
      delete (navigator as any).clipboard;
    } catch {
      /* noop */
    }
    vi.restoreAllMocks();
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
    expect(screen.queryByText(/couldn.?t copy/i)).not.toBeInTheDocument();

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

  describe('fallback chain: clipboard unavailable/rejecting falls back to execCommand', () => {
    beforeEach(() => {
      // Simulate the legacy fallback succeeding — the browser reports the
      // copy command as having worked.
      vi.spyOn(document, 'execCommand').mockReturnValue(true);
    });

    it('clipboard API entirely absent + execCommand fallback succeeds: shows "Copied ✓", same as the native path', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      expect((navigator as any).clipboard).toBeUndefined();

      renderWithQuery(<EmbedPage />);
      const copyButton = await screen.findByRole('button', { name: /^Copy$/i });

      fireEvent.click(copyButton);

      await waitFor(() => expect(document.execCommand).toHaveBeenCalledWith('copy'));
      await waitFor(() => expect(copyButton).toHaveTextContent(/Copied/i));
      expect(copyButton.className).toContain('text-vm-success');
      const announcement = screen.getByText(/Snippet copied to clipboard\./i);
      expect(announcement).toHaveAttribute('aria-live', 'polite');

      // No failure surface — the fallback worked.
      expect(screen.queryByText(/couldn.?t copy/i)).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      await waitFor(() => expect(copyButton).toHaveTextContent(/^Copy$/));
      vi.useRealTimers();
    });

    it('clipboard API present but rejects + execCommand fallback succeeds: still shows "Copied ✓"', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const writeText = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
      Object.assign(navigator, { clipboard: { writeText } });

      renderWithQuery(<EmbedPage />);
      const copyButton = await screen.findByRole('button', { name: /^Copy$/i });

      fireEvent.click(copyButton);

      await waitFor(() => expect(writeText).toHaveBeenCalled());
      await waitFor(() => expect(document.execCommand).toHaveBeenCalledWith('copy'));
      await waitFor(() => expect(copyButton).toHaveTextContent(/Copied/i));
      expect(copyButton.className).toContain('text-vm-success');
      expect(screen.queryByText(/couldn.?t copy/i)).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      await waitFor(() => expect(copyButton).toHaveTextContent(/^Copy$/));
      vi.useRealTimers();
    });
  });

  describe('total failure: both the Clipboard API and the execCommand fallback fail', () => {
    it('clipboard API absent + execCommand fallback also fails: shows a failure message, selects the snippet, and never claims success', async () => {
      vi.spyOn(document, 'execCommand').mockReturnValue(false);
      expect((navigator as any).clipboard).toBeUndefined();

      renderWithQuery(<EmbedPage />);
      const copyButton = await screen.findByRole('button', { name: /^Copy$/i });

      fireEvent.click(copyButton);

      await waitFor(() =>
        expect(screen.getByText(/couldn.?t copy.*select the code above/i)).toBeInTheDocument(),
      );

      // Never claims success when there was none.
      expect(copyButton).not.toHaveTextContent(/^Copied$/i);
      expect(copyButton.className).not.toContain('text-vm-success');
      expect(screen.queryByText(/Snippet copied to clipboard\./i)).not.toBeInTheDocument();

      // Announced to assistive tech too — failure is not silent.
      const announcement = screen.getByText(/Couldn.?t copy the snippet/i);
      expect(announcement).toHaveAttribute('aria-live', 'polite');

      // The snippet text is selected so the customer can copy it by hand
      // with one extra keystroke.
      const selection = window.getSelection?.();
      expect(selection && selection.toString().length).toBeGreaterThan(0);
    });

    it('clipboard API rejects + execCommand fallback also fails: shows a failure message, never a success state', async () => {
      vi.spyOn(document, 'execCommand').mockReturnValue(false);
      const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
      Object.assign(navigator, { clipboard: { writeText } });

      renderWithQuery(<EmbedPage />);
      const copyButton = await screen.findByRole('button', { name: /^Copy$/i });

      fireEvent.click(copyButton);
      await waitFor(() => expect(writeText).toHaveBeenCalled());

      await waitFor(() =>
        expect(screen.getByText(/couldn.?t copy.*select the code above/i)).toBeInTheDocument(),
      );
      expect(copyButton).not.toHaveTextContent(/^Copied$/i);
      expect(copyButton.className).not.toContain('text-vm-success');
    });

    it('a later successful click clears an earlier failure message and shows real feedback', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const execCommandMock = vi
        .spyOn(document, 'execCommand')
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);
      expect((navigator as any).clipboard).toBeUndefined();

      renderWithQuery(<EmbedPage />);
      const copyButton = await screen.findByRole('button', { name: /^Copy$/i });

      fireEvent.click(copyButton);
      await waitFor(() =>
        expect(screen.getByText(/couldn.?t copy.*select the code above/i)).toBeInTheDocument(),
      );

      fireEvent.click(copyButton);
      await waitFor(() => expect(copyButton).toHaveTextContent(/Copied/i));
      expect(screen.queryByText(/couldn.?t copy/i)).not.toBeInTheDocument();
      expect(execCommandMock).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });
});
