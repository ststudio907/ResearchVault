// src/ui/modals/create-project-modal.ts
//
// Two related modals used during Sprint 1 onboarding:
//
//   • `CreateProjectModal` — collect a name, folder path, and description;
//     create the folder on disk and persist a `Project` record.
//   • `SwitchProjectModal` — the project lifecycle hub: activate a project,
//     create a new one, or delete an existing one (with confirmation).
//     Formerly a switch-only picker; 2026-10-17 user-flagged move so the
//     sidebar stays tidy and all project management lives in one place.
//
// Both lean on `ProjectManager` for the actual mutations; their only job is
// to capture input and surface errors.
//

import { App, Modal, Notice, Setting, TFolder, normalizePath } from 'obsidian';
import type { TextComponent } from 'obsidian';
import type { ResearchVaultPlugin } from '../../core/plugin';
import type { Project } from '../../types';
import { ConfirmModal } from './confirm-modal';
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
  // 5.4 audit: no UI control (dropdown removed) — stamps the global default
  // into every new project record for the future 1.1 export flow (see below).
  private citationStyle = this.plugin.settings.globalCitationStyle;
  /** Set once the user hand-edits the folder field; stops the name mirror. */
  private folderTouched = false;
  /** Ref to the folder input so the name mirror can update it silently. */
  private folderInput: TextComponent | null = null;

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
          if (!this.folderTouched) {
            this.folderPath = v.trim();
            this.folderInput?.setValue(this.folderPath);
          }
        });
      });

    new Setting(contentEl)
      .setName('Folder path')
      .setDesc(
        'Defaults to a vault folder named after the project. Created — with its ' +
        'papers, notes, literature, and pdfs subfolders — if missing.',
      )
      .addText((text) => {
        text.setPlaceholder('ML research');
        text.setValue(this.folderPath);
        // 2.9.UX: mirror the project name into the folder path until the
        // user hand-edits it, so "name the project" is the only required
        // step (the folder materializes from the name automatically).
        this.folderInput = text;
        text.onChange((v) => {
          this.folderTouched = true;
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
          new Notice(`ResearchVault: ${hint}`, 6_000);
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

    // 5.4 audit (D37 posture, mirrored in the settings tab): a "Citation
    // style" dropdown here was inert — nothing reads
    // `project.settings.citationStyle` until the 1.1 Cite & ship export flow,
    // and D39 locks style selection to export time, never at insert/create.
    // New projects still stamp `settings.globalCitationStyle` into their
    // record silently; the export flow picks the final style.

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
  /** Unsubscribers for live refresh while the modal is open. */
  private unsubscribers: (() => void)[] = [];
  /** Guards re-entrancy: delete → confirm closes → list refresh mid-await. */
  private busy = false;

  onOpen(): void {
    applyStandardModalWidth(this);
    // Live-refresh the list while the modal is open: activating a project,
    // creating one from the embedded form, or deleting one all re-render it
    // in place — the user never has to reopen the modal to see the result.
    this.unsubscribers.push(
      this.plugin.eventBus.on('projectChanged', () => this.renderList()),
      this.plugin.eventBus.on('projectsChanged', () => this.renderList()),
    );
    this.renderList();
  }

  private renderList(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Manage projects' });

    const projects = this.plugin.projectManager.getAllProjects();

    if (projects.length === 0) {
      contentEl.createEl('p', {
        text: 'No projects yet. Create one to start adding papers.',
      });
      this.renderCreateButton(contentEl);
      return;
    }

    for (const project of projects) {
      this.renderProjectRow(contentEl, project);
    }
    this.renderCreateButton(contentEl);
  }

  private renderProjectRow(root: HTMLElement, project: Project): void {
    // Verify the folder still exists; warn if the user moved or deleted it.
    const folder = this.plugin.app.vault.getAbstractFileByPath(project.folderPath);
    const folderOk = folder instanceof TFolder;

    new Setting(root)
      .setName(project.name)
      .setDesc(
        folderOk
          ? `Folder: ${project.folderPath}`
          : `\u26a0\ufe0f Folder missing: ${project.folderPath}`,
      )
      .addButton((btn) => {
        btn.setButtonText(project.isActive ? 'Active' : 'Activate').setDisabled(project.isActive);
        if (!project.isActive) {
          btn.onClick(async () => {
            await this.plugin.projectManager.activateProject(project.id);
            new Notice(`ResearchVault: "${project.name}" is now active.`);
            this.close();
          });
        }
      })
      .addButton((btn) => {
        btn.setButtonText('Delete').setWarning();
        btn.onClick(async () => {
          if (this.busy) return;
          this.busy = true;
          try {
            // Same copy + guard as the settings-tab delete flow: explicit
            // confirmation, and files on disk are never touched.
            const ok = await ConfirmModal.ask(this.app, {
              title: 'Delete project',
              message: `Delete project "${project.name}"?\n\nFiles on disk are untouched.`,
              confirmLabel: 'Delete',
              cancelLabel: 'Cancel',
              destructive: true,
            });
            if (ok) {
              await this.plugin.projectManager.deleteProject(project.id);
              // The list refreshes itself via `projectsChanged` (emitted for
              // every deletion, including the last one).
            }
          } finally {
            this.busy = false;
          }
        });
      });
  }

  private renderCreateButton(root: HTMLElement): void {
    new Setting(root)
      .setName('New project')
      .setDesc('Creates a folder in the vault and makes it the active project.')
      .addButton((btn) =>
        btn
          .setButtonText('Create')
          .setCta()
          .onClick(() => {
            // Stacked modal: the create form opens on top; on success its
            // `projectChanged` emission refreshes this list underneath.
            new CreateProjectModal(this.app, this.plugin).open();
          }),
      );
  }

  onClose(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    this.contentEl.empty();
  }
}
