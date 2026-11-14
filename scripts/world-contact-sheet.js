/* Spec 102 FR-017, T094: a contact sheet of every world's pictures side by side, for the owner's look (artifact only: it is written to
   out/world-contact-sheet/ (git-ignored) and never committed, 098 FR-054's rule; it is not in DOC_SHOTS). One row per world: its card's
   arrangement, monitor, mood and light, then wall, floor, desk, monitor and fixture pictures at one box size, so shapes and colours can be
   told apart at a glance. Dev-side: the pictures are drawn in a hidden Electron window (no app code, no session, no network).

     electron scripts/world-contact-sheet.js [--out DIR] [--width 1400]      (npm run world:contact-sheet; run under the Electron lock)

   Not here yet: every world's own seating plan in the simulator scene at about 320x200 (needs the matrix scene); until then the sheet
   shows the pictures and the card's arrangement id, and the reviewer judges the seating plan from the card and the simulator.
   The reviewer's look is recorded by a person in the card's `distinct-check` (test:world-catalogue reads it); this script never sets it. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'renderer', 'realoffice', 'worlds');
const CARDS = path.join(ROOT, 'worlds');

const ORDER = [/^wall/, /^floor/, /^desk/, /^monitor/, /^fx-/];
const rank = (n) => { const i = ORDER.findIndex((r) => r.test(n)); return i < 0 ? ORDER.length : i; };
/** A picture shown on the sheet: every world picture except the kids (crew art, not the world's own look). */
const isSheetPicture = (n) => /\.webp$/.test(n) && !/^kid\d/.test(n);
const sheetOrder = (names) => names.filter(isSheetPicture).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));

/**
 * The layout, pure: { width, height, rows: [{ id, y, headerH, items: [{ name, x, y, w, h }] }] }. Every picture of every world gets one
 * box of cell x cell, left to right, wrapping at the sheet's width; a row's header is above its boxes.
 */
function plan(worlds, { width = 1400, cell = 120, gap = 10, pad = 16, header = 54, labelH = 14, rowGap = 20 } = {}) {
  const cols = Math.max(1, Math.floor((width - 2 * pad + gap) / (cell + gap)));
  const rows = [];
  let y = pad;
  for (const w of worlds) {
    const names = sheetOrder(w.files);
    const lines = Math.max(1, Math.ceil(names.length / cols));
    const items = names.map((name, i) => ({ name, x: pad + (i % cols) * (cell + gap), y: y + header + Math.floor(i / cols) * (cell + labelH + gap), w: cell, h: cell }));
    rows.push({ id: w.id, y, headerH: header, items });
    y += header + lines * (cell + labelH + gap) + rowGap;
  }
  return { width, height: y + pad - rowGap, cell, labelH, pad, rows };
}

/** Text is cut with an ellipsis to the width it may have (`measure(text)` is its drawn width); the page measures with the canvas, the test with a stand-in. */
function fitText(text, maxW, measure) {
  if (measure(text) <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (measure(text.slice(0, mid) + '\u2026') <= maxW) lo = mid; else hi = mid - 1; }
  return text.slice(0, lo) + '\u2026';
}
const FONT_PX = { title: 18, line: 13, label: 10 };

