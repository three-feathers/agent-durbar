/* Spec 102 FR-017, T094, plain Node: the layout of scripts/world-contact-sheet.js (what is on the sheet and where). The drawing needs
   Electron and is read by a person: `npm run world:contact-sheet`. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const S = require('./world-contact-sheet');

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h + 14 && b.y < a.y + a.h + 14;
function problems(p, worlds) {
  const out = [];
  const all = [];
  for (const row of p.rows) for (const it of row.items) all.push({ ...it, id: row.id });
  for (const w of worlds) {
    const shown = p.rows.find((r) => r.id === w.id);
    if (!shown) { out.push(`${w.id}: no row`); continue; }
    for (const n of w.files) if (S.isSheetPicture(n) && !shown.items.some((i) => i.name === n)) out.push(`${w.id}/${n}: missing from the sheet`);
    for (const i of shown.items) if (/^kid\d/.test(i.name)) out.push(`${w.id}/${i.name}: a kid picture is on the sheet`);
  }
  for (const it of all) {
    if (it.x < 0 || it.x + it.w > p.width) out.push(`${it.id}/${it.name}: outside the sheet's width`);
    if (it.y < 0 || it.y + it.h + p.labelH > p.height) out.push(`${it.id}/${it.name}: outside the sheet's height`);
  }
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (overlap(all[i], all[j])) out.push(`${all[i].id}/${all[i].name} overlaps ${all[j].id}/${all[j].name}`);
  for (let r = 1; r < p.rows.length; r++) if (p.rows[r].y < p.rows[r - 1].y + p.rows[r - 1].headerH) out.push(`${p.rows[r].id}: row starts inside the one above`);
  return out;
}

const fake = [
  { id: 'a', files: ['fx-web.webp', 'floor.webp', 'kid1-done.webp', 'wall.webp', 'desk.webp', 'monitor.webp', 'fx-bank.webp', 'world.css'] },
  { id: 'b', files: Array.from({ length: 23 }, (_, i) => `fx-${String(i).padStart(2, '0')}.webp`) },
  { id: 'c', files: ['floor.webp'] },
];
for (const width of [400, 700, 1400]) assert.deepStrictEqual(problems(S.plan(fake, { width }), fake), [], `a sheet ${width} wide holds every picture, once, with no overlap`);
const p = S.plan(fake, { width: 1400 });
assert.deepStrictEqual(p.rows[0].items.map((i) => i.name), ['wall.webp', 'floor.webp', 'desk.webp', 'monitor.webp', 'fx-bank.webp', 'fx-web.webp'], 'wall, floor, desk, monitor, then fixtures; no kid, no css');
assert.ok(p.rows[1].items.some((i) => i.y > p.rows[1].items[0].y), 'a long row wraps onto another line');
assert.ok(problems(S.plan(fake, { width: 1400 }), [...fake, { id: 'd', files: ['x.webp'] }]).some((m) => /d: no row/.test(m)), 'a world missing from the plan is named');

/* The real worlds: every picture of every world is on the sheet. */
const SRC = path.join(__dirname, '..', 'src', 'renderer', 'realoffice', 'worlds');
const real = fs.readdirSync(SRC).filter((id) => fs.existsSync(path.join(SRC, id, 'world.json'))).sort().map((id) => ({ id, files: fs.readdirSync(path.join(SRC, id)) }));
assert.ok(real.length >= 3);
assert.deepStrictEqual(problems(S.plan(real), real), [], 'every picture of the real worlds is on the sheet');
console.log(`test-world-contact-sheet OK (${real.length} worlds, ${S.plan(real).rows.reduce((n, r) => n + r.items.length, 0)} pictures)`);
