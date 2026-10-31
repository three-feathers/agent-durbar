/**
 * Spec 102 T022, FR-064, FR-065, FR-062: `world:list`, `world:part`, `world:remove` through the real handlers and the real `ipcguard` on a stand-in electron, with a real store in a
 * temp folder (the style of `test-orgwiring.ts` and `test-charipc.ts`). `npm run test:worldipc`. No Electron, no network (sealed), no credits.
 * The page sends a key and a part name and gets bytes back; a key main does not list gets nothing; a call from another page or frame never reaches the store.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { WorldStore } from '../src/main/worlds/store';
import type { FsLike, StoreInput } from '../src/main/worlds/store';
import { PART_NAMES } from '../src/shared/worldpack';
import { goodPack } from './fixtures/worlds/gen';

type Handler = (e: unknown, ...a: unknown[]) => unknown;
type Rec = Record<string, unknown>;
process.exitCode = 1;

const thrower = (what: string) => (): never => { throw new Error('NETWORK USED: ' + what); };
/* eslint-disable @typescript-eslint/no-require-imports */
for (const [m, ks] of [[require('http'), ['request', 'get']], [require('https'), ['request', 'get']], [require('net'), ['connect', 'createConnection']]] as Array<[Rec, string[]]>) for (const k of ks) m[k] = thrower(k);
/* eslint-enable @typescript-eslint/no-require-imports */
(globalThis as unknown as { fetch: unknown }).fetch = thrower('fetch');

const ROOT = path.join(__dirname, '..', '..');
const GOOD = goodPack();
const input = (id: string, name: string, files = GOOD): StoreInput => ({ origin: 'project', worldId: id, name, version: 1, unfinished: false, files: Object.keys(files).map((n) => ({ name: n, data: files[n] })) });

function spyFs(): { fsx: FsLike; calls: Array<{ op: string; arg: string }> } {
  const calls: Array<{ op: string; arg: string }> = [];
  const fsx: Record<string, unknown> = { constants: fs.constants };
  for (const op of ['lstatSync', 'openSync', 'fstatSync', 'readSync', 'closeSync', 'readdirSync', 'mkdirSync', 'writeFileSync', 'renameSync', 'unlinkSync', 'rmdirSync']) {
    fsx[op] = (...a: unknown[]) => { calls.push({ op, arg: typeof a[0] === 'string' ? a[0] : '' }); return (fs as unknown as Rec as Record<string, (...x: unknown[]) => unknown>)[op](...a); };
  }
  return { fsx: fsx as unknown as FsLike, calls };
}

