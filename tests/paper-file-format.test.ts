// tests/paper-file-format.test.ts
//
// Unit tests for the pure serialization helpers extracted from
// `paper-service.ts` in the 2026-10 cleanup. The frontmatter ⇄ `Paper`
// round-trip is the highest-risk surface in the plugin (a silent coercion
// bug corrupts user notes on the next persist), so it gets the most
// coverage.
//
// `frontmatterToPaper` takes an Obsidian `TFile`; the helpers only touch
// `basename` / `parent.path` / `stat.{ctime,mtime}`, so we stub just those.

import { describe, expect, it } from 'vitest';
import type { TFile } from 'obsidian';
import type { Paper, Quote } from '../src/types';
import {
  DEFAULT_PAPER_TEMPLATE,
  frontmatterToPaper,
  normaliseAuthorName,
  renderQuoteSection,
  templateDataFor,
  toFrontmatter,
  trimOrUndefined,
  upsertAttachedPdfSection,
} from '../src/services/papers/paper-file-format';

function makeTFile(overrides: { basename?: string; papersFolder?: string; ctime?: number; mtime?: number } = {}): TFile {
  return {
    basename: overrides.basename ?? 'smith_2023_test',
    parent: { path: overrides.papersFolder ?? 'proj/papers' },
    stat: {
      ctime: overrides.ctime ?? new Date(2023, 5, 15, 10, 0).getTime(),
      mtime: overrides.mtime ?? new Date(2024, 0, 20, 12, 30).getTime(),
    },
    // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- structural stub for pure helpers; there is no real vault in unit tests
  } as unknown as TFile;
}

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: 'p-1',
    citekey: 'smith_2023_test',
    title: 'Attention Is All You Test',
    authors: ['Smith', 'Jones'],
    year: 2023,
    keywords: ['transformers', 'testing'],
    status: 'reading',
    priority: 'normal',
    dateAdded: new Date(2023, 5, 15, 10, 0).getTime(),
    dateModified: new Date(2024, 0, 20, 12, 30).getTime(),
    quotes: [],
    claims: [],
    citations: [],
    citedBy: [],
    related: [],
    customFields: {},
    source: 'manual',
    ...overrides,
  };
}

describe('normaliseAuthorName / trimOrUndefined', () => {
  it('trims whitespace', () => {
    expect(normaliseAuthorName('  Smith  ')).toBe('Smith');
  });

  it('trimOrUndefined maps empty strings to undefined', () => {
    expect(trimOrUndefined('   ')).toBeUndefined();
    expect(trimOrUndefined(undefined)).toBeUndefined();
    expect(trimOrUndefined(null)).toBeUndefined();
    expect(trimOrUndefined('  x ')).toBe('x');
  });
});

