// tests/mocks/obsidian.ts
//
// Runtime stand-in for the `obsidian` module in unit tests. Vitest aliases
// `obsidian` here (see `vitest.config.mts`); tests that need specific
// behavior `vi.mock` the module and supply their own implementation.

/** Passthrough canonicalizer — unit tests use simple, already-normal paths. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/|\/$/g, '');
}

/**
 * Structural base classes so `instanceof TFile` / `instanceof TFolder`
 * checks in services resolve consistently between test and source modules.
 */
export class TFile {
  path = '';
  basename = '';
  extension = 'md';
  stat = { ctime: 0, mtime: 0 };
}

export class TFolder {
  path = '';
  children: Array<TFile | TFolder> = [];
}

/** Shown via Notice; recorded so tests can assert user-facing messages. */
export class Notice {
  constructor(public message: string | DocumentFragment) {}
}

/** Chrome-less Modal base: services importing UI helpers load cleanly in tests. */
export class Modal {
  /** Definite-assignment: never touched in unit tests (no DOM in node env). */
  contentEl!: HTMLElement;
  constructor(public app?: unknown) {}
  open(): void {}
  close(): void {}
}

/**
 * Minimal YAML writer standing in for Obsidian's `stringifyYaml` (used by
 * `utils/frontmatter.ts`). Covers what unit tests emit: flat scalars, string
 * arrays as block lists, nested objects inline-JSON, `undefined` omitted.
 * Tests needing the real parser should `vi.mock('obsidian')` themselves.
 */
export function stringifyYaml(value: Record<string, unknown>): string {
  const scalar = (v: unknown): string => {
    if (typeof v === 'string' && /^[A-Za-z0-9_./ -]+$/u.test(v)) return v;
    return JSON.stringify(v) ?? 'null';
  };
  const lines: string[] = [];
  for (const [key, val] of Object.entries(value)) {
    if (val === undefined) continue;
    if (Array.isArray(val)) {
      if (val.length === 0) {
        lines.push(`${key}: []`);
        continue;
      }
      lines.push(`${key}:`);
      for (const item of val) lines.push(`  - ${scalar(item)}`);
      continue;
    }
    if (val !== null && typeof val === 'object') {
      lines.push(`${key}: ${JSON.stringify(val)}`);
      continue;
    }
    lines.push(`${key}: ${scalar(val)}`);
  }
  return lines.length > 0 ? `${lines.join('\n')}\n` : '\n';
}

/**
 * Minimal YAML reader standing in for Obsidian's `parseYaml` — the inverse of
 * the `stringifyYaml` above, sufficient for the write→read round-trips unit
 * tests exercise. Scalars, block-list string arrays, `[]`, inline-JSON nested
 * objects; anything else is returned as a raw string.
 */
export function parseYaml(yaml: string): Record<string, unknown> | null {
  if (!yaml.trim()) return null;
  const scalarOf = (raw: string): unknown => {
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    if (raw === '[]') return [];
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null') return null;
    if (/^-?\d+(\.\d+)?$/u.test(raw)) return Number(raw);
    if (raw.startsWith('{') || raw.startsWith('[')) {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    return raw;
  };

  const result: Record<string, unknown> = {};
  let currentKey: string | null = null;
  for (const raw of yaml.split('\n')) {
    if (!raw.trim()) continue;
    if (/^\s+- /u.test(raw) && currentKey !== null) {
      const list = result[currentKey];
      if (Array.isArray(list)) list.push(scalarOf(raw.trim().slice(2)));
      continue;
    }
    const idx = raw.indexOf(':');
    if (idx === -1) continue;
    const key = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    currentKey = key;
    if (value === '') {
      result[key] = []; // mock-writer emits `key:` only for block lists
      continue;
    }
    result[key] = scalarOf(value);
  }
  return result;
}

/** Runtime API used by sidebar-opening tests; vi.mock supplies the implementation. */
export function requireApiVersion(_version: string): boolean {
  throw new Error('Mock requireApiVersion before exercising Obsidian APIs.');
}
