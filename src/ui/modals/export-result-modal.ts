// src/ui/modals/export-result-modal.ts
//
// 1.1 "Cite & ship" post-export dialog. The exported .docx/.pdf lands next to
// the note, but Obsidian's file explorer hides non-markdown extensions like
// .docx unless "Detect all file extensions" is on — so the dialog says where
// the file went and offers a desktop-only reveal in the OS file manager
// (electron.shell.showItemInFolder, which selects the file in Finder/
// Explorer). Kept to two buttons and one hint line on purpose.
//
import { App, Modal, Notice, Platform } from 'obsidian';
import { revealInFileManager, type ExportNoteResult } from '../../services/citation/export-service';
import { applyStandardModalWidth } from './modal-width';

export class ExportResultModal extends Modal {
	constructor(
		app: App,
		private readonly result: ExportNoteResult,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		applyStandardModalWidth(this);
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Export complete' });
		contentEl.createEl('p', { text: `Saved ${this.result.outputPath}.` });
		if (this.result.format === 'docx') {
			contentEl.createEl('p', {
				text:
					'Obsidian hides Word documents in its file explorer. To see them there, ' +
					'enable Settings → Files & Links → Detect all file extensions — ' +
					'or use "Show in folder" to open this file in your file manager.',
				cls: 'setting-item-description',
			});
		}

		const buttons = contentEl.createDiv({ cls: 'researchvault-confirm-buttons' });
		buttons.createEl('button', { text: 'Close' }).addEventListener('click', () => this.close());

		if (Platform.isDesktopApp) {
			const revealBtn = buttons.createEl('button', { text: 'Show in folder' });
			revealBtn.addClass('mod-cta');
			revealBtn.addEventListener('click', () => {
				try {
					revealInFileManager(this.result.outputAbsPath);
					this.close();
				} catch (err) {
					new Notice(
						`ResearchVault: could not open the file manager — ${err instanceof Error ? err.message : String(err)}`,
					);
				}
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
