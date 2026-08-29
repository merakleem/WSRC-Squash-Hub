import { readFileSync, writeFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { parseHTML } from 'linkedom';
const REPO = '/Users/meraklee/Desktop/Codebases/Squash Management System';
const HERE = new URL('.', import.meta.url).pathname;
const { window } = parseHTML(`<!doctype html><html><body>
  <div id="pageTitle"></div><div id="topbarActions"></div><main class="content"></main>
  <div id="modalOverlay"><div id="modal"><div id="modalTitle"></div><div id="modalBody"></div><button id="modalClose"></button></div></div>
  <div id="toastContainer"></div></body></html>`);
globalThis.document = window.document; globalThis.window = window;
window.matchMedia = () => ({ matches: false });
globalThis.requestAnimationFrame = (f) => f(); window.requestAnimationFrame = globalThis.requestAnimationFrame;
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
window.sessionStorage = globalThis.sessionStorage;
class IO { observe(){} disconnect(){} } globalThis.IntersectionObserver = IO; window.IntersectionObserver = IO;
globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
Object.defineProperty(window, 'innerWidth', { get: () => 1280 });
window.api = {
  getCourts: async () => [{ id: 1, name: 'Court 1', active: 1 }],
  getSchedule: async () => ({ slots: [] }),
  getMyBookings: async () => [],   // the empty case
  getPlayerRecords: async () => [],
};
for (const [src, dst] of [['renderer/state.js','state.mjs'],['renderer/utils.js','utils.mjs'],['renderer/pages/courtBooking.js','cb.mjs']]) {
  writeFileSync(`${HERE}${dst}`, readFileSync(`${REPO}/${src}`,'utf8').replace(/'\.\.?\/state\.js'/,"'./state.mjs'").replace(/'\.\.?\/utils\.js'/,"'./utils.mjs'"));
}
const { state } = await import(pathToFileURL(`${HERE}state.mjs`).href);
const cb = await import(pathToFileURL(`${HERE}cb.mjs`).href);
state.currentUser = { playerId: 1, role: 'player' }; state.players = [{ id: 1, name: 'Me' }];
cb.renderCourtBooking();
await new Promise(r => setTimeout(r, 30));
document.querySelector('#pageTitle .cb-tab[data-tab="mine"]')?.dispatchEvent(new window.Event('click', { bubbles: true }));
await new Promise(r => setTimeout(r, 20));
let failed = 0;
const ok = (l,c,e='') => { console.log(`  ${c?'PASS':'FAIL'}  ${l}${e?'  '+e:''}`); if(!c) failed++; };
ok('the empty state renders', !!document.querySelector('.cb-mine-empty'));
ok('and sits inside the padded list', !!document.querySelector('.cb-mine-list .cb-mine-empty'));
ok('not as a bare child of the wrapper', !document.querySelector('.cb-mine-wrap > .cb-mine-empty'));
ok('the heading is still there', document.querySelector('.cb-mine-title')?.textContent === 'My Bookings');
ok('and the book-a-court button', !!document.querySelector('#cbGoBook'));
console.log(`\n${failed===0?'ALL PASS':failed+' FAILED'}`);
process.exit(failed?1:0);
