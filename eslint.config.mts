import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores } from 'eslint/config';

export default tseslint.config(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		// `scripts/*.mjs` is plain Node, not TypeScript, so the
		// `obsidianmd/no-plugin-as-component` rule (which needs type info)
		// errors out on it. The file is small and self-contained.
		'scripts/**',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'pdf.worker.min.mjs',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		rules: {
			// User-facing notices are prefixed with the plugin's brand name
			// ("ResearchVault: ..."), whose interior capital conflicts with
			// sentence case. Skip strings that start with the prefix; the
			// remainder of the sentence is hand-kept sentence case.
			'obsidianmd/ui/sentence-case': [
				'error',
				{ ignoreRegex: ['^ResearchVault:'] },
			],
		},
	},
);
