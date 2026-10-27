// tests/export-service.test.ts
//
// Unit coverage for the 1.1 "Cite & ship" export (D39/D40). The pure decision
// logic is exercised directly; the `exportNote` flow is driven through the same
// lazy `window.require` seam the desktop path uses, with an in-memory fs and an
// injected `execFile` stub — no real filesystem and no real child process.
// The vendored CSL bundle IS round-tripped: each entry must inflate to real
// CSL XML, or every built-in export would fail in the wild.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';
import * as nodePath from 'node:path';

import {
  BUNDLED_CSL_STYLES,
  ExportService,
  buildPandocArgs,
  execFileFromModule,
  findProjectForPath,
  isBundledStyle,
  pandocCandidates,
  showItemInFolderFromModule,
  type ExecFileFn,
} from '../src/services/citation/export-service';
import { CSL_BUNDLED } from '../src/services/citation/csl-bundle.generated';
import { TFile } from 'obsidian';
import type { ResearchVaultPlugin } from '../src/core/plugin';
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

// ---------------------------------------------------------------------------
// 1.1.3.C.1 / 2b — temp-dir hygiene
//
// `exportNote` used to mkdtemp twice per run (`researchvault-export-*` and
// `researchvault-csl-*`) and removed neither directory — only the output file
// inside the first. It now creates ONE root per export, materialises `style.csl`
// inside it, and removes that root in a single `finally`, so these tests assert
// the root is gone on every exit path: success, pandoc failure, CSL-write
// failure, vault-write failure.
//
// They drive the real `exportNote` through the same `window.require` seam the
// desktop path uses, with an in-memory fs and an injected `execFile` stub, so no
// real filesystem or child process is touched.
// ---------------------------------------------------------------------------

interface FakeFs {
  dirs: Set<string>;
  files: Map<string, Uint8Array>;
  removed: string[];
  api: Record<string, unknown>;
}

interface FakeFsOptions {
  /** Make the first `writeFile` throw — exercises a CSL-write failure. */
  failWrite?: boolean;
}

function makeFakeFs(options: FakeFsOptions = {}): FakeFs {
  const dirs = new Set<string>();
  const files = new Map<string, Uint8Array>();
  const removed: string[] = [];
  let seq = 0;
  let writes = 0;
  const api = {
    writeFile: async (path: string, data: Uint8Array | string): Promise<void> => {
      writes += 1;
      if (options.failWrite && writes === 1) throw new Error('EACCES: simulated write failure');
      files.set(path, typeof data === 'string' ? new TextEncoder().encode(data) : data);
    },
    readFile: async (path: string): Promise<Uint8Array> => {
      const found = files.get(path);
      if (!found) throw new Error(`ENOENT: ${path}`);
      return found;
    },
    mkdtemp: async (prefix: string): Promise<string> => {
      seq += 1;
      const dir = `${prefix}${seq}`;
      dirs.add(dir);
      return dir;
    },
    rm: async (path: string): Promise<void> => {
      dirs.delete(path);
      removed.push(path);
      for (const key of [...files.keys()]) {
        if (key.startsWith(path)) files.delete(key);
      }
    },
  };
  return { dirs, files, removed, api };
}

/** Install the fake node modules behind the plugin's lazy `window.require` seam. */
function installNodeModules(fake: FakeFs, execFile: ExecFileFn): void {
  const modules: Record<string, unknown> = {
    'node:fs/promises': fake.api,
    'node:path': nodePath,
    'node:os': { tmpdir: () => '/tmp' },
    // The bundled CSL payload is bypassed: the style file's *location* is what
    // these tests are about, not its contents.
    'node:zlib': { gunzipSync: (bytes: Uint8Array) => bytes },
    'node:child_process': { execFile },
  };
  // `vi.stubGlobal` rather than touching `globalThis` (obsidianmd/no-global-this).
  vi.stubGlobal('window', { require: (id: string) => modules[id] });
}

