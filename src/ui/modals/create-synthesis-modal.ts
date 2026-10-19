// src/ui/modals/create-synthesis-modal.ts
//
// Minimal creation surface for synthesis notes (1.1). Slice 2 grows this
// into the full synthesis workspace (evidence capture UI); for now it
// captures a title (required) and an optional thesis and hands off to
// `SynthesisService.createSynthesis`, which owns validation, slug
// deconfliction, and the disk contract. Errors surface as a Notice —
// same posture as every other modal.
//
// Evidence blocks have no UI surface yet (Slice 2); during the Slice 1
// smoke they are driven from the dev console via the `window.researchVault`
// handle (see `plugin.ts`).

import { App, Modal, Notice, Setting } from 'obsidian';
import type { ResearchVaultPlugin } from '../../core/plugin';
import { applyStandardModalWidth } from './modal-width';

export class CreateSynthesisModal extends Modal {
  private title = '';
  private thesis = '';

  constructor(app: App, private readonly plugin: ResearchVaultPlugin) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    applyStandardModalWidth(this);
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Create synthesis note' });

    new Setting(contentEl)
      .setName('Title')
      .setDesc(
        'Becomes the note name inside the active project\'s syntheses/ folder.',
      )
      .addText((text) => {
        text.setPlaceholder('Scaling laws hold');
        text.setValue(this.title);
        text.onChange((v) => {
          this.title = v;
        });
      });

    new Setting(contentEl)
      .setName('Thesis')
      .setDesc('Optional. You can also write it in the note itself.')
      .addTextArea((text) => {
        text.setPlaceholder('One-sentence claim this note argues for.');
        text.setValue(this.thesis);
        text.onChange((v) => {
          this.thesis = v;
        });
      });

    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((btn) =>
        btn
          .setButtonText('Create')
          .setCta()
          .onClick(() => {
            void this.submit();
          }),
      );
  }

  private async submit(): Promise<void> {
    const active = this.plugin.projectManager.getActiveProject();
    if (!active) {
      new Notice('ResearchVault: activate a project before creating a synthesis note.');
      return;
    }
    if (!this.title.trim()) {
      new Notice('ResearchVault: give the synthesis note a title.');
      return;
    }
    try {
      const note = await this.plugin.synthesisService.createSynthesis(active.id, {
        title: this.title.trim(),
        thesis: this.thesis.trim() || undefined,
      });
      new Notice(`ResearchVault: created synthesis note "${note.title}".`);
      this.close();
      await this.plugin.app.workspace.openLinkText(note.path, '', false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`ResearchVault: could not create synthesis note: ${msg}`);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}