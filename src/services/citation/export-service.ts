// src/services/citation/export-service.ts
//
// The 1.1 "Cite & ship" export tail (D39/D40): turn a project note plus the
// per-project `bibliography.bib` into a formatted Word/PDF document by
// shelling out to a **user-installed** pandoc binary with `--citeproc`.
//
// Compliance posture (D40):
// - The only binary we invoke is one the user chose to install; nothing is
//   bundled, no WASM, no spawned servers. Absent binary → explanatory Notice.
// - `manifest.json` stays `isDesktopOnly: false`; the `child_process` /
//   `zlib` / `fs` calls all live behind desktop gates and are reached via a
//   lazy `window.require` helper — a static `import` of a node builtin would
//   emit a top-level `require` and crash the mobile bundle at load.
// - Style selection is per-project at export time (D39), never per citation.
//   Built-in styles are vendored CSL (CC BY-SA 3.0) inflated from
//   `csl-bundle.generated.ts`; `custom` reads a `.csl` file from the vault.
//
// Pure decision logic (`buildPandocArgs`, `findProjectForPath`, style→CSL
// mapping) is exported for unit tests; the spawn call itself is a thin tail.

import { Notice, normalizePath, TFile } from 'obsidian';
import type { ResearchVaultPlugin } from '../../core/plugin';
import type { CitationStyle, Project } from '../../types';
import { CSL_BUNDLED } from './csl-bundle.generated';

/** Output formats for one export run (D40 scope: docx default, PDF opt-in). */
export type ExportFormat = 'docx' | 'pdf';

export interface ExportOptions {
	style: CitationStyle;
	/** Vault path of a user-supplied `.csl` file; required when style is `custom`. */
	customCslPath?: string;
	format: ExportFormat;
	/** Persist the chosen style as the project default (D39 lifetime). */
	saveAsProjectDefault?: boolean;
}

export interface ExportNoteResult {
	/** Vault path the formatted document was written to. */
	outputPath: string;
	/** Absolute filesystem path (for reveal-in-file-manager; desktop only). */
	outputAbsPath: string;
	format: ExportFormat;
}

// --- Lazy Node boundary (desktop only) --------------------------------------

type NodeRequire = (id: string) => unknown;

/**
 * Resolve a node builtin through the Electron renderer's `window.require`.
 * Throws (rather than crashes the mobile bundle) when Node is unavailable.
 */
function nodeRequire(id: string): unknown {
	if (typeof window !== 'undefined' && typeof (window as { require?: NodeRequire }).require === 'function') {
		return (window as { require: NodeRequire }).require(id);
	}
	throw new Error('Node modules are only available in the Obsidian desktop app.');
}

export type ExecFileFn = (
	file: string,
	args: string[],
	options: { cwd: string },
	callback: (error: (Error & { stderr?: string }) | null, stdout: string, stderr: string) => void,
) => void;

interface FsPromises {
	writeFile(path: string, data: Uint8Array | string): Promise<void>;
	readFile(path: string): Promise<Uint8Array>;
	mkdtemp(prefix: string): Promise<string>;
	rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>;
}

interface NodePath {
	join(...parts: string[]): string;
}

interface NodeOs {
	tmpdir(): string;
}

interface NodeZlib {
	gunzipSync(data: Uint8Array): Uint8Array;
}

// `Buffer` is used only behind the desktop-gated lazy-require paths; the
// *type* comes from @types/node (dev dependency), never a runtime import.
declare const Buffer: typeof import('node:buffer').Buffer;

// --- Pure logic (unit-tested) -----------------------------------------------

export interface PandocInvocationInput {
	/** Absolute path of the note to compile. */
	noteAbsPath: string;
	/** Absolute path of the bibliography, or null to omit `--bibliography`. */
	bibliographyAbsPath: string | null;
	/** Absolute path of the CSL file driving `--citeproc`. */
	cslAbsPath: string;
	format: ExportFormat;
	/** Absolute output path pandoc writes to. */
	outputAbsPath: string;
	/** PDF engine binary (only used when format is `pdf`). */
	pdfEngine?: string;
}

