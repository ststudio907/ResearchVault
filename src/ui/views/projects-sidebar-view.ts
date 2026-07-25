// src/ui/views/projects-sidebar-view.ts
//
// Right-rail ItemView that lists every paper in the active project. Layout,
// top to bottom:
//
//   1. Project name + switch button (title row)
//   2. Full-width search input (sticky, 80 ms debounce)
//   3. Full-width "Add paper" button
//   4. Body — a derived "Needs action" group (red), followed by the
//      per-status groups in a fixed lifecycle order.
//
// Reacts to the plugin's typed event bus so the view stays in sync with
// `PaperService` without polling.

import { ItemView, WorkspaceLeaf, Notice, setIcon } from 'obsidian';
import type { ResearchVaultPlugin } from '../../core/plugin';
import type { Paper, Priority, ReadingStatus } from '../../types';
import { PRIORITIES, READING_STATUSES } from '../../types';
import { formatPaperDate } from '../../utils/format-date';

// `formatPaperDate` is the canonical "date" formatter for the sidebar (D24).
// Status / priority editing in-row use the small inline `<select>` controls
// and call `paperService.updatePaper` so the global change listeners stay
// consistent with modal-driven edits.

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

/**
 * Staleness window for the "Needs action" group. A paper that has been in
 * `skimming` or `annotating` for longer than this is treated as stagnant.
 * D20 — derived only; not a stored field.
 */
const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

/** Statuses considered "actively being worked on" by default. */
const ACTIVE_STATUSES: ReadonlySet<ReadingStatus> = new Set<ReadingStatus>([
  'reading',
  'skimming',
  'annotating',
]);

/** Statuses that can become stale (>14 days in the same state). */
const STALEABLE_STATUSES: ReadonlySet<ReadingStatus> = new Set<ReadingStatus>([
  'skimming',
  'annotating',
]);

/** Priority weight for the Needs-action sort. Higher = earlier. */
function priorityWeight(p: Paper['priority']): number {
  switch (p) {
    case 'critical':
      return 3;
    case 'high':
      return 2;
    case 'medium':
      return 1;
    case 'low':
      return 0;
    default:
      return 0;
  }
}

export class ProjectsSidebarView extends ItemView {
  /** Shorthand to mirror the pattern in `settings-tab`. */
  private readonly rv: ResearchVaultPlugin;
  /** Holds the unsubscribe handles returned by `eventBus.on()` so `onClose` is idempotent. */
  private readonly unsubscribers: Array<() => void> = [];
  /** Current search box value; preserved across re-renders triggered by index updates. */
  private currentQuery = '';
  /** Debounce handle for the search input. */
  private searchDebounce: number | null = null;

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
    // Most updates only need to refresh the paper list — the header (with
    // the search input) is rendered once on `onOpen` and stays mounted
    // so its focus is never blown away by a re-render. `projectChanged`
    // does a full re-render because switching projects should also clear
    // any in-flight search query.
    this.unsubscribers.push(
      this.rv.eventBus.on('paperImported', () => this.renderList()),
      this.rv.eventBus.on('paperUpdated', () => this.renderList()),
      this.rv.eventBus.on('paperRemoved', () => this.renderList()),
      this.rv.eventBus.on('paperStatusChanged', () => this.renderList()),
      this.rv.eventBus.on('projectChanged', () => {
        this.currentQuery = '';
        this.render();
      }),
      // Refresh results list when the indexer adds/removes/rebuilds records
      // (e.g. a quote was captured while the user is mid-typing a query).
      this.rv.eventBus.on('indexUpdated', () => this.renderList()),
    );
    this.render();
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    for (const off of this.unsubscribers.splice(0)) off();
    if (this.searchDebounce !== null) {
      window.clearTimeout(this.searchDebounce);
      this.searchDebounce = null;
    }
    this.contentEl.empty();
    return Promise.resolve();
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  /**
   * Full re-render of the sidebar. Called on `onOpen` and on project switch.
   * For in-place updates (search filter, paper import, status change,
   * indexer refresh) call `renderList()` instead so the header (and the
   * search input focused inside it) is never blown away.
   */
  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('researchvault-sidebar');

