/* Spec 102 FR-016, T093 (picture half): are the worlds' pictures distinct? Simulator-side and dev-side: it decodes each WebP in an
   Electron window (Node has no WebP decoder and the project adds none), so it is NOT in `npm test`; run it under the Electron lock.
   `npm run check:world-distinct` (it starts Electron through scripts/run-electron-script.js, which adds --no-sandbox on Linux). It is not the app: no app code, no session, no network.

     electron scripts/check-world-distinct.js [--measure] [--worlds-dir DIR]

   Compares every pair of worlds under src/renderer/realoffice/worlds (or DIR): exact copies of a fixture file, near copies (mask hash
   and difference hash, recoloured or re-encoded) and the average colour of wall, floor and desk (scripts/world-distinct.js holds the
   method and the limits). worlds/known-clashes.json is read: a listed pair is a card clash, reported in one line, never a picture
   waiver; a listed pair that no longer clashes fails. --measure prints the nearest distances of every pair and fails nothing. */
'use strict';
const fs = require('fs');
const path = require('path');
const D = require('./world-distinct');
const cards = require('./world-cards');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const argOf = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const MEASURE = argv.includes('--measure');
const DIR = argOf('--worlds-dir') || path.join(ROOT, 'src', 'renderer', 'realoffice', 'worlds');
const CARDS = path.join(ROOT, 'worlds');

/* Runs in the hidden window: decodes one picture to RGBA, base64. The argument is a JSON literal of a data URL. */
const PAGE = `window.__dec = async (url) => {
  const img = new Image(); img.src = url; await img.decode();
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let s = ''; for (let i = 0; i < d.length; i += 8192) s += String.fromCharCode.apply(null, d.subarray(i, i + 8192));
  return { w: c.width, h: c.height, b64: btoa(s) };
}; true;`;

/* A step that does not settle in `ms` fails the run, naming the step (a corrupt picture can hang a decode). The run takes about 1 s: 30 s a decode and 60 s in all are about 50 times that. */
const STEP_MS = 30000, RUN_MS = 60000;
const within = D.within;

async function main(app, BrowserWindow) {
  await within(app.whenReady(), STEP_MS, 'Electron start');
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await within(win.loadURL('data:text/html;charset=utf-8,<title>decode</title>'), STEP_MS, 'load the decode page');
  await within(win.webContents.executeJavaScript(PAGE), STEP_MS, 'install the decoder');
  const decode = async (buf, label) => {
    const r = await within(win.webContents.executeJavaScript('window.__dec(' + JSON.stringify('data:image/webp;base64,' + buf.toString('base64')) + ')'), STEP_MS, 'decode ' + label);
    return { w: r.w, h: r.h, rgba: Buffer.from(r.b64, 'base64') };
  };
  const worlds = [];
  for (const id of fs.readdirSync(DIR).sort()) {
    const dir = path.join(DIR, id);
    if (!fs.statSync(dir).isDirectory() || !fs.existsSync(path.join(dir, 'world.json'))) continue;
    const w = { id, fixtures: {}, colours: {} };
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith('.webp') || /^kid\d/.test(name)) continue;
      const buf = fs.readFileSync(path.join(dir, name));
      const wantFixture = D.isFixtureFile(name);
      const role = Object.keys(D.COLOUR_ROLES).find((r) => D.COLOUR_ROLES[r].test(name));
      if (!wantFixture && !role) continue;
      const px = await decode(buf, `${id}/${name}`);
      const f = D.features(px.rgba, px.w, px.h);
      if (wantFixture) w.fixtures[name] = { sha: D.sha256(buf), f };
      if (role) w.colours[role] = { name, f };
    }
    worlds.push(w);
  }
  win.destroy();

  if (MEASURE) {
    for (let i = 0; i < worlds.length; i++) for (let j = i + 1; j < worlds.length; j++) {
      const A = worlds[i], B = worlds[j];
      let best = null;
      for (const [na, fa] of Object.entries(A.fixtures)) for (const [nb, fb] of Object.entries(B.fixtures)) {
        if (fa.f.flat || fb.f.flat) continue;
        const { dh: dd, mask: md } = D.distances(fa.f, fb.f);
        if (!best || dd + md / 4 < best.dd + best.md / 4) best = { na, nb, dd, md };
      }
      const same = (x, y) => D.distances(x.f, y.f).dh;
      let rowSame = '';
      for (const [na, fa] of Object.entries(A.fixtures)) if (B.fixtures[na] && !fa.f.flat && !B.fixtures[na].f.flat) rowSame += ` ${na}:${same(fa, B.fixtures[na])}/${D.distances(fa.f, B.fixtures[na].f).mask}`;
      const col = Object.keys(D.COLOUR_ROLES).filter((r) => A.colours[r] && B.colours[r]).map((r) => `${r} dE ${D.deltaE(A.colours[r].f, B.colours[r].f).toFixed(1)}`).join(', ');
      console.log(`${A.id} vs ${B.id}: nearest fixture pair ${best ? `${best.na} / ${best.nb} dh ${best.dd}/64 mask ${best.md}/256` : 'none'}; same-name dh/mask:${rowSame || ' none'}; ${col || 'no colour roles shared'}`);
    }
    for (const w of worlds) console.log(`${w.id}: ${Object.keys(w.fixtures).length} fixtures, flat: ${Object.entries(w.fixtures).filter(([, v]) => v.f.flat).map(([n]) => n).join(' ') || 'none'}; avg ${Object.entries(w.colours).map(([r, v]) => `${r} ${v.f.avg.map(Math.round).join(',')}`).join('; ')}`);
    return 0;
  }

  const fails = D.compareAll(worlds).map((c) => `${c.kind}: ${c.msg}`);
  const cardsById = cards.readCards(CARDS).cards;
  const { known, problems } = cards.loadKnown(CARDS);
  fails.push(...problems);
  const { reported } = cards.judge(cardsById, known);
  for (const r of reported) console.log(`[KNOWN GAP] ${r} (a card clash listed in worlds/known-clashes.json; pictures are still compared and not waived)`);
  fails.push(...cards.staleKnown(cardsById, known));
  for (const f of fails) console.error('FAIL ' + f);
  console.log(fails.length ? `check-world-distinct: ${fails.length} problem(s)` : `check-world-distinct OK (${worlds.length} worlds: ${worlds.map((w) => w.id).join(', ')}; ${D.LIMITS.dhash}/64 difference-hash bits, ${D.LIMITS.mask}/256 silhouette bits, delta E ${D.LIMITS.deltaE})`);
  return fails.length ? 1 : 0;
}

if (!process.versions.electron) {
  console.error('check-world-distinct decodes WebP in Electron: run `npm run check:world-distinct` (under the Electron lock). The plain-Node half is `npm run test:world-distinct`.');
  process.exit(2);
}
const { app, BrowserWindow } = require('electron');
within(main(app, BrowserWindow), RUN_MS, 'the whole run').then((code) => { app.exit(code); }, (e) => { console.error(e && e.stack || e); app.exit(1); });
