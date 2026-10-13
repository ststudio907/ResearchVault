# ResearchVault

An Obsidian plugin that turns your vault into a **research operating system**: manage research projects, track papers, capture quotes from your sources, and keep everything as plain Markdown in your vault.

## Features

- **Projects** — Create, switch, and delete research projects. Each project is a folder (with `papers`, `notes`, `literature`, and `pdfs` subfolders) whose contents are filtered into the sidebar view. Exactly one project is active at a time.
- **Paper tracking** — Add papers manually, by pasting CSL-JSON (e.g. from Zotero or a DOI resolver), or by DOI through the built-in citation lookup (Crossref and OpenAlex). Papers are stored as Markdown files with structured frontmatter: authors, year, DOI, citekey, reading status, priority, and bibliography. Citekeys only need to be unique within a project, so the same paper can be added to multiple projects under the same citekey.
- **PDF attachment** — Link a PDF from your vault to a paper; the plugin copies it into the project's `pdfs/` folder and keeps the paper note and local copy in sync.
- **Quote capture** — Select text in the editor and run **Capture quote** to append it to a paper's note as a blockquote quote card with tags.
- **Projects sidebar** — A dedicated view lists your projects and papers, filters by status/priority, and offers fuzzy search over paper titles, authors, and citekeys.
- **Citation lookup** (opt-in) — Resolve DOIs and search strings against Crossref and OpenAlex to prefill the paper-import form. Responses are cached locally for 30 days.
- **Zotero sync** (opt-in) — Pull items from your Zotero library into the paper-import form using your account ID and read-only API key.
- **Zotero push** (opt-in, desktop only) — Push a paper's metadata into a running Zotero desktop instance via its local connector (`127.0.0.1:23119`). Nothing leaves your machine.
- **Templates** — Customize the Markdown templates used for new papers and notes in **Settings → ResearchVault**.
- **Works offline by default** — All network features are opt-in and off until you enable them in settings.

## Installation

Install from the community plugin browser (**Settings → Community plugins → Browse**), or manually:

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Copy them into `<Vault>/.obsidian/plugins/researchvault/`.
3. Reload Obsidian and enable the plugin under **Settings → Community plugins**.

## Getting started

1. Click the library ribbon icon (or run **Create research project**) to make your first project.
2. Run **Add paper** to log your first paper — use DOI lookup or CSL-JSON paste to skip manual typing.
3. Select text in any note and run **Capture quote** to attach it to a paper.
4. Run **Open projects sidebar** and pin the view to your sidebar for day-to-day browsing.

## Privacy & external services

ResearchVault runs locally and makes **no network requests** until you explicitly enable one of the opt-in integrations below. There is no telemetry, no auto-update, and no remote code execution.

- **Citation lookup** (off by default, under **Settings → ResearchVault → Citations**) sends only the DOI or search string you typed to `api.crossref.org` and/or `api.openalex.org`. No vault content is sent. Responses are cached locally for 30 days so repeat lookups don't re-hit the network. The optional polite-pool `mailto:` contact is off by default and, when enabled, is sent only to your chosen provider.
- **Zotero sync** (off by default, under **Settings → ResearchVault → Zotero sync**) sends only library read requests — plus your search terms — to `api.zotero.org`, using the account ID and read-only API key you provide. No vault content is sent. The API key is stored locally in this vault's plugin settings file.
- **Zotero push** (off by default, desktop only) sends a paper's metadata (title, authors, year, DOI, abstract) to the Zotero desktop app running on the same computer, via Zotero's local connector server on `127.0.0.1:23119`. All traffic stays on your machine. The push button appears only when Zotero is actually running.

## Development

```bash
npm install
npm run dev           # type-check + watch-bundle into main.js
npm run build         # one-shot production bundle (writes main.js + size report)
npm run analyze       # alias for build; also writes esbuild-metafile.json
npm run lint          # eslint with eslint-plugin-obsidianmd
npm run deploy        # copy main.js/manifest/styles.css into a local test vault
```

The build emits `main.js` at the repo root; copy it alongside `manifest.json` and `styles.css` into `<Vault>/.obsidian/plugins/researchvault/`, then reload Obsidian.

## License

0-BSD — see [LICENSE](LICENSE).

