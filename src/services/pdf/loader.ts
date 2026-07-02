// src/services/pdf/loader.ts
/**
 * Lazy loader for pdfjs-dist with graceful fallback.
 *
 * In Obsidian's Electron main process, `process.getBuiltinModule()` is not
 * available and Web Workers don't work. We lazy-load pdfjs-dist so the plugin
 * can still load even if PDF extraction fails, and we disable workers to run
 * on the main thread.
 */

import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';

let _cachedLib: typeof import('pdfjs-dist/legacy/build/pdf.mjs') | null = null;

/** Get the pdfjs-dist library, loading it lazily on first use. */
async function getPdfJsLib(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> {
  if (_cachedLib) return _cachedLib;
  try {
    _cachedLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // Disable workers — Obsidian's Electron environment doesn't support Web Workers.
    _cachedLib.GlobalWorkerOptions.workerSrc = '';
  } catch (err) {
    console.warn('[ResearchVault] Failed to load pdfjs-dist:', err);
    throw err;
  }
  return _cachedLib!;
}

/** Load a PDF document from an ArrayBuffer and return the proxy. */
export async function loadPdfDocument(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const pdfjsLib = await getPdfJsLib();
  return pdfjsLib.getDocument({ data }) as unknown as PDFDocumentProxy;
}

/** Check if pdfjs-dist is available (for feature detection). */
export async function isPdfJsAvailable(): Promise<boolean> {
  try {
    await getPdfJsLib();
    return true;
  } catch {
    return false;
  }
}
