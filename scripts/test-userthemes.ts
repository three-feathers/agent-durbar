/** Unit tests for user theme packs (spec 040): shared validation + the main-process store, no Electron. */
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { checkUserManifest, USER_THEME_LIMITS, RESERVED_THEME_IDS } from '../src/shared/themes';
import { UserThemeStore } from '../src/main/themes';

// reserved ids (spec 035 FR-018): the built-in, the old Cheeky Crew and the removed ones; main's handlers use exactly this list
for (const id of ['clean-office', 'retro', 'cheeky-crew', 'corporate', 'durbar-indian', 'durbar-european', 'durbar-japanese']) assert.ok(RESERVED_THEME_IDS.includes(id), `${id} is reserved`);
assert.ok(/BUILT_IN_THEME_IDS = RESERVED_THEME_IDS;/.test(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'ipc', 'themes.ts'), 'utf8')), 'ipc/themes.ts reads the shared reserved list');

// --- manifest validation ---
assert.strictEqual(checkUserManifest('{"id":"ocean","name":"Ocean"}').ok, true);
assert.strictEqual(checkUserManifest('{"id":"ocean"}').id, 'ocean');
assert.strictEqual(checkUserManifest('not json').ok, false);
assert.strictEqual(checkUserManifest('[]').ok, false);
assert.strictEqual(checkUserManifest('{"id":"Bad Id"}').ok, false, 'id must be lowercase kebab');
assert.strictEqual(checkUserManifest('{"id":""}').ok, false);
assert.strictEqual(checkUserManifest('{}').ok, false);
assert.strictEqual(checkUserManifest('{"id":"x","tokens":' + JSON.stringify(Object.fromEntries(Array.from({ length: 201 }, (_, i) => ['--t' + i, '#fff']))) + '}').ok, false, 'over 200 tokens rejected (spec 070 FR-004)');
assert.strictEqual(checkUserManifest('{"id":"x","words":' + JSON.stringify(Object.fromEntries(Array.from({ length: 25 }, (_, i) => ['w' + i, 'v']))) + '}').ok, false, 'over 24 words rejected');
assert.strictEqual(checkUserManifest('{"id":"x","tokens":{"--bg":"#eef"}}').ok, true);
assert.ok(checkUserManifest('x'.repeat(USER_THEME_LIMITS.manifestBytes + 1)).error!.includes('64 KB'));
// tokens on import (spec 040 FR-006): refused with the token named
assert.strictEqual(checkUserManifest('{"id":"x","tokens":{"display":"none"}}').ok, false, 'a key that is not --name is refused');
assert.ok(checkUserManifest('{"id":"x","tokens":{"--chair":"x\\"/><style>a{}</style>"}}').error!.includes('--chair'), 'a markup value is refused and named');
assert.strictEqual(checkUserManifest('{"id":"x","tokens":{"--chair":"url(x)"}}').ok, false, 'url() is refused');
assert.strictEqual(checkUserManifest('{"id":"x","tokens":{"--chair":"rgb(1 2 3 / .5)"}}').ok, true, 'a colour function is fine');
assert.strictEqual(checkUserManifest('{"id":"x","ui":"retro"}').ok, true, 'a listed UI style is fine');
// spec 035 FR-018: a saved theme naming a removed style or kit still loads; the value is reported as dropped (the window falls back with a note)
for (const k of ['corporate', 'court-indian', 'court-european', 'court-japanese']) {
  const r = checkUserManifest(JSON.stringify({ id: 'old', ui: k, scene: k }));
  assert.strictEqual(r.ok, true, k + ': a saved theme keeps working');
  assert.deepStrictEqual(r.dropped, ['ui', 'scene'], k + ': both values are reported');
}
assert.deepStrictEqual(checkUserManifest('{"id":"x","ui":"retro","scene":"pixel"}').dropped, [], 'a kept style and kit report nothing');
assert.ok(checkUserManifest('{"id":"x","ui":"court-mars"}').error!.includes('ui must be one of: clean, retro'), 'only the removed names are tolerated');
assert.ok(checkUserManifest('{"id":"x","ui":"neon"}').error!.includes('ui must be one of'), 'an unknown UI style is refused');
assert.strictEqual(checkUserManifest('{"id":"x","scene":"pixel"}').ok, true, 'a listed scene kit is fine');
assert.strictEqual(checkUserManifest('{"id":"x","art":{"room-floor":"<rect/>","char-robe":"<rect/>"}}').ok, true, 'drawn art slots are fine');
assert.ok(checkUserManifest('{"id":"x","art":{"chair-back":"<rect/>"}}').error!.includes('not one the app draws'), 'an art slot the app never draws is refused');
assert.ok(checkUserManifest('{"id":"x","scene":"robots"}').error!.includes('scene must be one of'), 'an unknown scene kit is refused');

