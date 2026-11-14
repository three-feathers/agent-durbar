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

/* Text: a long picture name, heading and mood line are cut to their box (the stand-in measure is 0.6 em a character; the page measures with the canvas). */
{
  const measure = (t, px, bold) => t.length * px * (bold ? 0.66 : 0.6);
  const longName = 'fx-' + 'x'.repeat(37) + '.webp'; // 40 characters before the extension
  const world = [{ id: 'long-world', files: [longName, 'floor.webp', 'wall.webp'] }, { id: 'b', files: ['floor.webp'] }];
  const heads = { 'long-world': { title: 'long-world  /  ' + 'arrangement '.repeat(12), line: 'Slate screen  |  ' + 'a very long mood line '.repeat(8) }, b: { title: 'b  /  rows', line: 'short' } };
  assert.ok(heads['long-world'].line.length >= 160, 'the fixture mood line is at least 160 characters');
  assert.strictEqual(longName.replace('.webp', '').length, 40);
  const box = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  function textProblems(plan, texts) {
    const out = [];
    const picBoxes = plan.rows.flatMap((r) => r.items.map((i) => ({ id: r.id, what: 'picture ' + i.name, x: i.x, y: i.y, w: i.w, h: i.h })));
    const all = [...texts, ...picBoxes];
    for (const t of texts) if (t.x < 0 || t.x + t.w > plan.width) out.push(`${t.id} ${t.what}: leaves the sheet's width (${Math.round(t.x + t.w)} of ${plan.width})`);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (box(all[i], all[j])) out.push(`${all[i].id} ${all[i].what} overlaps ${all[j].id} ${all[j].what}`);
    for (const t of texts) if (/^label /.test(t.what)) { const it = plan.rows.find((r) => r.id === t.id).items.find((i) => 'label ' + i.name === t.what); if (t.w > it.w) out.push(`${t.id} ${t.what}: wider than its picture box (${Math.round(t.w)} of ${it.w})`); }
    return out;
  }
  for (const width of [400, 700, 1400]) {
    const p = S.plan(world, { width });
    assert.deepStrictEqual(textProblems(p, S.textBoxes(p, heads, measure)), [], `TRUNCATION: at ${width} px no drawn text leaves the sheet or touches another box`);
  }
  assert.strictEqual(S.fitText('short', 100, (t) => t.length * 6), 'short', 'a text that fits is left alone');
  const cut = S.fitText('x'.repeat(40), 100, (t) => t.length * 6);
  assert.ok(cut.endsWith('\u2026') && cut.length * 6 <= 100, 'TRUNCATION: a long text is cut with an ellipsis to the width');
  assert.ok(S.fitText('x'.repeat(40), 100, (t) => t.length * 6).length > 5, 'and keeps as much as fits');
  /* The checker itself sees an uncut name: with fitting off, the same fixture fails. */
  const p = S.plan(world, { width: 1400 });
  const uncut = S.textBoxes(p, heads, (t, px, bold) => t.length * px * (bold ? 0.66 : 0.6)).map((t) => t);
  assert.ok(textProblems(p, uncut.map((t) => (/^label /.test(t.what) ? { ...t, w: longName.length * 10 * 0.6 } : t))).some((m) => /wider than its picture box/.test(m)), 'the text check does see a 40-character name that is not cut');
}

/* The real worlds: every picture of every world is on the sheet. */
const SRC = path.join(__dirname, '..', 'src', 'renderer', 'realoffice', 'worlds');
const real = fs.readdirSync(SRC).filter((id) => fs.existsSync(path.join(SRC, id, 'world.json'))).sort().map((id) => ({ id, files: fs.readdirSync(path.join(SRC, id)) }));
assert.ok(real.length >= 3);
assert.deepStrictEqual(problems(S.plan(real), real), [], 'every picture of the real worlds is on the sheet');
console.log(`test-world-contact-sheet OK (${real.length} worlds, ${S.plan(real).rows.reduce((n, r) => n + r.items.length, 0)} pictures)`);