    // Header is mounted once per full render. It contains the search
    // input; leaving it mounted across keystrokes is what keeps the input
    // focused.
    this.renderHeader(contentEl);

    // Persistent list container — only its children are cleared /
    // re-created in `renderList()`. The container itself is not replaced.
    contentEl.createDiv({ cls: 'researchvault-sidebar-list' });

    this.renderList();
  }

  /**
   * Re-create only the paper list section. Safe to call on every state
   * change; the header (with the focused search input) is left untouched
   * so the user keeps typing without re-clicking the field.
   */
  private renderList(): void {
    const listEl =
      this.contentEl.querySelector<HTMLElement>('.researchvault-sidebar-list');
    if (!listEl) {
      // View not yet opened (or full render was bypassed). Fall back to a
      // full render so the header + list container get mounted.
      this.render();
      return;
    }
    listEl.replaceChildren();

    const active = this.rv.projectManager.getActiveProject();
    if (!active) {
      listEl.createEl('p', {
        text: 'No active project. Use the "switch active project" command to pick one.',
        cls: 'researchvault-sidebar-empty',
      });
      return;
    }

    const papers = this.rv.paperService.getInProject(active.id);
    if (papers.length === 0) {
      listEl.createEl('p', {
        text: 'No papers in this project yet. Use "add paper" to import one.',
        cls: 'researchvault-sidebar-empty',
      });
      return;
    }

    // When the user has typed a query, the indexer gives us a fuzzy-matched
    // subset across the whole vault. We still constrain by active project
    // membership at render time so the user never sees a paper from a
    // different project mixed in.
    const trimmed = this.currentQuery.trim();
    if (trimmed) {
      const hits = this.rv.vaultIndexer.searchPapers(trimmed);
      const activePapers = new Set(papers.map((p) => p.id));
      const scoped = hits.filter((p) => activePapers.has(p.id));
      if (scoped.length === 0) {
        listEl.createEl('p', {
          text: `No papers match "${trimmed}" in this project.`,
          cls: 'researchvault-sidebar-empty',
        });
        return;
      }
      this.renderGroup(listEl, 'results', scoped);
      return;
    }

    // Derived "Needs action" group. Computed every render (cheap; it's just
    // a filter + sort over the in-memory list). Empty -> nothing rendered.
    const needsAction = computeNeedsAction(papers);
    if (needsAction.length > 0) {
      this.renderGroup(listEl, 'needs-action', needsAction);
    }

    const groups = groupByStatus(papers);
    for (const status of STATUS_ORDER) {
      const rows = groups.get(status);
      if (!rows || rows.length === 0) continue;
      this.renderGroup(listEl, status, rows);
    }
  }

  private renderHeader(root: HTMLElement): void {
    const header = root.createDiv({ cls: 'researchvault-sidebar-header' });

    // --- Row 1: project name + switch button -------------------------------
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

    // --- Row 2: search input (sticky, full-width) -------------------------
    // 80ms debounce so quick typing doesn't trigger a render per keystroke.
    const searchInput = header.createEl('input', {
      cls: 'researchvault-sidebar-search',
      attr: {
        type: 'search',
        placeholder: 'Filter papers\u2026',
        'aria-label': 'Filter papers',
      },
    });
    searchInput.value = this.currentQuery;
    searchInput.addEventListener('input', () => {
      const next = searchInput.value;
      this.currentQuery = next;
      if (this.searchDebounce !== null) {
        window.clearTimeout(this.searchDebounce);
      }
      this.searchDebounce = window.setTimeout(() => {
        this.searchDebounce = null;
        this.renderList();
      }, 80);
    });

    // --- Row 3: Add paper button (full-width) -----------------------------
    const addBtn = header.createEl('button', {
      text: 'Add paper',
      cls: 'mod-cta researchvault-sidebar-add',
    });
    addBtn.addEventListener('click', () => {
      // `openAddPaper` is added by `ResearchVaultPlugin` in 2.5 \u2014 it routes
      // to the active project and opens the import modal.
      this.rv.openAddPaperModal();
    });
  }

  /**
   * Render one group's rows. The DOM shape is identical between virtual and
   * real groups so icons never reflow as the user types into the search box
   * \u2014 only the `<select>` controls toggle between enabled/disabled.
   * (3.1b \u2014 sidebar row polish.)
   */
  private renderGroup(
    root: HTMLElement,
    status: ReadingStatus | 'results' | 'needs-action',
    papers: Paper[],
  ): void {
    const isVirtual = status === 'results' || status === 'needs-action';
    const section = root.createDiv({
      cls: [
        'researchvault-sidebar-group',
        `researchvault-sidebar-group--${status}`,
      ].join(' '),
    });
    const heading = section.createDiv({ cls: 'researchvault-sidebar-group-heading' });
    const headingText =
      status === 'results'
        ? 'Results'
        : status === 'needs-action'
          ? 'Needs action'
          : titleCase(status);
    heading.createEl('span', { text: headingText });
    heading.createEl('span', {
      text: String(papers.length),
      cls: 'researchvault-sidebar-group-count',
    });

    for (const paper of papers) {
      const row = section.createDiv({ cls: 'researchvault-sidebar-row' });

      // Single clickable wrapper. Bail out of click-to-open when the target is
      // an interactive child (button / select / link) so the inline controls
      // don't accidentally navigate.
      const content = row.createDiv({ cls: 'researchvault-sidebar-row-content' });
      content.addEventListener('click', (e) => {
        if (e.target instanceof Element && e.target.closest('button, select, a')) return;
        this.openPaper(paper);
      });

      // ---- Line 1: title + edit pencil (right) -----------------------------
      const line1 = content.createDiv({ cls: 'researchvault-sidebar-row-line researchvault-sidebar-row-line--title' });
      line1.createEl('div', { text: paper.title, cls: 'researchvault-sidebar-row-title' });
      const editBtn = line1.createEl('button', {
        cls: 'clickable-icon researchvault-sidebar-edit-btn',
        attr: { 'aria-label': 'Edit paper', title: 'Edit paper' },
      });
      setIcon(editBtn, 'pencil');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.rv.openEditPaperModal(paper);
      });

      // ---- Line 2: citekey / year / (needs-action tag) --------------------
      const line2 = content.createDiv({ cls: 'researchvault-sidebar-row-line researchvault-sidebar-row-line--meta' });
      line2.createEl('span', { text: paper.citekey, cls: 'researchvault-sidebar-row-citekey' });
      line2.createEl('span', { text: ' \u00b7 ', cls: 'researchvault-sidebar-row-meta-sep' });
      line2.createEl('span', { text: String(paper.year), cls: 'researchvault-sidebar-row-year' });
      if (status === 'needs-action') {
        const reason = needsActionReason(paper);
        if (reason) {
          const tag = line2.createEl('span', { text: reason, cls: 'researchvault-sidebar-row-tag' });
          tag.setAttribute('aria-label', `Needs action: ${reason}`);
          tag.setAttribute('title', `Needs action: ${reason}`);
        }
      }

      // ---- Line 3: status + priority selects + quote glyph (right) --------
      const line3 = content.createDiv({ cls: 'researchvault-sidebar-row-line researchvault-sidebar-row-line--controls' });

      const statusSelect = line3.createEl('select', {
        cls: 'dropdown researchvault-sidebar-status',
      });
      for (const candidate of READING_STATUSES) {
        statusSelect.createEl('option', { text: titleCase(candidate), value: candidate });
      }
      statusSelect.value = paper.status;
      // Virtual buckets don't have a single "current" status; we keep the
      // dropdown in place so layout doesn't reflow but disable it.
      statusSelect.disabled = isVirtual;
      statusSelect.addEventListener('change', () => {
        void this.changeStatus(paper.id, statusSelect.value as ReadingStatus);
      });
      statusSelect.addEventListener('click', (e) => e.stopPropagation());

      const prioritySelect = line3.createEl('select', {
        cls: 'dropdown researchvault-sidebar-priority',
      });
      for (const candidate of PRIORITIES) {
        prioritySelect.createEl('option', { text: titleCase(candidate), value: candidate });
      }
      prioritySelect.value = paper.priority;
      prioritySelect.addEventListener('change', () => {
        void this.changePriority(paper.id, prioritySelect.value as Priority);
      });
      prioritySelect.addEventListener('click', (e) => e.stopPropagation());

      const quoteBtn = line3.createEl('button', {
        cls: 'clickable-icon researchvault-sidebar-quote-btn',
        attr: { 'aria-label': 'Capture quote', title: 'Capture quote' },
      });
      setIcon(quoteBtn, 'quote');
      quoteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.rv.openQuoteCaptureModal({ defaultPaperId: paper.id });
      });

      // ---- Date line: "Added Jul 11, 2026, 14:30" -------------------------
      const dateLine = content.createDiv({ cls: 'researchvault-sidebar-row-line researchvault-sidebar-row-line--date' });
      dateLine.createEl('span', { text: 'Added ', cls: 'researchvault-sidebar-row-date-label' });
      dateLine.createEl('span', {
        text: formatPaperDate(paper.dateAdded, { withTime: true }),
        cls: 'researchvault-sidebar-row-date-value',
      });
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

  /**
   * Fire-and-forget priority change. Routes through `updatePaper` so listeners
   * see the canonical `paperUpdated` event, then re-renders.
   */
  private async changePriority(paperId: string, priority: Priority): Promise<void> {
    try {
      await this.rv.paperService.updatePaper(paperId, { priority });
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

/**
 * D20 \u2014 derived view. A paper lands in "Needs action" when:
 *   - `paper.priority === 'critical'`, OR
 *   - `paper.status in ACTIVE_STATUSES`, OR
 *   - (status in STALEABLE_STATUSES) AND `now - dateAdded > STALE_AFTER_MS`.
 *
 * 2.8.D: `dateModified` now re-stamps on every body edit, so the
 * staleness proxy moved off it. `dateAdded` (creation age) is the new
 * stable proxy: a paper added 14+ days ago that is still in 'skimming'
 * or 'annotating' is genuinely stagnant, regardless of how recently the
 * user typed in the note.
 */
function computeNeedsAction(papers: Paper[]): Paper[] {
  const now = Date.now();
  const matched = papers.filter((p) => {
    if (p.priority === 'critical') return true;
    if (ACTIVE_STATUSES.has(p.status)) return true;
    if (STALEABLE_STATUSES.has(p.status) && now - p.dateAdded > STALE_AFTER_MS) {
      return true;
    }
    return false;
  });
  return sortNeedsAction(matched, now);
}

/**
 * Sort: priority weight desc, then stale-first, then most-recently modified,
 * then title.
 */
function sortNeedsAction(papers: Paper[], now: number): Paper[] {
  return papers.slice().sort((a, b) => {
    const pa = priorityWeight(a.priority);
    const pb = priorityWeight(b.priority);
    if (pa !== pb) return pb - pa;
    const aStale =
      STALEABLE_STATUSES.has(a.status) && now - a.dateAdded > STALE_AFTER_MS;
    const bStale =
      STALEABLE_STATUSES.has(b.status) && now - b.dateAdded > STALE_AFTER_MS;
    if (aStale !== bStale) return aStale ? -1 : 1;
    if (a.dateModified !== b.dateModified) return b.dateModified - a.dateModified;
    return a.title.localeCompare(b.title);
  });
}

/**
 * Human-readable reason a paper surfaced in "Needs action". Used as the
 * small tag rendered next to the title. Falls back to the paper's priority
 * or active status.
 */
function needsActionReason(paper: Paper): string {
  const now = Date.now();
  if (STALEABLE_STATUSES.has(paper.status) && now - paper.dateAdded > STALE_AFTER_MS) {
    const days = Math.floor((now - paper.dateAdded) / (24 * 60 * 60 * 1000));
    return `Stale ${days}d \u00b7 ${titleCase(paper.status)}`;
  }
  if (paper.priority === 'critical') {
    return `Critical \u00b7 ${titleCase(paper.status)}`;
  }
  return titleCase(paper.status);
}

function titleCase(value: string): string {
  if (!value) return '';
  return value
    .split(' ')
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ');
}
