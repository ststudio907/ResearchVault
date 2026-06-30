// src/services/project-manager.ts
//
// CRUD and activation for `Project` records. All persistence flows through
// `ResearchVaultPlugin.saveSettings()` so the lifecycle matches Obsidian's
// built-in plugin data store and survives hot-reloads, vault moves, and
// plugin updates.
//

import { TFile, TFolder, normalizePath, Notice } from 'obsidian';
import type { Project, ProjectCreateConfig, ProjectStats, Paper, PaperSource, ReadingStatus } from '../types';
import { READING_STATUSES } from '../types';
import { newId } from '../utils/uuid';
import type { ResearchVaultPlugin } from '../core/plugin';

export type { Project, ProjectCreateConfig };

/**
 * Owns a project's lifecycle: folder binding, activation invariant, stats,
 * and file filtering. Emits events through the plugin's EventBus.
 */
export class ProjectManager {
  /** Cached active project id so repeated reads are O(1). Updated on every `activateProject`. */
  private activeId: string | null = null;

  constructor(private readonly plugin: ResearchVaultPlugin) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Called from `ResearchVaultPlugin.onload()`. Normalises the settings
   * payload (only one project may be active) and primes the active id cache.
   */
  hydrate(): void {
    const projects = this.plugin.settings.projects;
    const actives = projects.filter((p) => p.isActive);

    if (actives.length === 0) {
      this.activeId = null;
      return;
    }

    if (actives.length === 1) {
      this.activeId = actives[0]?.id ?? null;
      return;
    }

    // Defensive: more than one active — keep most recently updated, deactivate the rest.
    const sorted = [...actives].sort((a, b) => b.updatedAt - a.updatedAt);
    this.activeId = sorted[0]?.id ?? null;
    for (const project of sorted.slice(1)) {
      project.isActive = false;
    }
  }

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  /**
   * Create a project, ensuring its folder exists. The new project is added to
   * settings but not activated; call `activateProject()` separately when the
   * user intends to switch into it.
   */
  async createProject(config: ProjectCreateConfig): Promise<Project> {
    const name = config.name.trim();
    const folderPath = normalizePath(config.folderPath.trim());

    if (!name) {
      throw new Error('Project name is required.');
    }
    if (!folderPath) {
      throw new Error('Project folder path is required.');
    }

    const collision = this.plugin.settings.projects.find(
      (p) =>
        p.folderPath.toLowerCase() === folderPath.toLowerCase() ||
        p.name.toLowerCase() === name.toLowerCase(),
    );
    if (collision) {
      throw new Error(
        collision.folderPath.toLowerCase() === folderPath.toLowerCase()
          ? `A project already uses the folder "${folderPath}".`
          : `A project is already named "${name}".`,
      );
    }

    await this.ensureFolder(folderPath);

    const now = Date.now();
    const project: Project = {
      id: newId(),
      name,
      folderPath,
      description: config.description?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
      isActive: false,
      settings: {
        paperTemplate:
          config.paperTemplate ?? this.plugin.settings.templates.paper,
        noteTemplate: this.plugin.settings.templates.note,
        citationStyle:
          config.citationStyle ?? this.plugin.settings.globalCitationStyle,
        autoExtractMetadata: false,
        excludedFolders: [...this.plugin.settings.globalExcludedFolders],
        customFields: [],
        aiProvider: this.plugin.settings.ai.provider,
        aiModel: this.plugin.settings.ai.model,
      },
    };

    this.plugin.settings.projects.push(project);
    await this.persist();

    this.plugin.eventBus.emit('projectChanged', project);
    return project;
  }

  /** Update any subset of mutable project fields. Bumps `updatedAt`. */
  async updateProject(
    id: string,
    updates: Partial<
      Omit<Project, 'id' | 'createdAt' | 'isActive' | 'settings'>
    > & { settings?: Partial<Project['settings']> },
  ): Promise<Project> {
    const project = this.requireProject(id);
    const next: Project = {
      ...project,
      ...updates,
      settings: { ...project.settings, ...(updates.settings ?? {}) },
      updatedAt: Date.now(),
    };
    this.replaceProject(next);
    await this.persist();
    this.plugin.eventBus.emit('projectChanged', next);
    return next;
  }

  /** Permanently remove a project record from settings. Does NOT delete its folder from the vault. */
  async deleteProject(id: string): Promise<void> {
    const project = this.requireProject(id);
    this.plugin.settings.projects = this.plugin.settings.projects.filter(
      (p) => p.id !== id,
    );
    if (this.activeId === id) this.activeId = null;
    await this.persist();

    // Emit any remaining project so subscribers can refresh; if none, no-op.
    const fallback = this.plugin.settings.projects[0];
    if (fallback) {
      this.plugin.eventBus.emit('projectChanged', fallback);
    }
  }

  // -------------------------------------------------------------------------
  // Activation
  // -------------------------------------------------------------------------

