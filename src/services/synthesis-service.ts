// src/services/synthesis-service.ts
//
// Synthesis notes (1.1 Slice 1): one claim (the thesis) with evidence blocks
// arranged around it — each block a (source citekey, locator, stance) triple.
// Free-standing synthesis notes live at `<project>/syntheses/<slug>.md`;
// the body is canonical and
// evidence blocks are re-anchored via invisible `<!-- ev:<id> -->` comments
// (see `services/synthesis/synthesis-file-format.ts`).
//
// Reliability model inherited from Slice 0's `addQuote` fix: every mutation
// is staged in memory first, the disk write happens through
// `selfAwareProcess` (echo-marker + atomic `vault.process`), and only a
// successful write commits the index and emits `synthesisUpdated`. A failed
// write leaves memory, disk, and the echo marker exactly as they were.

import { TFile, TFolder, normalizePath } from 'obsidian';
import type { EvidenceBlock, SynthesisNote } from '../types';
import { EVIDENCE_STANCES } from '../types';
import { slugify } from '../utils/citekey';
import { joinFrontmatter, splitFrontmatter } from '../utils/frontmatter';
import { newId } from '../utils/uuid';
import type { ResearchVaultPlugin } from '../core/plugin';
import type { ProjectManager } from './project-manager';
import {
  frontmatterToSynthesis,
  renderSynthesisBody,
  toSynthesisFrontmatter,
  upsertEvidenceSection,
} from './synthesis/synthesis-file-format';
import { SYNC_DEBOUNCE_MS } from './papers/paper-paths';

/** Input shape accepted by `SynthesisService.createSynthesis`. */
export interface SynthesisCreateInput {
  title: string;
  thesis?: string;
  openQuestions?: string[];
}

/** Input shape accepted by `SynthesisService.addEvidence` (id/createdAt are service-assigned). */
export type EvidenceInput = Omit<EvidenceBlock, 'id' | 'createdAt'>;

/**
 * Owns the synthesis-note lifecycle: creation, evidence-block mutation,
 * hydration from disk, and live sync from vault events.
 */
export class SynthesisService {
  /** Active in-memory record of the on-disk synthesis notes, keyed by note id. */
  private byId = new Map<string, SynthesisNote>();
  /** Reverse index: lower-cased canonical path -> note id (O(1) rename/delete handling). */
  private pathToId = new Map<string, string>();
  /** Echo markers for our own writes (same contract as `PaperService`). */
  private selfWritePaths = new Set<string>();
  /** Per-path debounce timers for the vault `modify` handler. */
  private syncTimers = new Map<string, number>();

  constructor(
    private readonly plugin: ResearchVaultPlugin,
    private readonly projectManager: ProjectManager,
  ) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Walk every project's `syntheses/` folder and rebuild the in-memory index
   * from each file. Runs after `paperService.hydrate()` on layout-ready, so
   * Obsidian's metadata cache is warm; reads go through `cachedRead`.
   * Files missing required frontmatter are skipped (logged), never fatal.
   */
  async hydrate(): Promise<void> {
    this.byId.clear();
    this.pathToId.clear();

    for (const project of this.plugin.settings.projects) {
      const folder = this.plugin.app.vault.getAbstractFileByPath(
        this.projectManager.getProjectSynthesesFolder(project.id),
      );
      if (!(folder instanceof TFolder)) continue;

      const files = folder.children.filter(
        (c): c is TFile => c instanceof TFile && c.extension === 'md',
      );
      const notes = await Promise.all(files.map((f) => this.readSynthesisFile(f)));
      for (const note of notes) {
        if (note) this.indexNote(note);
      }
    }

    // 2a: the project hub lives at the project root (outside `syntheses/`),
    // so it needs its own hydration pass. A promoted-in-place hub inside
    // `syntheses/` was already picked up above; this finds the rest.
    for (const project of this.plugin.settings.projects) {
      const hubFile = this.plugin.app.vault.getAbstractFileByPath(
        this.projectManager.getProjectHubPath(project.id),
      );
      if (hubFile instanceof TFile) {
        const note = await this.readSynthesisFile(hubFile);
        if (note) this.indexNote(note);
      }
    }
  }

