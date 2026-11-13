/**
 * Spec 058 FR-233..FR-238, FR-240 (issue #1667, T217): the Copilot sign-in app setting. The stored value and its check, the settings IPC
 * (save, then hand to the adapter, then reconnect), the client option the Copilot adapter starts with (fake client: no runtime, no
 * account, no credits), the masks (no ID in any log, error or copied text) and the "app refused" words. `npm run test:signinapp`.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { SIGN_IN_APP_ID_MASK, SIGN_IN_APP_REFUSED, effectiveSignInApp, maskSignInAppId, parseClientId, parseSignInApp, sameSignInApp, signInAppLogLabel } from '../src/shared/signinapp';
import type { SignInAppChoice } from '../src/shared/signinapp';
import { parseSettings } from '../src/shared/credits';
import { SettingsStore } from '../src/main/settings';
import { CopilotAdapter, VSCODE_ENTRA_CLIENT_ID, copilotEntraOption } from '../src/adapters/copilot';
import { FakeClient } from './fakes/copilot-sdk';
import { MCP_ERROR_MAX_CHARS, maskMcpError, maskMcpEvent, maskMcpStatuses, maskMcpText, maskSignInAppText, setSignInAppMaskId } from '../src/main/mcpmask';
import { classifyMcpCall, isSignInAppRefusal, mcpFailureVerdict, signInAppRefusalText } from '../src/shared/mcpcall';
import { refreshAdapterAuth } from '../src/main/remoteops';
import type { AgentAdapter, AgentEvent } from '../src/adapters/types';
import { tmpDir } from './test-tmp';

const CUSTOM = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const CUSTOM_UP = CUSTOM.toUpperCase();
/** The one unlabeled ID of runtime 1.0.32 (spec 058 FR-234): never hard-coded as Copilot CLI's app. Split so this file does not match itself. */
const UNLABELED = ['5ecc71bb', '0fa6', '4d6b', 'a31b', 'de12184c4b1a'].join('-');
const SECRETISH = 'Xy7~Q8a.Lm3_Zp9-Rt2Vb5Nc1Kd4Wf6Hg0Js8Ee'; // 40 characters, shaped like an Entra client secret
const noGuid = (s: string, what: string): void => {
  for (const id of [CUSTOM, CUSTOM_UP, VSCODE_ENTRA_CLIENT_ID]) assert.ok(!s.toLowerCase().includes(id.toLowerCase()), `FR-236: ${what} holds no sign-in app ID (${s.slice(0, 160)})`);
};

/** A Copilot adapter whose `newClient` records the options and hands back a fake client (as `test-copilot-tmpdir` does). */
class OptsCopilot extends CopilotAdapter {
  opts: Record<string, unknown>[] = [];
  clients: FakeClient[] = [];
  /** FR-237 test: while set, `newClient` waits for it (a slow reconnect whose client already took its options). */
  hold: Promise<void> | undefined;
  protected async newClient(o: Record<string, unknown>): Promise<never> {
    this.opts.push(o);
    if (this.hold) await this.hold;
    const c = new FakeClient();
    this.clients.push(c);
    return c as never;
  }
  client$(): Promise<unknown> {
    return (this as unknown as { getClient(): Promise<unknown> }).getClient();
  }
}

