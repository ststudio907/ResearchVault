// tests/format-date.test.ts
//
// Date helpers sit on the frontmatter boundary: a regression here silently
// corrupts `dateAdded`/`dateRead` on persist. Tests use `new Date(y, m, d)`
// (local components) so expectations hold in any CI timezone.

import { describe, expect, it } from 'vitest';
import {
  formatPaperDate,
  fromFrontmatterDate,
  toIsoDateTime,
  toLocalDateTime,
} from '../src/utils/format-date';

describe('formatPaperDate', () => {
  it('formats an ISO string as "Mon D, YYYY"', () => {
    expect(formatPaperDate('2026-07-11T14:30:00')).toBe('Jul 11, 2026');
  });

  it('appends the time only when asked', () => {
    const d = new Date(2026, 6, 11, 14, 30);
    expect(formatPaperDate(d)).toBe('Jul 11, 2026');
    expect(formatPaperDate(d, { withTime: true })).toBe('Jul 11, 2026, 14:30');
  });

  it('returns "" for nullish and unparseable input', () => {
    expect(formatPaperDate(undefined)).toBe('');
    expect(formatPaperDate(null)).toBe('');
    expect(formatPaperDate('')).toBe('');
    expect(formatPaperDate('not a date')).toBe('');
    expect(formatPaperDate(Number.NaN)).toBe('');
    expect(formatPaperDate(new Date('invalid'))).toBe('');
  });

  it('zero-pads hours and minutes in withTime mode', () => {
    expect(formatPaperDate(new Date(2026, 0, 5, 8, 5), { withTime: true })).toBe('Jan 5, 2026, 08:05');
  });
});

describe('toLocalDateTime', () => {
  it('emits the canonical "YYYY-MM-DD | HH:MM" frontmatter string', () => {
    expect(toLocalDateTime(new Date(2026, 6, 11, 16, 57))).toBe('2026-07-11 | 16:57');
  });

  it('zero-pads every component', () => {
    expect(toLocalDateTime(new Date(2026, 0, 5, 8, 5))).toBe('2026-01-05 | 08:05');
  });

  it('returns "" for unparseable input so YAML omits the field', () => {
    expect(toLocalDateTime(undefined)).toBe('');
    expect(toLocalDateTime('garbage')).toBe('');
  });
});

describe('toIsoDateTime', () => {
  it('emits the legacy UTC-ish ISO string', () => {
    const d = new Date(2026, 6, 11, 0, 0);
    expect(toIsoDateTime(d)).toBe(d.toISOString());
  });
});

describe('fromFrontmatterDate', () => {
  it('returns the fallback for junk input', () => {
    expect(fromFrontmatterDate('garbage', 42)).toBe(42);
    expect(fromFrontmatterDate(undefined, 42)).toBe(42);
    expect(fromFrontmatterDate(null, 42)).toBe(42);
    expect(fromFrontmatterDate({}, 42)).toBe(42);
  });

  it('round-trips the local-tz frontmatter format', () => {
    const d = new Date(2026, 6, 11, 16, 55);
    expect(fromFrontmatterDate('2026-07-11 | 16:55', 0)).toBe(d.getTime());
  });

  it('accepts legacy epoch-ms numbers', () => {
    expect(fromFrontmatterDate(1_700_000_000_000, 0)).toBe(1_700_000_000_000);
  });
});
