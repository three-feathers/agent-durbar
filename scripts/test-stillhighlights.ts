/**
 * Spec 001 FR-192 (issue #780, WCAG 2.2.2): the *Still highlights (no motion)* setting is validated and saved in main. The simulator replaces
 * the preload and bypasses main, so main's own handler runs here on a stand-in `electron` with a real store. No Electron, no credits.
 * `npm run test:stillhighlights`.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { parseSettings } from '../src/shared/credits';

// the file reader keeps only `true`
assert.deepStrictEqual(parseSettings('{"stillHighlights":true}'), { stillHighlights: true });
for (const bad of ['false', '"true"', '1', '0', 'null', '[]', '{}']) assert.deepStrictEqual(parseSettings('{"stillHighlights":' + bad + '}'), {}, 'only true is kept: ' + bad);

async function main(): Promise<void> {
  const electronPath = require.resolve('electron');
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const fake = { ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(ch, fn), on: () => undefined }, app: { getVersion: () => '0.0.0-test' } };
  const savedElectron = require.cache[electronPath];
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-still-'));
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SettingsStore } = require('../src/main/settings') as typeof import('../src/main/settings');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { register } = require('../src/main/ipc/settings') as typeof import('../src/main/ipc/settings');
    const file = path.join(dir, 'durbar-settings.json');
    const read = (): Record<string, unknown> => JSON.parse(fs.readFileSync(file, 'utf8'));
    const store = new SettingsStore(file);
    store.load();
    register({ getSettingsStore: () => store, getRunTheme: () => undefined, clearRunTheme: () => undefined });
    assert.ok(handlers.has('settings:setStillHighlights'), 'the channel is registered');
    const frame = { url: pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href };
    const win = { senderFrame: frame, sender: { mainFrame: frame } };
    const call = async (ch: string, ...a: unknown[]): Promise<Record<string, unknown>> => (await handlers.get(ch)!(win, ...a)) as Record<string, unknown>;

    assert.strictEqual((await call('settings:get')).stillHighlights, false, 'off by default');
    assert.deepStrictEqual(await call('settings:setStillHighlights', true), { ok: true, stillHighlights: true });
    assert.strictEqual((await call('settings:get')).stillHighlights, true);
    assert.strictEqual(read().stillHighlights, true, 'written as true');
    assert.strictEqual(new SettingsStore(file).load().stillHighlights, true, 'survives a restart');
    for (const junk of ['yes', 'true', 1, 0, null, undefined, {}, []]) {
      assert.deepStrictEqual(await call('settings:setStillHighlights', junk), { ok: false, stillHighlights: true }, 'a non-boolean changes nothing: ' + JSON.stringify(junk));
    }
    assert.strictEqual(new SettingsStore(file).load().stillHighlights, true, 'a refused value changes nothing on disk');
    assert.deepStrictEqual(await call('settings:setStillHighlights', false), { ok: true, stillHighlights: false });
    assert.ok(!('stillHighlights' in read()), 'off is not written');
    assert.strictEqual(new SettingsStore(file).load().stillHighlights, undefined, 'off after a restart');
    // no store (a profile that failed to open): refused, never "saved"
    handlers.clear();
    register({ getSettingsStore: () => undefined, getRunTheme: () => undefined, clearRunTheme: () => undefined });
    assert.deepStrictEqual(await call('settings:setStillHighlights', true), { ok: false, stillHighlights: false }, 'no store: ok is false');
    handlers.clear();
    register({ getSettingsStore: () => store, getRunTheme: () => undefined, clearRunTheme: () => undefined });
    // sweep: a save that fails is said, and the setting stays as it was (Settings says "It stays off")
    {
      const blocker = path.join(dir, 'a-file');
      fs.writeFileSync(blocker, 'x');
      const stuck = new SettingsStore(path.join(blocker, 'durbar-settings.json'));
      stuck.load();
      handlers.clear();
      register({ getSettingsStore: () => stuck, getRunTheme: () => undefined, clearRunTheme: () => undefined });
      assert.deepStrictEqual(await call('settings:setStillHighlights', true), { ok: false, stillHighlights: false }, 'a failed save: not ok, and the value in force');
      assert.strictEqual(stuck.stillHighlights, false, 'rolled back in memory too');
      // a failed write that asks for the value already in force is not ok either (pre-review of #968: `ok = inForce === on` said ok)
      assert.deepStrictEqual(await call('settings:setStillHighlights', false), { ok: false, stillHighlights: false }, 'a failed save of the value already in force: not ok');
      handlers.clear();
      register({ getSettingsStore: () => store, getRunTheme: () => undefined, clearRunTheme: () => undefined });
    }
    // the store's own guard (the handler's guard hides it when called through the handler): a non-boolean is refused and changes nothing
    {
      const own = new SettingsStore(path.join(dir, 'own.json'));
      own.load();
      assert.deepStrictEqual(own.setStillHighlights(true), { ok: true, stillHighlights: true });
      for (const junk of ['yes', 1, null, undefined, {}]) assert.deepStrictEqual(own.setStillHighlights(junk), { ok: false, stillHighlights: true }, 'the store refuses ' + JSON.stringify(junk));
      assert.strictEqual(own.stillHighlights, true, 'and keeps the value');
    }
    // the handler's own guard: a store that records calls never sees a non-boolean
    {
      const seen: unknown[] = [];
      const spy = { stillHighlights: false, setStillHighlights: (v: unknown) => { seen.push(v); return { ok: true, stillHighlights: v === true }; } };
      handlers.clear();
      register({ getSettingsStore: () => spy as never, getRunTheme: () => undefined, clearRunTheme: () => undefined });
      for (const junk of ['yes', 1, null, undefined, {}]) assert.deepStrictEqual(await call('settings:setStillHighlights', junk), { ok: false, stillHighlights: false }, 'the handler refuses ' + JSON.stringify(junk));
      assert.deepStrictEqual(seen, [], 'a non-boolean never reaches the store');
      assert.deepStrictEqual(await call('settings:setStillHighlights', true), { ok: true, stillHighlights: true });
      assert.deepStrictEqual(seen, [true], 'a boolean does');
      handlers.clear();
      register({ getSettingsStore: () => store, getRunTheme: () => undefined, clearRunTheme: () => undefined });
    }
    // another setting keeps it
    await call('settings:setStillHighlights', true);
    store.setSeriousMode(true);
    assert.strictEqual(new SettingsStore(file).load().stillHighlights, true, 'a change elsewhere keeps it');
  } finally {
    if (savedElectron) require.cache[electronPath] = savedElectron;
    else delete require.cache[electronPath];
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('test-stillhighlights: ok');
}
main().catch((e) => { console.error(e); process.exit(1); });
