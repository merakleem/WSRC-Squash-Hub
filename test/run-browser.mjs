// Runs every test/*.browser.html suite headless and fails if any fails.
//
//   npm run test:browser                 # all suites, chromium
//   npm run test:browser -- events       # suites whose name contains "events"
//   PW_BROWSER=webkit npm run test:browser
//
// Each suite is a page that drives real renderer modules against fixtures,
// sets its <title> to PASS or FAIL n, and writes its assertions to #log. They
// have to be served over HTTP (ES modules), so this starts a static server on
// a free port for the repo root. Widths matter: a few suites test the phone or
// tablet layout and decide it from window.innerWidth.

import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BROWSER = process.env.PW_BROWSER || 'chromium';
const filter = process.argv.slice(2);

// Viewport width per suite; 1280 unless listed. Doubles suites also run at a
// phone width, because their layouts change there.
const WIDTHS = {
  'court-booking-mobile': [500],
  'events': [768],
  'schedule-editing': [768],
  'club-activity': [1000],
  'match-card-doubles': [1100, 390],
  'ladder-doubles': [1280, 390],
  'profile-doubles': [1280, 390],
  'league-doubles': [1280, 390],
  'dashboard-doubles': [1280, 390],
};

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

function serve() {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, url);
    if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end(); }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch (_) { res.writeHead(500); res.end(); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

async function runSuite(browser, port, name, width) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/test/${name}.browser.html`, { waitUntil: 'commit' });
  let title = '';
  // Three suites set no RUNNING title and only a final one, so an empty title
  // means "not finished", not "no suite". Poll up to 30s.
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(250);
    title = await page.title();
    if (title && title !== 'RUNNING') break;
  }
  const log = await page.evaluate(() => document.getElementById('log')?.textContent || '');
  await page.close();
  const passed = /^PASS/.test(title);
  return { name, width, title: title || '(no title: did not finish)', passed, errors, failures: log.split('\n').filter((l) => /^\s*FAIL/.test(l)) };
}

const files = (await readdir(path.join(ROOT, 'test'))).filter((f) => f.endsWith('.browser.html')).map((f) => f.replace(/\.browser\.html$/, '')).sort();
const chosen = files.filter((n) => !filter.length || filter.some((f) => n.includes(f)));
if (!chosen.length) { console.error('no suites match', filter); process.exit(2); }

const { [BROWSER]: engine } = await import('playwright');
const { server, port } = await serve();
const browser = await engine.launch();
let failed = 0;
try {
  for (const name of chosen) {
    for (const width of WIDTHS[name] || [1280]) {
      const r = await runSuite(browser, port, name, width);
      if (!r.passed) failed++;
      console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${name} @${width}  ${r.title}`);
      for (const f of r.failures) console.log('      ' + f.trim());
      for (const e of r.errors) console.log('      pageerror: ' + e);
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `\n${failed} suite run(s) FAILED` : '\nall browser suites passed');
process.exit(failed ? 1 : 0);
