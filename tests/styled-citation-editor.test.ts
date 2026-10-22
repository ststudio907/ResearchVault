// tests/styled-citation-editor.test.ts
//
// C3.2 — the pure decoration planner for the live-preview extension. The
// CM6 plumbing (ViewPlugin/widget) needs a real editor; the contract that
// matters here — which ranges get replaced, and which stay raw — is pure.

import { describe, expect, it } from 'vitest';
import { planCitationDecorations } from '../src/ui/styled-citation-editor';

const DOC = 'As @smith2020 shows, and [@jones2019; @lee2001] confirms.\n\nMore [@smith2020] text.';

const styled = new Map<number, string>([
  [3, 'Smith & Jones (2020)'],
  [25, '(Jones, 2019; Lee, 2001)'],
  [64, "(Smith & Jones, 2020)"],
]);

describe('planCitationDecorations', () => {
  it('plans a replace decoration per resolved citation, in order', () => {
    const ranges = planCitationDecorations(DOC, styled, -1, -1);
    expect(ranges.map((r) => r.styled)).toEqual([
      'Smith & Jones (2020)',
      '(Jones, 2019; Lee, 2001)',
      '(Smith & Jones, 2020)',
    ]);
    expect(ranges.map((r) => DOC.slice(r.from, r.to))).toEqual([
      '@smith2020',
      '[@jones2019; @lee2001]',
      '[@smith2020]',
    ]);
  });

  it('extracts every key of a group, and the single key of a narrative form', () => {
    const ranges = planCitationDecorations(DOC, styled, -1, -1);
    expect(ranges.map((r) => r.keys)).toEqual([
      ['smith2020'],
      ['jones2019', 'lee2001'],
      ['smith2020'],
    ]);
  });

  it('keeps the marker raw when the cursor/selection overlaps it', () => {
    const overlapping = planCitationDecorations(DOC, styled, 27, 29);
    expect(overlapping.map((r) => r.styled)).toEqual([
      'Smith & Jones (2020)',
      '(Smith & Jones, 2020)',
    ]);
  });

  it('keeps the marker raw when no styled string is known yet', () => {
    const partial = new Map<number, string>([[3, 'Smith & Jones (2020)']]);
    const ranges = planCitationDecorations(DOC, partial, -1, -1);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.styled).toBe('Smith & Jones (2020)');
  });

  it('returns nothing for a document without citations', () => {
    expect(planCitationDecorations('No citations here.', styled, -1, -1)).toEqual([]);
  });
});