describe('toFrontmatter', () => {
  it('converts dateAdded from epoch ms to a local-tz frontmatter string', () => {
    const fm = toFrontmatter(makePaper({ dateAdded: new Date(2023, 5, 15, 10, 0).getTime() }));
    expect(fm.dateAdded).toBe('2023-06-15 | 10:00');
  });

  it('never writes dateModified (derived from file mtime per D24 amendment)', () => {
    const fm = toFrontmatter(makePaper());
    expect(fm.dateModified).toBeUndefined();
  });

  it('omits dateRead when the paper was not read', () => {
    expect(toFrontmatter(makePaper()).dateRead).toBeUndefined();
  });

  it('writes dateRead as a local-tz string when set', () => {
    const fm = toFrontmatter(makePaper({ dateRead: new Date(2024, 2, 1, 9, 5).getTime() }));
    expect(fm.dateRead).toBe('2024-03-01 | 09:05');
describe('frontmatterToPaper', () => {
  const fm = {
    citekey: 'vaswani_2017_attention',
    title: 'Attention Is All You Need',
    authors: ['Vaswani', 'Shazeer'],
    authorFirstNames: ['Ashish', 'Noam'],
    year: 2017,
    status: 'reading',
    priority: 'high',
    keywords: ['transformers'],
    source: 'doi',
  };

  it('reads the modern frontmatter shape', () => {
    const paper = frontmatterToPaper(fm, 'proj-1', makeTFile());
    expect(paper.citekey).toBe('vaswani_2017_attention');
    expect(paper.id).toBe('vaswani_2017_attention');
    expect(paper.authors).toEqual(['Vaswani', 'Shazeer']);
    expect(paper.authorFirstNames).toEqual(['Ashish', 'Noam']);
    expect(paper.status).toBe('reading');
    expect(paper.priority).toBe('high');
    expect(paper.keywords).toEqual(['transformers']);
    expect(paper.source).toBe('doi');
  });

  it('stamps projectId and papersFolder into customFields', () => {
    const paper = frontmatterToPaper(fm, 'proj-1', makeTFile({ papersFolder: 'a/b/papers' }));
    expect(paper.customFields.projectId).toBe('proj-1');
    expect(paper.customFields.papersFolder).toBe('a/b/papers');
  });

  it('falls back to the file when frontmatter is missing', () => {
    const file = makeTFile({ basename: 'orphan_note', ctime: new Date(2020, 0, 1).getTime() });
    const paper = frontmatterToPaper({}, 'proj-1', file);
    expect(paper.citekey).toBe('orphan_note');
    expect(paper.title).toBe('orphan_note');
    expect(paper.year).toBe(2020);
    expect(paper.status).toBe('unread');
    expect(paper.priority).toBe('normal');
    expect(paper.source).toBe('manual');
    expect(paper.dateAdded).toBe(file.stat.ctime);
  });

  it('derives dateModified from file mtime and ignores any legacy disk value', () => {
    const file = makeTFile({ mtime: 123_456_789 });
    const paper = frontmatterToPaper({ ...fm, dateModified: '1999-01-01' }, 'proj-1', file);
    expect(paper.dateModified).toBe(123_456_789);
  });

  it('reads legacy author objects into the parallel-array shape', () => {
    const legacy = {
      citekey: 'k',
      authors: [
        { firstName: 'Terry', lastName: 'McGlynn' },
        { firstName: '', lastName: 'Smith' },
      ],
    };
    const paper = frontmatterToPaper(legacy, 'proj-1', makeTFile());
    expect(paper.authors).toEqual(['McGlynn', 'Smith']);
    expect(paper.authorFirstNames).toEqual(['Terry', '']);
  });

  it('leaves authorFirstNames undefined when the legacy rows have no first names', () => {
    const paper = frontmatterToPaper(
      { citekey: 'k', authors: [{ lastName: 'Solo' }] },
      'proj-1',
      makeTFile(),
    );
    expect(paper.authorFirstNames).toBeUndefined();
  });

  it('coerces non-scalar YAML author rows to a sane string[]', () => {
    const paper = frontmatterToPaper(
      { citekey: 'k', authors: ['Smith', 42 as unknown as string, true as unknown as string] },
      'proj-1',
      makeTFile(),
    );
    expect(paper.authors).toEqual(['Smith', '42', 'true']);
  });

  it('migrates legacy status and priority labels', () => {
    const base = { citekey: 'k' };
    expect(frontmatterToPaper({ ...base, status: 'queued' as never }, 'o', makeTFile()).status).toBe('unread');
    expect(frontmatterToPaper({ ...base, status: 'summarized' as never }, 'o', makeTFile()).status).toBe('annotating');
    expect(frontmatterToPaper({ ...base, status: 'bogus' as never }, 'o', makeTFile()).status).toBe('unread');
    expect(frontmatterToPaper({ ...base, priority: 'medium' as never }, 'o', makeTFile()).priority).toBe('normal');
    expect(frontmatterToPaper({ ...base, priority: 'critical' as never }, 'o', makeTFile()).priority).toBe('normal');
  });

  it('leaves dateRead undefined for unparseable values (no 1970 pinning)', () => {
    const paper = frontmatterToPaper({ citekey: 'k', dateRead: 'not a date' }, 'o', makeTFile());
    expect(paper.dateRead).toBeUndefined();
  });

  it('parses a valid dateRead', () => {
    const paper = frontmatterToPaper({ citekey: 'k', dateRead: '2024-03-01 | 09:05' }, 'o', makeTFile());
    expect(paper.dateRead).toBe(new Date(2024, 2, 1, 9, 5).getTime());
  });
});

  });
});

describe('frontmatter round-trip', () => {
  it('preserves the round-trippable fields', () => {
    const original = makePaper({
      authorFirstNames: ['J.', 'K.'],
      venue: 'ICML',
      doi: '10.1/test',
      oaUrl: 'https://example.org/oa.pdf',
      pdfPath: 'proj/pdfs/paper.pdf',
      abstract: 'An abstract.',
      rating: 4,
      dateRead: new Date(2024, 2, 1, 9, 5).getTime(),
      customFields: { note: 'user data', projectId: 'old', papersFolder: 'old' },
    });
    const fm = toFrontmatter(original);
    const file = makeTFile({ mtime: original.dateModified });
    const restored = frontmatterToPaper(fm, 'proj-new', file);

    expect(restored.id).toBe(original.id);
    expect(restored.citekey).toBe(original.citekey);
    expect(restored.title).toBe(original.title);
    expect(restored.authors).toEqual(original.authors);
    expect(restored.authorFirstNames).toEqual(original.authorFirstNames);
    expect(restored.year).toBe(original.year);
    expect(restored.venue).toBe(original.venue);
    expect(restored.doi).toBe(original.doi);
    expect(restored.oaUrl).toBe(original.oaUrl);
    expect(restored.pdfPath).toBe(original.pdfPath);
    expect(restored.abstract).toBe(original.abstract);
    expect(restored.keywords).toEqual(original.keywords);
    expect(restored.status).toBe(original.status);
    expect(restored.priority).toBe(original.priority);
    expect(restored.rating).toBe(original.rating);
    expect(restored.dateAdded).toBe(original.dateAdded);
    expect(restored.dateModified).toBe(original.dateModified);
    expect(restored.dateRead).toBe(original.dateRead);
    expect(restored.source).toBe(original.source);
    // User custom fields survive; the project-sync keys are re-stamped.
    expect(restored.customFields.note).toBe('user data');
    expect(restored.customFields.projectId).toBe('proj-new');
    expect(restored.customFields.papersFolder).toBe('proj/papers');
  });
});

