/**
 * Spec 017 FR-031 (review on #954 item 10): the IPC channels of the held prompts and main.ts's hand-over, by behaviour. The channels are
 * registered on a stand-in for the electron module and called as the window would call them (as test-orgwiring does). main.ts starts Electron
 * and cannot run here: the lines that hand each dependency over are pinned by their text. `npm run test:heldmig`. No session, no credits.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { HeldBeforeUpdate, loadHeld, MAX_IDS, saveHeld } from '../src/main/doormigrate';
import type { HeldRun } from '../src/main/doormigrate';

async function main(): Promise<void> {
  process.exitCode = 1;
  const electronPath = require.resolve('electron');
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const fake = { ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(ch, fn), on: () => undefined }, safeStorage: { isEncryptionAvailable: () => false } };
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { register } = require('../src/main/ipc/heldmig') as typeof import('../src/main/ipc/heldmig');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-heldmig-'));
  const file = path.join(dir, 'durbar-doors.json');
  const run = (id: string, prompt: string): HeldRun => ({ id, at: 1, prompt, scheduleId: 's-' + id });
  fs.writeFileSync(file, JSON.stringify({ doors: { k1: { closed: true, held: [run('a1', 'k1 first'), run('a2', 'k1 second')] }, k2: { held: [run('b1', 'k2 first')] } } }));
  const sent: string[] = [];
  let bad = 0, listener: (e: unknown) => void = () => undefined;
  const held = new HeldBeforeUpdate(loadHeld(file), {
    sessionOf: (key) => (key === 'k1' ? 'agent-1' : key === 'k2' ? 'agent-2' : undefined),
    scheduleExists: () => true,
    release: async (r) => (sent.push(r.prompt), 'sent'),
    persist: (d) => saveHeld(file, d),
    discardBad: () => (bad++, true),
    changed: () => undefined,
    stopped: () => undefined,
  });
  register({ held: () => held, router: { onEvent: (cb: (e: unknown) => void) => { listener = cb; return () => undefined; } } as never });
  const frame = { url: pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href };
  const win = { senderFrame: frame, sender: { mainFrame: frame } };
  const other = { senderFrame: { url: 'https://example.com/' }, sender: { mainFrame: {} } };
  const call = async (ev: unknown, ch: string, ...a: unknown[]) => (await handlers.get(ch)!(ev, ...a)) as Record<string, unknown>;

  assert.deepStrictEqual([...handlers.keys()].sort(), ['heldmig:discard', 'heldmig:discardBad', 'heldmig:list', 'heldmig:noticed', 'heldmig:send']);
  // the window's own page only (fromApp): any other page gets nothing and changes nothing
  for (const ch of ['heldmig:list', 'heldmig:send', 'heldmig:discard', 'heldmig:discardBad', 'heldmig:noticed']) {
    await assert.rejects(() => call(other, ch), /did not come from its own window/, ch + ': refused for a foreign page');
  }
  assert.deepStrictEqual([sent, bad, held.count(), held.list().notice], [[], 0, 3, true], 'nothing sent, deleted or marked by a foreign page');
  const l = (await call(win, 'heldmig:list')) as unknown as { items: { id: string; session?: string; canSend: boolean }[] };
  assert.deepStrictEqual(l.items.map((i) => [i.id, i.session, i.canSend]), [['a1', 'agent-1', true], ['a2', 'agent-1', true], ['b1', 'agent-2', true]], 'each run shows the session its key maps to');
  // bad input is refused, with a reason, and sends nothing
  for (const ids of ['a1', [1], [''], ['x'.repeat(101)], Array.from({ length: MAX_IDS + 1 }, (_, i) => 'i' + i)]) {
    assert.deepStrictEqual(await call(win, 'heldmig:send', ids), { ok: false, error: 'invalid request' }, 'send refuses ' + JSON.stringify(ids).slice(0, 30));
    assert.strictEqual((await call(win, 'heldmig:discard', ids)).ok, false, 'discard refuses it too');
  }
  assert.deepStrictEqual(sent, [], 'refused calls sent nothing');
  // one limit end to end: more than 200 ids (a row of gone sessions) is accepted up to every run the file may hold
  assert.strictEqual((await call(win, 'heldmig:discard', Array.from({ length: 201 }, (_, i) => 'zz' + i))).ok, true, '201 ids are accepted');
  assert.strictEqual((await call(win, 'heldmig:send', Array.from({ length: MAX_IDS }, (_, i) => 'zz' + i))).ok, true, 'MAX_IDS ids are accepted');
  assert.deepStrictEqual(sent, [], 'and unknown ids send nothing');
  assert.strictEqual((await call(win, 'heldmig:send', ['none'])).ok, true);
  assert.deepStrictEqual(sent, [], 'an unknown id sends nothing');
  // the ids are honoured: one row's Send never sends another session's prompts
  assert.deepStrictEqual(await call(win, 'heldmig:send', ['a1']), { ok: true, started: 1, skipped: 0 });
  assert.deepStrictEqual(sent, ['k1 first'], 'only the chosen run went (not k1 second, not k2)');
  assert.deepStrictEqual(await call(win, 'heldmig:send', []), { ok: true, started: 0, skipped: 0 });
  assert.deepStrictEqual(sent, ['k1 first'], 'an empty list of ids sends nothing (it is not "all")');
  // a status event from the router moves a chosen Send on (the wiring of onStatus)
  listener({ type: 'status', sessionId: 'agent-9', status: 'idle' });
  assert.deepStrictEqual(await call(win, 'heldmig:discard', ['b1']), { ok: true, discarded: 1 });
  assert.deepStrictEqual(held.list().items.map((i) => i.id), ['a2'], 'discard removes only the chosen id');
  assert.strictEqual((await call(win, 'heldmig:discardBad')).ok, true);
  assert.strictEqual(bad, 1, 'the kept-aside file is deleted only through its own channel');
  assert.deepStrictEqual(await call(win, 'heldmig:send'), { ok: true, started: 1, skipped: 0 });
  assert.deepStrictEqual(sent, ['k1 first', 'k1 second'], 'no ids: all that is left');

  // main.ts hands over exactly these (pinned by text: it cannot run here)
  let root = __dirname;
  while (!fs.existsSync(path.join(root, 'package.json'))) root = path.dirname(root);
  const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8').split(/\r?\n/);
  assert.ok(main.length > 500);
  const has = (re: RegExp, what: string) => assert.ok(main.some((l) => re.test(l)), 'main.ts: ' + what);
  has(/sessionOf: \(key\) => \[\.\.\.agents\.keys\(\)\]\.find\(\(id\) => resumeIdFor\(id\) === key\)/, 'a held key maps to the session whose resume id it is');
  has(/release: \(run\) => \(scheduler \? scheduler\.releaseDoorRun\(run\.scheduleId, run\.prompt\)/, 'a chosen Send goes through Scheduler.releaseDoorRun');
  has(/registerHeldMigIpc\(\{ held: \(\) => heldBefore, router \}\)/, 'the channels are registered with the store and the router');
  has(/heldBefore = new HeldBeforeUpdate\(loaded,/, 'the store is built from loadHeld');
  has(/setInterval\(\(\) => heldBefore\?\.retry\(\), 5000\)/, 'a timer retries a stalled Send');
  fs.rmSync(dir, { recursive: true, force: true });
  process.exitCode = 0;
  console.log('heldmig wiring tests passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
