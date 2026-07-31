import { z } from 'zod';

/**
 * Public contact form (marketing site). Unauthenticated, hCaptcha-gated.
 *
 * The destination inbox lives only on the server: this request carries the
 * message, never the address it is relayed to, so the inbox stays unharvestable
 * from the page source.
 */
export const contactRequest = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  message: z.string().min(10),
  /** hCaptcha token — verified SERVER-SIDE before the message is accepted. */
  captchaToken: z.string().min(1),
});
export type ContactRequest = z.infer<typeof contactRequest>;

export const contactResult = z.object({ ok: z.boolean() });
export type ContactResult = z.infer<typeof contactResult>;
