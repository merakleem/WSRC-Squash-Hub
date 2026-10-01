// Builds dist/ for the Claude Design sync: an ESM bundle of the components,
// their .d.ts, and dist/playwsrc.css - the app's own renderer/styles.css,
// copied verbatim, plus the few design-canvas adjustments in src/canvas.css.
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/index.js',
  jsx: 'automatic',
  target: 'es2020',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  // The sidebar crest is a 5 KB PNG; inline it so a design needs no /assets.
  loader: { '.png': 'dataurl' },
});

execSync('npx tsc -p tsconfig.json', { stdio: 'inherit' });

const app = readFileSync('../renderer/styles.css', 'utf8');
const canvas = readFileSync('src/canvas.css', 'utf8');
writeFileSync('dist/playwsrc.css',
  `/* ===== renderer/styles.css (copied at build time; edit it there) ===== */\n${app}\n${canvas}`);
console.log('built dist/');
