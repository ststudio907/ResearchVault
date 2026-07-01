// src/ui/views/projects-sidebar-view.ts
//
// Right-rail ItemView that lists every paper in the active project, grouped
// by status, with an inline dropdown for flipping status. Reacts to the
// plugin's typed event bus so the view stays in sync with `PaperService`
// without polling.
//
// Sprint 2 surface: project switcher, paper list, status flip. Filter /
// search is deferred to Sprint 3 alongside the `VaultIndexer` (see
// plans/plan.md §14 — 2.3).
//

import { ItemView, WorkspaceLeaf, Notice, setIcon } from 'obsidian';
import type { ResearchVaultPlugin } from '../../core/plugin';
import type { Paper, ReadingStatus } from '../../types';
import { READING_STATUSES } from '../../types';

/** Stable view id so the same leaf is reused on every "open" call. */
export const VIEW_TYPE_RESEARCHVAULT_SIDEBAR = 'researchvault-sidebar';

/** Status display order in the sidebar (priority then lifecycle). */
const STATUS_ORDER: readonly ReadingStatus[] = [
  'reading',
  'skimming',
  'annotating',
  'queued',
  'unread',
  'summarized',
  'synthesized',
  'archived',
  'excluded',
];

export class ProjectsSidebarView extends ItemView {
  /** Shorthand to mirror the pattern in `settings-tab`. */
  private readonly rv: ResearchVaultPlugin;
  /** Holds the unsubscribe handles returned by `eventBus.on()` so `onClose` is idempotent. */
  private readonly unsubscribers: Array<() => void> = [];

  constructor(leaf: WorkspaceLeaf, plugin: ResearchVaultPlugin) {
    super(leaf);
    this.rv = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_RESEARCHVAULT_SIDEBAR;
  }

  getDisplayText(): string {
    return 'Researchvault';
  }

  getIcon(): string {
    return 'library';
  }

  onOpen(): Promise<void> {
    // Event subscription must happen before the first render so the view
    // does not miss a `paperImported` that fires while we're drawing.
    this.unsubscribers.push(
      this.rv.eventBus.on('paperImported', () => this.render()),
      this.rv.eventBus.on('paperStatusChanged', () => this.render()),
      this.rv.eventBus.on('projectChanged', () => this.render()),
    );
    this.render();
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    for (const off of this.unsubscribers.splice(0)) off();
    this.contentEl.empty();
    return Promise.resolve();
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('researchvault-sidebar');

    this.renderHeader(contentEl);

    const active = this.rv.projectManager.getActiveProject();
    if (!active) {
      contentEl.createEl('p', {
        text: 'No active project. Use the "switch active project" command to pick one.',
        cls: 'researchvault-sidebar-empty',
      });
      return;
    }

    const papers = this.rv.paperService.getInProject(active.id);
    if (papers.length === 0) {
      contentEl.createEl('p', {
        text: 'No papers in this project yet. Use "add paper" to import one.',
        cls: 'researchvault-sidebar-empty',
      });
      return;
    }

    const groups = groupByStatus(papers);
    for (const status of STATUS_ORDER) {
      const rows = groups.get(status);
      if (!rows || rows.length === 0) continue;
      this.renderGroup(contentEl, status, rows);
    }
  }

  private renderHeader(root: HTMLElement): void {
    const header = root.createDiv({ cls: 'researchvault-sidebar-header' });
    const titleRow = header.createDiv({ cls: 'researchvault-sidebar-title-row' });

    const active = this.rv.projectManager.getActiveProject();
    titleRow.createEl('span', {
      text: active ? active.name : 'No active project',
      cls: 'researchvault-sidebar-title',
    });

    const switchBtn = titleRow.createEl('button', {
      cls: 'clickable-icon',
      attr: { 'aria-label': 'Switch active project', title: 'Switch active project' },
    });
    setIcon(switchBtn, 'folders');
    switchBtn.addEventListener('click', () => this.rv.openSwitchProjectModal());

    const addBtn = header.createEl('button', {
      text: 'Add paper',
      cls: 'mod-cta researchvault-sidebar-add',
    });
    addBtn.addEventListener('click', () => {
      // `openAddPaper` is added by `ResearchVaultPlugin` in 2.5 — it routes
      // to the active project and opens the import modal.
      this.rv.openAddPaperModal();
    });
  }

  private renderGroup(
    root: HTMLElement,
    status: ReadingStatus,
    papers: Paper[],
  ): void {
    const section = root.createDiv({ cls: 'researchvault-sidebar-group' });
    const heading = section.createDiv({ cls: 'researchvault-sidebar-group-heading' });
    heading.createEl('span', { text: titleCase(status) });
    heading.createEl('span', {
      text: String(papers.length),
      cls: 'researchvault-sidebar-group-count',
    });

    for (const paper of papers) {
      const row = section.createDiv({ cls: 'researchvault-sidebar-row' });
      const main = row.createDiv({ cls: 'researchvault-sidebar-row-main' });
      main.addEventListener('click', () => this.openPaper(paper));
      main.createEl('div', {
        text: paper.title,
        cls: 'researchvault-sidebar-row-title',
      });
      main.createEl('div', {
        text: `${paper.citekey} · ${paper.year}`,
        cls: 'researchvault-sidebar-row-meta',
      });

      const select = row.createEl('select', { cls: 'dropdown researchvault-sidebar-status' });
      for (const candidate of READING_STATUSES) {
        select.createEl('option', { text: titleCase(candidate), value: candidate });
      }
      // Defer value-set so the DOM has finished parsing the options.
      select.value = status;
      select.addEventListener('change', () => {
        // `EventTarget.addEventListener` expects a `() => void`; we don't
        // need to await the status update here because the sidebar listens
        // to `paperStatusChanged` and re-renders itself.
        void this.changeStatus(paper.id, select.value as ReadingStatus);
      });
      // Prevent click-to-open when interacting with the dropdown.
      select.addEventListener('click', (e) => e.stopPropagation());
    }
  }

  /** Open a paper in the active leaf; falls back to the most recent leaf. */
  private openPaper(paper: Paper): void {
    const projectId = paper.customFields['projectId'];
    const project = typeof projectId === 'string'
      ? this.rv.projectManager.getProjectById(projectId)
      : undefined;
    const folder = project?.folderPath ?? '';
    const path = folder ? `${folder}/papers/${paper.citekey}.md` : `${paper.citekey}.md`;
    void this.rv.app.workspace.openLinkText(path, '/', false);
  }

  /** Fire-and-forget status change with a single error path. */
  private async changeStatus(paperId: string, status: ReadingStatus): Promise<void> {
    try {
      await this.rv.paperService.updateStatus(paperId, status);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`ResearchVault: ${msg}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByStatus(papers: Paper[]): Map<ReadingStatus, Paper[]> {
  const map = new Map<ReadingStatus, Paper[]>();
  for (const paper of papers) {
    const list = map.get(paper.status);
    if (list) list.push(paper);
    else map.set(paper.status, [paper]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.title.localeCompare(b.title));
  }
  return map;
}

function titleCase(value: string): string {
  if (!value) return '';
  return value
    .split(' ')
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ');
}
