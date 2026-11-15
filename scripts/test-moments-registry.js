/*
 * Spec 102 RA7 (`npm run test:momentsregistry`, review of #1279, FR-264, T223): the `retro` cells of docs/experience/world-moments.json are guarded.
 *   - every moment has a `worlds.retro` cell, and the cells are exactly the 26 ids below (written out by hand, so the registry cannot vouch for itself);
 *   - a cell is built | designed | fallback-flat | missing;
 *   - the retro world is `shippable: false` while any cell is `missing` (or `designed`: drawn, not looked at);
 *   - a `built` cell names its evidence: driver steps that exist in scripts/shots-097-moments.js and pictures that driver writes; a `missing` cell says why (`gap`);
 *   - the arcade's changes are scoped: the other worlds' rows equal `origin/main`'s when this change touches the retro ones (a change to Photo alone is not this test's business);
 *     the arcade's top-bar rule in its world.css is scoped to html[data-world="retro"] (the driver's `scope` step shows it in the app, in Photo and the cave).
 * `check(inputs)` returns the problems; the mutants below must each fail with their own message.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const STATES = ['built', 'designed', 'fallback-flat', 'missing'];
const RETRO_CELLS = ['office-floor', 'lobby', 'boss-bank-post-coffee', 'desk-card', 'desk-lights', 'live-screen', 'lounge', 'walk', 'empty-office', 'first-run', 'lift-panel', 'floor-change', 'floor-indicator', 'all-floors', 'building-preview', 'floor-jumps', 'inbox', 'chat-open', 'chat-shell', 'chat-header', 'limit-card', 'permission-card', 'question-card', 'elicitation', 'answer-bar', 'coffee-bar'];
const WORLDS = ['photo', 'cave', 'loft', 'retro'];

const stripRetro = (reg) => {
  const c = JSON.parse(JSON.stringify(reg));
  delete c.worlds.retro;
  for (const m of c.moments) { delete m.worlds.retro; if (m.evidence) delete m.evidence.retro; if (m.gap) delete m.gap.retro; if (m.evidence && !Object.keys(m.evidence).length) delete m.evidence; if (m.gap && !Object.keys(m.gap).length) delete m.gap; }
  return c;
};
const retroPart = (reg) => JSON.stringify([reg.worlds.retro, reg.moments.map((m) => [m.id, m.worlds.retro, m.evidence && m.evidence.retro, m.gap && m.gap.retro])]);

/** The picture names the driver writes: the name argument of `shot(world, <name>, w, h)` (a literal, or the literals of a ternary after its `?`), and the X of a `${world}-X-${w}x${h}.png` template; never the condition's operands ('15' in `n === '15' ? ...`). */
function writtenPictures(driver, everyQuotedWord = false) {
  const out = new Set();
  for (const line of driver.split('\n')) {
    const i = line.indexOf('shot(world, ');
    if (i < 0) continue;
    const rest = line.slice(i + 'shot(world, '.length);
    if (everyQuotedWord) { for (const x of rest.matchAll(/'([\w-]+)'/g)) out.add(x[1]); continue; }
    const arg = rest.slice(0, rest.lastIndexOf(', w, h)'));
    const q = arg.indexOf('?') >= 0 ? arg.slice(arg.indexOf('?') + 1) : arg;
    for (const x of q.matchAll(/'([\w-]+)'(?!\s*\+)/g)) out.add(x[1]);
  }
  for (const x of driver.matchAll(/\$\{world\}-([\w-]+)-\$\{w\}x\$\{h\}\.png/g)) out.add(x[1]);
  return out;
}

