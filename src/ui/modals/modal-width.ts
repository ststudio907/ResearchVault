import { Modal } from 'obsidian';

/**
 * Shared modal-width utility.
 *
 * Obsidian's `Modal` base class sizes `contentEl` to its theme's `--modal-width`
 * (default ~500 px). That's a touch too narrow for ResearchVault's
 * `PaperImportModal` (PDF drop zone, author list, multiple text fields) and
 * makes the drop-zone copy wrap awkwardly.
 *
 * The standard Obsidian community-plugin pattern is to set a fixed
 * `style.width` on the outer `modalEl` (the *container* that gets centered
 * on the workspace). We pick 640 px — Obsidian's default + ~25 % — which
 * matches the user-stated ask of "an extra quarter of its width".
 *
 * We also set `max-width: 90vw` so a narrow window doesn't overflow horizontally
 * (instead the content scrolls or wraps inside the modal).
 *
 * Usage: call at the top of `onOpen()` in every modal, before rendering rows.
 */
export const STANDARD_MODAL_WIDTH = '640px';
export const STANDARD_MODAL_MAX_WIDTH = '90vw';

/**
 * Apply the standard ResearchVault modal width to a Modal.
 *
 * Safe to call multiple times — subsequent calls are no-ops because
 * `style.width` and `style.maxWidth` are idempotent. We *do* set them every
 * time so that if Obsidian re-applies a theme width (e.g. on window resize)
 * we re-assert ours on the next `onOpen()`.
 */
export function applyStandardModalWidth(modal: Modal): void {
	modal.modalEl.style.width = STANDARD_MODAL_WIDTH;
	modal.modalEl.style.maxWidth = STANDARD_MODAL_MAX_WIDTH;
}
