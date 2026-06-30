// src/main.ts
//
// Obsidian plugin entry point. Kept deliberately thin so the real plugin
// class lives in `./core/plugin.ts` and can be reused (future mobile shim,
// companion CLI, etc.) without dragging Obsidian globals into every caller.
//

export { ResearchVaultPlugin as default } from './core/plugin';
