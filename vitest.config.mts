import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The npm package contains API types only; Obsidian supplies runtime exports.
    alias: { obsidian: fileURLToPath(new URL('./tests/mocks/obsidian.ts', import.meta.url)) },
  },
});
