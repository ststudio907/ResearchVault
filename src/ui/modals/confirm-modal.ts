// src/ui/modals/confirm-modal.ts
//
// Tiny reusable confirm prompt. Wraps Obsidian's `Modal` so callers can
// `await ConfirmModal.ask(app, { title, message, confirmLabel, cancelLabel, destructive })`
// instead of using the browser `confirm()` (which fires the `no-alert` lint
// rule and isn't available on mobile WebViews).
//
// Resolves `true` on confirm, `false` on cancel or after-if-user-closes.
//

import { App, Modal } from 'obsidian';

export interface ConfirmModalOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, the confirm button uses the warning style (red). */
  destructive?: boolean;
}

export class ConfirmModal extends Modal {
  private readonly options: Required<ConfirmModalOptions>;
  private resolveConfirm!: (value: boolean) => void;

  constructor(app: App, options: ConfirmModalOptions) {
    super(app);
    this.options = {
      title: options.title ?? 'Confirm',
      message: options.message,
      confirmLabel: options.confirmLabel ?? 'Confirm',
      cancelLabel: options.cancelLabel ?? 'Cancel',
      destructive: options.destructive ?? false,
    };
  }

  /** Open the modal and await the user's choice. */
  static ask(app: App, options: ConfirmModalOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const modal = new ConfirmModal(app, options);
      modal.resolveConfirm = resolve;
      modal.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: this.options.title });

    const body = contentEl.createDiv({ cls: 'researchvault-confirm-body' });
    // Support multi-line messages.
    for (const line of this.options.message.split('\n')) {
      body.createEl('p', { text: line });
    }

    const buttons = contentEl.createDiv({ cls: 'researchvault-confirm-buttons' });
    buttons.createEl('button', { text: this.options.cancelLabel }).addEventListener(
      'click',
      () => {
        this.resolveConfirm(false);
        this.close();
      },
    );

    const confirmBtn = buttons.createEl('button', { text: this.options.confirmLabel });
    confirmBtn.addClass('mod-cta');
    if (this.options.destructive) confirmBtn.addClass('mod-warning');
    confirmBtn.addEventListener('click', () => {
      this.resolveConfirm(true);
      this.close();
    });
  }

  onClose(): void {
    // If the user dismisses via Esc / backdrop, resolve false so we never leave
    // an `await` hanging.
    this.resolveConfirm(false);
    this.contentEl.empty();
  }
}