/** reg: the registry; main: main's registry or null; driver: scripts/shots-097-moments.js text; css: the arcade's world.css text */
function check({ reg, main, driver, css }) {
  const bad = [];
  /* only names given to the picture writer count: shot(world, 'X', ...) and `${world}-X-${w}x${h}.png` */
  const written = writtenPictures(driver);
  const ids = reg.moments.map((m) => m.id);
  if (JSON.stringify(ids.slice().sort()) !== JSON.stringify(RETRO_CELLS.slice().sort())) bad.push(`the moments are not the 26 the arcade has cells for: ${ids.join(',')}`);
  const world = reg.worlds.retro;
  if (!world) bad.push('the retro world is not in the registry');
  const cells = {};
  for (const m of reg.moments) {
    const s = m.worlds && m.worlds.retro;
    cells[m.id] = s;
    if (!STATES.includes(s)) { bad.push(`retro cell ${m.id} is ${JSON.stringify(s)}, not one of ${STATES.join(' | ')}`); continue; }
    const ev = m.evidence && m.evidence.retro;
    if (s === 'built') {
      if (!ev || !Array.isArray(ev.steps) || !ev.steps.length || !Array.isArray(ev.pictures)) { bad.push(`retro cell ${m.id} is built and names no evidence (driver steps and pictures)`); continue; }
      for (const st of ev.steps) if (!driver.includes(`run('${st}')`)) bad.push(`retro cell ${m.id}: evidence step ${st} is not a step of shots-097-moments`);
      if (!ev.pictures.length) bad.push(`retro cell ${m.id} is built with no picture (T223: built only where a picture of it in the arcade was looked at)`);
      for (const p of ev.pictures) if (!written.has(p)) bad.push(`retro cell ${m.id}: evidence picture ${p} is not written by shots-097-moments`);
    } else if (ev) bad.push(`retro cell ${m.id} is ${s} but names evidence`);
    if (s === 'missing' && !(m.gap && typeof m.gap.retro === 'string' && m.gap.retro.length > 10)) bad.push(`retro cell ${m.id} is missing and says nothing why (gap.retro)`);
  }
  if (world && world.shippable !== false && Object.values(cells).some((s) => s === 'missing' || s === 'designed')) bad.push('retro is shippable while a cell is missing or only designed');
  if (world && typeof world.shippable !== 'boolean') bad.push('retro `shippable` is not a boolean');
  // scoped to the arcade
  if (main) {
    if (retroPart(reg) !== retroPart(main)) {
      if (JSON.stringify(stripRetro(reg)) !== JSON.stringify(stripRetro(main))) bad.push('the change touches the retro cells and also another world or the shared registry: it is not equal to origin/main outside the retro cells');
    }
  }
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.trim()).filter((r) => /#stats\b/.test(r));
  if (!rules.length) bad.push('the arcade\'s first-run rule (#stats) is not in its world.css');
  for (const r of rules) if (!/^html\[data-world="retro"\]/.test(r)) bad.push(`an arcade rule on #stats is not scoped to html[data-world="retro"]: ${r.slice(0, 80)}`);
  return bad;
}

function readMain() {
  /* the registry at the merge-base with origin/main, not at whatever origin/main is now; null in a shallow checkout (CI fetches depth 2), where the comparison is skipped and says so */
  const mb = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: ROOT, encoding: 'utf8' });
  if (mb.status !== 0 || !mb.stdout.trim()) return null;
  const r = spawnSync('git', ['show', mb.stdout.trim() + ':docs/experience/world-moments.json'], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? JSON.parse(r.stdout) : null;
}

