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
					allowDefaultProject: ['eslint.config.mts', 'vitest.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ['tests/**'],
		rules: {
			// Vitest runs in Node, so unit tests may import node builtins
			// (e.g. `node:zlib` to round-trip the vendored CSL bundle).
			'import/no-nodejs-modules': 'off',
		},
	},
	{
		rules: {
			// User-facing notices are prefixed with the plugin's brand name
			// ("ResearchVault: ..."), whose interior capital conflicts with
			// sentence case. Skip strings that start with the prefix; the
			// remainder of the sentence is hand-kept sentence case.
			'obsidianmd/ui/sentence-case': [
				'error',
				{
					ignoreRegex: ['^ResearchVault:'],
					// Industry acronyms are legitimately all-caps in UI copy
					// (5.4 settings audit): the rule would otherwise demand
					// "doi", "ttl", "lru" in settings descriptions. The option
					// REPLACES the plugin's built-in default list rather than
					// merging with it, so the defaults are mirrored here (sync
					// with upstream `DEFAULT_ACRONYMS` on a plugin major bump)
					// plus our additions: DOI, TTL, LRU.
					acronyms: [
						'API', 'HTTP', 'HTTPS', 'URL', 'DNS', 'TCP', 'IP', 'SSH', 'TLS',
						'SSL', 'FTP', 'SFTP', 'SMTP',
						'JSON', 'XML', 'HTML', 'CSS', 'PDF', 'CSV', 'YAML', 'SQL',
						'PNG', 'JPG', 'JPEG', 'GIF', 'SVG',
						'2FA', 'MFA', 'OAuth', 'JWT', 'LDAP', 'SAML',
						'SDK', 'IDE', 'CLI', 'GUI', 'CRUD', 'SOAP',
						'CPU', 'GPU', 'RAM', 'SSD', 'USB',
						'UI', 'OK',
						'RSS', 'S3',
						'ID', 'UUID', 'GUID', 'SHA', 'MD5', 'ASCII', 'UTF-8', 'UTF-16',
						'DOM', 'CDN', 'FAQ', 'AI', 'ML', 'LLM',
						'DOI', 'TTL', 'LRU',
					],
				},
			],
		},
	},
);
