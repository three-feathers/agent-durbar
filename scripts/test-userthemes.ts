/** Unit tests for user theme packs (spec 040): shared validation + the main-process store, no Electron. */
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { checkUserManifest, USER_THEME_LIMITS } from '../src/shared/themes';
import { UserThemeStore } from '../src/main/themes';

const BUILT = new Set(['clean-office', 'corporate', 'retro', 'durbar-indian', 'durbar-european', 'durbar-japanese', 'cheeky-crew']);

// --- manifest validation ---
assert.strictEqual(checkUserManifest('{"id":"ocean","name":"Ocean"}').ok, true);
assert.strictEqual(checkUserManifest('{"id":"ocean"}').id, 'ocean');
assert.strictEqual(checkUserManifest('not json').ok, false);
// spec 017 FR-034 (owner decision 2026-10-31: no doors): a saved theme naming the removed door-art slot or --door-* tokens still loads; they are ignored and listed as dropped
{
  const old = checkUserManifest(JSON.stringify({ id: 'olddoors', name: 'Old', tokens: { '--door-bg': '#112233', '--plant-dark': '#223344' }, art: { 'door-art': '<path d="M1 1"/>', 'lobby-art': '<rect width="1" height="1"/>' } }));
  assert.strictEqual(old.ok, true, 'a theme with door-art loads');
  if (old.ok) assert.ok(old.dropped?.includes('art.door-art'), 'door-art is listed as dropped');
  assert.strictEqual(checkUserManifest(JSON.stringify({ id: 'nope', name: 'N', art: { 'not-a-slot': '<path d="M1 1"/>' } })).ok, false, 'any other unknown slot is still refused');
}
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

// --- store: list / import / export ---
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-uth-'));
const src = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-uth-src-'));
fs.mkdirSync(path.join(src, 'ocean'));
fs.writeFileSync(path.join(src, 'ocean', 'manifest.json'), JSON.stringify({ id: 'ocean', name: 'Ocean Blue', tokens: { '--bg': '#e8f2f8' }, words: { 'place-terminal': 'Console Cove' } }));
fs.writeFileSync(path.join(src, 'ocean', 'README.txt'), 'a note');

const store = new UserThemeStore(path.join(root, 'themes'));
let r = store.importFolder(path.join(src, 'ocean'), (id) => BUILT.has(id));
assert.strictEqual(r.ok, true);
assert.strictEqual(r.id, 'ocean');
assert.strictEqual(r.name, 'Ocean Blue');

const list = store.list();
assert.strictEqual(list.length, 1);
assert.strictEqual(list[0].id, 'ocean');
assert.strictEqual(list[0].ok, true);
assert.deepStrictEqual(store.get('ocean')!.tokens, { '--bg': '#e8f2f8' });

// duplicate import refused
r = store.importFolder(path.join(src, 'ocean'), (id) => BUILT.has(id));
assert.strictEqual(r.ok, false);
assert.ok(r.error!.includes('already installed'));

// built-in id refused
const bsrc = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-uth-b-'));
fs.mkdirSync(path.join(bsrc, 'retro'));
fs.writeFileSync(path.join(bsrc, 'retro', 'manifest.json'), '{"id":"retro"}');
r = store.importFolder(path.join(bsrc, 'retro'), (id) => BUILT.has(id));
assert.strictEqual(r.ok, false);
assert.ok(r.error!.includes('built-in'));

// no manifest / bad manifest
const nsrc = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-uth-n-'));
fs.mkdirSync(path.join(nsrc, 'empty'));
assert.strictEqual(store.importFolder(path.join(nsrc, 'empty'), () => false).ok, false);
fs.writeFileSync(path.join(nsrc, 'empty', 'manifest.json'), '{bad');
assert.strictEqual(store.importFolder(path.join(nsrc, 'empty'), () => false).ok, false);
// folder name != manifest id refused on list
fs.mkdirSync(path.join(root, 'themes', 'mismatch'));
fs.writeFileSync(path.join(root, 'themes', 'mismatch', 'manifest.json'), '{"id":"other"}');
const l2 = store.list();
assert.ok(l2.some((t) => t.id === 'mismatch' && !t.ok), 'mismatched folder flagged bad');
assert.strictEqual(store.get('other'), null);
// corrupt entry ignored by get
fs.mkdirSync(path.join(root, 'themes', 'broken'));
fs.writeFileSync(path.join(root, 'themes', 'broken', 'manifest.json'), 'nope');
assert.ok(store.list().some((t) => t.id === 'broken' && !t.ok));

// export
const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-uth-out-'));
const e = store.exportFolder('ocean', dest);
assert.strictEqual(e.ok, true);
assert.strictEqual(fs.readFileSync(path.join(String(e.to), 'manifest.json'), 'utf8'), fs.readFileSync(path.join(root, 'themes', 'ocean', 'manifest.json'), 'utf8'));
assert.strictEqual(store.exportFolder('retro', dest).ok, false, 'no built-in id');
assert.strictEqual(store.exportFolder('ocean', dest).ok, false, 'existing dest refused');

// a failed copy returns ok:false, throws nothing and leaves no temporary folder (spec 040 FR-008)
{
  const fileRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-uth-bad-')), 'themes');
  fs.writeFileSync(fileRoot, 'a file where the themes folder should be');
  const r2 = new UserThemeStore(fileRoot).importFolder(path.join(src, 'ocean'), (id) => BUILT.has(id));
  assert.strictEqual(r2.ok, false, 'copy failure is reported');
  assert.ok(r2.error && r2.error.includes('could not be copied'));
}
// an unfinished import (dot folder) is not listed as a broken theme
fs.mkdirSync(path.join(root, 'themes', '.ocean.tmp-123'));
assert.ok(!store.list().some((t) => t.id.startsWith('.')), 'dot folders are skipped');

console.log('user theme tests passed');