  /** Cancel pending debounced syncs. Called from `plugin.onunload`. */
  dispose(): void {
    for (const handle of this.syncTimers.values()) window.clearTimeout(handle);
    this.syncTimers.clear();
  }

  // -------------------------------------------------------------------------
  // Read accessors
  // -------------------------------------------------------------------------

  getAll(): SynthesisNote[] {
    return [...this.byId.values()];
  }

  getById(id: string): SynthesisNote | undefined {
    return this.byId.get(id);
  }

  getInProject(projectId: string): SynthesisNote[] {
    return this.getAll().filter((n) => n.projectId === projectId);
  }

  /**
   * Resolve the note owning a vault path. O(1) via `pathToId`; used by the
   * plugin to detect "the active file is a synthesis note" for the
   * evidence-capture commands. Case-insensitive, matching the index keys.
   */
  getByPath(filePath: string): SynthesisNote | undefined {
    const id = this.pathToId.get(normalizePath(filePath).toLowerCase());
    return id ? this.byId.get(id) : undefined;
  }

  /**
   * The project's hub note, if one exists in the index (1.1 Slice 2a). The
   * hub is an ordinary synthesis note with the `hub` flag, marked up by
   * `ensureHub` / `promoteToHub`.
   */
  getHub(projectId: string): SynthesisNote | undefined {
    return this.getInProject(projectId).find((n) => n.hub);
  }

  // -------------------------------------------------------------------------
  // Creation
  // -------------------------------------------------------------------------

  /**
   * Create a synthesis note at `<project>/syntheses/<slug>.md`. The
   * `syntheses/` folder is ensured lazily here (older projects predate it) —
   * consistent with the "no folder creation at startup" contract. The disk
   * write happens first; the index commit and `synthesisCreated` emission
   * only follow success.
   */
  async createSynthesis(projectId: string, input: SynthesisCreateInput): Promise<SynthesisNote> {
    const title = input.title?.trim() ?? '';
    if (!title) {
      throw new Error('SynthesisService.createSynthesis: title is required.');
    }
    const project = this.projectManager.getProjectById(projectId);
    if (!project) {
      throw new Error(`SynthesisService.createSynthesis: project "${projectId}" not found.`);
    }

    await this.projectManager.ensureProjectFolders(projectId);
    const synthesesFolder = this.projectManager.getProjectSynthesesFolder(projectId);
    const slug = this.uniqueSlug(slugify(title) || 'synthesis', synthesesFolder);
    const path = normalizePath(`${synthesesFolder}/${slug}.md`);

    const note: SynthesisNote = {
      id: newId(),
      projectId,
      title,
      thesis: input.thesis?.trim() || undefined,
      evidence: [],
      openQuestions: (input.openQuestions ?? []).map((q) => q.trim()).filter(Boolean),
      path,
      dateAdded: Date.now(),
    };

    const content = joinFrontmatter(toSynthesisFrontmatter(note), renderSynthesisBody(note));
    await this.plugin.app.vault.create(path, content);

    this.indexNote(note);
    this.plugin.eventBus.emit('synthesisCreated', note);
    return note;
  }

