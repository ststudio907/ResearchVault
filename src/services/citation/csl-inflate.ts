// src/services/citation/csl-inflate.ts
//
// C3.2 — inflate the compressed CSL bundle anywhere the plugin runs.
//
// The vendored styles live in `csl-bundle.generated.ts` as gzip+base64. Until
// now the only consumer was the desktop-only export path (Node zlib through
// the lazy `window.require` boundary). C3's in-note rendering runs on *both*
// platforms, so inflation moved into this shared helper:
//
// - Primary: `DecompressionStream('gzip')` — a Web API available in the
//   desktop Electron renderer and the mobile webviews alike (and in Node 18+,
//   which covers vitest). Async, streaming.
// - Fallback: `zlib.gunzipSync` via the lazy `window.require` boundary, for
//   any webview old enough to lack `DecompressionStream` (desktop only —
//   on mobile a missing API simply degrades to the caller's fallback).
//
// Contract validated empirically in the C3 spike (citeproc accepts both the
// APA XML and the en-US locale produced by this path).

type NodeRequire = (id: string) => unknown;

// `Buffer` is only touched behind the desktop-gated lazy-require fallback; the
// *type* comes from @types/node (dev dependency), never a runtime import.
declare const Buffer: typeof import('node:buffer').Buffer;

interface NodeZlib {
  gunzipSync(data: Uint8Array): Uint8Array;
}

/** Is `DecompressionStream('gzip')` available in this JS realm? */
function hasDecompressionStream(): boolean {
  return typeof DecompressionStream === 'function';
}

/**
 * Inflate one gzip+base64 payload (a `CSL_BUNDLED` / `CSL_LOCALES` value)
 * to its UTF-8 text. Throws when no inflate path exists at all — callers
 * degrade to their own fallback (plain links / export aborted with a Notice).
 */
export async function inflateGzipBase64(b64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(b64), (char) => char.charCodeAt(0));

  if (hasDecompressionStream()) {
    // Hand-built ReadableStream rather than `new Blob(...).stream()` — jsdom's
    // Blob (test env) has no `.stream()`, while ReadableStream + Response +
    // DecompressionStream are consistent across Electron, mobile webviews,
    // and Node 18+. lib.dom types DecompressionStream's writable as
    // WritableStream<BufferSource>, which never satisfies a Uint8Array stream
    // across TS lib revisions; at runtime we only ever enqueue Uint8Array, so
    // the boundary cast is honest.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }).pipeThrough(
      new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>,
    );
    return await new Response(stream).text();
  }

  // Desktop fallback (Node zlib). `window.require` only exists in Electron.
  const req = typeof window !== 'undefined'
    ? (window as { require?: NodeRequire }).require
    : undefined;
  const zlib = req ? (req('node:zlib') as NodeZlib | undefined) : undefined;
  if (!zlib || typeof zlib.gunzipSync !== 'function') {
    throw new Error('No gzip inflate available in this environment.');
  }
  return Buffer.from(zlib.gunzipSync(bytes)).toString('utf8');
}
