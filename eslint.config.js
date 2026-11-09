import js from '@eslint/js'
import globals from 'globals'

export default [
  { ignores: ['libraries/', 'site/', '_site/', 'documentation_files/','coverage/', 'node_modules/'] },
  js.configs.recommended,
  {
    // Three.js and FileSaver are loaded as classic scripts in index.html.
    files: ['main.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, THREE: 'readonly', saveAs: 'readonly' },
    },
  },
  {
    files: ['worker.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.worker },
  },
  {
    files: ['scripts/**', 'tests/**', 'vitest.config.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
]
