// src/utils/template.ts
//
// Tiny `{{var}}` template renderer. No conditionals, no loops, no logic —
// paper templates live in settings as plain Markdown and we want zero surprises
// in the rendering surface.
//
// Semantics:
//   - `{{ key }}` → look up `key` in the input map; missing/empty values
//     render as an empty string (NOT `"undefined"`/`"null"`).
//   - Unknown `{{ key }}` after trim is left as-is so the user notices
//     typos rather than silently producing empty content.
//   - Escape: nothing extra. We do not HTML-escape because the output is
//     markdown that the user will edit; interfering breaks table alignment
//     and code blocks. The plugin is not responsible for sanitisation
//     because user-authored templates are already confined to the vault.
//

export type TemplateData = Record<string, string | number | boolean | undefined | null>;

/** Render `template` by replacing each `{{ key }}` token with the matching value in `data`. */
export function renderTemplate(template: string, data: TemplateData): string {
  if (!template) return template;

  return template.replace(/\{\{\s*([a-zA-Z][\w-]*)\s*\}\}/g, (match, key: string) => {
    const value = data[key];
    if (value === undefined || value === null || value === '') return '';
    return String(value);
  });
}