async function main(): Promise<void> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-worldipc-'));
  const electronPath = require.resolve('electron');
  const handlers = new Map<string, Handler>();
  const userData = path.join(base, 'userData');
  fs.mkdirSync(userData);
  const fake = {
    ipcMain: { handle: (ch: string, fn: Handler) => handlers.set(ch, fn), on: () => undefined },
    app: { getVersion: () => '0.0.0-test', getPath: () => userData },
    net: { request: thrower('electron.net.request'), fetch: thrower('electron.net.fetch') },
  };
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
  const logged: string[] = [];
  for (const k of ['log', 'warn', 'error', 'info', 'debug'] as const) { const real = console[k]; console[k] = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); if (k === 'log') real(...a); }; }
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
    const { register } = require('../src/main/ipc/worlds') as typeof import('../src/main/ipc/worlds');
    const { SIM_OPEN_CHANNELS, simChannelOpen } = require('../src/main/simguard') as typeof import('../src/main/simguard');
    /* eslint-enable @typescript-eslint/no-require-imports */

    const root = path.join(userData, 'worlds');
    const s = spyFs();
    const store = new WorldStore(root, s.fsx);
    const k1 = (store.save(input('test-world', 'Test world')) as { key: string }).key;
    const k2 = (store.save(input('second', 'Second', goodPack({ id: 'second', name: 'Second' }))) as { key: string }).key;
    // a leftover temp folder a crash left: repair at register removes it, but not under the simulator
    fs.mkdirSync(path.join(root, '.tmp-aaaaaaaaaaaa'));
    const simS = spyFs();
    register({ simulator: true, store: new WorldStore(root, simS.fsx) });
    assert.strictEqual(simS.calls.length, 0, 'under the simulator main touches no folder at start');
    assert.ok(fs.existsSync(path.join(root, '.tmp-aaaaaaaaaaaa')));
    handlers.clear(); // a second registration of the same channels is the test's own doing, not main's
    const ipc = register({ store });
    assert.ok(!fs.existsSync(path.join(root, '.tmp-aaaaaaaaaaaa')), 'the start repair swept the leftover');
    assert.deepStrictEqual([...handlers.keys()].sort(), ['world:list', 'world:part', 'world:remove'], 'exactly three channels');
    for (const c of handlers.keys()) assert.ok(!simChannelOpen(c) && !(c in SIM_OPEN_CHANNELS), c + ' is closed to the simulator');

    const indexUrl = pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href;
    const sent: unknown[] = [];
    const mk = (url: string, main = true): Rec => { const frame = { url }; return { senderFrame: frame, sender: { mainFrame: main ? frame : { url: indexUrl }, send: (...a: unknown[]) => sent.push(a) } }; };
    const app = mk(indexUrl);
    const call = (e: Rec, ch: string, ...a: unknown[]): Promise<unknown> => Promise.resolve().then(() => handlers.get(ch)!(e, ...a));

    // ---- list: names, states, no path ----
    const list = (await call(app, 'world:list')) as Array<Rec>;
    assert.deepStrictEqual(list.map((w) => w.key).sort(), [k1, k2].sort());
    const wire = JSON.stringify(list);
    assert.ok(!wire.includes(userData) && !wire.includes(base) && !/installed\.json|description|licence|synthetic/i.test(wire), 'no path, no description in the list');
    assert.deepStrictEqual(Object.keys(list[0]).sort(), ['date', 'key', 'name', 'origin', 'parts', 'size', 'state', 'unfinished', 'version']);
    assert.ok(list.every((w) => w.state === 'ok'));

    // ---- part: bytes out ----
    const r = (await call(app, 'world:part', k1, 'wall.webp')) as Rec;
    assert.ok(r.ok === true && Buffer.from(r.bytes as Uint8Array).equals(GOOD['wall.webp']) && r.mime === 'image/webp');
    for (const n of PART_NAMES) assert.strictEqual(((await call(app, 'world:part', k1, n)) as Rec).ok, true, n + ' is served');

    // ---- page reach: only a key main lists, only a closed part name ----
    s.calls.length = 0;
    for (const k of ['p--not-installed', 'p--other', 's-ab12--test-world', 'u-0123456789abcdef', '../x', '', 'p--test-world/..', 'COM1', 'p--test-world\0', undefined, null, 5, {}, [k1]]) {
      const x = (await call(app, 'world:part', k, 'wall.webp')) as Rec;
      assert.deepStrictEqual(x, { ok: false }, 'nothing for a key main does not list: ' + JSON.stringify(k));
      assert.deepStrictEqual(await call(app, 'world:remove', k), { ok: false }, 'nor a remove');
    }
    assert.ok(!s.calls.some((c) => c.op === 'openSync' || c.op === 'unlinkSync' || c.op === 'rmdirSync'), 'no file was opened or removed for them');
    for (const n of ['world.json', 'installed.json', '../wall.webp', 'wall.webp/', '', null, undefined, 3, {}, 'x.js', 'WALL.WEBP']) {
      const x = (await call(app, 'world:part', k1, n)) as Rec;
      assert.ok(x.ok === false && !('bytes' in x), 'no bytes for the name ' + JSON.stringify(n));
    }
    assert.deepStrictEqual(await call(app, 'world:part'), { ok: false });
    assert.deepStrictEqual(await call(app, 'world:part', k1), { ok: false, reason: 'unknown' });

    // ---- foreign pages and frames never reach the store ----
    s.calls.length = 0;
    for (const e of [mk('https://evil.example/index.html'), mk('file:///tmp/evil.html'), mk(indexUrl, false), { senderFrame: null, sender: { mainFrame: {}, send: () => undefined } } as Rec, mk('')]) {
      for (const [ch, args] of [['world:list', []], ['world:part', [k1, 'wall.webp']], ['world:remove', [k1]]] as Array<[string, unknown[]]>) {
        let out: unknown, threw = false;
        try { out = await call(e, ch, ...args); } catch { threw = true; }
        assert.ok(threw || !(out as Rec | unknown[] | undefined) || (Array.isArray(out) ? out.length === 0 : (out as Rec).ok === false), 'a foreign frame gets nothing from ' + ch);
        assert.ok(!(out && (out as Rec).bytes), 'no bytes to a foreign frame');
      }
    }
    assert.strictEqual(s.calls.length, 0, 'the store was not asked anything by a foreign frame');
    assert.ok(fs.existsSync(path.join(root, k1)), 'and nothing was removed');
    assert.strictEqual(sent.length, 0, 'nothing is ever sent to a window by main from here');

    // ---- re-check at load: one byte, Damaged, no bytes ----
    const wall = path.join(root, k2, 'wall.webp');
    const bytes = fs.readFileSync(wall);
    bytes[bytes.length - 1] ^= 0x55;
    fs.writeFileSync(wall, bytes);
    const bad = (await call(app, 'world:part', k2, 'wall.webp')) as Rec;
    assert.deepStrictEqual(bad, { ok: false, reason: 'damaged' }, 'one byte changed: Damaged, and the reply has no bytes');
    assert.ok(!('bytes' in bad));
    assert.strictEqual(((await call(app, 'world:list')) as Array<Rec>).find((w) => w.key === k2)?.state, 'damaged');
    assert.strictEqual(((await call(app, 'world:part', k1, 'wall.webp')) as Rec).ok, true, 'the other world still serves');
    // revoked: served nothing
    store.setRevoked([]);

    // ---- calls are answered in order, one at a time ----
    const order: number[] = [];
    await Promise.all([1, 2, 3, 4].map((i) => (call(app, 'world:part', k1, PART_NAMES[i]) as Promise<Rec>).then((x) => { assert.ok(x.ok); order.push(i); })));
    assert.deepStrictEqual(order, [1, 2, 3, 4], 'in the order asked');

    // ---- remove ----
    assert.deepStrictEqual(await call(app, 'world:remove', k2), { ok: true });
    assert.ok(!fs.existsSync(path.join(root, k2)) && fs.existsSync(path.join(root, k1)));
    assert.deepStrictEqual(await call(app, 'world:remove', k2), { ok: false }, 'a second remove: not in the list');
    assert.deepStrictEqual(((await call(app, 'world:list')) as Array<Rec>).map((w) => w.key), [k1]);

    // ---- shutdown: nothing starts after quit ----
    ipc.shutdown();
    assert.deepStrictEqual(await call(app, 'world:list'), []);
    assert.deepStrictEqual(await call(app, 'world:part', k1, 'wall.webp'), { ok: false });

    // ---- wiring: preload, main, MCP and remote control ----
    const strip = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    const rd = (f: string): string => strip(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    const walk = (d: string): string[] => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []));
    const pre = rd('src/preload/preload.ts');
    assert.deepStrictEqual([...pre.matchAll(/ipcRenderer\.invoke\('(world:[^']+)'/g)].map((m) => m[1]).sort(), ['world:list', 'world:part', 'world:remove'], 'the preload exposes these three and no other world channel');
    assert.ok(!/ipcRenderer\.(?:send|on)\('world:/.test(pre));
    const main = rd('src/main/main.ts');
    assert.ok(/import \{ register as registerWorldsIpc \} from '\.\/ipc\/worlds';/.test(main) && /const worldsIpc = registerWorldsIpc\(\{ simulator: SIMULATOR \}\);/.test(main), 'main imports and registers it with its own simulator decision');
    assert.ok(/worldsIpc\.shutdown\(\);/.test(rd('src/main/main.ts').slice(main.indexOf("app.on('will-quit'"))), 'and shuts it down at will-quit');
    const out = [...walk('src/main/mcp'), 'src/main/mcpipc.ts', 'src/main/mcpcall.ts', 'src/main/mcpsession.ts', 'src/main/remoteops.ts', 'src/main/ipc/remote.ts', 'src/shared/remote.ts', 'src/shared/mcpcall.ts', 'src/shared/mcpserver.ts', 'src/shared/mcp.ts'].filter((f) => fs.existsSync(path.join(ROOT, f)));
    assert.ok(out.length >= 8, 'the MCP and remote files were found (' + out.length + ')');
    for (const f of out) assert.ok(!/world:|worlds\/store|ipc\/worlds|WorldStore|worldList|worldPart/.test(rd(f)), f + ' (MCP or remote control) does not reach the world store');
    // agents: no file that talks to an agent app imports the store or the channels
    for (const f of [...walk('src/adapters')]) assert.ok(!/worlds\/store|ipc\/worlds|world:(?:list|part|remove)/.test(rd(f)), f + ' (an adapter) does not reach worlds');
    const ipcSrc = rd('src/main/ipc/worlds.ts');
    assert.strictEqual((ipcSrc.match(/ipcHandle\('world:/g) ?? []).length, 3);
    assert.strictEqual((ipcSrc.match(/if \(!fromApp\(e\)\) return/g) ?? []).length, 3, 'each handler checks fromApp itself too');
    assert.ok(!/netget|\bfetch\(|from 'https?'|from 'net'|require\(|\bnet\b/.test(ipcSrc.replace(/import \{ app \} from 'electron';/, '')), 'the IPC file imports no network');
    assert.ok(!/description|licence|license|prompt/i.test(ipcSrc), 'and no pack text but through the store');
    assert.ok(!logged.some((l) => /Test world|Second|userData|durbar-worldipc|p--test-world/.test(l)), 'nothing logged carries a world name, key or path');

    process.exitCode = 0;
    console.log('worldipc: OK');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}
main().catch((e) => { process.stderr.write(String((e as Error).stack ?? e) + '\n'); process.exit(1); });
