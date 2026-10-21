// src/ui/modals/export-note-modal.ts
//
// 1.1 "Cite & ship" pre-export dialog (D39/D40). The style is chosen per
// project at export time — this modal pre-fills from the project's default,
// and an opt-in checkbox persists the choice back onto the project record so
// the next export starts from the same place. Locked 2026-10-21 (Q4).
//
import { App, Modal, Notice, Setting, TFile, normalizePath } from 'obsidian';
import type { ResearchVaultPlugin } from '../../core/plugin';
import { BUNDLED_CSL_STYLES, type ExportFormat } from '../../services/citation/export-service';
import type { CitationStyle } from '../../types';
import { applyStandardModalWidth } from './modal-width';

const STYLE_LABELS: Record<string, string> = {
	apa: 'APA',
	mla: 'MLA (9th edition)',
	chicago: 'Chicago (author-date)',
	ieee: 'IEEE',
	harvard: 'Harvard (Cite Them Right)',
	custom: 'Custom (.csl file in vault)',
};

export class ExportNoteModal extends Modal {
	private style: CitationStyle;
	private customCslPath = '';
	private format: ExportFormat = 'docx';
	private saveAsDefault = false;

	constructor(
		app: App,
		private readonly plugin: ResearchVaultPlugin,
		private readonly file: TFile,
	) {
		super(app);
		const project = plugin.projectManager.getAllProjects().find(
			(p) => file.path.toLowerCase().startsWith(`${p.folderPath.toLowerCase()}/`),
		);
		this.style = project?.settings.citationStyle ?? plugin.settings.globalCitationStyle;
	}

	onOpen(): void {
		const { contentEl } = this;
		applyStandardModalWidth(this);
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Export note' });
		contentEl.createEl('p', {
			text:
				`Compile "${this.file.basename}" with pandoc and --citeproc, using this project's ` +
				'bibliography. Requires a locally installed pandoc (nothing is bundled). ' +
				'The output file is written next to this note.',
			cls: 'setting-item-description',
		});

		new Setting(contentEl)
			.setName('Citation style')
			.setDesc('Pre-filled from this project\u2019s default. Custom styles use a .csl file stored in the vault.')
			.addDropdown((dropdown) => {
				for (const style of [...BUNDLED_CSL_STYLES, 'custom' as const]) {
					dropdown.addOption(style, STYLE_LABELS[style] ?? style);
				}
				dropdown.setValue(this.style);
				dropdown.onChange((value) => {
					this.style = value as CitationStyle;
					// Rebuild the form so the custom-.csl field appears/disappears.
					this.contentEl.empty();
					this.onOpen();
				});
			});

		if (this.style === 'custom') {
			new Setting(contentEl)
				.setName('Custom .csl path')
				.setDesc('Vault path to a CSL style file, e.g. "Styles/my-style.csl".')
				.addText((text) => {
					text.setPlaceholder('Styles/my-style.csl');
					text.setValue(this.customCslPath);
					text.onChange((value) => {
						this.customCslPath = value;
					});
				});
		}

		new Setting(contentEl)
			.setName('Output format')
			.setDesc('PDF additionally requires a LaTeX engine on this machine.')
			.addDropdown((dropdown) => {
				dropdown.addOption('docx', 'Word (.docx)');
				dropdown.addOption('pdf', 'PDF (requires LaTeX)');
				dropdown.setValue(this.format);
				dropdown.onChange((value) => {
					this.format = value as ExportFormat;
				});
			});

		new Setting(contentEl)
			.setName('Save as project default')
			.setDesc('Remember this style for future exports of this project.')
			.addToggle((toggle) => {
				toggle.setValue(this.saveAsDefault);
				toggle.onChange((value) => {
					this.saveAsDefault = value;
				});
			});

		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((btn) =>
				btn
					.setButtonText('Export')
					.setCta()
					.onClick(async () => {
						await this.submit();
					}),
			);
	}

	private async submit(): Promise<void> {
		if (this.style === 'custom' && !this.customCslPath.trim()) {
			new Notice('ResearchVault: choose a .csl file for the custom style.');
			return;
		}
		if (this.style === 'custom') {
			const normalized = normalizePath(this.customCslPath.trim());
			if (!this.plugin.app.vault.getAbstractFileByPath(normalized)) {
				new Notice(`ResearchVault: no vault file at "${normalized}".`);
				return;
			}
		}
		try {
			const result = await this.plugin.ensureExportService().exportNote(this.file, {
				style: this.style,
				customCslPath: this.customCslPath.trim() || undefined,
				format: this.format,
				saveAsProjectDefault: this.saveAsDefault,
			});
			new Notice(`ResearchVault: exported to ${result.outputPath}.`);
			this.close();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			new Notice(`ResearchVault: export failed — ${message}`);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
