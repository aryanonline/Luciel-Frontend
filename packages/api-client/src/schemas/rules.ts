/**
 * Validation patterns shared by the control-plane schemas (classic zod) and the widget
 * data-plane schemas (zod/mini). This module imports nothing, so the widget bundle can use
 * a pattern without pulling in the classic API.
 */

/**
 * An ISO 8601 instant: a date, `T`, a time whose seconds are optional, then `Z` or a
 * numeric offset (`+05:30` or `+0530`). This is the pattern zod 3 built for
 * `.datetime({ offset: true })`, kept as it was: zod 4's `z.iso.datetime()` accepts
 * RFC 3339 only (seconds required, a colon in the offset), and the widget parses the
 * `at` of every reply it renders with it.
 */
export const ISO_INSTANT =
  /^((\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\d|3[01])|(0[469]|11)-(0[1-9]|[12]\d|30)|(02)-(0[1-9]|1\d|2[0-8])))T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|([+-]\d{2}:?\d{2}))$/;