  /**
   * Return the project's hub note, creating it on demand (1.1 Slice 2a).
   * The hub materializes at `getProjectHubPath` (the slugified project name
   * at the project root) with the standard synthesis skeleton.
   *
   * If a file already occupies the hub path we adopt it only when it parses
   * as a synthesis note of this project (the user may have moved one there
   * by hand); anything else is the user's own note and is never clobbered —
   * the caller surfaces the error.
   */
  async ensureHub(projectId: string): Promise<SynthesisNote> {
    const existing = this.getHub(projectId);
    if (existing) return existing;

    const project = this.projectManager.getProjectById(projectId);
    if (!project) {
      throw new Error(`SynthesisService.ensureHub: project "${projectId}" not found.`);
    }
    const hubPath = this.projectManager.getProjectHubPath(projectId);

    const occupant = this.plugin.app.vault.getAbstractFileByPath(hubPath);
    if (occupant instanceof TFile) {
      const parsed = await this.readSynthesisFile(occupant);
      if (parsed && parsed.projectId === projectId) {
        this.indexNote(parsed);
        return this.promoteToHub(parsed.id);
      }
      throw new Error(
        `SynthesisService.ensureHub: "${hubPath}" exists and is not a synthesis note of this project — move or rename that file before opening the hub.`,
      );
    }

    const note: SynthesisNote = {
      id: newId(),
      projectId,
      title: project.name,
      evidence: [],
      openQuestions: [],
      path: hubPath,
      dateAdded: Date.now(),
      hub: true,
    };
    const content = joinFrontmatter(toSynthesisFrontmatter(note), renderSynthesisBody(note));
    await this.plugin.app.vault.create(hubPath, content);

    this.indexNote(note);
    this.plugin.eventBus.emit('synthesisCreated', note);
    return note;
  }

  /**
   * Mark an existing synthesis note as the project's hub (1.1 Slice 2a).
   * The file stays where it is — only the frontmatter gains `hub: true` —
   * so hand-written prose outside the known sections is untouched (the body
   * is canonical). Follows the staged-write contract: index + event only on
   * a successful disk write.
   */
  async promoteToHub(synthesisId: string): Promise<SynthesisNote> {
    const current = this.requireById(synthesisId);
    if (current.hub) return current;

    const next: SynthesisNote = { ...current, hub: true };
    const file = this.findNoteFile(current);
    if (!file) {
      throw new Error(
        `SynthesisService: note file for "${current.title}" is missing at "${current.path}".`,
      );
    }

    await this.selfAwareProcess(file, (existing) => {
      const { frontmatter, body } = splitFrontmatter(existing);
      // Frontmatter-only edit — never re-render the body here.
      return joinFrontmatter({ ...frontmatter, hub: true }, body);
    });

    this.indexNote(next);
    this.plugin.eventBus.emit('synthesisUpdated', next);
    return next;
  }

  /** `slug`, `slug-2`, `slug-3`, … until the path is free on disk and in the index. */
  private uniqueSlug(base: string, folder: string): string {
    let candidate = base;
    let n = 1;
    while (
      this.plugin.app.vault.getAbstractFileByPath(normalizePath(`${folder}/${candidate}.md`)) ||
      this.pathToId.has(normalizePath(`${folder}/${candidate}.md`).toLowerCase())
    ) {
      n += 1;
      candidate = `${base}-${n}`;
    }
    return candidate;
  }

  // -------------------------------------------------------------------------
  // Evidence blocks
  // -------------------------------------------------------------------------

  /**
   * Append an evidence block to a synthesis note. Staged write: the block is
   * added to an in-memory copy, the `## Evidence` section is re-rendered in
   * full from that copy, and only a successful disk write commits the index
   * and emits `synthesisUpdated` (Slice 0's atomicity contract, applied from
   * day one).
   */
  async addEvidence(synthesisId: string, input: EvidenceInput): Promise<EvidenceBlock> {
    const note = this.requireById(synthesisId);
    const text = input.text?.trim() ?? '';
    if (!text) {
      throw new Error('SynthesisService.addEvidence: evidence text is required.');
    }
    if (!EVIDENCE_STANCES.includes(input.stance)) {
      throw new Error(`SynthesisService.addEvidence: invalid stance "${String(input.stance)}".`);
    }
    if (!input.citekey?.trim()) {
      throw new Error('SynthesisService.addEvidence: a source citekey is required.');
    }

    const stored: EvidenceBlock = {
      ...input,
      text,
      citekey: input.citekey.trim(),
      locator: input.locator?.trim() || undefined,
      id: newId(),
      createdAt: Date.now(),
    };
    const next: SynthesisNote = { ...note, evidence: [...note.evidence, stored] };
    await this.persistNote(note, next);
    return stored;
  }

