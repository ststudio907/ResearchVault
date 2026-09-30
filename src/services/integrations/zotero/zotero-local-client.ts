// src/services/integrations/zotero/zotero-local-client.ts
//
// 5.2 — Zotero local push-back (D30 layer b). Desktop-only write path to
// the Zotero desktop app via its loopback connector server.
//
// How it works: while Zotero 7 (desktop) is running it serves HTTP on
// http://127.0.0.1:23119. The `/connector/*` endpoints are the same
// protocol the official Zotero browser connector uses to save items from
// web pages — documented, stable, and the widest-compatibility write path
// (the `/api/` mirror on the same port is READ-ONLY in Zotero 7).
//
//   POST /connector/ping                    → liveness + version
//   POST /connector/getSelectedCollection   → the collection selected in the Zotero UI
//   POST /connector/saveItems               → save items (dedupes by DOI/title)
//
// Privacy posture (D30 / D12 / D13 extension): opt-in in settings
// (`enableLocalPush`, OFF by default). All traffic is loopback-only —
// nothing ever leaves the machine. The payload is the paper metadata
// itself; no vault content is attached.
//
// Design: plans/zotero-local-push-5.2-research.md (user-locked: push to
// the collection currently selected in the Zotero window; single-paper
// push only in v1).

import { applyObsidianFetch } from '../../citation/providers/_fetch-helper';
import type { FetchImpl } from '../../citation/types';

/** Loopback base — constant per the Zotero 7 connector protocol. */
const ZOTERO_CONNECTOR_BASE = 'http://127.0.0.1:23119';

/** Settings knob for the local push path (lives on `ZoteroSettings`). */
export interface ZoteroLocalSettings {
  /** Master switch for the push-back feature. Off by default per D30. */
  enableLocalPush: boolean;
}

/**
 * The subset of Zotero's connector "saveItems" item shape we emit.
 * Deliberately narrow — only fields a `Paper` can fill honestly.
 */
export interface ConnectorItem {
  itemType: string;
  title: string;
  creators: Array<{ creatorType: 'author'; firstName: string; lastName: string }>;
  DOI?: string;
  /** Zotero wants free-form dates ("2023" is fine). */
  date?: string;
  abstractNote?: string;
  url?: string;
  tags?: Array<{ tag: string }>;
  /** Connector items carry URIs of the page they were saved from; we send a stable pseudo-URI. */
  id?: string;
}

export interface SelectedCollection {
  id: string;
  name: string;
}

export interface ZoteroLocalFetchOpts {
  fetchImpl?: FetchImpl;
}

export class ZoteroLocalClient {
  constructor(
    private readonly getSettings: () => ZoteroLocalSettings,
    /** Injectable clock/timeout seam for tests. */
    private readonly timeoutMs = 1_500,
  ) {}

  /** True when the feature is enabled in settings (desktop gating is done by callers). */
  isEnabled(): boolean {
    return this.getSettings().enableLocalPush;
  }

  /**
   * Liveness probe. Resolves `true` when Zotero desktop is running; resolves
   * `false` (never throws) when it is not reachable — offline is an expected
   * state, not an error.
   */
  async ping(opts: ZoteroLocalFetchOpts = {}): Promise<boolean> {
    try {
      const res = await this.post('connector/ping', {}, opts);
      // The connector responds 200 with a JSON version envelope.
      void res;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The collection currently selected in the Zotero UI — the v1 push target.
   * Returns `null` when Zotero reports no usable selection (e.g. a saved-search
   * or a feed view); the caller then shows its fallback.
   */
  async getSelectedCollection(
    opts: ZoteroLocalFetchOpts = {},
  ): Promise<SelectedCollection | null> {
    const res = await this.post('connector/getSelectedCollection', {}, opts);
    const body = (await res.json()) as {
      id?: string | number;
      name?: string;
      type?: string;
    };
    if (
      !body ||
      body.type === 'feed' ||
      body.id === undefined ||
      body.id === null ||
      !body.name
    ) {
      return null;
    }
    return { id: String(body.id), name: body.name };
  }

  /**
   * Push items into the currently selected Zotero collection. Zotero shows
   * its own "items saved" popup and dedupes by DOI/title, so we do neither.
   * Returns the number of items handed to Zotero. Throws `Error` with a
   * readable message on any non-OK response.
   */
  async pushItems(
    items: ConnectorItem[],
    opts: ZoteroLocalFetchOpts = {},
  ): Promise<{ saved: number }> {
    if (items.length === 0) return { saved: 0 };
    const res = await this.post(
      'connector/saveItems',
      { items, uri: 'urn:researchvault:push' },
      opts,
    );
    if (!res.ok) {
      throw new Error(
        `Zotero save failed (status ${res.status}). Check that the selected ` +
          'collection accepts new items.',
      );
    }
    return { saved: items.length };
  }

  /** Shared POST with a short timeout; loopback only; no credentials. */
  private async post(
    path: string,
    body: unknown,
    opts: ZoteroLocalFetchOpts = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const doFetch = applyObsidianFetch(opts.fetchImpl);
      return await doFetch(`${ZOTERO_CONNECTOR_BASE}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timer);
    }
  }
}