describe('templateDataFor', () => {
  it('joins "<first> <last>" when first names exist', () => {
    const data = templateDataFor(makePaper({ authorFirstNames: ['Jane', 'Bob'] }));
    expect(data.authors).toBe('Jane Smith, Bob Jones');
  });

  it('falls back to last names only', () => {
    const data = templateDataFor(makePaper());
    expect(data.authors).toBe('Smith, Jones');
  });

  it('renders empty strings for missing optional fields', () => {
    const data = templateDataFor(makePaper());
    expect(data.venue).toBe('');
    expect(data.doi).toBe('');
    expect(data.abstract).toBe('');
  });

  it('stringifies keywords and year', () => {
    const data = templateDataFor(makePaper());
    expect(data.keywords).toBe('transformers, testing');
    expect(data.year).toBe(2023);
  });

  it('DEFAULT_PAPER_TEMPLATE placeholders are all provided by templateDataFor', () => {
    const keys = [...DEFAULT_PAPER_TEMPLATE.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
    const data = templateDataFor(makePaper());
    for (const key of keys) {
      expect(data).toHaveProperty(key ?? '');
    }
  });
});
describe('upsertAttachedPdfSection', () => {
  it('inserts the section into an empty body', () => {
    expect(upsertAttachedPdfSection('', 'proj/pdfs/a.pdf')).toBe(
      '## Attached PDF\n\n[[proj/pdfs/a.pdf|View PDF]]\n',
    );
  });

  it('appends the section after existing content', () => {
    const out = upsertAttachedPdfSection('# Title\n\nSome notes.\n', 'proj/pdfs/a.pdf');
    expect(out).toBe('# Title\n\nSome notes.\n\n## Attached PDF\n\n[[proj/pdfs/a.pdf|View PDF]]\n');
  });

  it('is a no-op when there is nothing to remove', () => {
    expect(upsertAttachedPdfSection('# Title\n', undefined)).toBe('# Title\n');
  });

  // NOTE: the replace/removal paths preserve the original body's trailing
  // newline (`split('\n')` round-trip). The extra whitespace is harmless in
  // markdown; these expectations pin the current behavior.

  it('replaces stale section content, keeping the following section', () => {
    const body = '# Title\n\n## Attached PDF\n\n[[old.pdf|View PDF]]\n\n## Notes\n\nSomething.\n';
    const out = upsertAttachedPdfSection(body, 'proj/pdfs/new.pdf');
    expect(out).toBe(
      '# Title\n\n## Attached PDF\n\n[[proj/pdfs/new.pdf|View PDF]]\n\n## Notes\n\nSomething.\n\n',
    );
  });

  it('removes the section cleanly when pdfPath is undefined', () => {
    const body = '# Title\n\n## Attached PDF\n\n[[old.pdf|View PDF]]\n\n## Notes\n\nSomething.\n';
    const out = upsertAttachedPdfSection(body, undefined);
    expect(out).toBe('# Title\n\n## Notes\n\nSomething.\n');
  });

  it('removes a trailing section entirely', () => {
    const body = '# Title\n\n## Attached PDF\n\n[[old.pdf|View PDF]]\n';
    expect(upsertAttachedPdfSection(body, undefined)).toBe('# Title\n\n');
  });

  it('handles a body that contains *only* the PDF section', () => {
    const body = '## Attached PDF\n\n[[old.pdf|View PDF]]\n';
    expect(upsertAttachedPdfSection(body, 'p.pdf')).toBe('## Attached PDF\n\n[[p.pdf|View PDF]]\n');
    expect(upsertAttachedPdfSection(body, undefined)).toBe('');
  });
});

describe('renderQuoteSection', () => {
  const base = {
    id: 'q-1',
    text: 'Line one.\nLine two.',
    tags: ['#tag1', '#tag2'],
    source: 'selection',
  } as Quote;

  it('prefixes every text line with "> "', () => {
    const out = renderQuoteSection(base);
    expect(out.startsWith('> Line one.\n> Line two.')).toBe(true);
  });

  it('includes page and section in the meta line', () => {
    const out = renderQuoteSection({ ...base, page: 42, section: 'Intro' });
    expect(out).toContain('-- p. 42 \u00B7 Intro');
  });

  it('renders tags and source lines', () => {
    const out = renderQuoteSection(base);
    expect(out).toContain('#tags: #tag1 #tag2');
    expect(out).toContain('-- source: selection');
  });

  it('omits the meta line when neither page nor section is set', () => {
    const out = renderQuoteSection(base);
    expect(out).not.toContain('-- p.');
    expect(out).not.toContain('\u00B7');
  });
});

