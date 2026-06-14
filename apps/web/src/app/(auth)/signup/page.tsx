/**
 * Signup — scaffold placeholder (Customer Journey Phase 2: email + password +
 * invisible captcha). The real form (React Hook Form + Zod, reusing the
 * `signupRequest` schema from @luciel/api-client) lands in the auth milestone.
 * Kept honest: this is a stub, not a working form.
 */
export default function SignupPage() {
  return (
    <div className="mx-auto max-w-md py-vm-7">
      <h1 className="font-heading text-vm-5">Create your account</h1>
      <p className="mt-vm-2 text-vm-1 text-vm-text-muted">
        Three fields — email, password, and a one-click captcha. No credit card. (Form wired in the
        auth milestone.)
      </p>
    </div>
  );
}
