import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { api } from '@/lib/api';
import LoginPage from '@/app/(auth)/login/page';
import SignupPage from '@/app/(auth)/signup/page';
import ForgotPage from '@/app/(auth)/forgot/page';
import ResetPage from '@/app/(auth)/reset/page';
import ContactPage from '@/app/(marketing)/contact/page';
import FirstRunPage from '@/app/(app)/first-run/page';

/**
 * Every message a form's schema shows, word for word, pinned at the major-version
 * move of the validation library and its form resolver (zod 3 → 4,
 * @hookform/resolvers 3 → 7; 2026-11-14). zod 4 words its default messages
 * differently, and first-run shows the defaults, so those are spelled out in the
 * schema now. A form whose input fails its schema shows the message under the field
 * and never calls the API.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  // The reset page needs the token from its link to render the form.
  useSearchParams: () => new URLSearchParams('token=reset-token'),
  usePathname: () => '/',
  useParams: () => ({}),
}));
// hCaptcha answers at once, so a form that passes its schema really is sent.
vi.mock('@/components/marketing/hcaptcha', async () => {
  const React = await import('react');
  return {
    HCaptcha: ({ onVerify }: { onVerify: (token: string | null) => void }) => {
      React.useEffect(() => onVerify('captcha-token'), [onVerify]);
      return null;
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const errorOf = (id: string) => document.getElementById(`${id}-error`)?.textContent ?? null;
const type = (label: RegExp | string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = (name: RegExp | string) => {
  const button = screen.getByRole('button', { name });
  // Signup holds its button until hCaptcha answers; the form still validates on submit.
  fireEvent.submit(button.closest('form')!);
};

describe('log in', () => {
  it('names the empty fields', async () => {
    const login = vi.spyOn(api.auth, 'login');
    renderWithQuery(<LoginPage />);
    submit('Log in');
    await waitFor(() => expect(errorOf('email')).toBe('Enter a valid email.'));
    expect(errorOf('password')).toBe('Enter your password.');
    expect(login).not.toHaveBeenCalled();
  });

  it('refuses an address that is not one', async () => {
    renderWithQuery(<LoginPage />);
    type(/^email/i, 'owner@example');
    type(/^password/i, 'correct horse');
    submit('Log in');
    await waitFor(() => expect(errorOf('email')).toBe('Enter a valid email.'));
    expect(errorOf('password')).toBeNull();
  });
});

describe('sign up', () => {
  it('asks for a real address and eight characters', async () => {
    const signup = vi.spyOn(api.auth, 'signup');
    renderWithQuery(<SignupPage />);
    type(/^email/i, 'not-an-email');
    type(/^password/i, 'short');
    submit('Create account');
    await waitFor(() => expect(errorOf('email')).toBe('Enter a valid email.'));
    expect(errorOf('password')).toBe('Use at least 8 characters.');
    expect(signup).not.toHaveBeenCalled();
  });
});

describe('forgot password', () => {
  it('asks for a real address', async () => {
    const forgot = vi.spyOn(api.auth, 'forgotPassword');
    renderWithQuery(<ForgotPage />);
    submit('Send reset link');
    await waitFor(() => expect(errorOf('email')).toBe('Enter a valid email.'));
    expect(forgot).not.toHaveBeenCalled();
  });
});

describe('reset password', () => {
  it('names a short password and an empty confirmation', async () => {
    const reset = vi.spyOn(api.auth, 'resetPassword');
    renderWithQuery(<ResetPage />);
    type(/^new password/i, 'short');
    submit('Update password');
    await waitFor(() => expect(errorOf('password')).toBe('Use at least 8 characters.'));
    expect(errorOf('confirm')).toBe('Re-enter your password.');
    expect(reset).not.toHaveBeenCalled();
  });

  it('says when the two passwords differ', async () => {
    const reset = vi.spyOn(api.auth, 'resetPassword');
    renderWithQuery(<ResetPage />);
    type(/^new password/i, 'correct horse battery');
    type(/^confirm password/i, 'correct horse battery staple');
    submit('Update password');
    await waitFor(() => expect(errorOf('confirm')).toBe('Passwords do not match.'));
    expect(errorOf('password')).toBeNull();
    expect(reset).not.toHaveBeenCalled();
  });
});

describe('contact', () => {
  it('names each empty field', async () => {
    const send = vi.spyOn(api.contact, 'submit');
    renderWithQuery(<ContactPage />);
    submit('Send message');
    await waitFor(() => expect(errorOf('name')).toBe('Please tell us your name.'));
    expect(errorOf('email')).toBe('Enter a valid email so we can reply.');
    expect(errorOf('message')).toBe('A little more detail helps us help you.');
    expect(send).not.toHaveBeenCalled();
  });

  it('a filled honeypot stops the message; the same message without it is sent', async () => {
    const send = vi.spyOn(api.contact, 'submit').mockResolvedValue({ ok: true });
    renderWithQuery(<ContactPage />);
    type(/^your name/i, 'Sam');
    type(/^your email/i, 'sam@example.com');
    type(/^message/i, 'Do you work with clinics?');
    const honeypot = document.getElementById('company')!;
    fireEvent.change(honeypot, { target: { value: 'Acme' } });
    submit('Send message');
    // The button says "Sending…" until the submit has finished (the resolver, then any
    // send), so once it reads "Send message" again nothing more can happen. A fixed 50 ms
    // wait could end first and leave the checks below proving nothing.
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    expect(await screen.findByRole('button', { name: 'Send message' })).toBeEnabled();
    expect(send).not.toHaveBeenCalled();
    expect(screen.queryByText(/your message is on its way/i)).toBeNull();

    fireEvent.change(honeypot, { target: { value: '' } });
    submit('Send message');
    await screen.findByText(/your message is on its way/i);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      name: 'Sam',
      email: 'sam@example.com',
      message: 'Do you work with clinics?',
      captchaToken: 'captcha-token',
    });
  });
});

describe('first run', () => {
  it('shows the schema message for each empty field', async () => {
    const create = vi.spyOn(api.luciel, 'create');
    renderWithQuery(<FirstRunPage />);
    submit(/create my luciel/i);
    await waitFor(() =>
      expect(errorOf('name')).toBe('String must contain at least 1 character(s)'),
    );
    expect(errorOf('websiteUrl')).toBe('String must contain at least 1 character(s)');
    expect(errorOf('businessOneLiner')).toBe('String must contain at least 1 character(s)');
    expect(create).not.toHaveBeenCalled();
  });

  it('caps the one-liner at 280 characters', async () => {
    const create = vi.spyOn(api.luciel, 'create');
    renderWithQuery(<FirstRunPage />);
    type(/what should we call/i, 'Front Desk');
    type(/website/i, 'example.com');
    // The input's maxLength stops typing; a value set past it still meets the schema.
    type(/one sentence/i, 'x'.repeat(281));
    submit(/create my luciel/i);
    await waitFor(() =>
      expect(errorOf('businessOneLiner')).toBe('String must contain at most 280 character(s)'),
    );
    expect(create).not.toHaveBeenCalled();
  });
});
