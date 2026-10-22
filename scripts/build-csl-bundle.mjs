// scripts/build-csl-bundle.mjs
//
// Build-time generator for the 1.1 "Cite & ship" export flow (D39/D40) and
// the C3 in-note renderer.
//
// pandoc ships no CSL style files (its only built-in is Chicago author-date),
// and community-plugin installs only copy `main.js` / `manifest.json` /
// `styles.css` — so the five built-in styles must live INSIDE the bundle.
// Raw CSL XML is ~300 KB, which would double main.js; minified + gzipped it
// is ~25 KB (~33 KB base64). Inflation is shared with the C3 in-note
// renderer via `csl-inflate.ts` (Web DecompressionStream, Node zlib
// fallback).
//
// C3 also vendors the en-US citeproc locale (citeproc-js needs at least one
// locale to build an engine) into a second generated map, `CSL_LOCALES`.
//
// Style sources: https://github.com/citation-style-language/styles
// Locale source: https://github.com/citation-style-language/locales
// (both CC BY-SA 3.0; attribution notice also carried in README)
// Re-run after editing any vendored `.csl` / locale: `npm run csl:build`.
//
// Usage: node scripts/build-csl-bundle.mjs

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cslDir = join(scriptDir, '..', 'src', 'services', 'citation', 'csl');
const outFile = join(scriptDir, '..', 'src', 'services', 'citation', 'csl-bundle.generated.ts');

/** Map of bundle key -> vendored file name (keys mirror `CitationStyle`). */
const STYLE_FILES = {
	apa: 'apa.csl',
	mla: 'modern-language-association.csl',
	chicago: 'chicago-author-date.csl',
	ieee: 'ieee.csl',
	harvard: 'harvard-cite-them-right.csl',
};

/** Locale map for the C3 engine (citeproc-js retrieves these by name). */
const LOCALE_FILES = {
	'en-US': 'locales-en-US.xml',
};

function minifyCsl(source) {
	return source
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/>\s+</g, '><')
		.trim();
}

function bundle(entries, minify) {
	return Object.entries(entries).map(([key, file]) => {
		const raw = readFileSync(join(cslDir, file), 'utf8');
		const prepared = minify ? minifyCsl(raw) : raw;
		const gz = gzipSync(Buffer.from(prepared, 'utf8'), { level: 9 });
		const b64 = gz.toString('base64');
		console.log(`${key.padEnd(8)} ${file.padEnd(34)} raw=${raw.length} min=${minify ? prepared.length : raw.length} gz=${gz.length} b64=${b64.length}`);
		return `\t${JSON.stringify(key)}: '${b64}',`;
	});
}

const entries = bundle(STYLE_FILES, true);
const localeEntries = bundle(LOCALE_FILES, false);

const banner = `// src/services/citation/csl-bundle.generated.ts
//
// GENERATED FILE — do not edit by hand. Run \`npm run csl:build\` after editing
// the vendored \`.csl\` files in \`src/services/citation/csl/\`.
//
// Five CSL styles for the D39/D40 "Cite & ship" export and the C3 in-note
// renderer, minified + gzipped + base64'd so they can live inside main.js
// (community-plugin installs only copy main.js / manifest.json / styles.css —
// separate asset files would not reach users). CSL_LOCALES carries the en-US
// citeproc locale the C3 engine needs. Inflated at runtime through
// csl-inflate.ts (Web DecompressionStream, Node zlib fallback).
//
// Style sources: https://github.com/citation-style-language/styles
// Locale source: https://github.com/citation-style-language/locales
// (CC BY-SA 3.0; attribution notice also carried in README).

export const CSL_BUNDLED: Record<string, string> = {
${entries.join('\n')}
};

export const CSL_LOCALES: Record<string, string> = {
${localeEntries.join('\n')}
};
`;

writeFileSync(outFile, banner);
console.log(`Wrote ${outFile}`);
