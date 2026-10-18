import type { Workspace } from 'obsidian';
import { requireApiVersion } from 'obsidian';

/** Reuse the sidebar leaf and reveal it even when its sidebar is collapsed. */
export async function openSidebar(workspace: Workspace, viewType: string): Promise<void> {
  const leaf = workspace.getLeavesOfType(viewType)[0]
    ?? workspace.getRightLeaf(false)
    ?? workspace.getLeaf('split');
  await leaf.setViewState({ type: viewType, active: true });
  if (requireApiVersion('1.7.2')) {
    await workspace.revealLeaf(leaf);
  } else {
    workspace.setActiveLeaf(leaf, { focus: true });
  }
}
