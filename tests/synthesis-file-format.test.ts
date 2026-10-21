// tests/synthesis-file-format.test.ts
//
// Pure round-trip tests for the synthesis-note serialization (1.1 Slice 1):
// evidence-block rendering (source citekey + locator + stance + invisible
// `<!-- ev:id -->` anchor), section upserts, and the frontmatter round-trip.

import { describe, expect, it } from 'vitest';
import type { EvidenceBlock, SynthesisNote } from '../src/types';
import {
  frontmatterToSynthesis,
  renderEvidenceBlock,
  renderEvidenceSectionContent,
  renderSynthesisBody,
  toSynthesisFrontmatter,
  upsertEvidenceSection,
  upsertOpenQuestionsSection,
  parseEvidenceBlocks,
  parseOpenQuestions,
  extractThesis,
} from '../src/services/synthesis/synthesis-file-format';
import { joinFrontmatter, splitFrontmatter } from '../src/utils/frontmatter';

function makeBlock(overrides: Partial<EvidenceBlock> = {}): EvidenceBlock {
  return {
    id: 'ev-1',
    citekey: 'smith_2023_test',
    text: 'Attention is all you need.',
    stance: 'supports',
    createdAt: 1,
    ...overrides,
  };
}

describe('renderEvidenceBlock', () => {
  it('renders citekey, numeric locator as p., and the bare anchor', () => {
    const out = renderEvidenceBlock(makeBlock({ locator: '42' }));
    expect(out).toContain('#### [[smith_2023_test]] · p. 42');
    expect(out).toContain('> Attention is all you need.');
    expect(out.trimEnd().endsWith('<!-- ev:ev-1 -->')).toBe(true);
    // Footer is machine-only: no source link, no stance (group header carries it).
    expect(out).not.toContain('-- source:');
    expect(out).not.toContain('· supports');
  });

  it('writes non-numeric locators verbatim and omits missing ones', () => {
    const section = renderEvidenceBlock(makeBlock({ locator: '§3.2' }));
    expect(section).toContain('#### [[smith_2023_test]] · §3.2');
    expect(renderEvidenceBlock(makeBlock())).not.toContain('p. ');
    // No locator → no `·` anywhere: heading and footer are both plain.
    expect(renderEvidenceBlock(makeBlock()).split('·')).toHaveLength(1);
  });

  it('block-quotes multi-line text', () => {
    const out = renderEvidenceBlock(makeBlock({ text: 'line one\nline two' }));
    expect(out).toContain('> line one\n> line two');
  });
});

describe('parseEvidenceBlocks (render → parse round-trip)', () => {
  it('recovers id, citekey, text, locator, and stance for all three stances', () => {
    const blocks = [
      makeBlock({ id: 'ev-a', stance: 'supports', locator: '42' }),
      makeBlock({ id: 'ev-b', stance: 'contradicts', citekey: 'jones_2020_x', locator: '§4' }),
      makeBlock({ id: 'ev-c', stance: 'neutral', locator: undefined }),
    ];
    // Render through the grouped section: stance lives in the ### headers now.
    const body = `## Evidence\n\n${renderEvidenceSectionContent(blocks)}\n`;
    const parsed = parseEvidenceBlocks(body);
    expect(parsed).toHaveLength(3);
    expect(parsed.map((b) => b.id)).toEqual(['ev-a', 'ev-b', 'ev-c']);
    expect(parsed[0]).toMatchObject({ citekey: 'smith_2023_test', locator: '42', stance: 'supports', text: 'Attention is all you need.' });
    expect(parsed[1]).toMatchObject({ citekey: 'jones_2020_x', locator: '§4', stance: 'contradicts' });
    expect(parsed[2]).toMatchObject({ stance: 'neutral' });
    expect(parsed[2]?.locator).toBeUndefined();
  });

  it('takes stance from the group header for anchor-only blocks', () => {
    const body = [
      '## Evidence',
      '',
      '### Contradicts',
      '',
      '#### [[smith_2023_test]] · p. 42',
      '',
      '> text',
      '',
      '<!-- ev:ev-1 -->',
      '',
    ].join('\n');
    expect(parseEvidenceBlocks(body)[0]).toMatchObject({
      id: 'ev-1',
      citekey: 'smith_2023_test',
      locator: '42',
      stance: 'contradicts',
      text: 'text',
    });
  });

  it('defaults an anchor outside any group header to neutral (hand-moved anchors survive)', () => {
    const body = [
      '## Evidence',
      '',
      '#### [[smith_2023_test]]',
      '',
      '> text',
      '',
      '<!-- ev:ev-1 -->',
      '',
    ].join('\n');
    expect(parseEvidenceBlocks(body)[0]?.stance).toBe('neutral');
  });

  it('skips anchor-only blocks with no heading above (citekey unrecoverable)', () => {
    const body = [
      '## Evidence',
      '',
      '### Supports',
      '',
      '> floating quote',
      '',
      '<!-- ev:ev-1 -->',
      '',
    ].join('\n');
    expect(parseEvidenceBlocks(body)).toHaveLength(0);
  });

  it('ignores anchor-less footers instead of fabricating ids', () => {
    const body = [
      '## Evidence',
      '',
      '### [[someone_manual]]',
      '',
      '> hand written',
      '',
      '-- source: [[someone_manual]] · supports',
      '',
    ].join('\n');
    expect(parseEvidenceBlocks(body)).toHaveLength(0);
  });
});

