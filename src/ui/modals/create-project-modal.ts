// src/ui/modals/create-project-modal.ts
//
// Two related modals used during Sprint 1 onboarding:
//
//   • `CreateProjectModal` — collect a name, folder path, citation style, and
//     description; create the folder on disk and persist a `Project` record.
//   • `SwitchProjectModal` — quick picker to promote one of the existing
//     projects to "active".
//
// Both lean on `ProjectManager` for the actual mutations; their only job is
// to capture input and surface errors.
//

import { App, Modal, Notice, Setting, TFolder, normalizePath } from 'obsidian';
import type { ResearchVaultPlugin } from '../../core/plugin';
import { CITATION_STYLES } from '../../types';
import { applyStandardModalWidth } from './modal-width';

/** Shared scaffolding so both modals inherit the same chrome. */
abstract class BaseProjectModal extends Modal {
  constructor(app: App, protected readonly plugin: ResearchVaultPlugin) {
    super(app);
  }
}

export class CreateProjectModal extends BaseProjectModal {
  private name = '';
  private folderPath = '';
  private description = '';
  private citationStyle = this.plugin.settings.globalCitationStyle;

  onOpen(): void {
    const { contentEl } = this;
    applyStandardModalWidth(this);
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Create research project' });

    new Setting(contentEl)
      .setName('Project name')
      .addText((text) => {
        text.setPlaceholder('ML research');
        text.setValue(this.name);
        text.onChange((v) => {
          this.name = v;
        });
      });

    new Setting(contentEl)
      .setName('Folder path')
      .setDesc('Where this project\'s files will live. Created if missing.')
      .addText((text) => {
        text.setPlaceholder('Projects/ML research');
        text.setValue(this.folderPath);
        text.onChange((v) => {
          this.folderPath = v;
        });
      })
      .addButton((btn) =>
        btn.setButtonText('Suggest from existing folders').onClick(() => {
          const folders = this.plugin.app.vault
            .getAllFolders()
            .map((f) => f.path)
            .filter((p) => p && !p.startsWith('.') && !p.includes('/' + this.app.vault.configDir))
            .sort();
          const hint =
            folders.length === 0
              ? 'No vault folders yet — type a path like `Projects/<name>`.'
              : `Try one of:\n- ${folders.slice(0, 12).join('\n- ')}`;
          new Notice(hint, 6_000);
        }),
      );

    new Setting(contentEl)
      .setName('Description')
      .addText((text) => {
        text.setPlaceholder('Optional short description');
        text.setValue(this.description);
        text.onChange((v) => {
          this.description = v;
        });
      });

    new Setting(contentEl)
      .setName('Citation style')
      .addDropdown((dropdown) => {
        for (const style of CITATION_STYLES) dropdown.addOption(style, style);
        dropdown.setValue(this.citationStyle);
        dropdown.onChange((v) => {
          this.citationStyle = v as typeof this.citationStyle;
        });
      });

    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((btn) =>
        btn
          .setButtonText('Create')
          .setCta()
          .onClick(async () => {
            await this.submit();
          }),
      );
  }

  private async submit(): Promise<void> {
    try {
      const project = await this.plugin.projectManager.createProject({
        name: this.name,
        folderPath: normalizePath(this.folderPath),
        description: this.description || undefined,
        citationStyle: this.citationStyle,
      });
      new Notice(`ResearchVault: created "${project.name}".`);
      this.close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`ResearchVault: ${msg}`);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class SwitchProjectModal extends BaseProjectModal {
  onOpen(): void {
    const { contentEl } = this;
    applyStandardModalWidth(this);
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Switch active project' });

    const projects = this.plugin.projectManager.getAllProjects();

    if (projects.length === 0) {
      contentEl.createEl('p', { text: 'No projects exist yet. Use "create research project" first.' });
      return;
    }

    for (const project of projects) {
      // Verify the folder still exists; warn if the user moved or deleted it.
      const folder = this.plugin.app.vault.getAbstractFileByPath(project.folderPath);
      const folderOk = folder instanceof TFolder;

      new Setting(contentEl)
        .setName(project.name)
        .setDesc(folderOk ? `Folder: ${project.folderPath}` : `⚠️ Folder missing: ${project.folderPath}`)
        .addButton((btn) => {
          btn.setButtonText(project.isActive ? 'Active' : 'Activate').setDisabled(project.isActive);
          if (!project.isActive) {
            btn.onClick(async () => {
              await this.plugin.projectManager.activateProject(project.id);
              new Notice(`ResearchVault: "${project.name}" is now active.`);
              this.close();
            });
          }
        });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
