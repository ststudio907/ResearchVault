// src/ui/settings/settings-tab.ts
//
// Settings UI for ResearchVault. Built on Obsidian's `PluginSettingTab` so the
// layout and theme follow the host app without us re-inventing the chrome.
// Sections, in order: General → Projects → Citations → Zotero → Templates.
// (An AI section existed while AI features were planned; it is hidden until
// those features actually ship — the `settings.ai` schema stays so persisted
// data survives.)
//

import { App, PluginSettingTab, Setting } from 'obsidian';
import type { ResearchVaultPlugin } from '../../core/plugin';
import {
  DEFAULT_PDF_LIBRARY_FOLDER,
  normalizePdfLibraryFolder,
} from '../../services/papers/paper-matching';
import { ConfirmModal } from '../modals/confirm-modal';

export class ResearchVaultSettingTab extends PluginSettingTab {
  /** Alias keeps `this.plugin.settings` lines short without a confused `plugin.plugin`. */
  private readonly rv: ResearchVaultPlugin;

  constructor(app: App, plugin: ResearchVaultPlugin) {
    super(app, plugin);
    this.rv = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderGeneral(containerEl);
    this.renderProjects(containerEl);
    this.renderCitations(containerEl);
    this.renderZotero(containerEl);
    this.renderTemplates(containerEl);
  }

  // -------------------------------------------------------------------------
  // General
  // -------------------------------------------------------------------------

  private renderGeneral(root: HTMLElement): void {
    // 5.4 audit (D37 posture): the "Default citation style" dropdown was inert —
    // nothing reads `globalCitationStyle` / `project.settings.citationStyle`
    // until the 1.1 Cite & ship export flow, and D39 locks style selection to
    // export time, never at insert/create. The schema field stays so persisted
    // payloads keep loading; re-introduce the control with the export command.

    new Setting(root)
      .setName('Default excluded folders')
      .setDesc('Comma-separated vault paths new projects will skip during indexing.')
      .addText((text) => {
        text.setPlaceholder('Config folder, .trash');
        text.setValue(this.rv.settings.globalExcludedFolders.join(', '));
        text.onChange(async (value) => {
          this.rv.settings.globalExcludedFolders = value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          await this.rv.saveSettings();
        });
      });

    new Setting(root)
      .setName('PDF library folder')
      .setDesc(
        'Vault-level folder that stores attached PDFs, shared by all projects. ' +
          'Existing per-project copies keep working; only new attachments land here.',
      )
      .addText((text) => {
        text.setPlaceholder(DEFAULT_PDF_LIBRARY_FOLDER);
        text.setValue(this.rv.settings.pdfLibraryFolder);
        text.onChange(async (value) => {
          this.rv.settings.pdfLibraryFolder = normalizePdfLibraryFolder(value);
          await this.rv.saveSettings();
        });
      });
  }

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  private renderProjects(root: HTMLElement): void {
    new Setting(root).setName("Projects").setHeading();

    new Setting(root)
      .setName('Create a new project')
      .setDesc('Opens a modal that accepts a name and a vault folder path.')
      .addButton((button) =>
        button.setButtonText('Create project').onClick(() => this.rv.openCreateProjectModal()),
      );

    const projects = this.rv.projectManager.getAllProjects();
    if (projects.length === 0) {
      root.createEl('p', {
        text: 'No projects yet. Create one above to get started.',
        cls: 'setting-item-description',
      });
      return;
    }

    const list = root.createEl('div', { cls: 'rv-project-list' });
    for (const project of projects) {
      const row = new Setting(list)
        .setName(project.name)
        .setDesc(
          [
            project.isActive ? '🟢 Active' : '⚪ Inactive',
            `Folder: ${project.folderPath}`,
            project.description ? `— ${project.description}` : '',
          ]
            .filter(Boolean)
            .join(' '),
        );

      if (!project.isActive) {
        row.addButton((btn) =>
          btn.setButtonText('Activate').onClick(async () => {
            await this.rv.projectManager.activateProject(project.id);
            this.display();
          }),
        );
      }

      row.addButton((btn) =>
        btn
          .setButtonText('Delete')
          .setWarning()
          .onClick(async () => {
            const ok = await ConfirmModal.ask(this.app, {
              title: 'Delete project',
              message: `Delete project "${project.name}"?\n\nFiles on disk are untouched.`,
              confirmLabel: 'Delete',
              cancelLabel: 'Cancel',
              destructive: true,
            });
            if (!ok) return;
            await this.rv.projectManager.deleteProject(project.id);
            this.display();
          }),
      );
    }
  }