describe('grouped evidence layout (2b format revision)', () => {
  it('groups entries under ### stance headers, entries as ####, skipping empty stances', () => {
    const blocks = [
      makeBlock({ id: 'ev-a', stance: 'contradicts', citekey: 'jones_2020_x' }),
      makeBlock({ id: 'ev-b', stance: 'supports' }),
    ];
    const content = renderEvidenceSectionContent(blocks);
    expect(content).toContain('### Supports');
    expect(content).toContain('### Contradicts');
    expect(content).not.toContain('### Neutral');
    expect(content).toContain('#### [[smith_2023_test]]');
    expect(content).toContain('#### [[jones_2020_x]]');
    // Fixed group order regardless of array order (matches the hub card).
    expect(content.indexOf('### Supports')).toBeLessThan(content.indexOf('### Contradicts'));
    // Entries follow group order: supports group (smith) before contradicts (jones).
    expect(content.indexOf('#### [[smith_2023_test]]')).toBeLessThan(content.indexOf('#### [[jones_2020_x]]'));
  });

  it('renders nothing for an empty evidence list', () => {
    expect(renderEvidenceSectionContent([])).toBe('');
  });

  it('round-trips the grouped layout and is idempotent under re-render', () => {
    const blocks = [
      makeBlock({ id: 'ev-a', stance: 'supports', locator: '42' }),
      makeBlock({ id: 'ev-b', stance: 'neutral', citekey: 'jones_2020_x' }),
      makeBlock({ id: 'ev-c', stance: 'supports', citekey: 'kay_2021' }),
    ];
    const body = `## Evidence\n\n${renderEvidenceSectionContent(blocks)}\n`;
    const parsed = parseEvidenceBlocks(body);
    // File order is grouped order: supports first (ev-a, ev-c), then neutral.
    expect(parsed.map((b) => b.id)).toEqual(['ev-a', 'ev-c', 'ev-b']);
    // Re-rendering from the parsed index reproduces the section byte-for-byte.
    const reRendered = upsertEvidenceSection(body, parsed);
    expect(reRendered).toBe(body);
    expect(parseEvidenceBlocks(reRendered).map((b) => b.id)).toEqual(['ev-a', 'ev-c', 'ev-b']);
  });

  it('still parses legacy flat blocks with ### entry headings (pre-grouping notes)', () => {
    const body = [
      '## Evidence',
      '',
      '### [[smith_2023_test]]',
      '',
      '> old note',
      '',
      '-- source: [[smith_2023_test]] · p. 3 · supports <!-- ev:ev-old -->',
      '',
    ].join('\n');
    const parsed = parseEvidenceBlocks(body);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      id: 'ev-old',
      citekey: 'smith_2023_test',
      // Legacy blocks carry the locator in the footer; the parser falls back.
      locator: '3',
      stance: 'supports',
      text: 'old note',
    });
  });

  it('prefers the heading locator when a legacy footer also carries one', () => {
    const body = [
      '## Evidence',
      '',
      '#### [[smith_2023_test]] · p. 42',
      '',
      '> text',
      '',
      '-- source: [[smith_2023_test]] · p. 99 · supports <!-- ev:ev-1 -->',
      '',
    ].join('\n');
    expect(parseEvidenceBlocks(body)[0]?.locator).toBe('42');
  });
});