  /**
   * Remove an evidence block by id. Same staged-write contract as
   * `addEvidence`; throws when the id is unknown so a stale UI click is loud.
   */
  async removeEvidence(synthesisId: string, evidenceId: string): Promise<void> {
    const note = this.requireById(synthesisId);
    if (!note.evidence.some((b) => b.id === evidenceId)) {
      throw new Error(`SynthesisService.removeEvidence: evidence "${evidenceId}" not found.`);
    }
    const next: SynthesisNote = {
      ...note,
      evidence: note.evidence.filter((b) => b.id !== evidenceId),
    };
    await this.persistNote(note, next);
  }

  /**
   * Shared staged-write pipeline for evidence mutations: resolve the file,
   * re-render the `## Evidence` section from `next`, write atomically with
   * the echo marker armed, then (success only) commit the index and emit
   * `synthesisUpdated`. Any throw leaves memory, disk, and the marker
   * untouched.
   */
  private async persistNote(current: SynthesisNote, next: SynthesisNote): Promise<void> {
    const file = this.findNoteFile(current);
    if (!file) {
      // The note exists in the index but not on disk — the user deleted it
      // out from under us. Refuse rather than resurrect it from memory.
      throw new Error(
        `SynthesisService: note file for "${current.title}" is missing at "${current.path}".`,
      );
    }

    await this.selfAwareProcess(file, (existing) => {
      const { body } = splitFrontmatter(existing);
      return joinFrontmatter(toSynthesisFrontmatter(next), upsertEvidenceSection(body, next.evidence));
    });

    this.indexNote(next);
    this.plugin.eventBus.emit('synthesisUpdated', next);
  }

  // -------------------------------------------------------------------------
  // Live sync (vault `modify` / `rename` / `delete`)
  // -------------------------------------------------------------------------

  /**
   * Reload a synthesis note from its on-disk file. Wired to a debounced
   * `vault.on('modify')` path so an in-Obsidian edit (thesis tweak, quote
   * text fix) propagates without a manual refresh.
   */
  async syncFromFile(file: TFile): Promise<SynthesisNote | null> {
    if (file.extension !== 'md') return null;
    const projectId = this.findOwnerProject(file.path);
    if (!projectId) return null;

    const next = await this.readSynthesisFile(file);
    if (!next) {
      this.dropAtPath(file.path);
      return null;
    }

    const previous = this.byId.get(next.id);
    if (previous && synthesisNotesEqual(previous, next)) {
      return previous;
    }

    this.indexNote(next);
    this.plugin.eventBus.emit('synthesisUpdated', next);
    return next;
  }

  /**
   * Debounced entry point for the vault `modify` handler — coalesces
   * Obsidian's autosave bursts into one `syncFromFile` per quiet window,
   * mirroring `PaperService.scheduleSync`.
   */
  scheduleSync(file: TFile): void {
    if (file.extension !== 'md' || !this.findOwnerProject(file.path)) return;
    const pending = this.syncTimers.get(file.path);
    if (pending !== undefined) window.clearTimeout(pending);
    const handle = window.setTimeout(() => {
      this.syncTimers.delete(file.path);
      void this.syncFromFile(file).catch((err) => {
        console.warn('[ResearchVault] SynthesisService: sync failed for', file.path, err);
      });
    }, SYNC_DEBOUNCE_MS);
    this.syncTimers.set(file.path, handle);
  }

