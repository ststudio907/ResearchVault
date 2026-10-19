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
  it('renders citekey, numeric locator as p., stance, and the anchor', () => {
    const out = renderEvidenceBlock(makeBlock({ locator: '42' }));
    expect(out).toContain('### [[smith_2023_test]]');
    expect(out).toContain('> Attention is all you need.');
    expect(out).toContain('-- source: [[smith_2023_test]] · p. 42 · supports <!-- ev:ev-1 -->');
  });

  it('writes non-numeric locators verbatim and omits missing ones', () => {
    const section = renderEvidenceBlock(makeBlock({ locator: '§3.2' }));
    expect(section).toContain('· §3.2 · supports');
    expect(renderEvidenceBlock(makeBlock())).not.toContain('p. ');
    expect(renderEvidenceBlock(makeBlock()).split('·')).toHaveLength(2); // stance only
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
    const body = `## Evidence\n\n${blocks.map(renderEvidenceBlock).join('\n')}\n`;
    const parsed = parseEvidenceBlocks(body);
    expect(parsed).toHaveLength(3);
    expect(parsed.map((b) => b.id)).toEqual(['ev-a', 'ev-b', 'ev-c']);
    expect(parsed[0]).toMatchObject({ citekey: 'smith_2023_test', locator: '42', stance: 'supports', text: 'Attention is all you need.' });
    expect(parsed[1]).toMatchObject({ citekey: 'jones_2020_x', locator: '§4', stance: 'contradicts' });
    expect(parsed[2]).toMatchObject({ stance: 'neutral' });
    expect(parsed[2]?.locator).toBeUndefined();
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



