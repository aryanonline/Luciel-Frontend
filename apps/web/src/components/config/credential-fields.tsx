'use client';

import { Field, Input } from '@luciel/ui';
import type { ProviderCredentialField } from '@luciel/api-client';

/**
 * The form a `credential_form` provider advertises (contract §1a) — the
 * customer's OWN credential, e.g. their Twilio account or their webhook
 * endpoint. The fields are SERVED, never hardcoded: a provider that starts
 * asking for one more thing must not need a frontend change.
 *
 * Secret fields are masked and never echoed back: the value goes to Secrets
 * Manager, so once saved there is nothing to re-display (§3.8.3).
 */
export function CredentialFields({
  idPrefix,
  fields,
  values,
  onChange,
}: {
  idPrefix: string;
  fields: ProviderCredentialField[];
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  return (
    <div className="grid gap-vm-2">
      {fields.map((field) => (
        <Field
          key={field.name}
          id={`${idPrefix}-${field.name}`}
          label={field.label}
          required={field.required}
          hint={field.secret ? 'Stored in the secrets vault, never shown again.' : undefined}
        >
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type={field.secret ? 'password' : 'text'}
              autoComplete={field.secret ? 'new-password' : 'off'}
              value={values[field.name] ?? ''}
              onChange={(e) => onChange({ ...values, [field.name]: e.target.value })}
            />
          )}
        </Field>
      ))}
    </div>
  );
}

/** True once every field the provider marks required has a value. */
export function credentialFieldsComplete(
  fields: ProviderCredentialField[],
  values: Record<string, string>,
): boolean {
  return fields.every((f) => !f.required || Boolean(values[f.name]?.trim()));
}
