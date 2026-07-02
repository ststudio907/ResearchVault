// src/services/pdf-service.ts
/**
 * Extracts text from PDF files using pdfjs-dist.
 *
 * Provides two public methods used by PaperService:
 *  - `extractFullText` — returns the complete document text as a string.
 *  - `extractQuotesByPage` — returns page-scoped quote candidates for citation.
 */

import { loadPdfDocument } from './pdf/loader';

export interface PdfQuoteCandidate {
  /** Zero-based page index. */
  pageIndex: number;
  /** The extracted text block on this page. */
  text: string;
}

/** Shape of a single text item from pdfjs-dist TextItem. */
interface TextItemLike {
  str: string;
}

export class PdfService {
  /** Load a PDF from an ArrayBuffer and return its full plain-text content. */
  async extractFullText(data: ArrayBuffer): Promise<string> {
    const doc = await loadPdfDocument(data);
    const pages: string[] = [];
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1);
      const content = await page.getTextContent();
      const text = content.items.map((item) => (item as TextItemLike).str).join(' ');
      pages.push(text.trim());
    }
    return pages.join('\n\n');
  }

  /** Extract per-page quote candidates from a PDF. */
  async extractQuotesByPage(data: ArrayBuffer): Promise<PdfQuoteCandidate[]> {
    const doc = await loadPdfDocument(data);
    const results: PdfQuoteCandidate[] = [];
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1);
      const content = await page.getTextContent();
      const text = content.items.map((item) => (item as TextItemLike).str).join(' ');
      results.push({ pageIndex: i, text: text.trim() });
    }
    return results;
  }

  /** Return the number of pages in a PDF. */
  async getPageCount(data: ArrayBuffer): Promise<number> {
    const doc = await loadPdfDocument(data);
    return doc.numPages;
  }
}
