/**
 * Spec 093 (T018, T036): the IPC wiring of `folders:createPickParent`, `folders:createCheck`, `folders:create` and
 * `folders:createCancel`, and the `folders:createProgress` event, by behaviour. Phase 2: a refused URL never reaches mkdir or a
 * process; the clone the handler starts allows https and ssh only (FR-095), on a stand-in `child_process` (no git, no network).
 * The channels are registered on a stand-in for the electron module (its dialog returns a scratch folder) and called as the window
 * would call them, with the real op, the real file system and a real SettingsStore in a scratch folder. main.ts cannot run here:
 * the line that hands the dependencies over is pinned by its text. No git is started (empty folders only), no network, no credits.
 * `npm run test:newfolderipc`.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { AddResult, PermMode, SessionOptions } from '../src/shared/api';
import { EventEmitter } from 'events';

async function main(): Promise<void> {
  const electronPath = require.resolve('electron');
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const dialogs: Array<Record<string, unknown>> = [];
  let answer: { canceled: boolean; filePaths: string[] } = { canceled: true, filePaths: [] };
  const fake = { ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(ch, fn), on: () => undefined }, dialog: { showOpenDialog: async (o: Record<string, unknown>) => { dialogs.push(o); return answer; } }, safeStorage: { isEncryptionAvailable: () => false } };
  const savedElectron = require.cache[electronPath];
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-093-ipc-')));
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { register } = require('../src/main/ipc/newfolder') as typeof import('../src/main/ipc/newfolder');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SettingsStore } = require('../src/main/settings') as typeof import('../src/main/settings');
    const store = new SettingsStore(path.join(root, 'settings.json'));
    store.load();
    const adds: Array<{ paths: string[]; mode: PermMode; opts: unknown }> = [];
    const addMany = async (paths: string[], mode: PermMode, opts?: SessionOptions & { persist?: boolean }): Promise<AddResult> => { adds.push({ paths, mode, opts }); return { ok: true, agents: [{ id: 'a' + adds.length, cwd: paths[0] } as never] }; };
    const sent: Array<[string, unknown]> = [];
    const quitter = register({ addMany, getSettingsStore: () => store, asEffort: (v) => (v === 'high' ? 'high' : undefined), toRenderer: (ch, p) => { sent.push([ch, p]); } });
    assert.deepStrictEqual([...handlers.keys()].sort(), ['folders:create', 'folders:createCancel', 'folders:createCheck', 'folders:createPickParent'], 'the four channels');

    const indexUrl = pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href;
    const frame = { url: indexUrl };
    const win = { senderFrame: frame, sender: { mainFrame: frame } };
    const other = { url: 'https://example.invalid/' };
    const foreign = { senderFrame: other, sender: { mainFrame: other } };
    const call = (ch: string, ...a: unknown[]) => Promise.resolve(handlers.get(ch)!(win, ...a)) as Promise<Record<string, unknown>>;

    const parent = path.join(root, 'code');
    fs.mkdirSync(parent);
    const list = (): string[] => fs.readdirSync(parent).sort();

    // a call from another page or frame never reaches a handler (ipcHandle), so nothing is picked or created
    for (const ch of handlers.keys()) await assert.rejects(Promise.resolve().then(() => handlers.get(ch)!(foreign, { kind: 'empty', token: 'x', name: 'x' }, 'allow', {})), /did not come from its own window/, ch);
    assert.deepStrictEqual([dialogs.length, adds.length, list()], [0, 0, []]);

    // FR-004: main's own picker (a folder, with Create on macOS); cancelled: no token
    assert.deepStrictEqual(await call('folders:createPickParent'), { ok: false, cancelled: true });
    assert.deepStrictEqual(dialogs[0], { title: 'Choose where to create the folder', buttonLabel: 'Choose', properties: ['openDirectory', 'createDirectory'] }, 'first time: the system default place');
    answer = { canceled: false, filePaths: [parent] };
    const pickNow = async (): Promise<string> => { const r = await call('folders:createPickParent', '/etc', { path: '/etc' }); assert.strictEqual(r.ok, true); assert.strictEqual(r.parent, parent, 'the window gets the picked place to show'); return String(r.token); };

    // FR-022: createCheck is feedback only
    assert.deepStrictEqual(await call('folders:createCheck', { kind: 'empty', name: 'CON' }), { ok: false, error: 'That name is reserved on Windows (CON, PRN, AUX, NUL, CONIN$, CONOUT$, COM0-9, LPT0-9). Choose another.', retry: 'name' });
    assert.deepStrictEqual(await call('folders:createCheck', { kind: 'empty', name: 'fine' }), { ok: true });
    assert.deepStrictEqual(list(), [], 'createCheck creates nothing');

    // a refused name or kind never reaches mkdir (the parent stays empty) or addMany
    let tok = await pickNow();
    for (const bad of ['..', '../escape', 'a/b', 'a\\b', '/etc', 'CON', '-rf', '.git', 'x.', 'a:b', '', 'ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8']) {
      const r = await call('folders:create', { kind: 'empty', token: tok, name: bad }, 'allow', {});
      assert.strictEqual(r.ok, false, `refused: ${bad}`);
    }
    for (const k of ['status', 'Init', 'Clone', undefined]) assert.strictEqual((await call('folders:create', { kind: k, token: tok, name: 'k' }, 'allow', {})).ok, false, `kind ${String(k)}`);
    assert.deepStrictEqual([list(), adds.length], [[], 0], 'nothing created, nothing added');
    assert.ok(!fs.existsSync(path.join(root, 'escape')), 'nothing outside the parent either');

    // the window cannot name the place: path-like fields are ignored, the folder goes in main's pick
    const r1 = await call('folders:create', { kind: 'empty', token: tok, name: 'first', parent: root, path: root, target: path.join(root, 'x'), cwd: root }, 'ask', {});
    assert.strictEqual(r1.ok, true, JSON.stringify(r1));
    assert.deepStrictEqual(list(), ['first']);
    assert.ok(!fs.existsSync(path.join(root, 'first')) && !fs.existsSync(path.join(root, 'x')));
    assert.strictEqual((await call('folders:create', { kind: 'empty', token: tok, name: 'second' }, 'ask', {})).error, 'Choose the place again.', 'the token is one use');

    // FR-061: the mode reaches addMany through validMode (anything unknown is Read-only); FR-060: the options as agents:addFolder reads them
    const modes: Array<[unknown, PermMode]> = [['allow', 'allow'], ['ask', 'ask'], ['read-only', 'read-only'], ['junk', 'read-only'], [undefined, 'read-only'], [{ toString: () => 'allow' }, 'read-only']];
    adds.length = 0;
    for (const [i, [m]] of modes.entries()) {
      tok = await pickNow();
      const r = await call('folders:create', { kind: 'empty', token: tok, name: `m${i}` }, m, { floor: 'f'.repeat(50), model: 'gpt-x', effort: 'high', adapterId: 'claude', maxAiCredits: '50', evil: '/etc', persist: false });
      assert.strictEqual(r.ok, true);
    }
    assert.deepStrictEqual(adds.map((a) => a.mode), modes.map(([, w]) => w));
    assert.deepStrictEqual(adds[0].opts, { model: 'gpt-x', effort: 'high', maxAiCredits: 50, floor: 'f'.repeat(20), adapterId: 'claude', persist: true }, 'options parsed like agents:addFolder (unknown keys dropped)');
    assert.deepStrictEqual(adds[0].paths, [path.join(parent, 'm0')]);

    // FR-006: the parent is remembered in settings and the picker starts there next time
    assert.strictEqual(new (require('../src/main/settings').SettingsStore)(path.join(root, 'settings.json')).load().newFolderParent, parent, 'saved in settings.json');
    await call('folders:createPickParent');
    assert.strictEqual(dialogs[dialogs.length - 1].defaultPath, parent, 'the picker opens at the last parent');
    fs.rmSync(path.join(parent), { recursive: true });
    await call('folders:createPickParent');
    assert.strictEqual(dialogs[dialogs.length - 1].defaultPath, undefined, 'a parent that is gone: the system default');

    // ---- phase 2: clone, on a stand-in child_process (the runner reads spawn and execFile from it when it runs) ----
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cp = require('child_process') as Record<string, unknown>;
    const realSpawn = cp.spawn, realExecFile = cp.execFile;
    const spawns: Array<{ file: string; args: string[]; opts: { cwd: string; env: NodeJS.ProcessEnv; shell: boolean } }> = [];
    const reads: string[][] = [];
    let child: (EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }) | undefined;
    // pid undefined: Cancel never signals a real process from this test (killChildTree needs a pid)
    cp.spawn = (file: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; shell: boolean }) => { spawns.push({ file, args, opts }); child = Object.assign(new EventEmitter(), { pid: undefined, exitCode: null, signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true }); return child; };
    cp.execFile = (_f: string, args: string[], _o: unknown, cb: (e: Error | null, out: string) => void) => { reads.push(args); cb(Object.assign(new Error('unset'), { code: 1 }), ''); };
    try {
      fs.mkdirSync(parent);
      adds.length = 0;
      // a refused URL (checked by createCheck and again by create) never reaches mkdir, the config read or a process
      for (const bad of ['file:///etc', 'ext::sh -c touch /tmp/x', '-uhelp', 'C:\\repos\\x', 'https://lena:hunter2@host/x.git', 'https://u%3Ap@h/x', 'git://h/x', '']) {
        const c = await call('folders:createCheck', { kind: 'clone', url: bad });
        assert.deepStrictEqual([c.ok, c.retry], [false, 'url'], `createCheck refuses ${bad}`);
        tok = await pickNow();
        const r = await call('folders:create', { kind: 'clone', token: tok, name: 'x', url: bad }, 'allow', {});
        assert.deepStrictEqual([r.ok, r.retry], [false, 'url'], `create refuses ${bad}`);
      }
      assert.deepStrictEqual([list(), spawns.length, reads.length], [[], 0, 0], 'nothing created, read or started');
      assert.deepStrictEqual(await call('folders:createCheck', { kind: 'clone', url: 'git@github.com:lena/shop.git' }), { ok: true, host: 'github.com', suggested: 'shop', shown: 'git@github.com:lena/shop.git' });
      // the clone the handler starts: https and ssh only (the window cannot pass protocols), in the new folder, no shell
      tok = await pickNow();
      const run = call('folders:create', { kind: 'clone', token: tok, name: 'shop', url: 'https://github.com/lena/shop.git', protocols: ['file'] }, 'ask', {});
      for (let i = 0; i < 50 && !spawns.length; i++) await new Promise((r) => setTimeout(r, 10));
      assert.strictEqual(spawns.length, 1, 'git started once');
      const sp = spawns[0];
      assert.deepStrictEqual([sp.file, sp.opts.cwd, sp.opts.shell], ['git', path.join(parent, 'shop'), false], 'git in the new folder, no shell');
      assert.deepStrictEqual(sp.args.slice(-5), ['--progress', '--no-recurse-submodules', '--', 'https://github.com/lena/shop.git', '.']);
      assert.strictEqual(sp.opts.env.GIT_ALLOW_PROTOCOL, 'https:ssh', 'FR-095: https and ssh only');
      assert.ok(sp.args.includes('protocol.file.allow=never') && sp.args.includes('protocol.ext.allow=never') && !sp.args.includes('protocol.file.allow=always'), 'every other transport off by name');
      assert.strictEqual(sp.opts.env.GIT_SSH_COMMAND, 'ssh -o BatchMode=yes', 'no core.sshCommand (the read said unset): BatchMode ssh');
      assert.deepStrictEqual(reads, [['--no-pager', '-c', 'core.fsmonitor=false', 'config', '--get', 'core.sshCommand']], 'the one config read');
      // FR-040: progress reaches the window masked, on folders:createProgress
      child!.stderr.emit('data', 'Receiving objects:  45% (9/20) https://u:secret@h/x\r');
      for (let i = 0; i < 50 && !sent.length; i++) await new Promise((r) => setTimeout(r, 10));
      assert.strictEqual(sent[0][0], 'folders:createProgress');
      assert.ok(!JSON.stringify(sent).includes('secret') && (sent[0][1] as { percent?: number }).percent === 45, 'masked progress: ' + JSON.stringify(sent[0][1]));
      // FR-041: Cancel from the window (and only from it); the folder goes after git's close
      await assert.rejects(Promise.resolve().then(() => handlers.get('folders:createCancel')!(foreign)), /did not come from its own window/);
      assert.strictEqual(quitter.busy(), true);
      assert.deepStrictEqual(await call('folders:createCancel'), { ok: true });
      assert.ok(fs.existsSync(path.join(parent, 'shop')), 'not removed before git has exited');
      child!.emit('close', null, 'SIGTERM');
      const r = await run;
      assert.deepStrictEqual([r.ok, r.cancelled, r.error], [false, true, 'Cancelled. Nothing was kept.']);
      assert.deepStrictEqual([list(), adds.length, quitter.busy()], [[], 0, false], 'nothing left, nothing added');
      assert.deepStrictEqual(await call('folders:createCancel'), { ok: false }, 'nothing to cancel');
      assert.strictEqual(await quitter.quit(), true, 'quit with nothing running');
    } finally {
      cp.spawn = realSpawn;
      cp.execFile = realExecFile;
    }

    // main.ts hands the real addMany, the settings store, the effort parser and toRenderer over, and ends a clone on quit
    const mainSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'), 'utf8');
    assert.ok(mainSrc.includes('const newFolderIpc = registerNewFolderIpc({ addMany, getSettingsStore: () => settingsStore, asEffort, toRenderer });'), 'main.ts wires folders:* with addMany, the settings store, asEffort and toRenderer');
    assert.ok(/if \(!newFolderEnded && newFolderIpc\.busy\(\)\) \{\n\s+newFolderEnded = true;\n\s+ev\.preventDefault\(\);\n\s+void newFolderIpc\.quit\(\)\.catch\(\(\) => undefined\)\.finally\(\(\) => app\.quit\(\)\);/.test(mainSrc.replace(/\r\n/g, '\n')), "main.ts's before-quit ends a running clone first (FR-043)");
    console.log('newfolderipc: owner-only channels, picker and remembered parent, refused names and URLs never created or started, no path from the window, mode through validMode, the clone https/ssh only, masked progress, Cancel, quit wiring OK');
  } finally {
    if (savedElectron) require.cache[electronPath] = savedElectron; else delete require.cache[electronPath];
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
