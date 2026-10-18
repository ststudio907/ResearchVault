import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from 'obsidian';
import { requireApiVersion } from 'obsidian';
import { openSidebar } from '../src/ui/views/open-sidebar';

vi.mock('obsidian', () => ({ requireApiVersion: vi.fn() }));

const VIEW_TYPE = 'researchvault-sidebar';

function makeWorkspace(existing: boolean, right: boolean) {
  const leaf = { setViewState: vi.fn().mockResolvedValue(undefined) };
  const workspace = {
    getLeavesOfType: vi.fn().mockReturnValue(existing ? [leaf] : []),
    getRightLeaf: vi.fn().mockReturnValue(right ? leaf : null),
    getLeaf: vi.fn().mockReturnValue(leaf),
    revealLeaf: vi.fn().mockResolvedValue(undefined),
    setActiveLeaf: vi.fn(),
  };
  return { workspace, leaf };
}

describe('openSidebar', () => {
  beforeEach(() => {
    vi.mocked(requireApiVersion).mockReturnValue(true);
  });

  it('reveals an existing leaf without creating a duplicate', async () => {
    const { workspace, leaf } = makeWorkspace(true, true);
    await openSidebar(workspace as unknown as Workspace, VIEW_TYPE);
    expect(workspace.getLeavesOfType).toHaveBeenCalledWith(VIEW_TYPE);
    expect(workspace.getRightLeaf).not.toHaveBeenCalled();
    expect(workspace.getLeaf).not.toHaveBeenCalled();
    expect(leaf.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE, active: true });
    expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
  });

  it('creates and reveals the view in the right sidebar', async () => {
    const { workspace, leaf } = makeWorkspace(false, true);
    await openSidebar(workspace as unknown as Workspace, VIEW_TYPE);
    expect(workspace.getRightLeaf).toHaveBeenCalledWith(false);
    expect(workspace.getLeaf).not.toHaveBeenCalled();
    expect(leaf.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE, active: true });
    expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
  });

  it('falls back to a split when no right leaf is available', async () => {
    const { workspace, leaf } = makeWorkspace(false, false);
    await openSidebar(workspace as unknown as Workspace, VIEW_TYPE);
    expect(workspace.getLeaf).toHaveBeenCalledWith('split');
    expect(leaf.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE, active: true });
    expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
  });

  it('waits for the view state before revealing the leaf', async () => {
    const { workspace, leaf } = makeWorkspace(true, true);
    let finish!: () => void;
    leaf.setViewState.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const opening = openSidebar(workspace as unknown as Workspace, VIEW_TYPE);
    expect(workspace.revealLeaf).not.toHaveBeenCalled();
    finish();
    await opening;
    expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
  });

  it('uses the supported activation API on Obsidian 1.6.6', async () => {
    vi.mocked(requireApiVersion).mockReturnValue(false);
    const { workspace, leaf } = makeWorkspace(true, true);
    await openSidebar(workspace as unknown as Workspace, VIEW_TYPE);
    expect(requireApiVersion).toHaveBeenCalledWith('1.7.2');
    expect(workspace.revealLeaf).not.toHaveBeenCalled();
    expect(workspace.setActiveLeaf).toHaveBeenCalledWith(leaf, { focus: true });
  });
});
