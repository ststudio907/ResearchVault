// src/services/citation/providers/_fetch-helper.ts
//
// Tiny shared helper for the two 4.1.B providers. Resolves the `FetchImpl`
// to a callable (preferring the injected one, falling back to `window.fetch`)
// and centralises the `obsidianmd/no-global-this` rule's gotcha: we have to
// use `window.fetch?.bind(window)`, not `globalThis.fetch`, because the
// Obsidian ESLint config flags the latter.
//

import type { FetchImpl } from '../types';

/**
 * Resolve the `FetchImpl`. Order of preference:
 *   1. The injected one (5.x vitest fixtures pass a mock here)
 *   2. `window.fetch`, bound to the global window
 *
 * Throws when neither is available (the only realistic case is a test
 * environment that failed to inject a mock — surface it loudly rather
 * than silently return undefined).
 */
export function applyObsidianFetch(injected: FetchImpl | undefined): FetchImpl {
	if (injected) return injected;
	const w = typeof window !== 'undefined' ? window.fetch : undefined;
	if (typeof w === 'function') {
		return w.bind(window) as FetchImpl;
	}
	throw new Error(
		'Citation provider: no FetchImpl available. Pass one via CitationServiceDeps.fetchImpl, '
		+ 'or run inside Electron / a browser where window.fetch is defined.',
	);
}
