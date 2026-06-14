/**
 * Login — scaffold placeholder. Email + password (no magic link for login;
 * the link is verification/reset only — Arch §3.7.1a). Real form lands in the
 * auth milestone.
 */
export default function LoginPage() {
  return (
    <div className="mx-auto max-w-md py-vm-7">
      <h1 className="font-heading text-vm-5">Log in</h1>
      <p className="mt-vm-2 text-vm-1 text-vm-text-muted">
        Email and password. (Form wired in the auth milestone.)
      </p>
    </div>
  );
}