/** Build the pandoc argv. Pure so the contract is testable without a spawn. */
export function buildPandocArgs(input: PandocInvocationInput): string[] {
	const args = [input.noteAbsPath, '--citeproc', `--csl=${input.cslAbsPath}`];
	if (input.bibliographyAbsPath) {
		args.push(`--bibliography=${input.bibliographyAbsPath}`);
	}
	if (input.format === 'pdf') {
		args.push(`--pdf-engine=${input.pdfEngine ?? 'pdflatex'}`);
	}
	args.push('--output', input.outputAbsPath);
	return args;
}

/**
 * Resolve the project that owns a note path by longest folder-prefix match
 * (case-insensitive, mirroring filesystem semantics on macOS/Windows).
 * Returns null when the note lives outside every known project folder.
 */
export function findProjectForPath(
	projects: ReadonlyArray<Pick<Project, 'folderPath'>>,
	path: string,
): Project | null {
	const lowered = path.toLowerCase();
	let best: Project | null = null;
	let bestLen = -1;
	for (const candidate of projects) {
		const folder = `${candidate.folderPath}/`;
		if (lowered.startsWith(folder.toLowerCase()) && folder.length > bestLen) {
			best = candidate as Project;
			bestLen = folder.length;
		}
	}
	return best;
}

/** Built-in style keys that map to vendored CSL (everything but `custom`). */
export const BUNDLED_CSL_STYLES = Object.keys(CSL_BUNDLED) as ReadonlyArray<string>;

export function isBundledStyle(style: CitationStyle): boolean {
	return style !== 'custom' && Object.prototype.hasOwnProperty.call(CSL_BUNDLED, style);
}

/**
 * Pull `execFile` off the `child_process` *module object*. The lazy node
 * boundary returns whole modules, so the spawn site must destructure —
 * calling the module object itself is a runtime "…n is not a function"
 * crash (shipped once, regression-tested here).
 */
export function execFileFromModule(mod: unknown): ExecFileFn {
	const execFile = (mod as { execFile?: ExecFileFn }).execFile;
	if (typeof execFile !== 'function') {
		throw new Error("node:child_process did not expose an 'execFile' function.");
	}
	return execFile;
}

/** Homebrew + common local prefixes, tried in order for bare command names. */
export const FALLBACK_BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'] as ReadonlyArray<string>;

/**
 * Spawn candidates for the configured pandoc binary, in order. A path with a
 * separator is used as-is; a bare name (default 'pandoc') additionally tries
 * the Homebrew prefixes, because a GUI-launched Electron app inherits a
 * minimal PATH that usually omits /opt/homebrew/bin. Windows resolves bare
 * names through its own lookup, so it needs no fallbacks.
 */
export function pandocCandidates(configured: string | undefined, isWindows = false): string[] {
	const trimmed = configured?.trim() || 'pandoc';
	if (isWindows || /[/\\]/.test(trimmed)) return [trimmed];
	const name = trimmed.split('/').pop() ?? trimmed;
	return [trimmed, ...FALLBACK_BIN_DIRS.map((dir) => `${dir}/${name}`)];
}


export function showItemInFolderFromModule(mod: unknown, path: string): void {
	const shell = (mod as { shell?: { showItemInFolder?: (p: string) => void } }).shell;
	if (typeof shell?.showItemInFolder !== 'function') {
		throw new Error("electron did not expose 'shell.showItemInFolder'.");
	}
	shell.showItemInFolder(path);
}

/**
 * Reveal a file in the OS file manager (Finder/Explorer), selecting it.
 * Desktop only (the caller gates on `Platform.isDesktopApp`); throws with a
 * diagnosable message when Electron's shell is unavailable.
 */
export function revealInFileManager(absPath: string): void {
	showItemInFolderFromModule(nodeRequire('electron'), absPath);
}

