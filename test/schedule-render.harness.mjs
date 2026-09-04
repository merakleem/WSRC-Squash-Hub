// Render the real schedule module against a real payload, then write the
// markup to a static page so Chrome can show the pixels.
// Usage: node harness.mjs <payload.json> <out.html> <YYYY-MM-DD> [panel:new|panel:edit]
import { readFileSync, writeFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { parseHTML } from 'linkedom';
const REPO='/Users/meraklee/Desktop/Codebases/Squash Management System';
const HERE=new URL('.', import.meta.url).pathname;
const OUT=process.argv[3];
const MODE=process.argv[5]||'';
const payload=JSON.parse(readFileSync(process.argv[2],'utf8'));
const { window } = parseHTML(`<!doctype html><html><body>
 <div id="pageTitle"></div><div id="topbarActions"></div><main class="content" id="mainContent"></main>
 <div id="modalOverlay"><div id="modal"><div id="modalTitle"></div><div id="modalBody"></div><button id="modalClose"></button></div></div>
 <div id="toastContainer"></div></body></html>`);
globalThis.document=window.document; globalThis.window=window;
window.matchMedia=()=>({matches:false});
globalThis.requestAnimationFrame=f=>f(); window.requestAnimationFrame=globalThis.requestAnimationFrame;
globalThis.sessionStorage={getItem:()=>null,setItem(){},removeItem(){}}; window.sessionStorage=globalThis.sessionStorage;
globalThis.fetch=async()=>({ok:true,json:async()=>({})});
Object.defineProperty(window,'innerWidth',{get:()=>1500});
const PLAYERS=['Sofia Duarte','Marcus Lang','Priya Raman','Tom Beckett','Elena Sorokin','Dev Patel','Ruth Okonjo','Callum Reid','James Whitfield']
  .map((name,i)=>({id:i+1,name}));
window.api={ getSchedule:async()=>payload, getCourts:async()=>payload.courts,
  getBookingTypes:async()=>payload.types||[], getPlayers:async()=>PLAYERS };
for (const [src,dst] of [['renderer/state.js','state.mjs'],['renderer/utils.js','utils.mjs'],
                         ['renderer/schedulePanel.js','schedPanel.mjs'],['renderer/schedule.js','sched.mjs']]) {
  writeFileSync(`${HERE}${dst}`, readFileSync(`${REPO}/${src}`,'utf8')
    .replace(/'\.\.?\/state\.js'/,"'./state.mjs'").replace(/'\.\.?\/utils\.js'/,"'./utils.mjs'")
    .replace(/'\.\/schedulePanel\.js'/,"'./schedPanel.mjs'")
    .replace(/from '\.\/pages\/[a-zA-Z]+\.js'/g, "from './stub.mjs'"));
}
writeFileSync(`${HERE}stub.mjs`,'export const x=1; export function openPickupGameModal(){}\n');
const { state } = await import(pathToFileURL(`${HERE}state.mjs`).href);
state.currentUser={role:'admin',playerId:null};
state.scheduleDate=process.argv[4];
const sched = await import(pathToFileURL(`${HERE}sched.mjs`).href);
await sched.renderSchedule();
await new Promise(r=>setTimeout(r,60));

if (MODE.startsWith('panel:')) {
  const panel = await import(pathToFileURL(`${HERE}schedPanel.mjs`).href);
  const editSlot = payload.slots.find((s)=>s.id===2);
  await panel.openBookingPanel({
    mode: MODE.split(':')[1],
    host: document.querySelector('.sch-page'),
    courts: payload.courts, slots: payload.slots, types: payload.types, players: PLAYERS,
    courtIds: [2, 3], start: 19*60, dur: 90,
    slot: editSlot,
  });
  await new Promise(r=>setTimeout(r,20));
}

const inner=document.getElementById('mainContent').innerHTML;
const actions=document.getElementById('topbarActions').innerHTML;
writeFileSync(OUT, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"></head>
<body><div class="app-container"><aside class="sidebar" style="width:220px"></aside>
<div class="main-wrapper"><header class="topbar"><div class="topbar-left"><h1 class="topbar-title">Schedule</h1></div><div class="topbar-actions">${actions}</div></header>
<main class="content content--schedule">${inner}</main></div></div></body></html>`);
console.log('  rendered', inner.length, 'chars');