function makePlugin(options: { failCreateBinary?: boolean } = {}): ResearchVaultPlugin {
  const project = {
    id: 'p1',
    name: 'Proj',
    folderPath: 'Proj',
    settings: { citationStyle: 'apa' },
  } as unknown as Project;
  const plugin = {
    settings: { pandocPath: 'pandoc' },
    projectManager: {
      getAllProjects: () => [project],
      updateProject: async () => project,
    },
    bibliographyService: {
      bibliographyPath: () => 'Proj/bibliography.bib',
      exportProjectBibliography: async () => ({ path: 'Proj/bibliography.bib' }),
    },
    app: {
      vault: {
        adapter: { getBasePath: () => '/vault' },
        getAbstractFileByPath: () => null,
        createBinary: async () => {
          if (options.failCreateBinary) throw new Error('simulated vault write failure');
          return undefined;
        },
        modifyBinary: async () => undefined,
      },
    },
  };
  return plugin as unknown as ResearchVaultPlugin;
}

function makeNote(): TFile {
  const note = new TFile();
  note.path = 'Proj/notes/draft.md';
  note.basename = 'draft';
  // The real TFile carries `parent`; the test mock does not, so attach the
  // minimum the export path reads (it decides where the output lands).
  Object.assign(note, { parent: { path: 'Proj/notes' } });
  return note;
}

describe('exportNote temp-dir cleanup (1.1.3.C.1 / 2b)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Assert one export root was created and removed; no CSL dir exists anymore. */
  function expectSingleRootCleaned(fake: FakeFs): void {
    expect(fake.dirs.size).toBe(0);
    expect(fake.removed.filter((p) => p.includes('researchvault-export-'))).toHaveLength(1);
    expect(fake.removed.filter((p) => p.includes('researchvault-csl-'))).toHaveLength(0);
  }

  it('removes the temp root after a successful export', async () => {
    const fake = makeFakeFs();
    const execFileOk: ExecFileFn = (_file, args, _options, callback) => {
      const outAbs = args.at(-1) ?? '';
      fake.files.set(outAbs, new TextEncoder().encode('docx-bytes'));
      callback(null, '', '');
    };
    installNodeModules(fake, execFileOk);

    const result = await new ExportService(makePlugin()).exportNote(makeNote(), {
      style: 'apa',
      format: 'docx',
    });

    expect(result.outputPath).toBe('Proj/notes/draft.docx');
    expectSingleRootCleaned(fake);
  });

  it('removes the temp root when pandoc fails', async () => {
    const fake = makeFakeFs();
    const execFileFail: ExecFileFn = (_file, _args, _options, callback) => {
      callback(
        Object.assign(new Error('boom'), { stderr: 'pandoc: missing template' }),
        '',
        'pandoc: missing template',
      );
    };
    installNodeModules(fake, execFileFail);

    await expect(
      new ExportService(makePlugin()).exportNote(makeNote(), { style: 'apa', format: 'docx' }),
    ).rejects.toThrow(/pandoc failed: pandoc: missing template/);

    expectSingleRootCleaned(fake);
  });

  it('removes the temp root when the CSL write throws, and propagates the error', async () => {
    const fake = makeFakeFs({ failWrite: true });
    const execFileNever: ExecFileFn = () => {
      throw new Error('pandoc must not run when the CSL write failed');
    };
    installNodeModules(fake, execFileNever);

    await expect(
      new ExportService(makePlugin()).exportNote(makeNote(), { style: 'apa', format: 'docx' }),
    ).rejects.toThrow(/simulated write failure/);

    expectSingleRootCleaned(fake);
  });

  it('removes the temp root when the vault write throws after pandoc succeeds', async () => {
    const fake = makeFakeFs();
    const execFileOk: ExecFileFn = (_file, args, _options, callback) => {
      const outAbs = args.at(-1) ?? '';
      fake.files.set(outAbs, new TextEncoder().encode('docx-bytes'));
      callback(null, '', '');
    };
    installNodeModules(fake, execFileOk);

    await expect(
      new ExportService(makePlugin({ failCreateBinary: true })).exportNote(makeNote(), {
        style: 'apa',
        format: 'docx',
      }),
    ).rejects.toThrow(/simulated vault write failure/);

    expectSingleRootCleaned(fake);
  });
});
