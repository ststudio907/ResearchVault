// tests/export-service.test.ts
//
// Unit coverage for the 1.1 "Cite & ship" export (D39/D40). Only the pure
// decision logic is exercised here — the pandoc spawn itself is the desktop
// boundary and is verified in the manual smoke (no child_process in tests).
// The vendored CSL bundle IS round-tripped: each entry must inflate to real
// CSL XML, or every built-in export would fail in the wild.

import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';

import {
  BUNDLED_CSL_STYLES,
  buildPandocArgs,
  execFileFromModule,
  findProjectForPath,
  isBundledStyle,
  pandocCandidates,
  showItemInFolderFromModule,
} from '../src/services/citation/export-service';
import { CSL_BUNDLED } from '../src/services/citation/csl-bundle.generated';
import type { Project } from '../src/types';

/** Base64 → bytes without the `Buffer` global (no-undef in test lint env). */
function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

describe('buildPandocArgs', () => {
  it('composes the docx invocation: citeproc + csl + bibliography + output', () => {
    const args = buildPandocArgs({
      noteAbsPath: '/vault/ML/notes/summary.md',
      bibliographyAbsPath: '/vault/ML/bibliography.bib',
      cslAbsPath: '/tmp/style.csl',
      format: 'docx',
      outputAbsPath: '/tmp/out.docx',
    });
    expect(args).toEqual([
      '/vault/ML/notes/summary.md',
      '--citeproc',
      '--csl=/tmp/style.csl',
      '--bibliography=/vault/ML/bibliography.bib',
      '--output',
      '/tmp/out.docx',
    ]);
    // No PDF-engine flag leaks into a docx run.
    expect(args.some((a) => a.startsWith('--pdf-engine'))).toBe(false);
  });

  it('adds the pdf engine only for pdf format, honoring a custom engine', () => {
    const base = {
      noteAbsPath: '/n.md',
      bibliographyAbsPath: null,
      cslAbsPath: '/s.csl',
      format: 'pdf' as const,
      outputAbsPath: '/o.pdf',
    };
    expect(buildPandocArgs(base)).toContain('--pdf-engine=pdflatex');
    expect(buildPandocArgs({ ...base, pdfEngine: 'xelatex' })).toContain('--pdf-engine=xelatex');
  });

  it('omits --bibliography entirely when no bibliography is available', () => {
    const args = buildPandocArgs({
      noteAbsPath: '/n.md',
      bibliographyAbsPath: null,
      cslAbsPath: '/s.csl',
      format: 'docx',
      outputAbsPath: '/o.docx',
    });
    expect(args.some((a) => a.startsWith('--bibliography='))).toBe(false);
  });
});

describe('findProjectForPath', () => {
  const projects = [
    { folderPath: 'ML Research' },
    { folderPath: 'ML Research/subproject' },
    { folderPath: 'History' },
  ] as unknown as Project[];

  it('matches the owning project by folder prefix, longest match wins', () => {
    expect(findProjectForPath(projects, 'History/paper.md')?.folderPath).toBe('History');
    expect(
      findProjectForPath(projects, 'ML Research/subproject/notes/deep.md')?.folderPath,
    ).toBe('ML Research/subproject');
    expect(findProjectForPath(projects, 'ML Research/notes/x.md')?.folderPath).toBe('ML Research');
  });

  it('is case-insensitive and refuses sibling-prefix collisions', () => {
    expect(findProjectForPath(projects, 'ml research/notes/x.md')?.folderPath).toBe('ML Research');
    // A folder named "ML Research-v2" must NOT match "ML Research".
    expect(findProjectForPath(projects, 'ML Research-v2/notes/x.md')).toBeNull();
  });

  it('returns null outside every project', () => {
    expect(findProjectForPath(projects, 'Unfiled/scratch.md')).toBeNull();
  });
});

describe('bundled CSL styles (D39 built-ins)', () => {
  it('covers exactly the five built-in styles', () => {
    expect([...BUNDLED_CSL_STYLES].sort()).toEqual(['apa', 'chicago', 'harvard', 'ieee', 'mla']);
    expect(isBundledStyle('apa')).toBe(true);
    expect(isBundledStyle('custom')).toBe(false);
  });

  it('every entry inflates to a real CSL style document', () => {
    for (const [style, b64] of Object.entries(CSL_BUNDLED)) {
      const xml = new TextDecoder().decode(gunzipSync(decodeBase64(b64)));
      expect(xml.startsWith('<?xml'), `${style} should be XML`).toBe(true);
      expect(xml).toContain('<style');
      expect(xml).toContain('http://purl.org/net/xbiblio/csl');
      // Minified but not empty: the largest style is ~100 KB, the smallest >5 KB.
      expect(xml.length).toBeGreaterThan(5000);
    }
  });

  it('is genuinely compressed — the bundle stays inside the size budget', () => {
    const totalB64 = Object.values(CSL_BUNDLED).reduce((sum, v) => sum + v.length, 0);
    // Guard against accidental vendoring of raw XML (~300 KB uncompressed).
    expect(totalB64).toBeLessThan(60_000);
  });
});

describe('execFileFromModule', () => {
  it('destructures execFile off the child_process module object', () => {
    // The lazy node boundary returns whole modules — the shipped bug was
    // calling the module object itself ("…n is not a function" at runtime).
    const fakeModule = { execFile: (_f: string, _a: string[], _o: unknown, cb: () => void) => cb() };
    expect(typeof execFileFromModule(fakeModule)).toBe('function');
  });

  it('refuses an object without an execFile function', () => {
    expect(() => execFileFromModule({})).toThrow(/execFile/);
  });
});

describe('pandocCandidates', () => {
  it('falls back to Homebrew prefixes for bare names (GUI apps inherit a minimal PATH)', () => {
    expect(pandocCandidates(undefined)).toEqual([
      'pandoc',
      '/opt/homebrew/bin/pandoc',
      '/usr/local/bin/pandoc',
    ]);
    expect(pandocCandidates('pandoc-3.12')).toEqual([
      'pandoc-3.12',
      '/opt/homebrew/bin/pandoc-3.12',
      '/usr/local/bin/pandoc-3.12',
    ]);
  });

  it('uses an explicit path as-is with no fallbacks', () => {
    expect(pandocCandidates('/opt/homebrew/bin/pandoc')).toEqual(['/opt/homebrew/bin/pandoc']);
    expect(pandocCandidates('~/bin/pandoc')).toEqual(['~/bin/pandoc']);
  });

  it('skips fallbacks on Windows, which resolves bare names itself', () => {
    expect(pandocCandidates('pandoc', true)).toEqual(['pandoc']);
    expect(pandocCandidates('C:\\tools\\pandoc.exe', true)).toEqual(['C:\\tools\\pandoc.exe']);
  });
});

describe('showItemInFolderFromModule', () => {
  it('reaches shell.showItemInFolder on the electron module object', () => {
    const revealed: string[] = [];
    const fakeElectron = { shell: { showItemInFolder: (p: string) => revealed.push(p) } };
    showItemInFolderFromModule(fakeElectron, '/vault/papers/out.docx');
    expect(revealed).toEqual(['/vault/papers/out.docx']);
  });

  it('refuses an electron module without shell.showItemInFolder', () => {
    expect(() => showItemInFolderFromModule({}, '/x')).toThrow(/showItemInFolder/);
  });
});
