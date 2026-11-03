/**
 * Spec 058 FR-198 (review on PR 1073, item 6): the wiring of the command check, by behaviour. `mcp:globalState` is registered on a
 * stand-in for the electron module (as test-orgwiring.ts does) and called as the window calls it: a check that adds the flag reaches the
 * window; a check that throws leaves the lists as read (the lookup never hides them); without a check the state is the lists' own.
 * main.ts starts Electron and cannot run here: the line that hands the check to the registration is pinned by its text.
 * Part of `npm run test:mcphealth`. Fakes only.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { GlobalState } from '../src/shared/api';

async function main(): Promise<void> {
  const electronPath = require.resolve('electron');
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const fake = { ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(ch, fn), on: () => undefined } };
  const saved = require.cache[electronPath];
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { register } = require('../src/main/ipc/mcpglobal') as typeof import('../src/main/ipc/mcpglobal');
    const frame = { url: pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href };
    const win = { senderFrame: frame, sender: { mainFrame: frame } };
    const state = (): GlobalState => ({ ok: true, apps: [{ app: 'claude', label: 'Claude Code', file: '~/.claude.json', found: true, off: [], servers: [{ name: 'pw', transport: 'stdio', command: 'gone', envKeys: [], headerKeys: [] }] }] });
    const lists = { state } as unknown as import('../src/main/mcpglobalio').GlobalLists;
    let check: ((s: GlobalState) => Promise<GlobalState>) | undefined;
    register({ lists: () => lists, offList: () => [], setOff: () => undefined, check: (s) => (check ? check(s) : Promise.resolve(s)) });
    const call = () => Promise.resolve(handlers.get('mcp:globalState')!(win)) as Promise<GlobalState>;
    let seen: GlobalState | undefined;
    check = async (s) => { seen = s; return { ...s, apps: s.apps.map((a) => ({ ...a, servers: a.servers.map((v) => ({ ...v, missing: true })) })) }; };
    const r1 = await call();
    assert.strictEqual(r1.apps[0].servers[0].missing, true, 'the check\'s flag reaches the window');
    assert.ok(seen && seen.apps[0].servers[0].name === 'pw', 'the check gets the lists as read');
    check = async () => { throw new Error('lookup failed'); };
    const r2 = await call();
    assert.deepStrictEqual(r2, state(), 'a check that throws leaves the lists as read');
    handlers.clear();
    register({ lists: () => lists, offList: () => [], setOff: () => undefined });
    assert.deepStrictEqual(await call(), state(), 'without a check: the lists as read');
  } finally {
    if (saved) require.cache[electronPath] = saved; else delete require.cache[electronPath];
  }
  // main.ts hands the check to the registration (pinned by its text)
  const mainSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'), 'utf8').replace(/\r/g, '');
  const reg = mainSrc.slice(mainSrc.indexOf('registerMcpGlobalIpc({'), mainSrc.indexOf('registerMcpGlobalIpc({') + 600);
  assert.ok(/check: async \(s\) => \{\n\s+await loginPathReady\(\);\n\s+return mcpMissing\(s\);/.test(reg), 'main.ts: registerMcpGlobalIpc gets the check (login PATH first, then the async checker)');
  assert.ok(/const mcpMissing = missingChecker\(nodeDetectEnv, \(dir\) => fs\.promises\.readdir\(dir, \{ withFileTypes: true \}\)/.test(mainSrc), 'main.ts: the checker reads folders with the async readdir');
  console.log('[058] mcp globalState wiring: PASS');
}
main().catch((e) => { console.error(e); process.exit(1); });
