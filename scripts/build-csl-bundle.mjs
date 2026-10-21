// scripts/build-csl-bundle.mjs
//
// Build-time generator for the 1.1 "Cite & ship" export flow (D39/D40).
//
// pandoc ships no CSL style files (its only built-in is Chicago author-date),
// and community-plugin installs only copy `main.js` / `manifest.json` /
// `styles.css` — so the five built-in styles must live INSIDE the bundle.
// Raw CSL XML is ~300 KB, which would double main.js; minified + gzipped it
// is ~25 KB (~33 KB base64). The export path is desktop-only, so the runtime
// inflates with Node's `zlib.gunzipSync` via the lazy `window.require`
// boundary in `export-service.ts` (mobile never touches it).
//
// Sources: citation-style-language/styles repo (CC BY-SA 3.0), fetched raw:
//   apa.csl, modern-language-association.csl (MLA 9), chicago-author-date.csl,
//   ieee.csl, harvard-cite-them-right.csl
// Re-run after editing any vendored `.csl`: `npm run csl:build`.
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

function minifyCsl(source) {
	return source
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/>\s+</g, '><')
		.trim();
}

const entries = Object.entries(STYLE_FILES).map(([key, file]) => {
	const raw = readFileSync(join(cslDir, file), 'utf8');
	const minified = minifyCsl(raw);
	const gz = gzipSync(Buffer.from(minified, 'utf8'), { level: 9 });
	const b64 = gz.toString('base64');
	console.log(`${key.padEnd(8)} ${file.padEnd(34)} raw=${raw.length} min=${minified.length} gz=${gz.length} b64=${b64.length}`);
	return `\t${key}: '${b64}',`;
});

const banner = `// src/services/citation/csl-bundle.generated.ts
//
// GENERATED FILE — do not edit by hand. Run \`npm run csl:build\` after editing
// the vendored \`.csl\` files in \`src/services/citation/csl/\`.
//
// Five CSL styles for the D39/D40 "Cite & ship" export, minified + gzipped +
// base64'd so they can live inside main.js (community-plugin installs only
// copy main.js / manifest.json / styles.css — separate asset files would not
// reach users). Inflated at export time with Node zlib (desktop-only path).
//
// Style sources: https://github.com/citation-style-language/styles
// (CC BY-SA 3.0; attribution notice also carried in README).

export const CSL_BUNDLED: Record<string, string> = {
${entries.join('\n')}
};
`;

writeFileSync(outFile, banner);
console.log(`Wrote ${outFile}`);
