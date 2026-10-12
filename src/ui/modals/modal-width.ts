import { Modal } from 'obsidian';

/**
 * Shared modal-width helper.
 *
 * Obsidian's `Modal` base class sizes `contentEl` to its theme's
 * `--modal-width` (default ~500 px). That's a touch too narrow for
 * ResearchVault's `PaperImportModal` (PDF drop zone, author list, multiple
 * text fields) and makes the drop-zone copy wrap awkwardly.
 *
 * Rather than setting inline `style.width` (which fights themes and custom
 * CSS snippets), we tag the modal with a class; the actual `width` /
 * `max-width` values live in `styles.css` under `.researchvault-modal` so
 * users can override them.
 *
 * Usage: call at the top of `onOpen()` in every modal, before rendering
 * rows. Safe to call multiple times — `addClass` is a no-op when the class
 * is already present.
 */
export function applyStandardModalWidth(modal: Modal): void {
	modal.modalEl.addClass('researchvault-modal');
}
