import { createRequire } from 'node:module'
const require = createRequire(new URL('../customer_app/package.json', import.meta.url))
const js = require('@eslint/js')
const globals = require('globals')
const hooks = require('eslint-plugin-react-hooks')
export default [{
  files: ['**/*.{js,jsx}'],
  languageOptions: { globals: globals.browser, parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { 'react-hooks': hooks },
  rules: { ...js.configs.recommended.rules, ...hooks.configs.recommended.rules },
}]
