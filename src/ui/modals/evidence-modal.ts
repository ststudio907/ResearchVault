// src/ui/modals/evidence-modal.ts
//
// Evidence-block capture + removal surfaces (1.1 Slice 2 pulled forward
// during the Slice 1 smoke). Both target a specific `SynthesisNote` —
// resolved by the plugin (active file if it is a synthesis note, else the
// only note in the active project) — and hand off entirely to
// `SynthesisService.addEvidence` / `removeEvidence`, which own validation
// and the disk contract. Errors surface as a Notice; the modal stays open
// so the input isn't lost.
//
// The paper dropdown mirrors `PaperImportModal`'s Setting-based form
// chrome; removal reuses the `FuzzySuggestModal` pattern from
// `CitationPickModal`.

import { App, FuzzySuggestModal, Modal, Notice, Setting } from 'obsidian';
import type { ResearchVaultPlugin } from '../../core/plugin';
import type { EvidenceBlock, EvidenceStance, Paper, SynthesisNote } from '../../types';
import { EVIDENCE_STANCES } from '../../types';
import { applyStandardModalWidth } from './modal-width';
import { renderStyledCitationText } from '../styled-citation-renderer';

const STANCE_LABELS: Record<EvidenceStance, string> = {
  supports: 'Supports',
  contradicts: 'Contradicts',
  neutral: 'Neutral',
};

/**
 * Styled-citation display cache for evidence listings (C3.4): keyed
 * `${projectId}::${citekey}` → styled citation text, populated by the add-
 * evidence flow; falls back to the raw citekey when rendering is unavailable.
 */
const styledEvidenceCache = new Map<string, string>();

export class AddEvidenceModal extends Modal {
  private citekey = '';
  private stance: EvidenceStance = 'supports';
  private locator = '';
  private text = '';

  constructor(
    app: App,
    private readonly plugin: ResearchVaultPlugin,
    private readonly note: SynthesisNote,
    /**
     * Optional paper to pre-select in the Source dropdown (1.1 Slice 2b:
     * the paper row's "→ hub" button opens the form with this paper filled
     * in). Still changeable — prefill, not a lock.
     */
    private readonly presetPaper?: Paper,
  ) {
    super(app);
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    applyStandardModalWidth(this);
    contentEl.empty();
    contentEl.createEl('h2', { text: `Add evidence — ${this.note.title}` });

    const papers: Paper[] = this.plugin.paperService
      .getInProject(this.note.projectId)
      .sort((a, b) => a.citekey.localeCompare(b.citekey));

    if (papers.length === 0) {
      contentEl.createEl('p', {
        text: 'No papers in this project yet. Add a paper first — evidence blocks cite a source.',
      });
      new Setting(contentEl).addButton((btn) =>
        btn.setButtonText('Close').onClick(() => this.close()),
      );
      return;
    }
    // Preset paper wins (row-button flow); otherwise first by citekey order.
    this.citekey = this.presetPaper?.citekey ?? papers[0]?.citekey ?? '';

    const sourceOptions = await Promise.all(
      papers.map(async (paper) => ({
        paper,
        styled: await renderStyledCitationText(this.plugin, paper.citekey, {
          projectId: this.note.projectId,
        }),
      })),
    );

    new Setting(contentEl)
      .setName('Source')
      .setDesc('Source paper — shown as a styled citation (apa, chicago, …); the citekey is what gets stored.')
      .addDropdown((dd) => {
        for (const { paper, styled } of sourceOptions) {
          dd.addOption(paper.citekey, styled ?? `${paper.citekey}  ${paper.title}`);
        }
        dd.setValue(this.citekey);
        dd.onChange((v) => {
          this.citekey = v;
        });
      });

    for (const { paper, styled } of sourceOptions) {
      styledEvidenceCache.set(
        `${this.note.projectId}::${paper.citekey}`,
        styled ?? `${paper.citekey}  ${paper.title}`,
      );
    }

    new Setting(contentEl)
      .setName('Stance')
      .setDesc('How this evidence relates to the thesis.')
      .addDropdown((dd) => {
        for (const stance of EVIDENCE_STANCES) {
          dd.addOption(stance, STANCE_LABELS[stance]);
        }
        dd.setValue(this.stance);
        dd.onChange((v) => {
          this.stance = v as EvidenceStance;
        });
      });

    new Setting(contentEl)
      .setName('Locator')
      .setDesc('Optional. "42" becomes "p. 42"; section and figure names stay verbatim.')
      .addText((text) => {
        text.setPlaceholder('42, §3.2, fig. 1…');
        text.onChange((v) => {
          this.locator = v;
        });
      });

    new Setting(contentEl)
      .setName('Evidence')
      .setDesc('The quoted or paraphrased material, plus any framing you need.')
      .addTextArea((text) => {
        text.setPlaceholder('Paste or type the passage…');
        text.onChange((v) => {
          this.text = v;
        });
      });

    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((btn) =>
        btn
          .setButtonText('Add evidence')
          .setCta()
          .onClick(() => {
            void this.submit();
          }),
      );
  }

  private async submit(): Promise<void> {
    if (!this.text.trim()) {
      new Notice('ResearchVault: the evidence text cannot be empty.');
      return;
    }
    try {
      await this.plugin.synthesisService.addEvidence(this.note.id, {
        citekey: this.citekey,
        text: this.text.trim(),
        locator: this.locator.trim() || undefined,
        stance: this.stance,
      });
      new Notice(`ResearchVault: evidence added to "${this.note.title}".`);
      this.close();
      // Reveal the freshly rendered block so the user sees where it landed.
      await this.plugin.app.workspace.openLinkText(this.note.path, '', false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`ResearchVault: could not add evidence: ${msg}`);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Fuzzy picker over a note's evidence blocks, used for removal (and
 * available to any future "jump to block" flow). Reads the note's evidence
 * live from the service so a stale caller-held snapshot can't offer ids
 * that no longer exist.
 */
export class EvidencePickerModal extends FuzzySuggestModal<EvidenceBlock> {
  constructor(
    app: App,
    private readonly plugin: ResearchVaultPlugin,
    private readonly note: SynthesisNote,
  ) {
    super(app);
    this.setPlaceholder('Pick an evidence block to remove…');
  }

  /** Always read the live list — the caller-held note may be stale. */
  getItems(): EvidenceBlock[] {
    return this.plugin.synthesisService.getById(this.note.id)?.evidence ?? [];
  }

  getItemText(block: EvidenceBlock): string {
    const locator = block.locator ? ` · ${block.locator}` : '';
    const excerpt = block.text.length > 60 ? `${block.text.slice(0, 60)}…` : block.text;
    const styled = styledEvidenceCache.get(`${this.note.projectId}::${block.citekey}`) ?? null;
    return `${styled ?? block.citekey}${locator}  ${STANCE_LABELS[block.stance]}  — ${excerpt}`;
  }

  onChooseItem(block: EvidenceBlock): void {
    void this.plugin.synthesisService
      .removeEvidence(this.note.id, block.id)
      .then(() => {
        new Notice('ResearchVault: evidence block removed.');
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        new Notice(`ResearchVault: could not remove evidence: ${msg}`);
      });
  }
}