  /** Marks the project as active and clears `isActive` on every other project. Emits `projectChanged`. */
  async activateProject(id: string): Promise<void> {
    const target = this.requireProject(id);
    const updatedAt = Date.now();
    const next = this.plugin.settings.projects.map<Project>((p) => ({
      ...p,
      isActive: p.id === id,
      updatedAt: p.id === id ? updatedAt : p.updatedAt,
    }));
    this.plugin.settings.projects = next;
    this.activeId = id;
    await this.persist();
    this.plugin.eventBus.emit('projectChanged', target);
  }

  /** Currently active project or `null` if none. */
  getActiveProject(): Project | null {
    if (!this.activeId) return null;
    return (
      this.plugin.settings.projects.find((p) => p.id === this.activeId) ??
      null
    );
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** All known projects in insertion order. */
  getAllProjects(): Project[] {
    return [...this.plugin.settings.projects];
  }

  /** Look up by id; returns undefined for unknown ids instead of throwing. */
  getProjectById(id: string): Project | undefined {
    return this.plugin.settings.projects.find((p) => p.id === id);
  }

  /**
   * Recompute `ProjectStats`. The count of papers is approximated from the
   * files inside `<folderPath>/papers/`. Sprint 2 will replace this with a
   * cached frontmatter parse so it stays accurate as the vault grows.
   */
  getProjectStats(id: string): ProjectStats {
    const project = this.requireProject(id);
    const papersByStatus: Record<ReadingStatus, number> = Object.fromEntries(
      READING_STATUSES.map((s) => [s, 0]),
    ) as Record<ReadingStatus, number>;
    const papers = this.getProjectPapers(id);
    for (const paper of papers) {
      papersByStatus[paper.status] = (papersByStatus[paper.status] ?? 0) + 1;
    }
    const papersRoot = `${project.folderPath.replace(/\/+$/, '')}/papers`;
    const notes = this.getProjectFiles(id).filter(
      (f) => !f.path.includes(`${papersRoot}/`),
    );
    return {
      totalPapers: papers.length,
      papersByStatus,
      totalNotes: notes.length,
      lastActivity: project.updatedAt,
      aiTokensUsed: 0, // Wired up in Sprint 4 once AIClient tracks usage.
    };
  }

  /** Every markdown file living inside the project's folder hierarchy. */
  getProjectFiles(projectId: string): TFile[] {
    const project = this.requireProject(projectId);
    const prefix = project.folderPath.replace(/\/+$/, '');
    return this.plugin.app.vault.getMarkdownFiles().filter((f) => {
      const normalized = f.path.replace(/\/+$/, '');
      return normalized === prefix || normalized.startsWith(`${prefix}/`);
    });
  }

  /**
   * Markdown files inside the project's `papers/` subfolder. In Sprint 1
   * this is a best-effort filter by path; Sprint 2 will validate YAML
   * frontmatter to confirm a note really represents a paper.
   */
  getProjectPapers(projectId: string): Paper[] {
    const project = this.requireProject(projectId);
    const papersRoot = `${project.folderPath.replace(/\/+$/, '')}/papers`;
    return this.getProjectFiles(projectId)
      .filter((f) => f.path.startsWith(`${papersRoot}/`))
      .map((f) =>
        this.mapFileToPaper(f, project.id, project.folderPath, 'imported'),
      );
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private requireProject(id: string): Project {
    const project = this.getProjectById(id);
    if (!project) {
      new Notice(`ResearchVault: no project with id "${id}".`);
      throw new Error(`Project not found: ${id}`);
    }
    return project;
  }

  private replaceProject(next: Project): void {
    this.plugin.settings.projects = this.plugin.settings.projects.map((p) =>
      p.id === next.id ? next : p,
    );
  }

  private async persist(): Promise<void> {
    await this.plugin.saveSettings();
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    const existing = this.plugin.app.vault.getAbstractFileByPath(folderPath);
    if (existing instanceof TFolder) return;
    if (existing) {
      throw new Error(`"${folderPath}" exists and is not a folder.`);
    }
    await this.plugin.app.vault.createFolder(folderPath).catch((err: unknown) => {
      // Two plugin instances racing for the same folder: ignore "already exists" races.
      const msg = err instanceof Error ? err.message : String(err);
      if (!/exists/i.test(msg)) throw err;
    });
  }

  /**
   * Build a stub `Paper` from a markdown filename. Used by `getProjectPapers`
   * to surface a count in Sprint 1 stats before PaperService exists; the
   * real parse lives in Sprint 2.
   */
  private mapFileToPaper(
    file: TFile,
    projectId: string,
    folderPath: string,
    source: PaperSource,
  ): Paper {
    const stem = file.basename;
    return {
      id: stem,
      citekey: stem,
      title: stem,
      authors: [],
      year: new Date(file.stat.ctime).getFullYear(),
      keywords: [],
      status: 'unread',
      priority: 'medium',
      dateAdded: file.stat.ctime,
      dateModified: file.stat.mtime,
      quotes: [],
      claims: [],
      citations: [],
      citedBy: [],
      related: [],
      customFields: { projectId },
      source,
      importedFrom: folderPath,
    };
  }
}