// --- Service ----------------------------------------------------------------

export class ExportService {
	constructor(private readonly plugin: ResearchVaultPlugin) {}

	/**
	 * Compile `file` (which must live inside a project folder) to Word/PDF.
	 * Regenerates the project bibliography first (D36 overwrite guard — a
	 * declined rebuild falls back to the existing file, hand-written or not;
	 * the export aborts only when no bibliography file exists at all).
	 * Throws with a user-facing message on every failure; the caller (plugin
	 * command / modal) degrades to a Notice.
	 */
	async exportNote(file: TFile, options: ExportOptions): Promise<ExportNoteResult> {
		const project = findProjectForPath(
			this.plugin.projectManager.getAllProjects(),
			file.path,
		);
		if (!project) {
			throw new Error(`"${file.path}" is not inside a project folder, so no bibliography can be attached.`);
		}

		// D39 lifetime: the modal's choice can be persisted as the project's
		// export default (opt-in checkbox, so one-off overrides don't stick).
		if (options.saveAsProjectDefault && project.settings.citationStyle !== options.style) {
			await this.plugin.projectManager.updateProject(project.id, {
				settings: { citationStyle: options.style },
			});
		}

		const bib = await this.ensureBibliography(project);
		if (!bib) return { outputPath: '', outputAbsPath: '', format: options.format };

		const outName = `${file.basename}.${options.format}`;

		// Work through the OS temp dir, then import the result into the vault
		// next to the note. Never spawn with vault-internal output paths —
		// pandoc writes raw bytes and the vault API stays the single writer.
		//
		// ONE temp root per export holds both the materialised CSL and the
		// compiled document, so a single `rm` in the `finally` owns the whole
		// lifetime: CSL creation/write failure, pandoc failure, and vault-write
		// failure all leave nothing behind.
		const fs = nodeRequire('node:fs/promises') as FsPromises;
		const nodePath = nodeRequire('node:path') as NodePath;
		const os = nodeRequire('node:os') as NodeOs;
		let workDir: string | null = null;

		try {
			workDir = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'researchvault-export-'));
			const cslPath = await this.resolveCslPath(options, workDir);
			const outAbs = nodePath.join(workDir, outName);
			const adapter = this.plugin.app.vault.adapter as unknown as { getBasePath(): string };
			const vaultRoot = adapter.getBasePath();
			const noteAbs = nodePath.join(vaultRoot, file.path);
			// cwd = the note's folder so relative image links resolve.
			const cwd = nodePath.join(vaultRoot, file.parent?.path ?? '');
			const args = buildPandocArgs({
				noteAbsPath: noteAbs,
				bibliographyAbsPath: nodePath.join(vaultRoot, bib),
				cslAbsPath: cslPath,
				format: options.format,
				outputAbsPath: outAbs,
			});
			await this.runPandoc(args, cwd);

			const bytes = await fs.readFile(outAbs);
			const parentPath = file.parent?.path ?? '';
			const targetPath = parentPath
				? normalizePath(`${parentPath}/${outName}`)
				: normalizePath(outName);
			const existing = this.plugin.app.vault.getAbstractFileByPath(targetPath);
			if (existing instanceof TFile) {
				await this.plugin.app.vault.modifyBinary(existing, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
			} else {
				await this.plugin.app.vault.createBinary(targetPath, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
			}
			const outputAbsPath = nodePath.join(vaultRoot, targetPath);
			return { outputPath: targetPath, outputAbsPath, format: options.format };
		} finally {
			// The one temp root covers the CSL file and the compiled document,
			// so this is the only cleanup site: success, pandoc failure, CSL
			// write failure, or a vault-write failure. Leaking it left a
			// directory behind on every export, unbounded.
			if (workDir !== null) {
				await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
			}
		}
	}

