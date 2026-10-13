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

/** Canonical local-tz frontmatter shape written by `toLocalDateTime` (2.8.C). */
const LOCAL_TZ_RE = /^(\d{4})-(\d{2})-(\d{2}) \| (\d{2}):(\d{2})$/;

/** Convert a string / number / Date / null / undefined into a `Date` (or `null` if unparseable). */
function toDate(input: string | number | Date | null | undefined): Date | null {
  if (input == null) return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  if (typeof input === 'number') {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // String path. Empty string -> null.
  if (typeof input !== 'string' || input.trim() === '') return null;
  const trimmed = input.trim();
  // Explicitly handle our own canonical frontmatter format (`YYYY-MM-DD |
  // HH:MM`, written by `toLocalDateTime`). `Date.parse` does NOT reliably
  // parse the pipe-delimited form (NaN on modern V8 — caught by the Phase 5
  // tests), so relying on the generic parse would silently corrupt
  // `dateAdded` (falls back to file ctime) and drop `dateRead` on read.
  const localMatch = LOCAL_TZ_RE.exec(trimmed);
  if (localMatch) {
    const [, y, mo, d, h, mi] = localMatch;
    const parsed = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const d = new Date(trimmed);
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
 * Round-trip safety: the reader `toDate` parses this exact shape explicitly
 * (`LOCAL_TZ_RE`) — `Date.parse` silently returns NaN for the pipe form on
 * modern V8. Existing paper notes that already carry the old ISO format
 * keep their data on the next write.
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