  // -------------------------------------------------------------------------
  // Citations (4.1.D)
  // -------------------------------------------------------------------------

  private renderCitations(root: HTMLElement): void {
    new Setting(root).setName("Citation lookup").setHeading();
    root.createEl('p', {
      text:
        'Lookups send only the DOI or search string. We do not send your vault contents, file names, or paper notes. No analytics. API responses are cached locally (30 days by default).',
      cls: 'setting-item-description',
    });

    new Setting(root)
      .setName('Enable citation lookup')
      .addToggle((toggle) => {
        toggle.setValue(Boolean(this.rv.settings.citation.enableCitationLookup));
        toggle.onChange(async (value) => {
          this.rv.settings.citation.enableCitationLookup = value;
          await this.rv.saveSettings();
        });
      });

    new Setting(root)
      .setName('Preferred provider')
      .setDesc('Crossref is the canonical DOI registry. OpenAlex covers a wider corpus.')
      .addDropdown((dropdown) => {
        dropdown.addOption('crossref', 'Crossref');
        dropdown.addOption('openalex', 'OpenAlex');
        dropdown.setValue(this.rv.settings.citation.preferredProvider);
        dropdown.onChange(async (value) => {
          this.rv.settings.citation.preferredProvider = value as typeof this.rv.settings.citation.preferredProvider;
          await this.rv.saveSettings();
        });
      });

    new Setting(root)
      .setName('Polite contact')
      .setDesc(
        'Optional contact email, sent to your lookup provider to join its polite ' +
          'pool. Leave empty to stay anonymous; anonymous requests are throttled more.',
      )
      .addText((text) => {
        text.setPlaceholder('you@example.com');
        text.setValue(this.rv.settings.citation.politeContact);
        text.onChange(async (value) => {
          this.rv.settings.citation.politeContact = value.trim();
          await this.rv.saveSettings();
        });
      });

    new Setting(root)
      .setName('Cache TTL (days)')
      .setDesc('In-memory LRU cache entry lifetime. Default 30.')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.setValue(String(this.rv.settings.citation.cacheTtlDays));
        text.onChange(async (value) => {
          const n = Number(value);
          if (Number.isFinite(n) && n > 0) {
            this.rv.settings.citation.cacheTtlDays = n;
            await this.rv.saveSettings();
          }
        });
      });

    new Setting(root)
      .setName('Cache max entries')
      .setDesc('Maximum number of entries in the LRU cache. Default 500.')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.setValue(String(this.rv.settings.citation.cacheMaxEntries));
        text.onChange(async (value) => {
          const n = Number(value);
          if (Number.isFinite(n) && n > 0) {
            this.rv.settings.citation.cacheMaxEntries = n;
            await this.rv.saveSettings();
          }
        });
      });

    new Setting(root)
      .setName('Rate limit (requests/sec)')
      .setDesc('Token-bucket refill rate. Default 5.')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.setValue(String(this.rv.settings.citation.rateLimitRps));
        text.onChange(async (value) => {
          const n = Number(value);
          if (Number.isFinite(n) && n > 0) {
            this.rv.settings.citation.rateLimitRps = n;
            await this.rv.saveSettings();
          }
        });
      });

    new Setting(root)
      .setName('Rate limit burst')
      .setDesc('Token-bucket capacity (burst). Default 10.')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.setValue(String(this.rv.settings.citation.rateLimitBurst));
        text.onChange(async (value) => {
          const n = Number(value);
          if (Number.isFinite(n) && n > 0) {
            this.rv.settings.citation.rateLimitBurst = n;
            await this.rv.saveSettings();
          }
        });
      });
  }

  // -------------------------------------------------------------------------
  // Zotero
  // -------------------------------------------------------------------------

  /**
   * 5.1 — Zotero web API read-in (D30 layer a). Opt-in: master toggle +
   * credentials + library targeting + tag filter. Nothing hits
   * api.zotero.org until the toggle is on and a userID is set.
   */
  private renderZotero(root: HTMLElement): void {
    new Setting(root).setName('Zotero sync').setHeading();
    root.createEl('p', {
      text: 'Read-only pull from the Zotero web API. Sends only library read requests to api.zotero.org — nothing from your vault is sent. Create a key at zotero.org/settings/keys (library read permission is enough).',
      cls: 'setting-item-description',
    });

    new Setting(root)
      .setName('Enable Zotero sync')
      .setDesc('Off by default. When on, a "Zotero…" button appears in the add-paper modal.')
      .addToggle((toggle) => {
        toggle.setValue(this.rv.settings.zotero.enableZoteroSync);
        toggle.onChange(async (value) => {
          this.rv.settings.zotero.enableZoteroSync = value;
          await this.rv.saveSettings();
        });
      });

    new Setting(root)
      .setName('Account ID')
      .setDesc('Numeric ID from your Zotero account settings, not your username.')
      .addText((text) => {
        text.setPlaceholder('12345678');
        text.setValue(this.rv.settings.zotero.userID);
        text.onChange(async (value) => {
          this.rv.settings.zotero.userID = value.trim();
          await this.rv.saveSettings();
        });
      });

    new Setting(root)
      .setName('API key')
      .setDesc('Stored locally in this vault\'s plugin settings. Read-only key is sufficient.')
      .addText((text) => {
        text.inputEl.type = 'password';
        text.setPlaceholder('Paste your Zotero API key');
        text.setValue(this.rv.settings.zotero.apiKey);
        text.onChange(async (value) => {
          this.rv.settings.zotero.apiKey = value.trim();
          await this.rv.saveSettings();
        });
      });

    new Setting(root)
      .setName('Library type')
      .setDesc('Personal library, or a group library by ID.')
      .addDropdown((dropdown) => {
        dropdown.addOption('user', 'Personal library');
        dropdown.addOption('group', 'Group library');
        dropdown.setValue(this.rv.settings.zotero.libraryType);
        dropdown.onChange(async (value) => {
          this.rv.settings.zotero.libraryType = value === 'group' ? 'group' : 'user';
          await this.rv.saveSettings();
        });
      });

    new Setting(root)
      .setName('Tag filter (optional)')
      .setDesc('Only fetch items carrying this Zotero tag, e.g. "researchvault". Leave blank for all items.')
      .addText((text) => {
        text.setPlaceholder('Example: researchvault');
        text.setValue(this.rv.settings.zotero.tagFilter);
        text.onChange(async (value) => {
          this.rv.settings.zotero.tagFilter = value.trim();
          await this.rv.saveSettings();
        });
      });

    // --- 5.2 (D30 layer b): local push-back -------------------------------
    new Setting(root).setName('Zotero push (desktop)').setHeading();
    root.createEl('p', {
      text:
        'Push papers from the sidebar into the Zotero desktop app. Requires Zotero 7 running on ' +
        'this computer. All traffic stays on this machine (loopback) — nothing is sent to any ' +
        'server. When Zotero is not running, the push button simply does not appear.',
      cls: 'setting-item-description',
    });

    new Setting(root)
      .setName('Enable Zotero push')
      .setDesc('Off by default. When on (and Zotero is running), a push button appears on each sidebar paper row.')
      .addToggle((toggle) => {
        toggle.setValue(this.rv.settings.zotero.enableLocalPush);
        toggle.onChange(async (value) => {
          this.rv.settings.zotero.enableLocalPush = value;
          await this.rv.saveSettings();
        });
      });
  }

  // -------------------------------------------------------------------------
  // Templates
  // -------------------------------------------------------------------------

  private renderTemplates(root: HTMLElement): void {
    new Setting(root).setName('Templates').setHeading();
    root.createEl('p', {
      text:
        'Applied to new paper and note files as they are created; existing ' +
        'files are never rewritten.',
      cls: 'setting-item-description',
    });

    // 5.4 audit: `templates.dailyNote` has no runtime consumer — the textarea
    // was an inert control, so it stays hidden until a daily-note flow reads
    // it (D37 posture, same as the hidden AI section). The schema field stays
    // in the defaults so persisted payloads keep round-tripping.
    const templates: Array<[keyof typeof this.rv.settings.templates, string]> = [
      ['paper', 'Paper template'],
      ['note', 'Note template'],
    ];
    for (const [key, label] of templates) {
      new Setting(root)
        .setName(label)
        .addTextArea((text) => {
          text.setValue(this.rv.settings.templates[key]);
          text.onChange(async (value) => {
            this.rv.settings.templates[key] = value;
            await this.rv.saveSettings();
          });
        });
    }
  }
}