	/**
	 * Rebuild the project bibliography, honouring the D36 hand-edit guard.
	 * Returns the vault-relative bib path, or null when the export must abort
	 * (guard declined AND no bibliography file exists to fall back to).
	 */
	private async ensureBibliography(project: Project): Promise<string | null> {
		const bibPath = this.plugin.bibliographyService.bibliographyPath(project.id);
		const result = await this.plugin.bibliographyService.exportProjectBibliography(project.id);
		if (result) return result.path;
		// Guard declined: a hand-written bibliography is a perfectly good
		// pandoc input — proceed only when the file actually exists.
		if (this.plugin.app.vault.getAbstractFileByPath(bibPath) instanceof TFile) {
			return bibPath;
		}
		new Notice('ResearchVault: no bibliography available — export aborted.');
		return null;
	}

	/**
	 * Materialise the CSL file for this run **inside the caller's temp work
	 * dir**. Built-ins are inflated from the compressed bundle; `custom` is
	 * read out of the vault and written into `workDir`. Either way pandoc needs
	 * a real filesystem path (desktop only), and the file is always written into
	 * `workDir` created by `exportNote` — so `exportNote`'s single `finally`
	 * owns the directory's lifetime and a throw from `writeFile` cannot orphan
	 * a directory.
	 */
	private async resolveCslPath(options: ExportOptions, workDir: string): Promise<string> {
		const nodePath = nodeRequire('node:path') as NodePath;
		const fs = nodeRequire('node:fs/promises') as FsPromises;

		let xml: string;
		if (isBundledStyle(options.style)) {
			const zlib = nodeRequire('node:zlib') as NodeZlib;
			const inflated = zlib.gunzipSync(Buffer.from(CSL_BUNDLED[options.style]!, 'base64'));
			xml = Buffer.from(inflated).toString('utf8');
		} else {
			const customPath = options.customCslPath?.trim();
			if (!customPath) {
				throw new Error('Custom style selected but no .csl file path given.');
			}
			const cslFile = this.plugin.app.vault.getAbstractFileByPath(normalizePath(customPath));
			if (!(cslFile instanceof TFile)) {
				throw new Error(`No vault file at "${customPath}" — the custom style must point at a .csl file inside the vault.`);
			}
			xml = await this.plugin.app.vault.cachedRead(cslFile);
		}

		const cslPath = nodePath.join(workDir, 'style.csl');
		await fs.writeFile(cslPath, xml);
		return cslPath;
	}

	/**
	 * The single spawn site (D40 boundary). Surfaces pandoc's stderr verbatim.
	 * Tries each candidate path (bare names also probe Homebrew prefixes — a
	 * GUI-launched Obsidian inherits a PATH that omits /opt/homebrew/bin);
	 * "not found" is only reported when every candidate misses.
	 */
	private runPandoc(args: string[], cwd: string): Promise<void> {
		return new Promise((resolve, reject) => {
			let execFile: ExecFileFn;
			try {
				execFile = execFileFromModule(nodeRequire('node:child_process'));
			} catch {
				reject(new Error('Exporting to Word/PDF requires the Obsidian desktop app.'));
				return;
			}
			const candidates = pandocCandidates(this.plugin.settings.pandocPath);
			const tryCandidate = (index: number): void => {
				const binary = candidates[index];
				if (binary === undefined) {
					const tried = candidates.length > 1 ? ` (tried ${candidates.join(', ')})` : ` ("${candidates[0]}")`;
					reject(new Error(
						`pandoc was not found${tried}. Install it (e.g. brew install pandoc) ` +
						'— or point Settings → Research Vault → Pandoc binary at the full path — and try again.',
					));
					return;
				}
				execFile(binary, args, { cwd }, (error, _stdout, stderr) => {
					if (!error) {
						resolve();
						return;
					}
					if ((error as { code?: string }).code === 'ENOENT') {
						tryCandidate(index + 1);
						return;
					}
					const detail = (error.stderr || stderr || error.message || '').trim();
					reject(new Error(detail ? `pandoc failed: ${detail}` : 'pandoc failed with no error output.'));
				});
			};
			tryCandidate(0);
		});
	}
}

