import { describe, expect, it } from 'vitest';
import { CURRENT_SETTINGS_VERSION, DEFAULT_SETTINGS, migrateSettings } from '../src/settings';

describe('migrateSettings', () => {
  it.each([undefined, null, false, 42, 'old settings'])('defaults an absent or non-object payload (%s)', (raw) => {
    expect(migrateSettings(raw)).toEqual(DEFAULT_SETTINGS);
  });

  it('fills every nested block in a legacy payload', () => {
    expect(migrateSettings({ version: '0' })).toEqual(DEFAULT_SETTINGS);
  });

  it('preserves partial nested settings while filling missing fields', () => {
    const settings = migrateSettings({
      ai: { model: 'custom-model' },
      templates: { paper: '# Custom paper' },
      citation: { preferredProvider: 'openalex' },
      zotero: { userID: '1234', apiKey: 'local-test-key' },
      filterPanel: { open: true },
    });
    expect(settings.ai).toEqual({ ...DEFAULT_SETTINGS.ai, model: 'custom-model' });
    expect(settings.templates).toEqual({ ...DEFAULT_SETTINGS.templates, paper: '# Custom paper' });
    expect(settings.citation).toEqual({ ...DEFAULT_SETTINGS.citation, preferredProvider: 'openalex' });
    expect(settings.zotero).toEqual({ ...DEFAULT_SETTINGS.zotero, userID: '1234', apiKey: 'local-test-key' });
    expect(settings.filterPanel).toEqual({ ...DEFAULT_SETTINGS.filterPanel, open: true });
    expect(settings.citation.enableCitationLookup).toBe(false);
    expect(settings.zotero.enableZoteroSync).toBe(false);
    expect(settings.zotero.enableLocalPush).toBe(false);
  });

  it('defaults null nested blocks and a malformed projects list', () => {
    expect(migrateSettings({
      ai: null, templates: null, citation: null, zotero: null, filterPanel: null, projects: {},
    })).toEqual(DEFAULT_SETTINGS);
  });

  it('does not mutate the saved payload or share defaults between migrations', () => {
    const raw = { zotero: { userID: '1234' } };
    const settings = migrateSettings(raw);
    settings.zotero.userID = 'changed';
    settings.templates.paper = 'changed';
    settings.globalExcludedFolders.push('private');
    expect(settings.projects).not.toBe(DEFAULT_SETTINGS.projects);
    expect(raw).toEqual({ zotero: { userID: '1234' } });
    expect(migrateSettings(raw).zotero.userID).toBe('1234');
    expect(migrateSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('normalizes the PDF library folder and stamps the current schema version', () => {
    expect(migrateSettings({ pdfLibraryFolder: '   ' }).pdfLibraryFolder).toBe(DEFAULT_SETTINGS.pdfLibraryFolder);
    const settings = migrateSettings({ pdfLibraryFolder: '  Library/PDFs/  ', version: '0' });
    expect(settings.pdfLibraryFolder).toBe('Library/PDFs');
    expect(settings.version).toBe(CURRENT_SETTINGS_VERSION);
  });
});
