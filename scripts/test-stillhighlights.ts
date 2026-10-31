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
      assert.deepStrictEqual(await call('settings:setStillHighlights', junk), { ok: true, stillHighlights: true }, 'a non-boolean changes nothing: ' + JSON.stringify(junk));
    }
    assert.strictEqual(new SettingsStore(file).load().stillHighlights, true, 'a refused value changes nothing on disk');
    assert.deepStrictEqual(await call('settings:setStillHighlights', false), { ok: true, stillHighlights: false });
    assert.ok(!('stillHighlights' in read()), 'off is not written');
    assert.strictEqual(new SettingsStore(file).load().stillHighlights, undefined, 'off after a restart');
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
