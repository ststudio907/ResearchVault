// tests/csl-inflate.test.ts
//
// C3.2 — the shared CSL/locale inflate path. Node 18+ ships the Web
// `DecompressionStream` globally, so these exercise the same primary path
// the plugin uses in Obsidian desktop and mobile (the zlib fallback is
// unreachable here by construction — DecompressionStream exists).

import { describe, expect, it } from 'vitest';
import { inflateGzipBase64 } from '../src/services/citation/csl-inflate';
import { CSL_BUNDLED, CSL_LOCALES } from '../src/services/citation/csl-bundle.generated';

describe('inflateGzipBase64', () => {
  it('round-trips every vendored CSL style to real style XML', async () => {
    for (const [key, payload] of Object.entries(CSL_BUNDLED)) {
      const xml = await inflateGzipBase64(payload);
      expect(xml, `style ${key}`).toContain('<style');
      expect(xml, `style ${key} is not minified`).not.toContain('<!--');
    }
  });

  it('round-trips the vendored en-US locale', async () => {
    const xml = await inflateGzipBase64(CSL_LOCALES['en-US'] ?? '');
    expect(xml).toContain('<locale');
    expect(xml).toContain('xml:lang="en-US"');
  });

  it('rejects garbage payloads instead of returning junk', async () => {
    await expect(inflateGzipBase64('bm90IGd6aXAgYXQgYWxs')).rejects.toThrow();
  });
});