/** The text each row draws, as boxes { id, what, x, y, w, h } at their fitted width: heading, monitor and mood line, and one label under every picture. */
function textBoxes(p, heads, measure) {
  const out = [];
  const full = p.width - 2 * p.pad;
  for (const row of p.rows) {
    const t = fitText(heads[row.id].title, full, (x) => measure(x, FONT_PX.title, true));
    out.push({ id: row.id, what: 'heading', x: p.pad, y: row.y, w: measure(t, FONT_PX.title, true), h: FONT_PX.title + 4 });
    const l = fitText(heads[row.id].line, full, (x) => measure(x, FONT_PX.line, false));
    out.push({ id: row.id, what: 'line', x: p.pad, y: row.y + 26, w: measure(l, FONT_PX.line, false), h: FONT_PX.line + 3 });
    for (const it of row.items) {
      const n = fitText(it.name.replace('.webp', ''), it.w, (x) => measure(x, FONT_PX.label, false));
      out.push({ id: row.id, what: 'label ' + it.name, x: it.x, y: it.y + it.h + 2, w: measure(n, FONT_PX.label, false), h: FONT_PX.label + 2 });
    }
  }
  return out;
}
/* Runs in the hidden window. The argument is a JSON literal of the plan, the header texts and the pictures as data URLs. */
const PAGE = 'const fitText = ' + fitText.toString() + ';\n' + `window.__sheet = async (spec) => {
  const c = document.createElement('canvas'); c.width = spec.plan.width; c.height = spec.plan.height;
  const g = c.getContext('2d');
  g.fillStyle = '#2b2b2b'; g.fillRect(0, 0, c.width, c.height);
  const load = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('picture did not decode')); i.src = u; });
  for (const row of spec.plan.rows) {
    g.fillStyle = '#f2f2f2'; g.font = 'bold 18px sans-serif'; g.textBaseline = 'top';
    g.font = 'bold 18px sans-serif';
    g.fillText(fitText(spec.heads[row.id].title, spec.plan.width - 2 * spec.plan.pad, (t) => g.measureText(t).width), 16, row.y);
    g.font = '13px sans-serif'; g.fillStyle = '#c8c8c8';
    g.fillText(fitText(spec.heads[row.id].line, spec.plan.width - 2 * spec.plan.pad, (t) => g.measureText(t).width), 16, row.y + 26);
    for (const it of row.items) {
      const img = await load(spec.pics[row.id + '/' + it.name]);
      g.fillStyle = '#7d7d7d'; g.fillRect(it.x, it.y, it.w, it.h);
      const s = Math.min(it.w / img.naturalWidth, it.h / img.naturalHeight);
      const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
      g.imageSmoothingEnabled = s < 1;
      g.drawImage(img, it.x + Math.floor((it.w - w) / 2), it.y + Math.floor((it.h - h) / 2), w, h);
      g.fillStyle = '#c8c8c8'; g.font = '10px sans-serif'; g.fillText(fitText(it.name.replace('.webp', ''), it.w, (t) => g.measureText(t).width), it.x, it.y + it.h + 2);
    }
  }
  return c.toDataURL('image/jpeg', 0.82);
}; true;`;

function readWorlds() {
  const out = [];
  for (const id of fs.readdirSync(SRC).sort()) {
    const dir = path.join(SRC, id);
    if (!fs.statSync(dir).isDirectory() || !fs.existsSync(path.join(dir, 'world.json'))) continue;
    let card = {};
    try { card = JSON.parse(fs.readFileSync(path.join(CARDS, id, 'card.json'), 'utf8')); } catch (e) { /* no card: the heading says so */ }
    out.push({ id, dir, card, files: fs.readdirSync(dir).filter(isSheetPicture) });
  }
  return out;
}

async function main(app, BrowserWindow) {
  const argv = process.argv.slice(2);
  const argOf = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const outDir = path.resolve(argOf('--out') || path.join(ROOT, 'out', 'world-contact-sheet'));
  const width = Number(argOf('--width') || 1400);
  const worlds = readWorlds();
  const p = plan(worlds, { width });
  const heads = {}; const pics = {};
  for (const w of worlds) {
    const c = w.card;
    heads[w.id] = { title: `${w.id}${c.arrangement ? '  /  ' + c.arrangement : '  /  (no card)'}`, line: [c.monitor, c.mood, c.light ? c.light.join(' and ') + ' K' : ''].filter(Boolean).join('  |  ') };
    for (const n of w.files) pics[w.id + '/' + n] = 'data:image/webp;base64,' + fs.readFileSync(path.join(w.dir, n)).toString('base64');
  }
  await app.whenReady();
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL('data:text/html;charset=utf-8,<title>sheet</title>');
  await win.webContents.executeJavaScript(PAGE);
  const url = await win.webContents.executeJavaScript('window.__sheet(' + JSON.stringify({ plan: p, heads, pics }) + ')');
  win.destroy();
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'world-contact-sheet.jpg');
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`world-contact-sheet: ${worlds.length} worlds (${worlds.map((w) => w.id).join(', ')}), ${p.width}x${p.height}, ${fs.statSync(file).size} bytes: ${file}`);
  return 0;
}

module.exports = { plan, sheetOrder, isSheetPicture, fitText, textBoxes, FONT_PX };

if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  require('./world-distinct').within(main(app, BrowserWindow), 60000, 'the whole run').then((code) => { app.exit(code); }, (e) => { console.error((e && e.stack) || e); app.exit(1); });
} else if (require.main === module) {
  console.error('world-contact-sheet draws in Electron: run `npm run world:contact-sheet` (under the Electron lock).');
  process.exit(2);
}