describe('upsertEvidenceSection / upsertOpenQuestionsSection', () => {
  const base = `# Title\n\n## Thesis\n\nThe thesis.\n\n## Evidence\n\n## Open questions\n\n- one\n`;

  it('replaces the section content in place, preserving siblings', () => {
    const out = upsertEvidenceSection(base, [makeBlock(), makeBlock({ id: 'ev-2' })]);
    expect(out).toContain('## Thesis');
    expect(out).toContain('The thesis.');
    expect(out).toContain('## Open questions');
    expect(out).toContain('- one');
    expect(out.split('## Evidence')).toHaveLength(2);
    expect(out).toContain('<!-- ev:ev-1 -->');
    expect(out).toContain('<!-- ev:ev-2 -->');
  });

  it('empties the section when the evidence list is empty', () => {
    const populated = upsertEvidenceSection(base, [makeBlock()]);
    const emptied = upsertEvidenceSection(populated, []);
    expect(emptied).not.toContain('<!-- ev:ev-1 -->');
    expect(emptied.split('## Evidence')).toHaveLength(2);
  });

  it('appends the section when the heading is missing', () => {
    const out = upsertEvidenceSection('# Title only\n', [makeBlock()]);
    expect(out).toContain('## Evidence');
    expect(out).toContain('<!-- ev:ev-1 -->');
  });

  it('upserts open questions', () => {
    const out = upsertOpenQuestionsSection(base, ['why?', 'how?']);
    expect(out).toContain('- why?');
    expect(out).toContain('- how?');
    expect(parseOpenQuestions(out)).toEqual(['why?', 'how?']);
  });
});

describe('full-note round-trip', () => {
  it('renderSynthesisBody produces the skeleton; frontmatter round-trips', () => {
    const note: SynthesisNote = {
      id: 'syn-1',
      projectId: 'p-1',
      title: 'Scaling laws hold',
      thesis: 'Bigger models win.',
      evidence: [makeBlock({ locator: '42' })],
      openQuestions: ['what about data quality?'],
      path: 'proj/syntheses/scalinglawshold.md',
      dateAdded: new Date(2026, 9, 19, 10, 0).getTime(),
    };

    const content = joinFrontmatter(toSynthesisFrontmatter(note), renderSynthesisBody(note));
    expect(content).toContain('type: synthesis');
    expect(content).toContain('# Scaling laws hold');

    const { frontmatter, body } = splitFrontmatter(content);
    const back = frontmatterToSynthesis(frontmatter, body, note.path, 0);
    expect(back).not.toBeNull();
    expect(back?.id).toBe('syn-1');
    expect(back?.projectId).toBe('p-1');
    expect(back?.title).toBe('Scaling laws hold');
    expect(back?.thesis).toBe('Bigger models win.');
    expect(back?.openQuestions).toEqual(['what about data quality?']);
    expect(back?.evidence).toHaveLength(1);
    expect(back?.evidence[0]).toMatchObject({
      id: 'ev-1',
      citekey: 'smith_2023_test',
      locator: '42',
      stance: 'supports',
    });
    expect(back?.dateAdded).toBe(note.dateAdded);
  });

  it('returns null for files missing required frontmatter', () => {
    expect(frontmatterToSynthesis({ title: 'x' }, '', 'p.md', 0)).toBeNull();
    expect(frontmatterToSynthesis({ id: 'a', title: 'x' }, '', 'p.md', 0)).toBeNull();
  });

  it('extractThesis picks up the paragraph between headings', () => {
    expect(extractThesis('## Thesis\n\nMulti\nline.\n\n## Evidence\n')).toBe('Multi\nline.');
    expect(extractThesis('## Evidence\n')).toBe('');
  });
});

describe('empty-text evidence blocks (1.1 Slice 2b quick-add)', () => {
  it('renders a bare blockquote line that parses back to empty text', () => {
    const rendered = renderEvidenceBlock(makeBlock({ text: '' }));
    expect(rendered).toContain('> \n');
    // Parse inside a group header, as the section actually renders it —
    // anchor-only blocks take their stance from the enclosing header.
    const parsed = parseEvidenceBlocks(`### Supports\n\n${rendered}\n`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.text).toBe('');
    expect(parsed[0]?.citekey).toBe('smith_2023_test');
    expect(parsed[0]?.stance).toBe('supports');
  });
});

describe('hub flag round-trip (2a)', () => {
  const base: SynthesisNote = {
    id: 'syn-1',
    projectId: 'p-1',
    title: 'Project hub',
    evidence: [],
    openQuestions: [],
    path: 'proj/project.md',
    dateAdded: new Date(2026, 9, 19, 10, 0).getTime(),
    hub: true,
  };

  it('writes hub: true on hub notes and round-trips it', () => {
    const content = joinFrontmatter(toSynthesisFrontmatter(base), renderSynthesisBody(base));
    expect(content).toContain('hub: true');

    const { frontmatter, body } = splitFrontmatter(content);
    const back = frontmatterToSynthesis(frontmatter, body, base.path, 0);
    expect(back?.hub).toBe(true);
  });

  it('omits the key for ordinary notes and reads them back as hub: false', () => {
    const ordinary = { ...base, hub: undefined };
    const content = joinFrontmatter(toSynthesisFrontmatter(ordinary), renderSynthesisBody(ordinary));
    expect(content).not.toContain('hub:');

    const { frontmatter, body } = splitFrontmatter(content);
    const back = frontmatterToSynthesis(frontmatter, body, ordinary.path, 0);
    expect(back?.hub).toBe(false);
  });
});



