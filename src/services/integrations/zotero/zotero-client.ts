// src/services/integrations/zotero/zotero-client.ts
//
// 5.1 — Zotero web API read-in (D30 layer a). Read-only client for
// https://api.zotero.org. No local Zotero required, works on every
// platform, coexists with the official Obsidian Zotero plugins.
//
// API contract (https://www.zotero.org/support/dev/web_api/v3/start):
//   GET /users/<userID>/items?format=csljson&limit=<n>&tag=&q=
//     → a CSL-JSON array (when `format=csljson`, the response body IS the
//       array — no wrapping envelope). Every item type maps to CSL; notes
//       and attachments are excluded by the API for this format.
//   Headers: `Zotero-API-Version: 3` and `Zotero-API-Key: <key>` for
//   non-public libraries.
//
// Privacy posture (D30 / D14 / D15 extension): opt-in in settings; sends
// only library-scoped read requests to api.zotero.org; nothing from the
// vault is sent; the API key is stored locally in the settings file.

import { applyObsidianFetch } from '../../citation/providers/_fetch-helper';
import type { CslJsonRecord, FetchImpl } from '../../citation/types';

export interface ZoteroSettings {
  /** Master switch. Off by default per D30 — nothing hits api.zotero.org until enabled. */
  enableZoteroSync: boolean;
  /** Zotero userID (find it at zotero.org/settings/keys — "Your userID for use in API calls"). */
  userID: string;
  /** Zotero API key with read permission (create at zotero.org/settings/keys). Stored locally. */
  apiKey: string;
  /** Optional library type override: 'user' (default) or a group id prefix. */
  libraryType: 'user' | 'group';
  /** Library id (same as userID for 'user'; the numeric group id for 'group'). */
  libraryID: string;
  /** Tag filter — when set, only items carrying this tag are fetched (e.g. 'researchvault'). */
  tagFilter: string;
  /**
   * 5.2 (D30 layer b): local push-back to the Zotero desktop app via its
   * loopback connector server. OFF by default; desktop-only at runtime
   * (the UI hides the push affordance on mobile regardless).
   */
  enableLocalPush: boolean;
}

export const DEFAULT_ZOTERO_SETTINGS: ZoteroSettings = {
  enableZoteroSync: false,
  userID: '',
  apiKey: '',
  libraryType: 'user',
  libraryID: '',
  tagFilter: '',
  enableLocalPush: false,
};

export class ZoteroApiError extends Error {
  constructor(
    public readonly kind: 'network' | 'auth' | 'not-found' | 'rate-limited' | 'server',
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

export interface ZoteroFetchOpts {
  fetchImpl?: FetchImpl;
}

/** The maximum items per page the web API allows with `format=csljson`. */
const MAX_LIMIT = 100;

export class ZoteroClient {
  constructor(
    private readonly getSettings: () => ZoteroSettings,
  ) {}

  /** Base URL for the configured library. */
  private libraryUrl(s: ZoteroSettings): string {
    const type = s.libraryType === 'group' ? 'groups' : 'users';
    const id = s.libraryType === 'group' ? (s.libraryID || s.userID) : s.userID;
    return `https://api.zotero.org/${type}/${encodeURIComponent(id)}`;
  }

  /**
   * Fetch items as CSL-JSON. With a `query`, Zotero runs a server-side
   * full-text search across titles/creators/year; without one, the
   * most-recently-modified items come back (newest first). Returns `[]`
   * for an empty library / no hits — throws `ZoteroApiError` for mapped
   * errors.
   */
  async fetchItems(limit = 50, opts: ZoteroFetchOpts = {}, query = ''): Promise<CslJsonRecord[]> {
    const s = this.getSettings();
    const params = new URLSearchParams({
      format: 'csljson',
      limit: String(Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)))),
      sort: 'dateModified',
      direction: 'desc',
    });
    if (s.tagFilter.trim()) params.set('tag', s.tagFilter.trim());
    const q = query.trim();
    if (q) params.set('q', q);
    const url = `${this.libraryUrl(s)}/items?${params.toString()}`;

    const fetchImpl: FetchImpl = applyObsidianFetch(opts.fetchImpl);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: this.headers(s),
      });
    } catch (err) {
      throw new ZoteroApiError('network', `Zotero: fetch failed — ${(err as Error).message ?? 'unknown error'}`);
    }

    // Read the body once up front — Zotero's error bodies are plain-text
    // reasons ("Invalid user ID", "Invalid 'sort' value 'x'") that we want
    // to surface verbatim.
    const bodyText = await response.text();
    const status = response.status;

    if (status === 400) {
      throw new ZoteroApiError('network', `Zotero rejected the request: ${bodyText || 'bad request (400)'}. Check the account ID in settings — it is the numeric ID at zotero.org/settings/keys, not your username.`, status);
    }
    if (status === 401 || status === 403) {
      throw new ZoteroApiError('auth', 'Zotero: API key missing, invalid, or lacks read permission', status);
    }
    if (status === 404) {
      throw new ZoteroApiError('not-found', 'Zotero: library not found — check the account ID / library settings', status);
    }
    if (status === 429) {
      throw new ZoteroApiError('rate-limited', 'Zotero: rate-limited (429) — retry in a moment', status);
    }
    if (status >= 500) {
      throw new ZoteroApiError('server', `Zotero: server error ${status}`, status);
    }
    if (!(status >= 200 && status < 300)) {
      throw new ZoteroApiError('network', `Zotero: unexpected status ${status}`, status);
    }

    let body: unknown;
    try {
      body = JSON.parse(bodyText) as unknown;
    } catch (err) {
      throw new ZoteroApiError('network', `Zotero: invalid JSON — ${(err as Error).message ?? 'unknown error'}`);
    }
    // `format=csljson` wraps the array in {"items": [...]}.
    const records = Array.isArray(body)
      ? body
      : Array.isArray((body as { items?: unknown })?.items)
        ? (body as { items: unknown[] }).items
        : null;
    if (records === null) {
      const snippet = bodyText.slice(0, 200).replace(/\s+/g, ' ');
      throw new ZoteroApiError('network', `Zotero: expected a CSL-JSON array (or {"items": [...]}) response — got: ${snippet || '(empty body)'}`);
    }
    return records.filter(
      (r): r is CslJsonRecord => !!r && typeof r === 'object' && !Array.isArray(r),
    );
  }

  /** Probe the configured library; returns the number of visible items (0 on empty). */
  async probe(opts: ZoteroFetchOpts = {}): Promise<number> {
    const items = await this.fetchItems(1, opts);
    return items.length >= 0 ? items.length : 0;
  }

  private headers(s: ZoteroSettings): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Zotero-API-Version': '3',
    };
    if (s.apiKey.trim()) headers['Zotero-API-Key'] = s.apiKey.trim();
    return headers;
  }
}
