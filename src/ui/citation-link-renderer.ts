// src/ui/citation-link-renderer.ts
//
// 3.2 C2 follow-up: D35 keeps `[@citekey]` as inert text so Pandoc can
// resolve it at export time — but inside the vault plain text that doesn't
// link anywhere reads as broken. This reading-view markdown post-processor
// rewrites each `[@key]` (including `[@a; @b]` groups and the bare `@key`
// narrative form) into clickable spans
// that open the matching paper note. Live-preview decoration is deliberately
// out of scope (it requires a CodeMirror extension; reading view covers the
// "read my writing back" flow).

import { MarkdownPostProcessorContext, Notice } from 'obsidian';
import type { ResearchVaultPlugin } from '../core/plugin';
import type { Paper } from '../types';
import {
  findCitationMatches,
  locateKeysInBlock,
} from '../services/citation/citation-markup';
import { canonicalPathOf } from '../services/papers/paper-paths';
import { queueStyledCitationUpgrade } from './styled-citation-renderer';

/** Never decorate inside rendered code, or inside links we already made. */
const SKIP_ANCESTORS = 'code, pre, a, .md-embed-code';

export function registerCitationLinkProcessor(plugin: ResearchVaultPlugin): void {
  plugin.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    decorateCitations(el, ctx, plugin);
  });
}

function decorateCitations(
  root: HTMLElement,
  ctx: MarkdownPostProcessorContext,
  plugin: ResearchVaultPlugin,
): void {
  // Collect first — rewriting nodes mid-walk invalidates the traversal.
  const candidates: Text[] = [];
  const walker = activeDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (parent && parent.closest(SKIP_ANCESTORS)) return NodeFilter.FILTER_REJECT;
      return /@[A-Za-z0-9]/.test(node.textContent ?? '')
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  let n: Node | null;
  while ((n = walker.nextNode()) !== null) candidates.push(n as Text);

  for (const textNode of candidates) {
    const matches = findCitationMatches(textNode.data);
    if (matches.length === 0) continue;

    const fragment = activeDocument.createDocumentFragment();
    let cursor = 0;
    for (const match of matches) {
      fragment.append(textNode.data.slice(cursor, match.start));
      decorateBlock(match.block, fragment, plugin, ctx);
      cursor = match.end;
    }
    fragment.append(textNode.data.slice(cursor));
    textNode.replaceWith(fragment);
  }
}

/**
 * Rewrite one matched block, keeping brackets and `;` separators as plain
 * text so the rendered note still reads as valid Pandoc markup.
 *
 * The whole block is wrapped in a `.researchvault-cite-block` span carrying
 * the per-key anchors — the C3 styled-citation renderer upgrades that span
 * in place once the citeproc engine resolves (queued asynchronously; see
 * `styled-citation-renderer.ts`).
 */
function decorateBlock(
  block: string,
  fragment: DocumentFragment,
  plugin: ResearchVaultPlugin,
  ctx: MarkdownPostProcessorContext,
): void {
  const group = activeDocument.createElement('span');
  group.addClass('researchvault-cite-block');
  if (block.startsWith('[')) group.addClass('researchvault-cite-group');

  let cursor = 0;
  for (const { key, start, end } of locateKeysInBlock(block)) {
    group.append(block.slice(cursor, start));
    const anchor = makeCitekeyAnchor(key, plugin, ctx);
    anchor.dataset.rvKey = key;
    group.append(anchor);
    cursor = end;
  }
  group.append(block.slice(cursor));
  fragment.append(group);
  queueStyledCitationUpgrade(plugin, ctx, group);
}

function makeCitekeyAnchor(
  key: string,
  plugin: ResearchVaultPlugin,
  ctx: MarkdownPostProcessorContext,
): HTMLAnchorElement {
  const paper = resolvePaper(plugin, key);
  const anchor = activeDocument.createElement('a');
  anchor.addClass('internal-link', 'researchvault-citekey-link');
  anchor.setText(`@${key}`);

  if (paper) {
    anchor.setAttr('title', `${paper.title} (${paper.year})`);
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void openPaperNote(plugin, paper, ctx.sourcePath);
    });
  } else {
    anchor.addClass('is-unresolved');
    anchor.setAttr('title', `No paper with citekey "${key}" found in your projects`);
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      new Notice(`ResearchVault: no paper with citekey "${key}" found in your projects.`);
    });
  }
  return anchor;
}

/**
 * Citekeys are only unique within a project (D24), so resolution prefers the
 * active project and falls back to the first match anywhere in the library.
 */
function resolvePaper(plugin: ResearchVaultPlugin, key: string): Paper | null {
  const active = plugin.projectManager.getActiveProject();
  if (active) {
    const inActive = plugin.paperService.getByCitekey(key, active.id);
    if (inActive) return inActive;
  }
  return plugin.paperService.getByCitekey(key) ?? null;
}

async function openPaperNote(
  plugin: ResearchVaultPlugin,
  paper: Paper,
  sourcePath: string,
): Promise<void> {
  const path = canonicalPathOf(paper);
  if (!path || !plugin.app.vault.getAbstractFileByPath(path)) {
    new Notice(`ResearchVault: the note for @${paper.citekey} is missing on disk.`);
    return;
  }
  await plugin.app.workspace.openLinkText(path, sourcePath, false);
}
