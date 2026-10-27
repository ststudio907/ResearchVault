#!/usr/bin/env node
/**
 * ResearchVault — agent-doc invariant checker.
 *
 * Asserts the small set of facts that keep the repo-local agent workflow honest,
 * so "the docs say X" is a gate result rather than an assurance:
 *
 *   1. dev/agents/standing-instructions.md contains the headings R1..R12.
 *   2. dev/agents/drift-check.md still says "Report only, fix nothing."
 *   3. AGENTS.md references all three agent files and says "R1–R12".
 *
 * `dev/` is not tracked in the public repo (it is backed up in the private
 * `ResearchVault-dev` clone), so this is a LOCAL gate: when `dev/` is absent the
 * script prints SKIP and exits 0. It must never be wired into CI.
 *
 * Usage: npm run check:docs
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve('.');
const DEV_DIR = join(ROOT, 'dev');
const RULE_COUNT = 12;

const failures = [];

/** Read a file, recording a failure instead of throwing when it is missing. */
function readOrFail(label, path) {
	if (!existsSync(path)) {
		failures.push(`${label}: missing file ${path}`);
		return null;
	}
	return readFileSync(path, 'utf8');
}

if (!existsSync(DEV_DIR)) {
	console.log('SKIP agent-doc check — dev/ is absent (private clone not present).');
	process.exit(0);
}

// 1. Rules R1..R12 exist as headings.
const rulesPath = join(DEV_DIR, 'agents', 'standing-instructions.md');
const rules = readOrFail('standing-instructions.md', rulesPath);
if (rules !== null) {
	for (let n = 1; n <= RULE_COUNT; n += 1) {
		const heading = new RegExp(`^### R${n}\\b`, 'm');
		if (!heading.test(rules)) {
			failures.push(`standing-instructions.md: missing heading "### R${n}"`);
		}
	}
}

// 2. The drift check stays report-only.
const driftPath = join(DEV_DIR, 'agents', 'drift-check.md');
const drift = readOrFail('drift-check.md', driftPath);
if (drift !== null && !drift.includes('Report only, fix nothing.')) {
	failures.push('drift-check.md: missing "Report only, fix nothing."');
}

// 3. AGENTS.md points at all three agent files and states the rule range.
const agentsPath = join(ROOT, 'AGENTS.md');
const agents = readOrFail('AGENTS.md', agentsPath);
if (agents !== null) {
	const referenced = [
		'dev/agents/standing-instructions.md',
		'dev/handoffs/README.md',
		'dev/agents/drift-check.md',
	];
	for (const ref of referenced) {
		if (!agents.includes(ref)) {
			failures.push(`AGENTS.md: does not reference ${ref}`);
		}
	}
	if (!agents.includes(`R1–R${RULE_COUNT}`)) {
		failures.push(`AGENTS.md: does not say "R1–R${RULE_COUNT}"`);
	}
}

if (failures.length > 0) {
	console.error('check:docs FAILED');
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}

console.log(`check:docs OK — R1–R${RULE_COUNT} present, drift check report-only, AGENTS.md links all three files.`);