// --- store: list / export / remove (saved themes; Import and the AI maker were retired, spec 040 FR-031) ---
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-uth-'));
const themesDir = path.join(root, 'themes');
const seed = (id: string, manifest: object | string, extra: Record<string, string> = {}): void => {
  fs.mkdirSync(path.join(themesDir, id), { recursive: true });
  fs.writeFileSync(path.join(themesDir, id, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  for (const [f, text] of Object.entries(extra)) fs.writeFileSync(path.join(themesDir, id, f), text);
};
seed('ocean', { id: 'ocean', name: 'Ocean Blue', tokens: { '--bg': '#e8f2f8' }, words: { 'place-terminal': 'Console Cove' } }, { 'README.txt': 'a note' });

const store = new UserThemeStore(themesDir);
const list = store.list();
assert.strictEqual(list.length, 1);
assert.strictEqual(list[0].id, 'ocean');
assert.strictEqual(list[0].ok, true);
assert.deepStrictEqual(store.get('ocean')!.tokens, { '--bg': '#e8f2f8' });
assert.strictEqual(typeof (store as unknown as { importFolder?: unknown }).importFolder, 'undefined', 'no Import any more');
assert.strictEqual(typeof (store as unknown as { saveManifest?: unknown }).saveManifest, 'undefined', 'no saving of generated themes any more');

// a saved theme naming a removed style or kit is still listed and valid (spec 035 FR-018)
seed('old-court', { id: 'old-court', name: 'Old Court', ui: 'court-indian', scene: 'corporate' });
assert.ok(store.list().some((t) => t.id === 'old-court' && t.ok), 'a theme saved with a removed ui and scene still lists');
assert.strictEqual(store.get('old-court')!.ui, 'court-indian', 'the file is not rewritten; the window falls back');

// folder name != manifest id refused on list
seed('mismatch', '{"id":"other"}');
const l2 = store.list();
assert.ok(l2.some((t) => t.id === 'mismatch' && !t.ok), 'mismatched folder flagged bad');
assert.strictEqual(store.get('other'), null);
// corrupt entry ignored by get
seed('broken', 'nope');
assert.ok(store.list().some((t) => t.id === 'broken' && !t.ok));

// export
const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-uth-out-'));
const e = store.exportFolder('ocean', dest);
assert.strictEqual(e.ok, true);
assert.strictEqual(fs.readFileSync(path.join(String(e.to), 'manifest.json'), 'utf8'), fs.readFileSync(path.join(themesDir, 'ocean', 'manifest.json'), 'utf8'));
assert.strictEqual(store.exportFolder('retro', dest).ok, false, 'no built-in id');
assert.strictEqual(store.exportFolder('ocean', dest).ok, false, 'existing dest refused');

// an unfinished folder (dot folder) is not listed as a broken theme
fs.mkdirSync(path.join(themesDir, '.ocean.tmp-123'));
assert.ok(!store.list().some((t) => t.id.startsWith('.')), 'dot folders are skipped');

// --- remove (spec 040 FR-032, T039) ---
assert.deepStrictEqual(store.remove('ocean'), { ok: true, id: 'ocean' });
assert.ok(!fs.existsSync(path.join(themesDir, 'ocean')), 'the folder, with its other files, is gone');
assert.ok(!store.list().some((t) => t.id === 'ocean'), 'no longer listed');
assert.strictEqual(store.remove('ocean').ok, false, 'a second remove finds nothing');
assert.strictEqual(store.remove('mismatch').ok, true, 'a folder that does not load can be cleared too');
for (const bad of ['..', '../themes', 'a/b', '', '.ocean.tmp-123', 'nope', 'C:\\x', 'a'.repeat(65)]) assert.strictEqual(store.remove(bad).ok, false, `"${bad}" is refused`);
assert.ok(fs.existsSync(path.join(themesDir, 'old-court')) && fs.existsSync(path.join(themesDir, '.ocean.tmp-123')), 'nothing else is touched');
// links inside a theme folder are removed as links, never followed
{
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-uth-outside-'));
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'mine');
  fs.mkdirSync(path.join(outside, 'sub'));
  fs.writeFileSync(path.join(outside, 'sub', 'keep2.txt'), 'mine too');
  seed('linky', { id: 'linky', name: 'Linky' });
  let linked = true;
  try {
    fs.symlinkSync(outside, path.join(themesDir, 'linky', 'dirlink'), 'junction'); // a junction needs no privilege on Windows
    fs.symlinkSync(path.join(outside, 'keep.txt'), path.join(themesDir, 'linky', 'filelink'));
  } catch {
    linked = false; // a runner that cannot make links: the check below is skipped, not passed by accident
  }
  assert.strictEqual(store.remove('linky').ok, true);
  assert.ok(!fs.existsSync(path.join(themesDir, 'linky')));
  assert.ok(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8') === 'mine' && fs.readFileSync(path.join(outside, 'sub', 'keep2.txt'), 'utf8') === 'mine too', `a link inside the folder is not followed (links made: ${linked})`);
  // the folder itself a link: not a theme folder (list() skips it), so remove() does nothing and nothing outside is touched
  let top = true;
  try { fs.symlinkSync(outside, path.join(themesDir, 'toplink'), 'junction'); } catch { top = false; }
  if (top) {
    store.remove('toplink');
    assert.ok(fs.existsSync(path.join(outside, 'keep.txt')) && fs.existsSync(path.join(outside, 'sub', 'keep2.txt')), 'a linked folder never loses what it points to');
  }
}

console.log('user theme tests passed');
