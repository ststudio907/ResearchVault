// src/utils/uuid.ts
//
// UUID generation. Uses Web Crypto when available (Electron + modern mobile
// WebView both expose it). Falls back to a `Date.now()` + `Math.random()`
// concatenation that is unique enough for the plugin's use cases — these IDs
// never leave the user's vault.
//

/** Returns a v4 UUID string. */
export function newId(): string {
  const cryptoRef = typeof globalThis !== 'undefined' ? (window.crypto as Crypto | undefined) : undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  return fallbackId();
}

/** RFC4122-ish fallback when Web Crypto is unavailable. Not cryptographically strong; collisions would only break this vault. */
function fallbackId(): string {
  const segment = () =>
    Math.floor((1 + Math.random()) * 0x10_000)
      .toString(16)
      .slice(1);
  return [
    segment(),
    segment(),
    // Set version (4) and variant (10xx) so the shape still looks like a UUID.
    `4${segment().slice(0, 3)}`,
    ((8 + Math.floor(Math.random() * 4)).toString(16) + segment().slice(0, 3)),
    segment(),
    segment(),
  ].join('-');
}