  /**
   * Handle a vault `rename` or `delete` for a synthesis note. Drops the note
   * that was at `oldPath` and (for renames) re-syncs the new path. Safe to
   * call repeatedly.
   */
  async pathChanged(opts: { oldPath?: string; newPath?: string }): Promise<void> {
    if (opts.oldPath) {
      this.dropAtPath(opts.oldPath);
    }
    if (opts.newPath) {
      const file = this.plugin.app.vault.getAbstractFileByPath(opts.newPath);
      if (file instanceof TFile) {
        await this.syncFromFile(file);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Self-write tracking + internals
  // -------------------------------------------------------------------------

  /**
   * Single choke point for every write this service performs on an existing
   * synthesis file. Arms the echo marker just before the write and disarms
   * it on failure, so the vault `modify` event the write triggers is
   * recognized as ours exactly once — success or not. Uses `vault.process`
   * so the read-modify-write is atomic.
   */
  private async selfAwareProcess(file: TFile, fn: (data: string) => string): Promise<void> {
    this.selfWritePaths.add(file.path);
    try {
      await this.plugin.app.vault.process(file, fn);
    } catch (err) {
      this.selfWritePaths.delete(file.path);
      throw err;
    }
  }

  /** Consume-at-most-once echo check used by the vault `modify` handler. */
  consumeSelfWrite(path: string): boolean {
    return this.selfWritePaths.delete(path);
  }

  /** Insert or replace a note in `byId` and the path reverse index. */
  private indexNote(note: SynthesisNote): void {
    const previous = this.byId.get(note.id);
    if (previous && previous.path !== note.path) {
      this.pathToId.delete(previous.path.toLowerCase());
    }
    this.byId.set(note.id, note);
    this.pathToId.set(note.path.toLowerCase(), note.id);
  }

  /** Drop the note (if any) stored at `filePath` and emit `synthesisRemoved`. */
  private dropAtPath(filePath: string): void {
    const id = this.pathToId.get(normalizePath(filePath).toLowerCase());
    if (!id) return;
    this.byId.delete(id);
    this.pathToId.delete(normalizePath(filePath).toLowerCase());
    this.plugin.eventBus.emit('synthesisRemoved', { synthesisId: id });
  }

  /** Resolve the `TFile` for a note by its recorded canonical path. */
  private findNoteFile(note: SynthesisNote): TFile | null {
    const abstract = this.plugin.app.vault.getAbstractFileByPath(note.path);
    return abstract instanceof TFile ? abstract : null;
  }

  /**
   * Which project (if any) owns this path: a note under the project's
   * `syntheses/` folder, or the project's hub note at the project root
   * (1.1 Slice 2a).
   */
  private findOwnerProject(filePath: string): string | undefined {
    for (const project of this.plugin.settings.projects) {
      const folder = this.projectManager.getProjectSynthesesFolder(project.id);
      if (folder && (filePath === folder || filePath.startsWith(`${folder}/`))) {
        return project.id;
      }
      if (this.projectManager.getProjectHubPath(project.id) === normalizePath(filePath)) {
        return project.id;
      }
    }
    return undefined;
  }

  /**
   * Read a single synthesis file. Required frontmatter: `id`, `title`,
   * `projectId`; thesis/evidence/open-questions are parsed from the body.
   */
  private async readSynthesisFile(file: TFile): Promise<SynthesisNote | null> {
    try {
      const raw = await this.plugin.app.vault.cachedRead(file);
      const { frontmatter, body } = splitFrontmatter(raw);
      return frontmatterToSynthesis(frontmatter, body, file.path, file.stat.ctime);
    } catch (err) {
      console.warn('[ResearchVault] SynthesisService: failed to read', file.path, err);
      return null;
    }
  }

  private requireById(id: string): SynthesisNote {
    const note = this.byId.get(id);
    if (!note) {
      // Throw-only: callers decide how to surface the failure (Notice, modal).
      throw new Error(`Synthesis not found: ${id}`);
    }
    return note;
  }
}

/** Field-level equality short-circuit so an echo-free resync is a no-op. */
function synthesisNotesEqual(a: SynthesisNote, b: SynthesisNote): boolean {
  return (
    a.title === b.title &&
    (a.thesis ?? '') === (b.thesis ?? '') &&
    JSON.stringify(a.evidence) === JSON.stringify(b.evidence) &&
    JSON.stringify(a.openQuestions) === JSON.stringify(b.openQuestions)
  );
}





