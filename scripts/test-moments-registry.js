/*
 * Spec 102 RA7 (`npm run test:momentsregistry`, review of #1279, FR-264, T223): the `retro` cells of docs/experience/world-moments.json are guarded.
 *   - every moment has a `worlds.retro` cell, and the cells are exactly the 27 ids below (written out by hand, so the registry cannot vouch for itself);
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
const { gitTry } = require('./git-index-helper.js');

const ROOT = path.join(__dirname, '..');
const STATES = ['built', 'designed', 'fallback-flat', 'missing'];
const RETRO_CELLS = ['office-floor', 'lobby', 'boss-bank-post-coffee', 'desk-card', 'helpers', 'desk-lights', 'live-screen', 'lounge', 'walk', 'empty-office', 'first-run', 'lift-panel', 'floor-change', 'floor-indicator', 'all-floors', 'building-preview', 'floor-jumps', 'inbox', 'chat-open', 'chat-shell', 'chat-header', 'limit-card', 'permission-card', 'question-card', 'elicitation', 'answer-bar', 'coffee-bar'];
/* issue 1644 (spec 102 T235, T327): `helpers` is the one cell that may stay `fallback-flat` for lack of kids: the arcade has no kids (issue #1643, T327, not started) and keeps 097's adult head row; the cell says so in `gap.retro` and is never `built` until T327 is ticked */
const KIDS_PENDING = 'helpers';
const WORLDS = ['photo', 'cave', 'loft', 'retro'];
/* issue 1891: the only cells that may stay `fallback-flat` in the arcade: no world has the surface, so they are not part of the flip (owner, Vikram, 2026-11-19; a backlog feature for all worlds, issue #1892); each says so in `gap.retro` */
const DEFERRED = ['floor-indicator', 'building-preview'];
/* issue 1891: the five chrome cells are drawn by rules in the arcade's world.css (its own tokens); a rule gone is a cell fallen back to the flat drawing, even if the registry still says `built` */
const CHROME_RULES = { 'lift-panel': '.lift-b{border-radius:0', 'chat-shell': '#panel>.rail{border-right:3px', 'chat-header': '.ph{border-bottom:3px', 'chat-open': 'arc-chat-on .2s steps(4)', elicitation: '.note.elicit{border:3px' };

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
  if (JSON.stringify(ids.slice().sort()) !== JSON.stringify(RETRO_CELLS.slice().sort())) bad.push(`the moments are not the 27 the arcade has cells for: ${ids.join(',')}`);
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
  for (const m of reg.moments) {
    const s = m.worlds && m.worlds.retro;
    if (m.id === KIDS_PENDING) { if (!(s === 'fallback-flat' && m.gap && /#1643/.test(m.gap.retro || '') && /T327/.test(m.gap.retro || ''))) bad.push(`retro cell ${m.id}: the arcade has no kids (T327, issue #1643): fallback-flat with a gap.retro naming #1643 and T327, never built`); continue; }
    if (s === 'fallback-flat' && !DEFERRED.includes(m.id)) bad.push(`retro cell ${m.id} falls back to the flat drawing: draw it in the arcade (issue 1891), or the owner defers it`);
    if (DEFERRED.includes(m.id) && !(s === 'fallback-flat' && m.gap && /#1892/.test(m.gap.retro || ''))) bad.push(`retro cell ${m.id} is deferred to #1892 (owner, 2026-11-19): fallback-flat with a gap.retro naming #1892`);
  }
  if (typeof css === 'string') {
    const flat = css.replace(/\s+/g, '').replace(/html\[data-world="retro"\]\[data-ui="retro"\]/g, '');
    for (const [id, frag] of Object.entries(CHROME_RULES)) if (!flat.includes(frag.replace(/\s+/g, ''))) bad.push(`retro cell ${id}: its arcade rule (${frag}) is not in the arcade's world.css: the cell fell back to the flat drawing`);
  }
  if (world && typeof world.shippable !== 'boolean') bad.push('retro `shippable` is not a boolean');
  /* issue #1777: the empty-office step goes to the empty floor, which the app stores (durbar.floor); the next step of the same run (cells) then starts on that floor and finds no Jonas. The step must put the storage back in a finally. */
  { const d = driver.replace(/\r\n/g, '\n'), a = d.indexOf("run('empty-office')) {"), e = d.indexOf('// ---- FR-120', a), step = a < 0 || e < 0 ? '' : d.slice(a, e);
    if (!step) bad.push('the empty-office step is not found in shots-097-moments (the step-order check cannot read it)');
    else if (!/\} finally \{[^]*localStorage\.removeItem\('durbar\.floor'\)/.test(step)) bad.push('the empty-office step leaves durbar.floor stored (restore it in a finally): the next step of the same run starts on the empty floor'); }
  // scoped to the arcade
  if (main) {
    if (retroPart(reg) !== retroPart(main)) {
      const known = new Set(main.moments.map((m) => m.id)); /* a moment main does not have yet (issue 1644: helpers) is new, not a change to another world's row */
      const old = stripRetro(reg); old.moments = old.moments.filter((m) => known.has(m.id));
      /* the shared note may only grow, and only by the PR that adds a moment (issue 1644: it says what helpers is); any other note change is a change to the shared registry */
      if (reg.moments.length > main.moments.length && typeof reg.note === 'string' && reg.note.startsWith(main.note)) old.note = main.note;
      if (JSON.stringify(old) !== JSON.stringify(stripRetro(main))) bad.push('the change touches the retro cells and also another world or the shared registry: it is not equal to origin/main outside the retro cells');
    }
  }
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.trim()).filter((r) => /#stats\b/.test(r));
  if (!rules.length) bad.push('the arcade\'s first-run rule (#stats) is not in its world.css');
  for (const r of rules) if (!/^html\[data-world="retro"\]/.test(r)) bad.push(`an arcade rule on #stats is not scoped to html[data-world="retro"]: ${r.slice(0, 80)}`);
  return bad;
}

function readMain() {
  /* the registry at the merge-base with origin/main, not at whatever origin/main is now; null in a shallow checkout (CI fetches depth 2), where the comparison is skipped and says so */
  const git = (args) => (gitTry(ROOT, args) || '').trim(); // an ordinary git failure is "no answer"; a hang throws (gitTry)
  const mb = git(['merge-base', 'HEAD', 'origin/main']);
  if (!mb) return null;
  const r = git(['show', mb + ':docs/experience/world-moments.json']);
  return r ? JSON.parse(r) : null;
}

if (require.main === module) {
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'experience', 'world-moments.json'), 'utf8'));
  const driver = fs.readFileSync(path.join(__dirname, 'shots-097-moments.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'realoffice', 'worlds', 'retro', 'world.css'), 'utf8');
  const main = readMain();
  if (!main) console.log('[momentsregistry] SKIP the origin/main comparison: no merge-base with origin/main in this checkout (a shallow clone as in CI: this runs locally and in a full clone only); every other check ran');
  const inputs = { reg, main, driver, css };
  assert.deepStrictEqual(check(inputs), [], 'the real registry passes');
  assert.strictEqual(RETRO_CELLS.length, 27);
  { const w = writtenPictures(driver);
    for (const n of ['inbox', 'asleep', 'coffee', 'notes', 'jump-f1', 'jump-f2', 'cell-chat', 'cell-question', 'cell-focus-answer', 'cell-focus-skip', 'cell-answerbar', 'cell-preview', 'walk-desk', 'walk-place']) assert.ok(w.has(n), 'the picture ' + n + ' is read as written');
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
  /* issue 1891: a chrome cell falling back again fails at its own assert */
  fails('lift-panel back to the flat drawing (rule gone)', (i) => { i.css = i.css.replace('.lift-b{border-radius:0', '.lift-b{border-radius:4px'); }, /lift-panel: its arcade rule/);
  fails('chat-shell rule gone', (i) => { i.css = i.css.replace('#panel>.rail{border-right:3px', '#panel>.rail{border-right:1px'); }, /chat-shell: its arcade rule/);
  fails('chat-header rule gone', (i) => { i.css = i.css.replace('.ph{border-bottom:3px', '.ph{border-bottom:1px'); }, /chat-header: its arcade rule/);
  fails('chat-open rule gone', (i) => { i.css = i.css.replace('arc-chat-on .2s steps(4)', 'slide .28s ease-out'); }, /chat-open: its arcade rule/);
  fails('elicitation rule gone', (i) => { i.css = i.css.replace('.note.elicit{border:3px', '.note.elicit{border:1px'); }, /elicitation: its arcade rule/);
  fails('elicitation back to fallback-flat', (i) => { const m = i.reg.moments.find((x) => x.id === 'elicitation'); m.worlds.retro = 'fallback-flat'; delete m.evidence; }, /elicitation falls back to the flat drawing/);
  fails('a deferred cell loses its #1892 note', (i) => { delete i.reg.moments.find((x) => x.id === 'floor-indicator').gap; }, /floor-indicator is deferred to #1892/);
  /* issue 1644: helpers in the arcade is not built (T327 not started) */
  fails('helpers claimed built for the arcade', (i) => { const m = i.reg.moments.find((x) => x.id === 'helpers'); m.worlds.retro = 'built'; m.evidence = { retro: { steps: ['asleep'], pictures: ['asleep'] } }; }, /retro cell helpers: the arcade has no kids/);
  fails('helpers fallback-flat loses its #1643 note', (i) => { i.reg.moments.find((x) => x.id === 'helpers').gap.retro = 'the arcade has no kids yet'; }, /retro cell helpers: the arcade has no kids/);
  fails('the shared note changes with no new moment (retro cells also changed)', (i) => { i.reg.moments.splice(i.reg.moments.findIndex((m) => m.id === 'helpers'), 1); i.reg.moments.find((m) => m.id === 'lobby').gap = { retro: 'x' }; i.reg.note += ' extra'; }, /also another world or the shared registry/);
  fails('the shared note is rewritten, not extended, by the moment-adding change', (i) => { i.reg.note = 'rewritten ' + i.reg.note; }, /also another world or the shared registry/);
  fails('a retro cell removed', (i) => { i.reg.moments.splice(i.reg.moments.findIndex((m) => m.id === 'walk'), 1); }, /not the 27/);
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
  /* T223 (2026-11-14): walk, question-card and answer-bar are built on steps and pictures the driver writes */
  fails('question-card built without its evidence', (i) => { delete i.reg.moments.find((m) => m.id === 'question-card').evidence; }, /question-card is built and names no evidence/);
  fails('answer-bar built on a step removed from the driver (cells)', (i) => { i.driver = i.driver.replace("run('cells')", "run('cellz')"); }, /answer-bar: evidence step cells/);
  fails('walk built on a step removed from the driver (walk)', (i) => { i.driver = i.driver.replace("run('walk')", "run('walkx')"); }, /walk: evidence step walk/);
  fails('walk built on a picture the driver no longer writes', (i) => { i.driver = i.driver.replace("'walk-place'", "'walk-gone'"); }, /walk: evidence picture walk-place/);
  fails('question-card built on a focus-ring picture the driver no longer writes', (i) => { i.driver = i.driver.replace("'cell-focus-skip'", "'cell-focus-gone'"); }, /question-card: evidence picture cell-focus-skip/);
  fails('answer-bar built on a picture the driver no longer writes', (i) => { i.driver = i.driver.replace("'cell-answerbar'", "'cell-gone'"); }, /answer-bar: evidence picture cell-answerbar/);
  fails('building-preview built with no evidence', (i) => { i.reg.moments.find((m) => m.id === 'building-preview').worlds.retro = 'built'; }, /building-preview is built and names no evidence/);
  fails('building-preview fallback-flat naming evidence', (i) => { i.reg.moments.find((m) => m.id === 'building-preview').evidence = { retro: { steps: ['cells'], pictures: ['cell-preview'] } }; }, /building-preview is fallback-flat but names evidence/);
  fails('empty-office built with no evidence', (i) => { delete i.reg.moments.find((m) => m.id === 'empty-office').evidence; }, /empty-office is built and names no evidence/);
  fails('the empty-office step does not restore the stored floor (issue 1777)', (i) => { const d0 = i.driver.replace(/\r\n/g, '\n'); /* a Windows checkout has CRLF: the check normalises, so the mutant does too */ i.driver = d0.replace("localStorage.removeItem('durbar.floor');localStorage.removeItem('durbar.floorView')`).catch(() => undefined);\n      }\n    }\n    // ---- FR-120", "`).catch(() => undefined);\n      }\n    }\n    // ---- FR-120"); assert.notStrictEqual(i.driver, d0, 'the mutation applied'); }, /empty-office step leaves durbar\.floor stored/);
  fails('a missing cell without a reason', (i) => { const m = i.reg.moments.find((x) => x.id === 'all-floors'); m.worlds.retro = 'missing'; delete m.evidence; delete m.gap; }, /all-floors is missing and says nothing why/); /* all-floors may already be built (the All floors PR): the mutant makes it missing first */
  fails('shippable while a cell is missing', (i) => { const m = i.reg.moments.find((x) => x.id === 'all-floors'); m.worlds.retro = 'missing'; delete m.evidence; m.gap = 'x'; i.reg.worlds.retro.shippable = true; }, /shippable while a cell is missing/); /* all-floors built on this branch: the mutant makes one cell missing first */
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
