/**
 * Spec 011 FR-012 (the settings store), issue #2066 (the review of PR 2064 found three weaknesses in older setters): `npm run test:settings-store`.
 * No Electron, no network. Three items, one battery each, run against the real compiled `settings.js` and then against copies of it with ONE text change (a mutant),
 * each of which must die at its own assert:
 *   1. `mcpWarnLevels` is a copy (the getter and the answer of `setMcpWarnLevels`): a change to it does not reach the store;
 *   2. `setAutopilotLimit` rolls back a failed write (memory and file do not differ) and a bad value writes nothing;
 *   3. `setCharacterPin` checks the key and the id before the merge: a bad one writes nothing and leaves memory and file as they were.
 * A failing write is injected (`save` replaced), so it is the same on every OS. The compiled text is read with LF first (a CRLF checkout), and an anchor that is gone fails loudly.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import type { SettingsStore as Store } from '../src/main/settings';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-settings-store-'));
const dir = path.join(__dirname, '..', 'src', 'main');
const ID = 'my-0123456789ab';
const KEY = process.platform === 'win32' ? 'c:/work/demo' : '/work/demo';
let seq = 0;

type Ctor = new (file: string) => Store;
const make = (C: Ctor, start: object): { st: Store; file: string } => {
  const file = path.join(tmp, `s-${seq++}.json`);
  fs.writeFileSync(file, JSON.stringify({ version: 1, ...start }));
  const st = new C(file);
  st.load();
  return { st, file };
};
const failWrites = (st: Store): void => { (st as unknown as { save(): boolean }).save = () => false; }; // an injected failing write

function battery(C: Ctor): void {
  // ---- item 1: a copy, never the stored object
  {
    const { st } = make(C, { mcpWarnLevels: { warn: 20, strong: 40, off: false } });
    const got = st.mcpWarnLevels;
    got.warn = 99; got.off = true;
    assert.deepStrictEqual(st.mcpWarnLevels, { warn: 20, strong: 40, off: false }, 'item 1: a changed copy of mcpWarnLevels does not change the store');
    const set = st.setMcpWarnLevels({ warn: 25, strong: 50, off: false });
    assert.ok(set.ok, 'item 1: a valid level is written');
    set.levels.warn = 77;
    assert.deepStrictEqual(st.mcpWarnLevels, { warn: 25, strong: 50, off: false }, 'item 1: the levels setMcpWarnLevels answers with are a copy too');
    const d = make(C, {}).st;
    d.mcpWarnLevels.warn = 1;
    assert.notStrictEqual(d.mcpWarnLevels.warn, 1, 'item 1: the defaults are a copy');
  }
  // ---- item 2: a failed write is rolled back; a bad value writes nothing
  {
    const { st, file } = make(C, { autopilotLimit: 3 });
    assert.strictEqual(st.autopilotLimit, 3, 'item 2: the stored limit is read');
    const bytes = fs.readFileSync(file);
    for (const bad of [0, 1001, 1.5, NaN, Infinity, -1, '5' as unknown as number]) {
      assert.strictEqual(st.setAutopilotLimit(bad), false, `item 2: ${String(bad)} is refused`);
      assert.strictEqual(st.autopilotLimit, 3, `item 2: ${String(bad)} changes nothing in memory`);
      assert.ok(fs.readFileSync(file).equals(bytes), `item 2: ${String(bad)} changes nothing on disk`);
    }
    assert.strictEqual(st.setAutopilotLimit(7), true, 'item 2: a valid limit is written');
    assert.strictEqual((JSON.parse(fs.readFileSync(file, 'utf8')) as { autopilotLimit: number }).autopilotLimit, 7, 'item 2: the file holds it');
    const onDisk = fs.readFileSync(file);
    failWrites(st);
    assert.strictEqual(st.setAutopilotLimit(9), false, 'item 2: a failed write answers false');
    assert.strictEqual(st.autopilotLimit, 7, 'item 2: a failed write restores the previous limit (memory and file do not differ)');
    assert.ok(fs.readFileSync(file).equals(onDisk), 'item 2: the file is as it was after the failed write');
  }
  // ---- item 3: the key and the id are checked in the store, before the merge
  {
    const { st, file } = make(C, { characterPins: { [KEY]: ID } });
    const bytes = fs.readFileSync(file);
    const badKeys: unknown[] = ['', 'relative/path', 'a\u0000b', '/x\ny', 7, null, undefined, '/'.padEnd(5000, 'a')];
    for (const k of badKeys) {
      assert.strictEqual(st.setCharacterPin(k as string, ID), false, `item 3: the key ${JSON.stringify(k)?.slice(0, 20)} is refused`);
      assert.deepStrictEqual(st.characterPinsOf([ID]), { [KEY]: ID }, 'item 3: a bad key changes nothing in memory');
      assert.ok(fs.readFileSync(file).equals(bytes), 'item 3: a bad key changes nothing on disk');
    }
    for (const bad of ['x', '', 'my-xyz', '../etc', 'MY-0123456789AB', 5, {}, undefined]) {
      assert.strictEqual(st.setCharacterPin(KEY, bad as string), false, `item 3: the id ${JSON.stringify(bad)} is refused`);
      assert.deepStrictEqual(st.characterPinsOf([ID, 'x']), { [KEY]: ID }, 'item 3: a bad id changes nothing in memory');
      assert.ok(fs.readFileSync(file).equals(bytes), 'item 3: a bad id changes nothing on disk');
    }
    assert.strictEqual(st.setCharacterPin(KEY + '2', ID), true, 'item 3: a valid pin is written');
    assert.strictEqual(st.setCharacterPin(KEY + '2', null), true, 'item 3: a pin is cleared with null');
    assert.deepStrictEqual(st.characterPinsOf([ID]), { [KEY]: ID }, 'item 3: the valid pin was set and cleared');
  }
}

battery(require('../src/main/settings').SettingsStore as Ctor);

// ---- mutants: the compiled settings.js with one change, run again; each must die at its own assert
const lf = fs.readFileSync(path.join(dir, 'settings.js'), 'utf8').replace(/\r\n/g, '\n');
const MUTANTS: [string, string, string, RegExp][] = [
  ['getter-returns-the-stored-object', 'return { ...(this.s.mcpWarnLevels ?? (0, mcpcost_1.mcpWarnDefaults)()) };', 'return this.s.mcpWarnLevels ?? (0, mcpcost_1.mcpWarnDefaults)();', /item 1: a changed copy of mcpWarnLevels/],
  ['set-answers-with-the-stored-object', 'return { ok: true, levels: this.mcpWarnLevels };', 'return { ok: true, levels };', /item 1: the levels setMcpWarnLevels answers with/],
  ['autopilot-no-rollback', 'return this.commit({ ...this.s, autopilotLimit: v });', 'this.s = { ...this.s, autopilotLimit: v }; return this.save();', /item 2: a failed write restores the previous limit/],
  ['autopilot-bad-value-written', 'if (!Number.isInteger(v) || v < 1 || v > 1000)\n            return false;', 'if (!Number.isInteger(v) || v < 1)\n            return false;', /item 2: 1001 is refused/],
  ['pin-key-unchecked', '!(0, charrules_1.isFolderKey)(key) || ', '', /item 3: the key /],
  ['pin-id-unchecked', '(id !== null && !(typeof id === \'string\' && charrules_1.CHARACTER_ID_RE.test(id)))', 'false', /item 3: the id /],
];
let killed = 0;
for (const [name, from, to, expect] of MUTANTS) {
  assert.ok(lf.includes(from), `mutant ${name}: the text to change is gone from settings.js`);
  const mutated = lf.split(from).join(to);
  const uniq = `settings.mutant-${process.pid}-${killed}`;
  try { new vm.Script(mutated, { filename: uniq }); } catch (e) { assert.fail(`mutant ${name} is not valid JavaScript: ${(e as Error).message}`); }
  const mp = path.join(dir, uniq + '.js');
  fs.writeFileSync(mp, mutated);
  let died: Error | undefined;
  try { battery((require(mp) as { SettingsStore: Ctor }).SettingsStore); } catch (e) { died = e as Error; } finally { fs.rmSync(mp, { force: true }); }
  assert.ok(died, `mutant ${name} survived`);
  assert.ok(expect.test(String(died.message)), `mutant ${name} died at the wrong assert: ${String(died.message).split('\n')[0]}`);
  killed++;
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`settings-store: ok (${killed} mutants killed)`);
