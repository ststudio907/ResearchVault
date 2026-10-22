// src/services/citation/citeproc.d.ts
//
// C3 — hand-typed surface of citeproc-js (the bundled in-note citation
// renderer). The npm package ships no type declarations and we use a tiny
// slice of its API (engine construction + cluster append), so the types are
// inline here rather than pulling in a community `.d.ts` (same posture as the
// hand-typed CSL-JSON subset — see the comment atop `citation/types.ts`).
//
// `sys` shape per the citeproc-js docs: `retrieveLocale(lang)` must return the
// CSL locale XML string (or null to force the engine's fallback), and
// `retrieveItem(id)` must return the CSL-JSON record for a citation id.

declare module 'citeproc' {
  /** The `sys` object the engine calls back into for data. */
  export interface CiteprocSys {
    retrieveLocale(lang: string): string | null;
    retrieveItem(id: string): unknown;
  }

  /** One cited item inside a citation cluster. */
  export interface CiteprocCitationItem {
    id: string;
    /** Render only the author names (narrative "Smith and Jones" form). */
    'author-only'?: boolean;
    /** Render only the year/number tail ("(2020)" / "[1]" form). */
    'suppress-author'?: boolean;
    prefix?: string;
    suffix?: string;
    locator?: string;
    label?: string;
  }

  /** One citation cluster (a `[@a; @b]` group or a narrative `@key`). */
  export interface CiteprocCitation {
    citationItems: CiteprocCitationItem[];
    properties: {
      /** Monotonic index across the document — drives first-vs-subsequent forms. */
      noteIndex: number;
      mode?: string;
    };
  }

  /**
   * The processor. `appendCitationCluster(citation, preSorted)` returns
   * `[noteIndex, renderedString, citationId?]` tuples — one per item.
   */
  export class Engine {
    constructor(sys: CiteprocSys, styleXml: string, lang?: string, forceLang?: boolean);
    setOutputFormat(format: string): void;
    appendCitationCluster(
      citation: CiteprocCitation,
      preSorted?: boolean,
    ): Array<[number, string] | [number, string, string]>;
  }

  export const PROCESSOR_VERSION: string;
}
