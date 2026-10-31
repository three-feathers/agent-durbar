/**
 * Spec 100: main's handlers by behaviour: `agents:mcpContext`, `mcp:costs`, `settings:setMcpWarnLevels`, `settings:get` and the `mcp-context` push. The
 * channels are registered on a stand-in for the electron module and called as the window would call them, with the real McpStore, McpCostStore and
 * SettingsStore in a scratch folder. Also: figures never touch a server store that failed to load (the original bytes survive). main.ts cannot
 * run here: the lines that hand the dependencies over are pinned by their text. No agent app, no network, no credits. `npm run test:mcpcontextipc`.
 */
process.exitCode = 1;
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { AgentEvent, McpServerStatus } from '../src/adapters/types';
import type { McpContextView } from '../src/shared/api';
import type { McpContextReport } from '../src/shared/mcpcost';

const tick = async (): Promise<void> => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

async function main(): Promise<void> {
  const electronPath = require.resolve('electron');
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const fake = {
    ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(ch, fn), on: () => undefined },
    app: { getVersion: () => '0.0.0', getPath: () => os.tmpdir() },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  };
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-100-ipc-')));
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
    const { registerMcpIpc } = require('../src/main/mcpipc') as typeof import('../src/main/mcpipc');
    const { McpStore } = require('../src/main/mcpstore') as typeof import('../src/main/mcpstore');
    const { McpCostStore } = require('../src/main/mcpcosts') as typeof import('../src/main/mcpcosts');
    const settingsIpc = require('../src/main/ipc/settings') as typeof import('../src/main/ipc/settings');
    const { SettingsStore } = require('../src/main/settings') as typeof import('../src/main/settings');
    /* eslint-enable @typescript-eslint/no-require-imports */

    const indexUrl = pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href;
    const frame = { url: indexUrl };
    const win = { senderFrame: frame, sender: { mainFrame: frame } };
    const call = (ch: string, ...a: unknown[]) => Promise.resolve(handlers.get(ch)!(win, ...a)) as Promise<Record<string, unknown>>;

    // one registered world: the store file, the costs file and what the adapter answers can each be set
    const ID = 'a1';
    let listeners: ((e: AgentEvent) => void)[] = [];
    let answer: unknown = { servers: [{ name: 'github', tokens: 41_000, tools: 3, source: 'reported', description: 'tool text' }], window: 200_000 } satisfies McpContextReport & { servers: unknown[] };
    let asks = 0;
    const pushed: { id: string; view: McpContextView }[] = [];
    const storeFile = path.join(root, 'durbar-mcp.json');
    const costsFile = path.join(root, 'durbar-mcp-costs.json');
    const store = new McpStore(storeFile);
    let costs: InstanceType<typeof McpCostStore> | undefined = new McpCostStore(costsFile);
    let global: Partial<Record<'copilot' | 'claude' | 'codex', string[]>> = {};
    registerMcpIpc({
      store: () => store,
      agents: new Map([[ID, { id: ID, cwd: root } as never]]),
      router: { onEvent: (fn: (e: AgentEvent) => void) => { listeners.push(fn); return () => undefined; }, forAgent: (id: string) => (id === ID ? { isLive: () => true, mcpContext: async () => { asks++; return answer; } } : undefined) } as never,
      dev: { DURBAR_COPILOT_DIR: path.join(root, 'no-copilot') } as never,
      appOf: () => 'copilot',
      globalNames: () => global,
      pushContext: (id, view) => pushed.push({ id, view }),
      costs: () => costs,
    });
    const emit = (e: Record<string, unknown>): void => listeners.forEach((l) => l({ sessionId: ID, timestamp: 1, ...e } as unknown as AgentEvent));
    const servers = (...names: string[]): McpServerStatus[] => names.map((name) => ({ name, status: 'connected' }));

    // ---- the handlers and the push ----
    store.load();
    assert.deepStrictEqual(await call('agents:mcpContext', 'nope'), { ok: false, supported: false }, 'an unknown agent');
    assert.deepStrictEqual(await call('agents:mcpContext', ID), { ok: true, supported: true }, 'no report yet: and nothing asked');
    assert.strictEqual(asks, 0);
    emit({ type: 'mcp', servers: servers('github') });
    await tick();
    assert.strictEqual(asks, 1, 'the first running servers ask');
    assert.strictEqual(pushed.length, 1, 'the push');
    assert.strictEqual(pushed[0].id, ID);
    assert.deepStrictEqual(pushed[0].view.report, { servers: [{ name: 'github', source: 'reported', tokens: 41_000, tools: 3 }], window: 200_000 }, 'only names and numbers: not the tool text');
    const got = await call('agents:mcpContext', ID);
    assert.deepStrictEqual(got.report, pushed[0].view.report, 'the handler gives the same');
    assert.strictEqual(asks, 1, 'a plain read asks nothing');
    await call('agents:mcpContext', ID, true);
    assert.strictEqual(asks, 1, 'an open within the minute asks nothing');
    const c1 = await call('mcp:costs');
    assert.strictEqual(c1.ok, true);
    assert.strictEqual((c1.costs as Record<string, Record<string, { tokens: number }>>).copilot.github.tokens, 41_000, 'the handler shows the kept figure');
    assert.ok(!fs.readFileSync(costsFile, 'utf8').includes('tool text'), 'names and numbers only on disk');
    assert.ok(!fs.existsSync(storeFile), 'the figure did not create or touch the server store');
    emit({ type: 'status', status: 'stopped' });
    assert.deepStrictEqual(pushed.at(-1)?.view, { ok: true, supported: true }, 'the session ended: the window forgets it');

    // ---- finding 1: a store that failed to load keeps its bytes, whatever figures arrive ----
    const VAULT = '"vault":"ENCRYPTED-BLOB"';
    const truncated = `{"version":3,"folders":{"/w":[{"name":"keep","transport":"stdio","command":"x","env":[{"key":"T","ref":"r1"}]}]},${VAULT},"disabledAmbient":["a"`;
    const oversize = `{"version":3,"folders":{},${VAULT},"pad":"${'p'.repeat(2.2 * 1024 * 1024)}"}`;
    for (const [what, bytes] of [['truncated', truncated], ['oversize', oversize]] as const) {
      fs.writeFileSync(storeFile, bytes);
      store.load();
      asks = 0;
      emit({ type: 'status', status: 'stopped' });
      emit({ type: 'mcp', servers: servers('github') });
      await tick();
      emit({ type: 'mcp', servers: servers('github', 'other') });
      await tick();
      assert.ok(asks >= 1, `${what}: a report with figures came`);
      await call('mcp:costs');
      assert.strictEqual(fs.readFileSync(storeFile, 'utf8'), bytes, `${what}: the original bytes survive`);
    }
    fs.rmSync(storeFile);
    store.load();

    // ---- finding 10: a removed server's figure goes at the next read; a server still listed stays ----
    costs = new McpCostStore(costsFile);
    costs.load();
    costs.set('copilot', [{ name: 'gone', tokens: 5, source: 'reported' }, { name: 'stays', tokens: 6, source: 'reported' }], 2);
    costs.set('codex', [{ name: 'cx', tokens: 7, source: 'estimated', capped: true }], 3);
    global = { copilot: ['stays'] };
    const c2 = (await call('mcp:costs')).costs as Record<string, Record<string, unknown>>;
    assert.ok(!('gone' in c2.copilot) && 'stays' in c2.copilot, `pruned: ${JSON.stringify(c2)}`);
    assert.deepStrictEqual(c2.codex.cx, { tokens: 7, source: 'estimated', capped: true, at: 3 }, 'an app with no list keeps its figures, capped too');
    costs = undefined;
    assert.deepStrictEqual(await call('mcp:costs'), { ok: false, costs: {} }, 'no costs store: says so');
    emit({ type: 'status', status: 'stopped' });
    answer = null;
    emit({ type: 'mcp', servers: servers('github') });
    await tick();
    assert.deepStrictEqual(pushed.at(-1)?.view.report?.servers, [{ name: 'github', source: 'unknown' }], 'an adapter answering null: no figures, nothing thrown');

    // ---- the levels: the handler, the store, the file, the reload ----
    const settingsFile = path.join(root, 'durbar-settings.json');
    let settings: InstanceType<typeof SettingsStore> | undefined = new SettingsStore(settingsFile);
    settings.load();
    settingsIpc.register({ getSettingsStore: () => settings, getRunTheme: () => undefined, clearRunTheme: () => undefined });
    const DEF = { warn: 15, strong: 30, off: false };
    assert.deepStrictEqual(settings.mcpWarnLevels, DEF, 'the defaults');
    assert.deepStrictEqual((await call('settings:get')).mcpWarnLevels, DEF);
    assert.deepStrictEqual(await call('settings:setMcpWarnLevels', { warn: 5, strong: 90, off: true }), { ok: true, levels: { warn: 5, strong: 90, off: true } });
    assert.deepStrictEqual((await call('settings:get')).mcpWarnLevels, { warn: 5, strong: 90, off: true });
    const again = new SettingsStore(settingsFile);
    again.load();
    assert.deepStrictEqual(again.mcpWarnLevels, { warn: 5, strong: 90, off: true }, 'kept across a restart');
    for (const bad of [{ warn: 4, strong: 30 }, { warn: 30, strong: 30 }, { warn: 15, strong: 91 }, { warn: 15.5, strong: 30 }, 'x', null]) {
      assert.deepStrictEqual(await call('settings:setMcpWarnLevels', bad), { ok: false, levels: { warn: 5, strong: 90, off: true } }, `refused and said so: ${JSON.stringify(bad)}`);
    }
    assert.deepStrictEqual(settings.setMcpWarnLevels({ warn: 40, strong: 30 }), { ok: false, levels: { warn: 5, strong: 90, off: true } }, 'the store keeps its value on a refusal');
    // a bad value on disk: the defaults
    const doc = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    fs.writeFileSync(settingsFile, JSON.stringify({ ...doc, mcpWarnLevels: { warn: 99, strong: 1 } }));
    const odd = new SettingsStore(settingsFile);
    odd.load();
    assert.deepStrictEqual(odd.mcpWarnLevels, DEF, 'a bad file value falls back');
    // the disk refuses: not "Saved"
    const blocked = new SettingsStore(path.join(root, 'settings.json', 'nope'));
    fs.writeFileSync(path.join(root, 'settings.json'), 'a file where a folder is needed');
    settings = blocked;
    const refused = await call('settings:setMcpWarnLevels', { warn: 10, strong: 20 });
    assert.strictEqual(refused.ok, false, 'a write that fails says so');
    assert.deepStrictEqual(blocked.mcpWarnLevels, DEF, 'and the value did not change for this run either');
    settings = undefined;
    assert.deepStrictEqual(await call('settings:setMcpWarnLevels', { warn: 10, strong: 20 }), { ok: false, levels: DEF }, 'no store: not ok');

    // main.ts hands over what the handlers need: pinned by text, since it cannot run here
    const mainSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'), 'utf8');
    assert.ok(mainSrc.includes("pushContext: (id, view) => toRenderer('mcp-context', { id, view })"), 'main pushes to the window');
    assert.ok(mainSrc.includes('costs: () => mcpCostStore'), 'main hands over the costs store');
    assert.ok(/new McpCostStore\(path\.join\(app\.getPath\('userData'\), 'durbar-mcp-costs\.json'\)\)/.test(mainSrc), 'in a file of its own');
    const preload = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'preload', 'preload.ts'), 'utf8');
    assert.ok(preload.includes("onMcpContext: (cb) => sub('mcp-context', cb)"), 'the preload listens on the same channel');

    console.log('test:mcpcontextipc OK');
    process.exitCode = 0;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
void main().catch((e) => { console.error(e); process.exitCode = 1; });