async function main(): Promise<void> {
  process.exitCode = 1;

  // ---- FR-235: the ID check ----
  assert.strictEqual(parseClientId(CUSTOM), CUSTOM);
  assert.strictEqual(parseClientId(CUSTOM_UP), CUSTOM, 'FR-235 lower-cased: upper case is stored lower case');
  assert.strictEqual(parseClientId(`  ${CUSTOM}\n`), CUSTOM, 'FR-235 trim: a padded ID ("  <id>\\n") is accepted and stored trimmed');
  assert.strictEqual(parseClientId(`\t${CUSTOM}\r\n`), CUSTOM, 'FR-235 trim: tabs and line breaks');
  assert.strictEqual(parseClientId(`\u00a0${CUSTOM}`), undefined, 'FR-235 trim: only spaces, tabs and line breaks (not NBSP)');
  const refused: [string, unknown][] = [
    ['zero GUID', '00000000-0000-0000-0000-000000000000'],
    ['braces', `{${CUSTOM}}`],
    ['urn', `urn:uuid:${CUSTOM}`],
    ['inner space', CUSTOM.replace('-', ' -')],
    ['32 bare hex digits', CUSTOM.replace(/-/g, '')],
    ['one more digit', CUSTOM + '0'],
    ['one digit short', CUSTOM.slice(1)],
    ['not hex', CUSTOM.replace('f', 'g')],
    ['a secret', SECRETISH],
    ['empty', ''],
    ['a number', 5],
    ['null', null],
    ['very long', CUSTOM + ' '.repeat(100_000)],
  ];
  for (const [what, v] of refused) assert.strictEqual(parseClientId(v), undefined, `FR-235 check: ${what} is refused`);

  // ---- FR-233: the stored shape ----
  assert.deepStrictEqual(parseSignInApp({ mode: 'vscode' }), { mode: 'vscode' });
  assert.deepStrictEqual(parseSignInApp({ mode: 'off' }), { mode: 'off' }, 'an explicit Off is stored');
  assert.deepStrictEqual(parseSignInApp({ mode: 'copilot-cli' }), { mode: 'copilot-cli' }, 'FR-234: copilot-cli is stored and kept (no migration later)');
  assert.deepStrictEqual(parseSignInApp({ mode: 'custom', clientId: CUSTOM_UP }), { mode: 'custom', clientId: CUSTOM }, 'FR-235 lower-cased in the stored value');
  for (const [what, v] of [['missing', undefined], ['null', null], ['a string', 'vscode'], ['an array', [{ mode: 'vscode' }]], ['unknown mode', { mode: 'cli' }], ['custom without an ID', { mode: 'custom' }], ['custom with a bad ID', { mode: 'custom', clientId: SECRETISH }], ['custom with the zero GUID', { mode: 'custom', clientId: '00000000-0000-0000-0000-000000000000' }], ['an ID on vscode', { mode: 'vscode', clientId: CUSTOM }], ['an ID on copilot-cli', { mode: 'copilot-cli', clientId: CUSTOM }], ['extra keys', { mode: 'vscode', matsAppName: 'x' }], ['inherited mode', Object.create({ mode: 'vscode' })]] as [string, unknown][]) {
    assert.strictEqual(parseSignInApp(v), undefined, `FR-233: ${what} is not a stored value`);
    assert.deepStrictEqual(effectiveSignInApp(v), { mode: 'vscode' }, `owner default 2026-11-13: ${what} reads as VS Code's app`);
  }
  assert.deepStrictEqual(effectiveSignInApp({ mode: 'copilot-cli' }), { mode: 'vscode' }, 'FR-234 pending Q25: copilot-cli reads as the default');
  assert.deepStrictEqual(effectiveSignInApp({ mode: 'off' }), { mode: 'off' }, 'FR-233: an explicit Off stays Off (not the default)');
  assert.deepStrictEqual(effectiveSignInApp({ mode: 'custom', clientId: CUSTOM }), { mode: 'custom', clientId: CUSTOM });
  assert.ok(sameSignInApp(undefined, undefined) && sameSignInApp({ mode: 'custom', clientId: CUSTOM }, { mode: 'custom', clientId: CUSTOM }));
  assert.ok(sameSignInApp(undefined, { mode: 'vscode' }) && sameSignInApp({ mode: 'copilot-cli' }, { mode: 'vscode' }), 'the same app in force');
  assert.ok(!sameSignInApp(undefined, { mode: 'off' }) && !sameSignInApp({ mode: 'custom', clientId: CUSTOM }, { mode: 'custom', clientId: VSCODE_ENTRA_CLIENT_ID }));
  assert.deepStrictEqual([undefined, { mode: 'off' }, { mode: 'vscode' }, { mode: 'copilot-cli' }, { mode: 'custom', clientId: CUSTOM }].map((c) => signInAppLogLabel(c as SignInAppChoice | undefined)), ['vscode (default)', 'off', 'vscode', 'vscode (copilot-cli is not available in this build)', 'custom (set)']);

  // parseSettings keeps it only when valid; missing = off (FR-233 default)
  assert.strictEqual(parseSettings('{}').copilotSignInApp, undefined, 'FR-233: nothing stored');
  assert.deepStrictEqual(parseSettings(JSON.stringify({ copilotSignInApp: { mode: 'off' } })).copilotSignInApp, { mode: 'off' }, 'an explicit Off survives a load');
  assert.deepStrictEqual(parseSettings(JSON.stringify({ copilotSignInApp: { mode: 'custom', clientId: CUSTOM_UP } })).copilotSignInApp, { mode: 'custom', clientId: CUSTOM });
  for (const bad of [null, 'vscode', 7, { mode: 'custom' }, { mode: 'vscode', clientId: CUSTOM }]) assert.ok(!('copilotSignInApp' in parseSettings(JSON.stringify({ copilotSignInApp: bad }))), `parseSettings drops ${JSON.stringify(bad)}`);

  // ---- SettingsStore: set, off, refused, failed save ----
  const dir = tmpDir('durbar-signinapp-');
  {
    const file = path.join(dir, 'durbar-settings.json');
    const st = new SettingsStore(file);
    st.load();
    assert.strictEqual(st.copilotSignInApp, undefined);
    assert.deepStrictEqual(st.setCopilotSignInApp({ mode: 'custom', clientId: CUSTOM_UP }), { ok: true, value: { mode: 'custom', clientId: CUSTOM } });
    const again = new SettingsStore(file);
    again.load();
    assert.deepStrictEqual(again.copilotSignInApp, { mode: 'custom', clientId: CUSTOM }, 'on disk, lower case');
    const r = st.setCopilotSignInApp({ mode: 'custom', clientId: SECRETISH });
    assert.deepStrictEqual(r, { ok: false, value: { mode: 'custom', clientId: CUSTOM } }, 'a refused value keeps the one in force');
    assert.ok(!fs.readFileSync(file, 'utf8').includes(SECRETISH), 'FR-235: a refused value is not stored');
    assert.deepStrictEqual(st.setCopilotSignInApp(null), { ok: true, value: undefined }, 'null: back to the default');
    assert.ok(!('copilotSignInApp' in JSON.parse(fs.readFileSync(file, 'utf8'))), 'the default is not written');
    assert.deepStrictEqual(st.setCopilotSignInApp({ mode: 'off' }), { ok: true, value: { mode: 'off' } });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).copilotSignInApp, { mode: 'off' }, 'an explicit Off is written');
    assert.strictEqual(st.setCopilotSignInApp(undefined).ok, false, 'undefined is refused (only null clears)');
    fs.writeFileSync(path.join(dir, 'blocker'), 'x');
    const bad = new SettingsStore(path.join(dir, 'blocker', 'durbar-settings.json'));
    bad.load();
    assert.deepStrictEqual(bad.setCopilotSignInApp({ mode: 'vscode' }), { ok: false, value: undefined }, 'issue #1023: a failed save keeps the old value');
  }

  // ---- FR-237: the settings IPC on a stand-in electron with a real store ----
  {
    const electronPath = require.resolve('electron');
    const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
    const fake = { ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(ch, fn), on: () => undefined }, app: { getVersion: () => '0.0.0-test' } };
    const saved = require.cache[electronPath];
    require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { register } = require('../src/main/ipc/settings') as typeof import('../src/main/ipc/settings');
      const frame = { url: require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href };
      const win = { senderFrame: frame, sender: { mainFrame: frame } };
      const call = async (ch: string, ...a: unknown[]): Promise<Record<string, unknown>> => (await handlers.get(ch)!(win, ...a)) as Record<string, unknown>;
      const steps: string[] = [];
      const setup = (store: SettingsStore | undefined): void => {
        handlers.clear();
        steps.length = 0;
        register({
          getSettingsStore: () => store, getRunTheme: () => undefined, clearRunTheme: () => undefined,
          signInApp: {
            hand: (c) => steps.push(`hand:${store?.copilotSignInApp?.mode === c?.mode ? 'saved' : 'unsaved'}:${signInAppLogLabel(c)}`),
            reconnect: async () => { steps.push('reconnect'); },
          },
        });
      };
      const st = new SettingsStore(path.join(dir, 'ipc', 'durbar-settings.json'));
      st.load();
      setup(st);
      assert.strictEqual((await call('settings:get')).copilotSignInApp, undefined, 'settings:get: nothing stored (the default)');
      assert.deepStrictEqual(await call('settings:setCopilotSignInApp', { mode: 'vscode' }), { ok: true, copilotSignInApp: { mode: 'vscode' } });
      assert.deepStrictEqual(steps, [], 'FR-237: VS Code chosen while it is the default: the same app, no restart');
      assert.deepStrictEqual(await call('settings:setCopilotSignInApp', { mode: 'off' }), { ok: true, copilotSignInApp: { mode: 'off' } });
      assert.deepStrictEqual(steps, ['hand:saved:off', 'reconnect'], 'FR-237: saved, then handed to the adapter, then reconnected (once)');
      steps.length = 0;
      assert.deepStrictEqual(await call('settings:setCopilotSignInApp', { mode: 'off' }), { ok: true, copilotSignInApp: { mode: 'off' } });
      assert.deepStrictEqual(steps, [], 'FR-237: the same value again restarts nothing');
      const fileOf = path.join(dir, 'ipc', 'durbar-settings.json');
      const onDisk = fs.readFileSync(fileOf, 'utf8');
      const mtime = fs.statSync(fileOf).mtimeMs;
      const r = await call('settings:setCopilotSignInApp', { mode: 'custom', clientId: SECRETISH });
      assert.strictEqual(fs.readFileSync(fileOf, 'utf8'), onDisk, 'FR-235 handler check: a bad ID through IPC stores nothing');
      assert.strictEqual(fs.statSync(fileOf).mtimeMs, mtime, 'FR-235 handler check: the settings file is not written');
      assert.deepStrictEqual(st.copilotSignInApp, { mode: 'off' }, 'FR-235 handler check: the stored value is unchanged');
      assert.deepStrictEqual(r, { ok: false, error: SIGN_IN_APP_REFUSED, copilotSignInApp: { mode: 'off' } }, 'FR-235: the fixed text and the value in force');
      assert.ok(!JSON.stringify(r).includes(SECRETISH), 'FR-235 not echoed: the refused value is not in the reply');
      assert.deepStrictEqual(steps, [], 'a refused value restarts nothing');
      assert.strictEqual((await call('settings:setCopilotSignInApp', 'vscode')).ok, false, 'main checks again: a bare string is refused');
      assert.strictEqual((await call('settings:setCopilotSignInApp', { mode: 'cli' })).ok, false);
      assert.strictEqual((await call('settings:setCopilotSignInApp', undefined)).ok, false);
      assert.deepStrictEqual(steps, []);
      assert.deepStrictEqual(await call('settings:setCopilotSignInApp', { mode: 'custom', clientId: CUSTOM_UP }), { ok: true, copilotSignInApp: { mode: 'custom', clientId: CUSTOM } });
      assert.deepStrictEqual(steps, ['hand:saved:custom (set)', 'reconnect']);
      assert.deepStrictEqual((await call('settings:get')).copilotSignInApp, { mode: 'custom', clientId: CUSTOM }, 'settings:get: the custom ID for its own field (FR-236)');
      steps.length = 0;
      assert.deepStrictEqual(await call('settings:setCopilotSignInApp', null), { ok: true, copilotSignInApp: undefined }, 'back to the default counts as a change');
      assert.deepStrictEqual(steps, ['hand:saved:vscode (default)', 'reconnect']);
      // a failed save restarts nothing and says the value in force
      const bad = new SettingsStore(path.join(dir, 'blocker', 'x.json'));
      bad.load();
      setup(bad);
      assert.deepStrictEqual(await call('settings:setCopilotSignInApp', { mode: 'off' }), { ok: false, copilotSignInApp: undefined });
      assert.deepStrictEqual(steps, [], 'FR-237: a failed save restarts nothing');
      setup(undefined);
      assert.strictEqual((await call('settings:setCopilotSignInApp', { mode: 'off' })).ok, false, 'no store: not ok');
      assert.deepStrictEqual(steps, []);
    } finally {
      if (saved) require.cache[electronPath] = saved;
      else delete require.cache[electronPath];
    }
  }

  // ---- FR-237: main's reconnect is the existing refreshAdapterAuth (spec 012 FR-158), only for an adapter already created ----
  {
    const calls: string[] = [];
    const ad = { id: 'copilot', refreshAuth: async () => { calls.push('refreshAuth'); } } as unknown as AgentAdapter;
    const sent: unknown[] = [];
    const remote = new Set(['a1', 'b1']);
    const d = { router: { created: () => [ad], adapterIdOf: (id: string) => (id === 'a1' ? 'copilot' : 'claude') }, remoteOps: { ids: () => [...remote], forget: (id: string) => void remote.delete(id) }, toRenderer: (ch: string, p: unknown) => void sent.push([ch, p]) };
    await refreshAdapterAuth(d, 'copilot');
    assert.deepStrictEqual(calls, ['refreshAuth']);
    assert.deepStrictEqual(sent, [['agents:remoteOff', 'a1']], 'only that app\'s remote sessions are said to be off');
    await refreshAdapterAuth({ ...d, router: { ...d.router, created: () => [] } }, 'copilot');
    assert.deepStrictEqual(calls, ['refreshAuth'], 'no adapter created yet: nothing to restart, the first client reads the value');
  }

  // ---- FR-234, FR-236, FR-237: the client option the Copilot adapter starts with ----
  {
    assert.deepStrictEqual(copilotEntraOption(undefined), { entra: { clientId: VSCODE_ENTRA_CLIENT_ID } }, 'owner default 2026-11-13: nothing stored passes VS Code\'s app');
    assert.deepStrictEqual(copilotEntraOption({ mode: 'off' }), {}, 'FR-237: no entra key for an explicit Off');
    assert.deepStrictEqual(copilotEntraOption({ mode: 'copilot-cli' }), { entra: { clientId: VSCODE_ENTRA_CLIENT_ID } }, 'FR-234 copilot-cli pending: the default');
    assert.deepStrictEqual(copilotEntraOption({ mode: 'vscode' }), { entra: { clientId: VSCODE_ENTRA_CLIENT_ID } }, 'FR-236: entra is exactly { clientId } (no matsAppName, no tokenProvider)');
    assert.deepStrictEqual(copilotEntraOption({ mode: 'custom', clientId: CUSTOM_UP }), { entra: { clientId: CUSTOM } }, 'FR-235 adapter check: the custom ID reaches entra checked and lower case');
    assert.deepStrictEqual(copilotEntraOption({ mode: 'custom', clientId: SECRETISH }), { entra: { clientId: VSCODE_ENTRA_CLIENT_ID } }, 'FR-235 adapter check: an invalid custom ID never reaches entra (the default)');
    assert.deepStrictEqual(copilotEntraOption({ mode: 'custom' }), { entra: { clientId: VSCODE_ENTRA_CLIENT_ID } });
    assert.strictEqual(VSCODE_ENTRA_CLIENT_ID, 'aebc6443-996d-45c2-90f0-388ff96faa56');

    const ad = new OptsCopilot();
    const dbg: string[] = [];
    ad.debug = (m) => dbg.push(m);
    assert.strictEqual(ad.capabilities.signInAppChoice, true, 'FR-238: the flag is on for Copilot');
    await ad.client$();
    assert.deepStrictEqual(ad.opts[0].entra, { clientId: VSCODE_ENTRA_CLIENT_ID }, 'owner default 2026-11-13: with nothing handed, the first client gets VS Code\'s app');
    // FR-237: a change is stored, then refreshAuth starts a new client with it and resumes the live session
    const ws = tmpDir('durbar-signinapp-ws-');
    const sid = await ad.start({ workspace: ws, quiet: true });
    assert.strictEqual(ad.setSignInApp({ mode: 'custom', clientId: CUSTOM }), CUSTOM, 'returns the ID it will use, for main\'s mask');
    assert.strictEqual(ad.opts.length, 1, 'storing the choice starts nothing');
    await ad.refreshAuth();
    assert.strictEqual(ad.opts.length, 2, 'refreshAuth started a new client');
    assert.deepStrictEqual(ad.opts[1].entra, { clientId: CUSTOM }, 'FR-237: the new client carries entra.clientId');
    assert.deepStrictEqual(ad.clients[1].resumed.map((r) => r.id), [sid], 'FR-237: the live session is resumed on the new client');
    assert.ok(ad.isLive(sid));
    const vs = { clientId: VSCODE_ENTRA_CLIENT_ID };
    for (const [choice, want] of [[{ mode: 'off' }, undefined], [{ mode: 'vscode' }, vs], [{ mode: 'off' }, undefined], [{ mode: 'copilot-cli' }, vs], [{ mode: 'off' }, undefined], [undefined, vs], [{ mode: 'custom', clientId: 'not-a-guid' }, vs]] as [SignInAppChoice | undefined, unknown][]) {
      ad.setSignInApp(choice);
      await ad.refreshAuth();
      const o: Record<string, unknown> = ad.opts[ad.opts.length - 1];
      if (want) assert.deepStrictEqual(o.entra, want, `entra for ${JSON.stringify(choice)}`);
      else assert.ok(!('entra' in o), `FR-237: no entra key (not {} or undefined) for Off: ${JSON.stringify(choice)}`);
    }
    assert.strictEqual(ad.setSignInApp({ mode: 'copilot-cli' }), VSCODE_ENTRA_CLIENT_ID, 'FR-234: copilot-cli hands the default\'s ID (for the mask too)');
    assert.strictEqual(ad.setSignInApp({ mode: 'off' }), undefined, 'Off hands no ID');
    for (const m of dbg) noGuid(m, 'the adapter debug line');
    assert.ok(dbg.includes('sign-in app: custom (set)') && dbg.includes('sign-in app: vscode') && dbg.includes('sign-in app: off') && dbg.includes('sign-in app: vscode (default)'), 'FR-236: the debug line says the mode');
    assert.ok(dbg.includes('sign-in app: vscode (copilot-cli is not available in this build)'));
    // FR-235 adapter check: a bad custom ID handed straight to the adapter never reaches entra (the default instead)
    assert.strictEqual(ad.setSignInApp({ mode: 'custom', clientId: 'x' }), VSCODE_ENTRA_CLIENT_ID, 'FR-235 adapter check: a bad ID is the default');
    await ad.refreshAuth();
    assert.deepStrictEqual(ad.opts[ad.opts.length - 1].entra, { clientId: VSCODE_ENTRA_CLIENT_ID }, 'FR-235 adapter check: entra carries the default, not "x"');
    await ad.dispose();

    // FR-237: changes during a running (slow) reconnect: the client ends on the latest choice, with one more reconnect (two, not three)
    const slow = new OptsCopilot();
    slow.setSignInApp({ mode: 'off' });
    await slow.client$();
    let release!: () => void;
    slow.hold = new Promise<void>((r) => { release = r; });
    slow.setSignInApp({ mode: 'vscode' });
    const first = slow.refreshAuth();
    for (let i = 0; i < 200 && slow.opts.length < 2; i++) await new Promise((r) => setImmediate(r));
    assert.strictEqual(slow.opts.length, 2, 'the first reconnect is starting its client (with vscode)');
    slow.setSignInApp({ mode: 'custom', clientId: VSCODE_ENTRA_CLIENT_ID.replace('aebc', '1234') });
    const second = slow.refreshAuth();
    slow.setSignInApp({ mode: 'custom', clientId: CUSTOM });
    const third = slow.refreshAuth();
    slow.hold = undefined;
    release();
    await Promise.all([first, second, third]);
    assert.strictEqual(slow.opts.length, 3, 'FR-237 in-flight change: one more reconnect after the running one (two, not three)');
    assert.deepStrictEqual(slow.opts[2].entra, { clientId: CUSTOM }, 'FR-237 in-flight change: the client ends on the latest saved choice');
    // a plain sign-in refresh (no app change) still joins the one in flight (spec 012 FR-158)
    let rel2!: () => void;
    slow.hold = new Promise<void>((r) => { rel2 = r; });
    const a1 = slow.refreshAuth();
    for (let i = 0; i < 200 && slow.opts.length < 4; i++) await new Promise((r) => setImmediate(r));
    const a2 = slow.refreshAuth();
    slow.hold = undefined;
    rel2();
    await Promise.all([a1, a2]);
    assert.strictEqual(slow.opts.length, 4, 'FR-158: a refresh without an app change joins the running one');
    await slow.dispose();
  }

  // ---- FR-236: the masks ----
  {
    assert.strictEqual(maskSignInAppId(`a ${CUSTOM_UP} b ${CUSTOM}`, CUSTOM), `a ${SIGN_IN_APP_ID_MASK} b ${SIGN_IN_APP_ID_MASK}`, 'any case');
    assert.strictEqual(maskSignInAppId('a.b.c', 'a.b'), 'a.b.c', 'not an ID: no replace');
    setSignInAppMaskId(CUSTOM);
    const err = `ENTRA_CLIENT_NOT_PREAUTHORIZED: client ${CUSTOM_UP} for https://x.example`;
    const m = maskMcpError(err) ?? '';
    noGuid(m, 'a masked MCP error');
    assert.ok(m.includes(SIGN_IN_APP_ID_MASK), FR236('the masked error shows the placeholder'));
    // mask before the cut: an ID straddling the 300-character cut leaves no part of it
    // mask, then cut: a 400-character error with the upper-case ID starting at character 290 (across the 300-character cut)
    const straddle = ('x'.repeat(290) + CUSTOM_UP + ' ').padEnd(400, 'y');
    assert.strictEqual(straddle.length, 400);
    const sm = maskMcpError(straddle) ?? '';
    assert.strictEqual(MCP_ERROR_MAX_CHARS, 300);
    const hex = CUSTOM.replace(/-/g, '');
    const leaked = [...Array(hex.length - 7).keys()].some((i) => sm.toLowerCase().replace(/-/g, '').includes(hex.slice(i, i + 8)));
    assert.ok(!leaked, FR236(`mask before the cut: no 8 hex digits of the ID are left (${sm.slice(280)})`));
    noGuid(maskMcpText(`tool failed: ${CUSTOM}`) ?? '', 'a masked tool output');
    // Copy diagnostics is built in the window from the reply's masked `error` (FR-093): the reply's statuses go through maskMcpStatuses
    noGuid(JSON.stringify(maskMcpStatuses([{ name: 'srv', status: 'failed', error: err } as never])), 'the status error Copy diagnostics copies');
    const ev = maskMcpEvent({ type: 'mcp', sessionId: 's', servers: [{ name: 'srv', status: 'failed', error: err }] } as unknown as AgentEvent);
    noGuid(JSON.stringify(ev), 'an mcp event');
    const st = maskMcpEvent({ type: 'status', sessionId: 's', status: 'error', intent: `Invalid host Entra configuration: ${CUSTOM_UP}` } as AgentEvent);
    noGuid(JSON.stringify(st), 'an error status');
    const plain = { type: 'status', sessionId: 's', status: 'error', intent: 'nothing here' } as AgentEvent;
    assert.strictEqual(maskMcpEvent(plain), plain, 'an event without the ID is the same object');
    noGuid(maskSignInAppText(JSON.stringify({ debug: `refreshAuth: old client stop failed: ${CUSTOM_UP}` })), 'a debug-log line');
    setSignInAppMaskId(undefined);
    assert.ok(maskSignInAppText(CUSTOM).includes(CUSTOM), 'off: nothing to replace');
    setSignInAppMaskId('not-a-guid');
    assert.strictEqual(maskSignInAppText('not-a-guid'), 'not-a-guid', 'an invalid ID is never a mask');
    setSignInAppMaskId(undefined);
  }

  // ---- FR-240: "app mode refused" ----
  {
    for (const [t, want] of [
      ['ENTRA_CLIENT_NOT_PREAUTHORIZED: the resource has not pre-authorized this client', 'app'],
      ['entra_client_not_preauthorized', 'app'],
      ['this server has not authorized Copilot CLI to request tokens for it (AADSTS65002)', 'app'],
      ['AADSTS50011: The redirect URI specified in the request does not match', 'redirect'],
      [`masked: ${SIGN_IN_APP_ID_MASK} said aadsts50011 at [address hidden]`, 'redirect'],
      ['AADSTS650020', undefined],
      ['AADSTS65001: consent', undefined],
      ['XENTRA_CLIENT_NOT_PREAUTHORIZED', undefined],
      ['401 Unauthorized', undefined],
      [undefined, undefined],
    ] as [unknown, string | undefined][]) assert.strictEqual(isSignInAppRefusal(t), want, `FR-240: ${String(t)}`);
    // FR-240 order: the refusal check runs before the auth class (classifyMcpCall says auth for these)
    assert.strictEqual(classifyMcpCall('AADSTS65002: unauthorized_client'), 'auth', 'the auth class alone reads unauthorized_client as a sign-in');
    assert.deepStrictEqual(mcpFailureVerdict('AADSTS65002: unauthorized_client'), { refused: 'app' }, 'FR-240 order: refusal before auth (unauthorized_client)');
    assert.deepStrictEqual(mcpFailureVerdict('ENTRA_CLIENT_NOT_PREAUTHORIZED', true), { refused: 'app' }, 'FR-240 order: refusal before auth (mcpAuth: true)');
    assert.deepStrictEqual(mcpFailureVerdict('401 Unauthorized'), { cls: 'auth' }, 'other texts keep their class');
    assert.deepStrictEqual(mcpFailureVerdict('AADSTS53003 conditional access'), { cls: 'policy' });
    assert.strictEqual(classifyMcpCall('error AADSTS65002 for this resource'), undefined, 'FR-240: 65002 is not read as auth (signing in again does not fix it)');
    assert.strictEqual(classifyMcpCall('AADSTS65001 consent'), 'auth', '65001 stays auth');
    assert.strictEqual(signInAppRefusalText('app', "Visual Studio Code's app"), "Microsoft refused the sign-in app chosen in Settings > MCP servers (Visual Studio Code's app): this server does not accept that app. Choose another app or Off.", 'FR-240: the words with a sign-in app set');
    assert.strictEqual(signInAppRefusalText('redirect', 'Custom app'), "Microsoft refused the sign-in app chosen in Settings > MCP servers (Custom app): the app does not list this computer's sign-in address. Choose another app or Off.", 'FR-240: the redirect reason');
    assert.strictEqual(signInAppRefusalText('app', undefined), "Microsoft refused Copilot's sign-in app for this server.", 'FR-240: the words with Off');
  }

  // ---- FR-234: the unlabeled runtime ID is not in src/ (a source scan that cannot pass empty) ----
  {
    let root = __dirname;
    while (!fs.existsSync(path.join(root, 'package.json'))) root = path.dirname(root);
    const files: string[] = [];
    const walk = (d: string): void => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|js|json)$/.test(e.name)) files.push(p); } };
    walk(path.join(root, 'src'));
    assert.ok(files.length > 200, 'the scan read src/');
    assert.ok(files.some((f) => f.endsWith(path.join('src', 'adapters', 'copilot.ts'))), 'the scan read src/adapters/copilot.ts');
    const forms = [UNLABELED, UNLABELED.replace(/-/g, ''), UNLABELED.slice(0, 8)];
    const hits = files.filter((f) => { const t = fs.readFileSync(f, 'utf8').toLowerCase(); return forms.some((x) => t.includes(x)); });
    assert.deepStrictEqual(hits, [], 'FR-234: the unlabeled 1.0.32 ID (dashed, bare hex or its first group, any case) is not in src/');
    assert.ok(files.some((f) => fs.readFileSync(f, 'utf8').includes(VSCODE_ENTRA_CLIENT_ID)), 'the scan sees the one constant');
    assert.strictEqual(files.filter((f) => fs.readFileSync(f, 'utf8').includes(VSCODE_ENTRA_CLIENT_ID)).length, 1, 'FR-234: one constant, in one file');
  }

  process.exitCode = 0;
  console.log('[058] sign-in app PASS');
}

function FR236(what: string): string {
  return `FR-236: ${what}`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
