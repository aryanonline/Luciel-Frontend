'use client';

import * as React from 'react';
import { Modal, Field, Input } from '@luciel/ui';
import { LucielApiError } from '@luciel/api-client';
import type { Lead, LeadPatchRequest } from '@luciel/api-client';
import { api } from '@/lib/api';

/**
 * Owner correction of a lead's own facts — name / email / phone (round 7 WP-3c
 * item 6; PATCH /dashboard/leads/{id}).
 *
 * The Modal's async contract owns the outcome: the dialog stays open on a
 * failure and renders the reason, so an edit that did not land can never look
 * like one that did. Field-level rules mirror the backend's (LeadPatchRequest +
 * edit_lead): lengths 255 / 320 / 32, an email must look like one, a phone must
 * read as an international E.164 number, and a value another lead already owns
 * is a conflict — never a silent merge. A server 422 / 409 that names the field
 * lands on that field; anything else lands in the dialog's banner.
 *
 * Only the fields the owner CHANGED ride the request: an omitted field is left
 * alone server-side and an explicit null clears it.
 */

/** Backend LeadPatchRequest limits. */
const NAME_MAX = 255;
const EMAIL_MAX = 320;
const PHONE_MAX = 32;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** E.164 after the separators people type are stripped: + then 8–15 digits. */
const E164 = /^\+[1-9]\d{7,14}$/;
const PHONE_SEPARATORS = /[\s\-.()]/g;

type FieldName = 'name' | 'email' | 'phone';
type FieldErrors = Partial<Record<FieldName, string>>;

/** Client-side mirror of the backend's rules — UX only; the server decides. */
export function validateLeadEdit(values: Record<FieldName, string>): FieldErrors {
  const errors: FieldErrors = {};
  const name = values.name.trim();
  const email = values.email.trim();
  const phone = values.phone.trim();
  if (name.length > NAME_MAX) errors.name = `Keep the name under ${NAME_MAX} characters.`;
  if (email.length > EMAIL_MAX) {
    errors.email = `Keep the email under ${EMAIL_MAX} characters.`;
  } else if (email && !EMAIL_SHAPE.test(email)) {
    errors.email = 'That is not a valid email address.';
  }
  if (phone.length > PHONE_MAX) {
    errors.phone = `Keep the phone number under ${PHONE_MAX} characters.`;
  } else if (phone && !E164.test(phone.replace(PHONE_SEPARATORS, ''))) {
    errors.phone =
      'Enter an international number starting with + and the country code (E.164), like +1 604 555 0100.';
  }
  return errors;
}

/**
 * Which field a server refusal is about. The backend's messages name the field
 * ("That is not a valid email address.", "That phone number already belongs to
 * another lead."); one that names neither is a dialog-level failure.
 */
function fieldOfServerError(message: string): FieldName | null {
  const lower = message.toLowerCase();
  if (lower.includes('email')) return 'email';
  if (lower.includes('phone')) return 'phone';
  if (lower.includes('name')) return 'name';
  return null;
}

/** The patch: only changed fields; an emptied field is an explicit null. */
export function leadPatchFrom(lead: Lead, values: Record<FieldName, string>): LeadPatchRequest {
  const patch: LeadPatchRequest = {};
  const name = values.name.trim();
  if (name !== (lead.name ?? '')) patch.name = name || null;
  const email = values.email.trim();
  if (email !== (lead.email ?? '')) patch.email = email || null;
  const phone = values.phone.trim();
  if (phone !== (lead.phone ?? '')) patch.phone = phone || null;
  return patch;
}

export function LeadEditDialog({
  lead,
  open,
  onOpenChange,
  onSaved,
}: {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The served row after the write — the page re-reads from it, never from the form. */
  onSaved: (lead: Lead) => void;
}) {
  const [values, setValues] = React.useState<Record<FieldName, string>>({
    name: '',
    email: '',
    phone: '',
  });
  const [errors, setErrors] = React.useState<FieldErrors>({});

  // A freshly opened dialog shows the served facts, never a previous attempt.
  React.useEffect(() => {
    if (open && lead) {
      setValues({ name: lead.name ?? '', email: lead.email ?? '', phone: lead.phone ?? '' });
      setErrors({});
    }
  }, [open, lead]);

  const set = (field: FieldName) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setValues((prev) => ({ ...prev, [field]: next }));
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const { [field]: _cleared, ...rest } = prev;
      return rest;
    });
  };

  /**
   * Throws for a dialog-level failure ON PURPOSE (the Modal renders it and stays
   * open). A field-level refusal — ours or the server's — lands on the field and
   * returns without closing, which is the same "stays open" outcome.
   */
  const save = async () => {
    if (!lead) return;
    const clientErrors = validateLeadEdit(values);
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      return;
    }
    const patch = leadPatchFrom(lead, values);
    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }
    try {
      const updated = await api.leads.update(lead.leadId, patch);
      onSaved(updated);
      onOpenChange(false);
    } catch (err) {
      if (
        err instanceof LucielApiError &&
        (err.code === 'validation_error' || err.code === 'conflict')
      ) {
        const field = fieldOfServerError(err.message);
        if (field) {
          setErrors({ [field]: err.message });
          return;
        }
        throw err;
      }
      throw new Error('We could not save those changes. The lead is unchanged — please try again.');
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Edit lead"
      description="Correct what Luciel captured. A changed email or phone is forwarded to your CRM as an update; a value that already belongs to another lead is refused rather than merged."
      confirmLabel="Save changes"
      confirmPendingLabel="Saving…"
      onConfirm={save}
    >
      <Field id="lead-edit-name" label="Name" error={errors.name}>
        {(props) => (
          <Input {...props} value={values.name} maxLength={NAME_MAX} onChange={set('name')} />
        )}
      </Field>
      <Field
        id="lead-edit-email"
        label="Email"
        error={errors.email}
        hint="Leave empty to clear it."
      >
        {(props) => (
          <Input
            {...props}
            type="email"
            value={values.email}
            maxLength={EMAIL_MAX}
            onChange={set('email')}
          />
        )}
      </Field>
      <Field
        id="lead-edit-phone"
        label="Phone"
        error={errors.phone}
        hint="International format with the country code, like +1 604 555 0100. Leave empty to clear it."
      >
        {(props) => (
          <Input
            {...props}
            type="tel"
            value={values.phone}
            maxLength={PHONE_MAX}
            onChange={set('phone')}
          />
        )}
      </Field>
    </Modal>
  );
}
