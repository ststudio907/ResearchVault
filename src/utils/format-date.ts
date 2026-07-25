// src/utils/format-date.ts
//
// Human-readable date formatting for paper frontmatter and the sidebar.
//
// Frontmatter round-trips ISO date+time strings (e.g. `2026-07-11T14:30:00`)
// so the on-disk format is stable, sortable, and unambiguous across
// timezones. The UI calls `formatPaperDate` when it needs a friendly
// display string. Per `D24` \u2014 we never display the raw ISO string to the
// user.

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Format an ISO date+time string (e.g. `2026-07-11T14:30:00`) for display.
 *
 *  - `formatPaperDate('2026-07-11T14:30:00')`                    -> `"Jul 11, 2026"`
 *  - `formatPaperDate('2026-07-11T14:30:00', { withTime: true })` -> `"Jul 11, 2026, 14:30"`
 *  - `formatPaperDate(undefined)`                                 -> `""` (graceful)
 *
 * Accepts a `Date` or epoch ms as well so callers can pass either form.
 * The output is in the user's *local* timezone (Date does this for us).
 */
export function formatPaperDate(
  input: string | number | Date | null | undefined,
  options: { withTime?: boolean } = {},
): string {
  const date = toDate(input);
  if (!date) return '';
  const month = MONTHS[date.getMonth()] ?? '';
  const day = date.getDate();
  const year = date.getFullYear();
  const base = `${month} ${day}, ${year}`;
  if (!options.withTime) return base;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${base}, ${hh}:${mm}`;
}

/** Convert a string / number / Date / null / undefined into a `Date` (or `null` if unparseable). */
function toDate(input: string | number | Date | null | undefined): Date | null {
  if (input == null) return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  if (typeof input === 'number') {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // String path. Empty string -> null. Otherwise let `Date` parse it.
  // (If TS still complains about the `string` cast later, ignore — the union
  // narrows to `string` here so it's harmless.)
  if (typeof input !== 'string' || input.trim() === '') return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Convert a `Date` (or epoch ms, or ISO string) to the canonical ISO
 * date+time string we write to frontmatter. Returns `''` for unparseable
 * input so the YAML serializer omits the field cleanly.
 *
 * Kept as the original UTC-with-ms emitter for legacy compatibility — any
 * reader will round-trip it via `Date.parse`. New writes go through
 * `toLocalDateTime` (2.8.C).
 */
export function toIsoDateTime(input: string | number | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return '';
  return d.toISOString();
}

/**
 * 2.8.C — local-tz frontmatter writer.
 *
 * Emits `YYYY-MM-DD | HH:MM` in the user's *local* timezone (no seconds,
 * no millis, no trailing `Z`). This replaces the `toIsoDateTime` UTC writer
 * at the YAML boundary so the user sees "year-month-day | time of day"
 * instead of an opaque ISO-with-ms-and-Z string.
 *
 * Round-trip safety: `Date.parse('2026-07-11 | 16:57')` parses correctly in
 * every evergreen browser / Node, and existing paper notes that already
 * carry the old format keep their data on next write.
 */
export function toLocalDateTime(input: string | number | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} | ${hh}:${mi}`;
}

/**
 * Coerce a frontmatter value (string | number | Date | null | undefined)
 * to an epoch ms number. Used by `PaperService` when reading papers back
 * from disk so the in-memory `Paper` keeps a single canonical `number`
 * shape (per `D24`).
 */
export function fromFrontmatterDate(input: unknown, fallback: number): number {
  const d = toDate(coerce(input));
  return d ? d.getTime() : fallback;
}

function coerce(input: unknown): string | number | Date | null | undefined {
  if (input == null) return null;
  if (input instanceof Date) return input;
  if (typeof input === 'number' || typeof input === 'string') return input;
  return null;
}
