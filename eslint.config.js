// House style, as the code already writes it: two-space indent, single
// quotes, semicolons, trailing commas on multi-line literals. Correctness
// rules from ESLint's recommended set on top. `npm run lint` runs it; CI does
// too, so a stray undefined name or unused import fails the build rather
// than the next person.
const js = require('@eslint/js');
const stylistic = require('@stylistic/eslint-plugin');
const globals = require('globals');

const style = {
  '@stylistic/indent': ['error', 2, { SwitchCase: 1, ignoredNodes: ['TemplateLiteral *', 'ConditionalExpression'] }],
  '@stylistic/quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: 'always' }],
  '@stylistic/semi': ['error', 'always'],
  '@stylistic/comma-dangle': ['error', 'always-multiline'],
  '@stylistic/no-trailing-spaces': 'error',
  '@stylistic/eol-last': 'error',
  '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
  '@stylistic/object-curly-spacing': ['error', 'always'],
  '@stylistic/arrow-parens': ['error', 'always'],
};

const correctness = {
  'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'prefer-const': ['error', { destructuring: 'all' }],
  'eqeqeq': ['error', 'always', { null: 'ignore' }],
  'no-var': 'error',
};

module.exports = [
  { ignores: ['node_modules/**', 'renderer/vendor/**', 'test/*.mjs', '!test/run-browser.mjs', '!test/*.harness.mjs', 'avatars/**', 'storage/**'] },
  js.configs.recommended,
  {
    // Server: CommonJS on Node.
    files: ['**/*.js'],
    ignores: ['renderer/**'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...globals.node } },
    plugins: { '@stylistic': stylistic },
    rules: { ...style, ...correctness },
  },
  {
    // Browser: ES modules, no build step. Quill is vendored and global.
    files: ['renderer/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser, Quill: 'readonly' } },
    plugins: { '@stylistic': stylistic },
    rules: { ...style, ...correctness },
  },
  {
    // The service worker has its own global scope.
    files: ['public/sw.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: { ...globals.serviceworker } },
  },
  {
    // Fixtures the browser suites import; ES modules despite the .js.
    files: ['test/*-fixture.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser } },
    plugins: { '@stylistic': stylistic },
    rules: { ...style, ...correctness },
  },
  {
    files: ['test/**/*.mjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    plugins: { '@stylistic': stylistic },
    rules: { ...style, ...correctness },
  },
];
