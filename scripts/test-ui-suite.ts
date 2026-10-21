/** Unit test (spec 008 FR-091): the ui-suite driver list is not stale, and the runner never uses a shell. No Electron is started. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const ROOT = path.join(__dirname, '..', '..');
const SUITE = path.join(ROOT, 'scripts', 'ui-suite.js');
const names = execFileSync(process.execPath, [SUITE, '--list'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
assert.ok(names.length >= 15, `ui-suite lists ${names.length} drivers`);
for (const n of names) {
  const file = n.split(' ')[0];
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts', file + '.js')), `listed driver exists: ${file}`);
}
const src = fs.readFileSync(SUITE, 'utf8');
assert.ok(/shell: false/.test(src) && !/shell: true/.test(src) && !/execSync\(|exec\(/.test(src), 'the runner spawns without a shell');
assert.ok(/require\('electron'\)/.test(src), 'it starts the Electron binary directly');
const main = fs.readFileSync(path.join(ROOT, 'src', 'main', 'main.ts'), 'utf8');
assert.ok(/app\.exit\(failed \? 1 : 0\)/.test(main), 'a failing driver exits 1 (FR-090)');
assert.ok(/dev\.DURBAR_DRIVER \|\| dev\.DURBAR_SHOT \? \{ enableLargerThanScreen: true \}/.test(main), 'test windows may be larger than the screen (FR-093, macOS runners)');
const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ui-platforms.yml'), 'utf8');
for (const os of ['ubuntu-latest', 'macos-latest', 'windows-latest']) assert.ok(wf.includes(os), `the workflow runs on ${os}`);
for (const step of ['check-theme-geometry.js', 'check-office-overlap.js', 'check-mac-titlebar.js', 'ui-suite.js']) assert.ok(wf.includes(step), `the workflow runs ${step}`);
// ---- scripts/driver-helpers.js (spec 008 FR-097): the shared plumbing behaves as the drivers' own copies did ----
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dh = require(path.join(ROOT, 'scripts', 'driver-helpers.js'));
(async () => {
  const events: any[] = [], sizes: any[] = [], loads: any[] = [], codes: string[] = [], waited: string[] = [], shots: string[] = [], sleeps: number[] = [];
  const ctx = {
    win: { webContents: { sendInputEvent: (e: any) => events.push(e), focus: () => events.push('focus') }, setContentSize: (w: number, h: number) => sizes.push([w, h]), loadFile: async (p: string, o: any) => { loads.push([p, o]); } },
    js: async (c: string) => { codes.push(c); return c.includes('NOPE') ? Promise.reject(new Error('boom')) : true; },
    waitFor: async (e: string) => { waited.push(e); return true; }, sleep: async (ms: number) => { sleeps.push(ms); }, shot: async (f: string) => { shots.push(f); },
  };
  const H = dh.helpers(ctx);
  // Return sends the char event that activates a button; other keys do not; 'always' and 'never' override it
  await H.key('Return'); assert.deepStrictEqual(events.map((e) => e.type), ['keyDown', 'char', 'keyUp'], 'Return: down, char, up'); assert.strictEqual(events[1].keyCode, '\r');
  events.length = 0; await H.key('Tab', ['shift']); assert.deepStrictEqual(events.map((e) => e.type), ['keyDown', 'keyUp'], 'Tab has no char event'); assert.deepStrictEqual(events[0].modifiers, ['shift']);
  events.length = 0; await H.key('K', ['control'], { char: 'always' }); assert.deepStrictEqual(events.map((e) => e.type), ['keyDown', 'char', 'keyUp']);
  events.length = 0; await H.key('Return', [], { char: 'never' }); assert.deepStrictEqual(events.map((e) => e.type), ['keyDown', 'keyUp']);
  // load: sim=15 and simfreeze=1 unless a driver says otherwise (undefined removes one); waits for the desks; settles; focuses on request
  await H.load({ w: 1280, h: 800, query: { simkinds: 'mixed' }, focus: true });
  assert.deepStrictEqual(sizes[0], [1280, 800]); assert.deepStrictEqual(loads[0][1].query, { sim: '15', simfreeze: '1', simkinds: 'mixed' });
  assert.ok(waited[0].includes('>=15'), 'default ready: 15 desks'); assert.ok(events.includes('focus'));
  await H.load({ query: { simfreeze: undefined, sim: '12' }, ready: 'fit', settle: false });
  assert.deepStrictEqual(loads[1][1].query, { sim: '12' }); assert.ok(waited[1].includes('dataset.fit')); assert.strictEqual(sizes.length, 1, 'no size given: the window keeps its size');
  // load settles by default (the page stopped changing: two equal readings 200 ms apart) and not when asked not to
  codes.length = 0; sleeps.length = 0; await H.load({ w: 800, h: 600 });
  assert.ok(codes.some((c) => c.includes("querySelectorAll('*').length")), 'load waits for the page to settle'); assert.ok(sleeps.includes(200), 'the settling wait sleeps between readings');
  codes.length = 0; sleeps.length = 0; await H.load({ w: 800, h: 600, settle: false });
  assert.ok(!codes.some((c) => c.includes("querySelectorAll('*').length")) && !sleeps.includes(200), 'settle: false skips the settling wait');
  // shot prepares the page by its prep: toasts are removed, calm hides them, mouse moves the pointer
  codes.length = 0; await H.shot('/tmp/t.png', { prep: 'toasts', delay: 0 }); assert.ok(codes.some((c) => c.includes('#toasts .toast') && c.includes('remove()')), "prep 'toasts' removes the toasts");
  codes.length = 0; events.length = 0; await H.shot('/tmp/t.png', { prep: 'none', delay: 0 }); assert.strictEqual(codes.length, 0, "prep 'none' does nothing to the page");
  events.length = 0; await H.shot('/tmp/t.png', { prep: 'mouse', delay: 0 }); assert.strictEqual(events[0].type, 'mouseMove', "prep 'mouse' moves the pointer");
  codes.length = 0; sleeps.length = 0; await H.shot('/tmp/t.png', { settle: true, delay: 0 }); assert.ok(codes.some((c) => c.includes("querySelectorAll('*').length")), 'shot settles when asked');
  // values spliced into page code are escaped, whatever they hold
  const evil = `x');alert(1);//</script>\u2028`;
  codes.length = 0; await H.click(evil); await H.clickText(evil, evil); await H.exists(evil); await H.text(evil); await H.idOf(evil);
  for (const c of codes) { assert.ok(!c.includes(evil), 'the raw value is never in the page code'); assert.ok(!/[\u2028\u2029]|<\/script>/.test(c), 'no raw line separator or closing tag'); }
  // a page error names the code and is thrown again
  await assert.rejects(() => H.js('NOPE'), /boom/);
  // shot: prepares, waits, then takes the picture
  codes.length = 0; shots.length = 0; await H.shot('/tmp/x.png', { prep: 'calm', blur: true, settle: false, delay: 7 }); assert.deepStrictEqual(shots, ['/tmp/x.png']); assert.ok(codes[0].includes("shotCalm") && codes[0].includes('blur()')); assert.ok(sleeps.includes(7));
  console.log('driver-helpers: key, load, escaping and shot behave');
})().catch((e) => { console.error(e); process.exit(1); });

// ---- no driver keeps its own copy of what the shared module does, and no string is spliced raw into page code ----
// Not page drivers: they never touch a window (or drive a real session / the packaged app).
const SKIP = new Set(['driver-helpers.js', 'ui-suite.js', 'check-names.js', 'check-fuses.js', 'check-fuses-launch.js', 'check-parallel.js', 'e2e-driver.js', 'installed-app-check.js', 'installed-app-ci.js']);
/** The template literals of one line (top level only): their text and their `${...}` expressions (a nested template is part of its expression). */
function templates(line: string): { text: string; exprs: string[] }[] {
  const out: { text: string; exprs: string[] }[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '`') continue;
    const t = { text: '', exprs: [] as string[] };
    for (i++; i < line.length && line[i] !== '`'; i++) {
      if (line[i] === '\\') { t.text += line[i] + (line[i + 1] || ''); i++; continue; }
      if (line[i] === '$' && line[i + 1] === '{') {
        let depth = 0, k = i + 1, inTpl = 0;
        for (; k < line.length; k++) {
          if (line[k] === '`') inTpl ^= 1;
          else if (!inTpl && line[k] === '{') depth++;
          else if (!inTpl && line[k] === '}' && --depth === 0) break;
        }
        t.exprs.push(line.slice(i + 2, k)); i = k; continue;
      }
      t.text += line[i];
    }
    out.push(t);
  }
  return out;
}
/* Allowed raw splices into page code: jsLiteral (or its alias q), and these typed numbers, booleans and ready-made code strings. */
const RAW_OK = /^(w|h|n|i|width|n - 1|before|sim|expanded|expectPlaces|SECONDS|SPEED|open|!open|iconClick|left|tags|level === 'simple'|[\w.]+\.toString\(\))$/;
const PAGE = /\b(document|window)\.|localStorage|getComputedStyle|querySelector/;
const drivers = fs.readdirSync(path.join(ROOT, 'scripts')).filter((x) => /^(shots|check)-.*\.js$/.test(x) && !SKIP.has(x));
assert.ok(drivers.length >= 45, `${drivers.length} page drivers are checked`);
export function checkDriverSource(f: string, t: string): string[] {
  const bad: string[] = [];
  if (/\.loadFile\(/.test(t)) bad.push(`${f}: loads the page through helpers(ctx).load, not its own loadFile`);
  if (/#toasts[^'"`\n]*\{display:none/.test(t)) bad.push(`${f}: hides the toasts through helpers(ctx).calm`);
  if (/(function\s+jsLiteral\s*\(|(const|let|var)\s+jsLiteral\s*=)/.test(t)) bad.push(`${f}: jsLiteral comes from driver-helpers`);
  if (/\{[^}]*\bjsLiteral\b[^}]*\}\s*=\s*require\('\.\/check-office-overlap\.js'\)/.test(t)) bad.push(`${f}: takes jsLiteral from driver-helpers`);
  t.split('\n').forEach((line, n) => {
    for (const t of templates(line)) {
      if (!PAGE.test(t.text + t.exprs.join(' '))) continue; // a message, a path, a name: not page code
      for (const e of t.exprs) if (!/^(jsLiteral|q)\(/.test(e) && !RAW_OK.test(e)) bad.push(`${f}:${n + 1}: raw \${${e}} in page code: use jsLiteral(...)`);
    }
  });
  return bad;
}
const allBad = drivers.flatMap((f) => checkDriverSource(f, fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8')));
assert.deepStrictEqual(allBad, [], '\n' + allBad.join('\n'));
// the guard itself catches what it is for (a mutation of a clean driver must fail)
const clean = "const { helpers, jsLiteral } = require('./driver-helpers');\nmodule.exports = async (ctx) => { await ctx.js(`document.title=${jsLiteral(1)}`); };\n";
assert.deepStrictEqual(checkDriverSource('x.js', clean), []);
for (const [what, add] of [
  ['a local loadFile', "await ctx.win.loadFile(INDEX, {});"],
  ['a toast-hiding style', "s.textContent='#toasts{display:none!important}';"],
  ['a local jsLiteral', "const jsLiteral = (v) => JSON.stringify(v);"],
  ['a function jsLiteral', "function jsLiteral(v) { return v; }"],
  ['a raw string in page code', "await ctx.js(`document.querySelector('[data-id=\"${id}\"]')`);"],
  ['jsLiteral from the overlap check', "const { jsLiteral } = require('./check-office-overlap.js');"],
]) assert.ok(checkDriverSource('x.js', clean + add + '\n').length > 0, `the guard catches ${what}`);
console.log(`ui-suite: ${names.length} drivers listed and present; no shell; driver failures exit 1; workflow covers 3 OSes`);
