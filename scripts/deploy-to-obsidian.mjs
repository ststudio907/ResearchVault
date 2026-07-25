#!/usr/bin/env node
/**
 * ResearchVault — local Obsidian plugin deployer.
 *
 * Copies the built plugin artifacts (main.js, manifest.json, styles.css,
 * pdf.worker.min.mjs) from the source repo into a target Obsidian vault's
 * `.obsidian/plugins/<plugin-id>/` folder so you can reload Obsidian and
 * pick up the latest changes without manual copy/paste.
 *
 * Usage:
 *   node scripts/deploy-to-obsidian.mjs                    # uses default vault path
 *   RV_DEPLOY_TARGET=/path/to/vault node scripts/...mjs    # override
 *
 * Default target: $HOME/Documents/ResearchVault-Test/.obsidian/plugins/researchvault
 */
import { existsSync, statSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DEFAULT_TARGET = '/Users/justinboeringa/Documents/ResearchVault-Test/.obsidian/plugins/researchvault';
const PLUGIN_ID = 'researchvault';

// Plugin folder name must match manifest's id.
const TARGET = process.env.RV_DEPLOY_TARGET || DEFAULT_TARGET;
const SRC = resolve('.');

// ---------------------------------------------------------------------------
// Pre-flight: ensure a fresh build exists and the source artifacts are present
// ---------------------------------------------------------------------------

const REQUIRED = ['main.js', 'manifest.json'];
const OPTIONAL = ['styles.css', 'main.js.map'];

const missingRequired = REQUIRED.filter((f) => !existsSync(join(SRC, f)));
if (missingRequired.length > 0) {
  console.error(
    `\u2717 Deploy aborted — required artifacts missing in source repo:\n` +
      missingRequired.map((f) => `    - ${f}`).join('\n') +
      `\n    Run \`npm run build\` first.`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Ensure target dir exists
// ---------------------------------------------------------------------------

if (!existsSync(TARGET)) {
  mkdirSync(TARGET, { recursive: true });
  console.log(`\u00B7 Created target dir: ${TARGET}`);
}

const targetStat = statSync(TARGET);
if (!targetStat.isDirectory()) {
  console.error(`\u2717 Deploy target is not a directory: ${TARGET}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Copy artifacts
// ---------------------------------------------------------------------------

const copied = [];

for (const name of [...REQUIRED, ...OPTIONAL]) {
  const from = join(SRC, name);
  const to = join(TARGET, name);
  if (!existsSync(from)) continue; // optionals may legitimately be absent
  copyFileSync(from, to);
  copied.push({ name, bytes: statSync(from).size });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const totalBytes = copied.reduce((acc, c) => acc + c.bytes, 0);

console.log(`\n\u2713 ResearchVault deployed to:`);
console.log(`    ${TARGET}`);
console.log(`    Plugin id: ${PLUGIN_ID}`);
console.log(`    Artifacts copied: ${copied.length}\n`);
for (const c of copied) {
  const kb = (c.bytes / 1024).toFixed(1).padStart(6, ' ');
  console.log(`      ${kb} KB  ${c.name}`);
}
console.log(
  `\n    Reload Obsidian (Cmd/Ctrl-R in dev, or toggle the plugin off+on) to pick up the new build.\n`,
);

// Bonus: list what's currently in the target folder so the user can sanity-check
const peers = readdirSync(TARGET).sort();
console.log(`    Folder contents now:`);
for (const f of peers) console.log(`      - ${f}`);
console.log();