if (require.main === module) {
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'experience', 'world-moments.json'), 'utf8'));
  const driver = fs.readFileSync(path.join(__dirname, 'shots-097-moments.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'realoffice', 'worlds', 'retro', 'world.css'), 'utf8');
  const main = readMain();
  if (!main) console.log('[momentsregistry] SKIP the origin/main comparison: no merge-base with origin/main in this checkout (a shallow clone as in CI: this runs locally and in a full clone only); every other check ran');
  const inputs = { reg, main, driver, css };
  assert.deepStrictEqual(check(inputs), [], 'the real registry passes');
  assert.strictEqual(RETRO_CELLS.length, 26);
  { const w = writtenPictures(driver);
    for (const n of ['inbox', 'asleep', 'coffee', 'notes', 'jump-f1', 'jump-f2', 'cell-chat']) assert.ok(w.has(n), 'the picture ' + n + ' is read as written');
    for (const n of ['15', 'inbox-', 'world', 'limitfocus', 'scope', 'w', 'h']) assert.ok(!w.has(n), `${n} is not a picture name`);
    assert.ok(writtenPictures(driver, true).has('15'), 'the old parse (every quoted word on a shot line) took the 15: the mutant is real'); }
  assert.strictEqual(Object.keys(reg.worlds).sort().join(), WORLDS.slice().sort().join(), 'the four worlds');

  // mutants: each fails with its own message
  const clone = () => JSON.parse(JSON.stringify(reg));
  const fails = (what, mut, re) => {
    const i = { reg: clone(), main: main && JSON.parse(JSON.stringify(main)), driver, css }; const o = mut(i) || i;
    const got = check(o);
    assert.ok(got.some((g) => re.test(g)), `mutant "${what}" must fail with ${re}: ${JSON.stringify(got)}`);
    console.log(`[momentsregistry] mutant killed: ${what}`);
  };
  fails('a retro cell removed', (i) => { i.reg.moments.splice(i.reg.moments.findIndex((m) => m.id === 'walk'), 1); }, /not the 26/);
  fails('a retro cell is not a state', (i) => { i.reg.moments.find((m) => m.id === 'lobby').worlds.retro = 'bogus'; }, /lobby is "bogus"/);
  fails('a moment has no retro key', (i) => { delete i.reg.moments.find((m) => m.id === 'lobby').worlds.retro; }, /lobby is undefined/);
  fails('a built cell without evidence', (i) => { delete i.reg.moments.find((m) => m.id === 'lobby').evidence; }, /lobby is built and names no evidence/);
  fails('a built cell naming a step the driver does not have', (i) => { i.reg.moments.find((m) => m.id === 'lobby').evidence.retro.steps = ['nowhere']; }, /step nowhere/);
  fails('a built cell naming a picture the driver does not write', (i) => { i.reg.moments.find((m) => m.id === 'lobby').evidence.retro.pictures = ['nopic']; }, /picture nopic/);
  fails('a built cell with no picture (walk)', (i) => { const m = i.reg.moments.find((x) => x.id === 'walk'); m.worlds.retro = 'built'; m.evidence = { retro: { steps: ['inbox'], pictures: [] } }; }, /walk is built with no picture/);
  fails('a picture named that is only text in the driver', (i) => { i.reg.moments.find((x) => x.id === 'lobby').evidence.retro.pictures = ['limitfocus']; }, /picture limitfocus/);
  fails('a picture named 15 (the old every-quoted-word parse would pass it)', (i) => { i.reg.moments.find((x) => x.id === 'lounge').evidence.retro.pictures = ['15']; }, /picture 15/);
  fails('permission-card built on a picture the driver does not write', (i) => { i.reg.moments.find((m) => m.id === 'permission-card').evidence.retro.pictures = ['retro-cell-chat']; }, /permission-card: evidence picture retro-cell-chat/);
  fails('permission-card built on a step the driver does not have', (i) => { i.reg.moments.find((m) => m.id === 'permission-card').evidence.retro.steps = ['perm']; }, /permission-card: evidence step perm/);
  fails('empty-office built again with no evidence', (i) => { i.reg.moments.find((m) => m.id === 'empty-office').worlds.retro = 'built'; }, /empty-office is built and names no evidence/);
  fails('a missing cell without a reason', (i) => { delete i.reg.moments.find((m) => m.id === 'empty-office').gap; }, /empty-office is missing and says nothing why/);
  fails('shippable while a cell is missing', (i) => { i.reg.worlds.retro.shippable = true; }, /shippable while a cell is missing/);
  fails('the first-run rule unscoped', (i) => { i.css = i.css.replace('html[data-world="retro"] body:has(#stage > .welcome) #stats', 'body:has(#stage > .welcome) #stats'); }, /not scoped to html\[data-world="retro"\]/);
  { /* main stands in as a registry whose retro part differs (as on this branch), so these stay mutants after the arcade is merged */
    const asMain = () => { const m = clone(); m.moments.find((x) => x.id === 'lobby').worlds.retro = 'designed'; return m; };
    fails('a photo cell changed alongside the retro cells', (i) => { i.main = asMain(); const m = i.reg.moments.find((x) => x.id === 'walk'); m.worlds.photo = m.worlds.photo === 'built' ? 'designed' : 'built'; }, /not equal to origin\/main outside the retro cells/);
    fails('a photo crew changed alongside the retro cells', (i) => { i.main = asMain(); i.reg.worlds.photo.crews.push('x'); }, /not equal to origin\/main outside the retro cells/);
    assert.deepStrictEqual(check({ reg: clone(), main: asMain(), driver, css }), [], 'retro-only changes pass the main comparison');
  }
  process.exitCode = 0;
  console.log('[momentsregistry] ok');
}
module.exports = { check, RETRO_CELLS };
