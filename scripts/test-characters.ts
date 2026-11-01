/**
 * Characters, separate from themes (spec 077 FR-064..FR-067, FR-070; issue #814). No Electron, no credits. `npm run test:characters`.
 *   - the shared rule (src/shared/characters.ts) and the renderer's copy (theme.js) answer alike;
 *   - kit resolution: every Characters value on every built-in theme, the old Cheeky Crew id, a user pack, unknown values;
 *   - the migration: the old theme becomes Clean Office with Characters = Cheeky, written once; a stored choice is kept; unknown values dropped;
 *   - the settings round trip through the real IPC handlers (`settings:setCharacters`, `settings:get`, `settings:setTheme`) on a stand-in electron.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { CHARACTER_CHOICES, CHARACTER_KITS, LEGACY_CREW_THEME, kitFor, migrateLegacyTheme, parseCharacters } from '../src/shared/characters';
import { parseSettings } from '../src/shared/credits';
import { SCENE_KITS } from '../src/shared/themes';

const ROOT = path.resolve(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const T = require(path.join(ROOT, 'src', 'renderer', 'theme.js'));

// --- the two copies of the rule (agent notes: two copies, one corpus) ---
assert.deepStrictEqual(T.CHARACTERS, [...CHARACTER_CHOICES], 'theme.js lists the same Characters values, in the same order');
assert.deepStrictEqual([...CHARACTER_CHOICES], ['theme', 'minimalist', 'cheeky', 'prehistoric', 'mine'], 'new crews are appended: the old values never move (FR-064, FR-072; spec 096 FR-040)');
assert.strictEqual(CHARACTER_KITS.mine, 'crew', 'spec 096 FR-040: My characters draw the crew kit');
// spec 096 T044: Settings offers the first four and `mine` only behind the character list; a stored `mine` with no character draws the theme's own (check-characters runs it)
{
  const screens = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'screens.js'), 'utf8');
  const list = /const charItems=\(\)=>\{[\s\S]*?const list=\[([^\n]*)\];/.exec(screens)?.[1] ?? '';
  assert.deepStrictEqual([...list.matchAll(/\bid:'([a-z]+)'/g)].map((m) => m[1]), ['theme', 'minimalist', 'cheeky', 'prehistoric'], 'Settings offers these always');
  assert.ok(/if\(mineN>=0\)list\.push\(\{id:'mine'/.test(screens), 'and mine, when the app can list characters');
  assert.ok(!/T\.CHARACTERS|THEME\.CHARACTERS/.test(screens), 'and does not list from theme.js');
  const appJs = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');
  assert.ok(/THEME\.setCharacters\(drawableCharacters\(CHARS_CHOSEN\)\)/.test(appJs) && /const drawableCharacters=c=>c==='mine'&&!\(CREW&&CREW\.idsFor\('mine'\)\.length\)\?'theme':c;/.test(appJs), "a stored mine with no character draws the theme's own");
}
assert.deepStrictEqual(T.CHARACTER_KITS, { ...CHARACTER_KITS }, 'theme.js maps each choice to the same kit');
assert.strictEqual(T.LEGACY_CREW_THEME, LEGACY_CREW_THEME);
for (const k of Object.values(CHARACTER_KITS)) assert.ok(SCENE_KITS.includes(k) && T.SCENE_KITS.includes(k), `${k} is a scene kit`);
const corpus: unknown[] = [...CHARACTER_CHOICES, 'Mine', 'mine ', 'Cheeky', 'Prehistoric', 'prehistoric ', ' cheeky', 'crew', 'office', '', null, undefined, 0, {}, [], '__proto__', 'constructor', 'theme\n'];
for (const v of corpus) {
  assert.strictEqual(T.parseCharacters(v), parseCharacters(v), 'parseCharacters agrees on ' + JSON.stringify(v));
  for (const kit of [...SCENE_KITS, undefined, '']) assert.strictEqual(T.kitFor(kit, v), kitFor(kit, v), `kitFor(${kit}, ${JSON.stringify(v)}) agrees`);
}

// --- kit resolution (FR-065): every built-in theme, each value ---
const OWN: Record<string, string> = { 'clean-office': 'office', corporate: 'corporate', retro: 'pixel', 'durbar-indian': 'court-indian', 'durbar-european': 'court-european', 'durbar-japanese': 'court-japanese' };
assert.deepStrictEqual(T.list().map((t: { id: string }) => t.id).sort(), Object.keys(OWN).sort(), 'the built-in themes; Cheeky Crew is not one of them (FR-066)');
assert.ok(!T.list().some((t: { id: string; name: string }) => t.id === LEGACY_CREW_THEME || /cheeky/i.test(t.name)), 'Cheeky is not listed as a theme');
for (const [id, own] of Object.entries(OWN)) {
  T.setCharacters('theme');
  T.setTheme(id);
  assert.strictEqual(T.current().id, id);
  assert.strictEqual(T.themeKit(), own, `${id}: its own kit is ${own}`);
  assert.strictEqual(T.sceneKit(), own, `${id}: The theme's own draws ${own}`);
  T.setCharacters('minimalist');
  assert.strictEqual(T.sceneKit(), 'office', `${id}: Minimalist draws the office kit`);
  T.setCharacters('cheeky');
  assert.strictEqual(T.sceneKit(), 'crew', `${id}: Cheeky draws the crew kit on top of it`);
  assert.strictEqual(T.current().id, id, `${id}: the theme stays`);
  assert.strictEqual(T.themeKit(), own, `${id}: its own kit is unchanged by the choice`);
  T.setCharacters('prehistoric');
  assert.strictEqual(T.sceneKit(), 'crew', `${id}: Prehistoric draws the crew kit on top of it (FR-072)`);
  assert.strictEqual(T.themeKit(), own, `${id}: its own kit is unchanged by Prehistoric`);
  T.setCharacters('mine');
  assert.strictEqual(T.sceneKit(), 'crew', `${id}: My characters draw the crew kit on top of it, in any world (spec 096 FR-040)`);
  assert.strictEqual(T.current().id, id, `${id}: the theme stays under My characters`);
  assert.strictEqual(T.themeKit(), own, `${id}: its own kit is unchanged by My characters`);
  T.setCharacters('nonsense');
  assert.strictEqual(T.characters(), 'theme', `${id}: an unknown value is the default`);
  assert.strictEqual(T.sceneKit(), own, `${id}: and draws the theme's own`);
}
// a choice applies on top of a user pack too (FR-065)
T.registerUserThemes({ 'my-pixels': { id: 'my-pixels', name: 'My pixels', scene: 'pixel' } });
T.setCharacters('theme');
T.setTheme('my-pixels');
assert.strictEqual(T.current().id, 'my-pixels');
assert.strictEqual(T.sceneKit(), 'pixel', 'a user pack: its own kit by default');
T.setCharacters('cheeky');
assert.strictEqual(T.sceneKit(), 'crew', 'a user pack: Cheeky on top');
// the revision changes with the choice, so every cache key and scene signature does (FR-065)
{
  T.setCharacters('theme');
  const a = T.themeIdForCache();
  T.setCharacters('cheeky');
  const b = T.themeIdForCache();
  T.setCharacters('cheeky');
  assert.notStrictEqual(a, b, 'a new choice changes the cache key');
  assert.strictEqual(T.themeIdForCache(), b, 'the same choice again does not');
  T.setCharacters('prehistoric');
  assert.notStrictEqual(T.themeIdForCache(), b, 'Cheeky to Prehistoric (the same kit) still changes the cache key (FR-072)');
}
// the old id in the window (FR-067): Clean Office with Cheeky when the choice is the default; another choice in force is kept
T.setCharacters('theme');
T.setTheme('retro');
assert.strictEqual(T.setTheme(LEGACY_CREW_THEME), 'clean-office', 'the old id applies Clean Office');
assert.strictEqual(T.characters(), 'cheeky', 'with Characters = Cheeky');
assert.strictEqual(T.sceneKit(), 'crew');
T.setCharacters('minimalist');
T.setTheme(LEGACY_CREW_THEME);
assert.strictEqual(T.characters(), 'minimalist', 'a choice in force is not overwritten by the old id');
T.setCharacters('theme');
T.setTheme('nope');
assert.strictEqual(T.current().id, 'clean-office', 'any other unknown theme still falls back to Clean Office');
assert.strictEqual(T.characters(), 'theme', 'and leaves the characters alone');

// --- the pure migration (FR-067) ---
assert.deepStrictEqual(migrateLegacyTheme({ theme: 'cheeky-crew' }), { settings: { characters: 'cheeky' }, changed: true });
assert.deepStrictEqual(migrateLegacyTheme({ theme: 'cheeky-crew', characters: 'minimalist' }), { settings: { characters: 'minimalist' }, changed: true }, 'a stored choice is kept');
assert.deepStrictEqual(migrateLegacyTheme({ theme: 'retro', characters: 'cheeky' }), { settings: { theme: 'retro', characters: 'cheeky' }, changed: false });
assert.deepStrictEqual(migrateLegacyTheme({}), { settings: {}, changed: false });
// the settings file reader drops values off the list (FR-064)
assert.deepStrictEqual(parseSettings('{"characters":"cheeky"}'), { characters: 'cheeky' });
assert.deepStrictEqual(parseSettings('{"characters":"minimalist"}'), { characters: 'minimalist' });
assert.deepStrictEqual(parseSettings('{"characters":"prehistoric"}'), { characters: 'prehistoric' }, 'FR-072');
assert.deepStrictEqual(parseSettings('{"characters":"mine"}'), { characters: 'mine' }, 'spec 096 FR-040');
assert.deepStrictEqual(migrateLegacyTheme({ theme: 'cheeky-crew', characters: 'mine' }), { settings: { characters: 'mine' }, changed: true }, 'a stored My characters is kept by the migration');
// spec 096 FR-033, FR-060: pins and Motion in the file; anything else is dropped
assert.deepStrictEqual(parseSettings('{"characterPins":{"/a":"my-0123456789ab"},"characterMotion":false}'), { characterPins: { '/a': 'my-0123456789ab' }, characterMotion: false });
assert.deepStrictEqual(parseSettings('{"characterPins":{"rel":"my-0123456789ab","/a":"../x","/b":7},"characterMotion":true}'), {}, 'bad pins and the default Motion are not kept');
for (const bad of ['[]', '"x"', '7', 'null']) assert.deepStrictEqual(parseSettings(`{"characterPins":${bad},"characterMotion":${bad}}`), {}, 'dropped: ' + bad);
assert.deepStrictEqual(migrateLegacyTheme({ theme: 'cheeky-crew', characters: 'prehistoric' }), { settings: { characters: 'prehistoric' }, changed: true }, 'a stored Prehistoric is kept by the migration');
for (const bad of ['"theme"', '"crew"', '"CHEEKY"', '42', '{}', '["cheeky"]', 'null']) assert.deepStrictEqual(parseSettings(`{"characters":${bad}}`), {}, 'dropped: ' + bad);

async function main(): Promise<void> {
  // --- the store and the IPC handlers, with a stand-in electron ---
  const electronPath = require.resolve('electron');
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const fake = { ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(ch, fn), on: () => undefined }, app: { getVersion: () => '0.0.0-test' } };
  const savedElectron = require.cache[electronPath];
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-chars-'));
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SettingsStore } = require('../src/main/settings') as typeof import('../src/main/settings');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { register } = require('../src/main/ipc/settings') as typeof import('../src/main/ipc/settings');
    const file = path.join(dir, 'durbar-settings.json');
    const read = (): Record<string, unknown> => JSON.parse(fs.readFileSync(file, 'utf8'));

    // migration on load, once (FR-067)
    fs.writeFileSync(file, JSON.stringify({ version: 1, theme: 'cheeky-crew', seriousMode: true }));
    const s1 = new SettingsStore(file);
    const got = s1.load();
    assert.strictEqual(got.theme, undefined, 'the old theme is gone: Clean Office');
    assert.strictEqual(got.characters, 'cheeky', 'Characters = Cheeky');
    assert.strictEqual(got.seriousMode, true, 'the other settings are untouched');
    const onDisk = read();
    assert.ok(!('theme' in onDisk) && onDisk.characters === 'cheeky', 'written to the file at once: ' + JSON.stringify(onDisk));
    const before = fs.readFileSync(file, 'utf8');
    fs.utimesSync(file, new Date(0), new Date(0));
    new SettingsStore(file).load();
    assert.strictEqual(fs.statSync(file).mtimeMs, 0, 'the next load writes nothing (the migration ran once)');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
    // a later choice is never overwritten by the migration
    assert.deepStrictEqual(s1.setCharacters('theme'), { ok: true, characters: 'theme' });
    assert.strictEqual(new SettingsStore(file).load().characters, undefined, "the theme's own is the default and not written");
    assert.strictEqual(new SettingsStore(file).characters, 'theme');
    // an old file with a stored choice keeps it
    fs.writeFileSync(file, JSON.stringify({ version: 1, theme: 'cheeky-crew', characters: 'minimalist' }));
    assert.strictEqual(new SettingsStore(file).load().characters, 'minimalist', 'a stored choice is kept');
    // unknown values fall back safely
    fs.writeFileSync(file, JSON.stringify({ version: 1, theme: 'gone-theme', characters: 'pirates' }));
    const s2 = new SettingsStore(file);
    assert.deepStrictEqual(s2.load(), { theme: 'gone-theme' }, 'an unknown characters value is dropped (the renderer handles the unknown theme)');
    assert.strictEqual(s2.characters, 'theme');
    fs.writeFileSync(file, '{not json');
    assert.deepStrictEqual(new SettingsStore(file).load(), {}, 'a corrupt file is no settings');

    // round trip through the handlers
    fs.rmSync(file);
    const store = new SettingsStore(file);
    store.load();
    let runTheme: string | undefined = 'cheeky-crew'; // DURBAR_THEME for this run: the window maps it, main never stores it
    register({ getSettingsStore: () => store, getRunTheme: () => runTheme, clearRunTheme: () => { runTheme = undefined; } });
    assert.ok(handlers.has('settings:setCharacters') && handlers.has('settings:get'), 'the channels are registered');
    const indexUrl = pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href; // ipcguard's own index, as compiled next to it
    const frame = { url: indexUrl };
    const win = { senderFrame: frame, sender: { mainFrame: frame } };
    const call = async (ch: string, ...a: unknown[]): Promise<Record<string, unknown>> => (await handlers.get(ch)!(win, ...a)) as Record<string, unknown>;
    assert.strictEqual((await call('settings:get')).characters, 'theme', 'the default');
    assert.deepStrictEqual(await call('settings:setCharacters', 'cheeky'), { ok: true, characters: 'cheeky' });
    assert.strictEqual((await call('settings:get')).characters, 'cheeky');
    assert.strictEqual(new SettingsStore(file).load().characters, 'cheeky', 'survives a restart');
    for (const junk of ['crew', 'Cheeky', '', null, undefined, 1, {}, ['cheeky'], 'theme ']) {
      assert.deepStrictEqual(await call('settings:setCharacters', junk), { ok: false, characters: 'cheeky' }, 'refused: ' + JSON.stringify(junk));
    }
    assert.strictEqual(new SettingsStore(file).load().characters, 'cheeky', 'a refused value changes nothing on disk');
    assert.deepStrictEqual(await call('settings:setCharacters', 'prehistoric'), { ok: true, characters: 'prehistoric' }, 'FR-072');
    assert.strictEqual(new SettingsStore(file).load().characters, 'prehistoric', 'Prehistoric survives a restart');
    assert.deepStrictEqual(await call('settings:setCharacters', 'mine'), { ok: true, characters: 'mine' }, 'spec 096 FR-040');
    assert.strictEqual(new SettingsStore(file).load().characters, 'mine', 'My characters survive a restart');
    assert.deepStrictEqual(await call('settings:setCharacters', 'minimalist'), { ok: true, characters: 'minimalist' });
    assert.deepStrictEqual(await call('settings:setCharacters', 'theme'), { ok: true, characters: 'theme' });
    assert.ok(!('characters' in read()), "the theme's own is not written");
    // the old id through settings:setTheme: the same rule, never stored (FR-067)
    assert.strictEqual((await call('settings:get')).theme, 'cheeky-crew', 'the run theme is reported as given (the window maps it)');
    assert.deepStrictEqual(await call('settings:setTheme', 'cheeky-crew'), { ok: true, theme: 'clean-office', characters: 'cheeky' });
    assert.ok(!('theme' in read()) && read().characters === 'cheeky', 'the old id is not stored: ' + JSON.stringify(read()));
    await call('settings:setCharacters', 'minimalist');
    assert.deepStrictEqual(await call('settings:setTheme', 'cheeky-crew'), { ok: true, theme: 'clean-office', characters: 'minimalist' }, 'a choice in force is kept');
    assert.deepStrictEqual(await call('settings:setTheme', 'retro'), { ok: true, theme: 'retro' });
    assert.strictEqual(new SettingsStore(file).load().characters, 'minimalist', 'a theme change keeps the characters');
    // an unwritable profile: refused, the value in force kept
    const ro = new SettingsStore(path.join(file, 'nope', 'x.json'));
    assert.deepStrictEqual(ro.setCharacters('cheeky'), { ok: false, characters: 'theme' }, 'a failed write is refused, not silently lost');
  } finally {
    if (savedElectron) require.cache[electronPath] = savedElectron;
    else delete require.cache[electronPath];
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('test-characters: ok');
}
main().catch((e) => { console.error(e); process.exit(1); });
