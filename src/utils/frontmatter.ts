// src/utils/frontmatter.ts
//
// YAML frontmatter read/write helpers. Wraps Obsidian's `parseYaml` and
// `stringifyYaml` so callers don't have to remember the dash-line rules.
// Same trade-off as the rest of the codebase: we use the host app's own
// parser (no extra dependency) to guarantee round-trip safety.
//
// File shape:
//   ---
//   citekey: foo
//   title: "bar"
//   ---
//   # Markdown body...
//

import { parseYaml, stringifyYaml } from 'obsidian';

/** Sentinel result type for a parsed file — body always non-null even for files with no frontmatter. */
export interface ParsedFile<T = Record<string, unknown>> {
  frontmatter: T;
  body: string;
}

/**
 * Split a markdown file into frontmatter and body.
 *
 * - Leading blank lines are tolerated.
 * - Files with no frontmatter return `{}` as frontmatter and the original content as body.
 * - Frontmatter is allowed to be empty (`---\n---\n`) — treated as `{}`.
 */
export function splitFrontmatter<T = Record<string, unknown>>(content: string): ParsedFile<T> {
  const trimmedStart = content.replace(/^\uFEFF/, '').trimStart();
  if (!trimmedStart.startsWith('---')) {
    return { frontmatter: {} as T, body: content };
  }

  // Capture the opening fence; find the matching closing fence on its own line.
  const lines = trimmedStart.split(/\r?\n/);
  if (lines[0] !== '---') return { frontmatter: {} as T, body: content };

  let endIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === '---' || lines[i] === '...') {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    // Unterminated fence — treat the entire file as body, no frontmatter.
    return { frontmatter: {} as T, body: content };
  }

  const yaml = lines.slice(1, endIdx).join('\n');
  const rest = lines.slice(endIdx + 1).join('\n');
  const parsed = (parseYaml(yaml) ?? {}) as T;
  return { frontmatter: parsed, body: rest };
}

/**
 * Join a frontmatter object and body back into a markdown file.
 *
 * - If `frontmatter` is empty AND `omitIfEmpty` is true, returns just the body.
 * - Otherwise emits the opening + closing fence around `stringifyYaml`'s output.
 * - Both sides use a trailing newline so the file ends cleanly.
 */
export function joinFrontmatter(
  frontmatter: Record<string, unknown>,
  body: string,
  options: { omitIfEmpty?: boolean } = {},
): string {
  const isEmpty = !frontmatter || Object.keys(frontmatter).length === 0;
  if (isEmpty && options.omitIfEmpty !== false) {
    // Body provided; trailing newline preserved if present.
    return body.endsWith('\n') ? body : `${body}\n`;
  }

  const yaml = stringifyYaml(frontmatter).trimEnd();
  // stringifyYaml produces a trailing newline after `---` already in some Obsidian
  // builds — we explicitly stamp our own fences so the file is portable across
  // versions and external editors.
  const head = '---';
  return [head, yaml, head, ''].join('\n') + body;
}
