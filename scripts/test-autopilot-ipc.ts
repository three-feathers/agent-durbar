/**
 * Spec 099 Phase 3 (T030, T031, T039, T095, T098, T099, T032): main's Autopilot by behaviour: the real `register` of `ipc/agents.ts` on a stand-in for electron, the real router,
 * remote ops, `setModeOp` and Scheduler, and FakeAdapter. main.ts cannot run here: its few wiring lines are pinned by text at the end. `AUTOPILOT_WIRED` stays false, so `enabled` is
 * handed in here; `test-autopilot-reach.ts` pins that the default build refuses. No credits, no process, no network. `npm run test:autopilot-ipc`.
 */
process.exitCode = 1;
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { createRegistry } from '../src/adapters/registry';
import { createRouter } from '../src/adapters/router';
import { FakeAdapter } from '../src/adapters/fake';
import type { AgentEvent, AutopilotSettings } from '../src/adapters/types';
import type { AdapterDescriptor } from '../src/adapters/capabilities';
import type { AgentInfo, PermMode } from '../src/shared/api';
import { dialogText, plainLine, readSettings, windowAdapters, NOT_AVAILABLE, REMOTE_ON, CHANGED, ORG_UNREAD } from '../src/main/autopilotops';
import type { AutopilotOpsDeps } from '../src/main/autopilotops';
import { OrgPolicyCache } from '../src/main/orgpolicy';
import { emptyOrgPolicy, wholeOrgPolicy } from '../src/shared/orgpolicy';
import { readCopilotOrgPolicy } from '../src/adapters/copilotOrgPolicy';
import { claudeHistoryFromText } from '../src/adapters/claudeHistory';
import { folderFingerprint } from '../src/main/gitstatus';
import { AUTOPILOT_HELD, Scheduler } from '../src/main/schedules';

type R = Record<string, unknown>;
const AP = { capUnit: 'aiu' as const, attachments: true, planApproval: true, verified: false };

async function main(): Promise<void> {
  const electronPath = require.resolve('electron');
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const dialogs: unknown[] = [];
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: { ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(ch, fn), on: () => undefined }, dialog: { showOpenDialog: async () => { dialogs.push('open'); return { canceled: true, filePaths: [] }; }, showMessageBox: async (o: unknown) => { dialogs.push(o); return { response: 0 }; } }, shell: {}, BrowserWindow: class {} } } as unknown as NodeJS.Module;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { register } = require('../src/main/ipc/agents') as typeof import('../src/main/ipc/agents');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createAutopilotOps } = require('../src/main/autopilotops') as typeof import('../src/main/autopilotops');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createRemoteOps } = require('../src/main/remoteops') as typeof import('../src/main/remoteops');

  const indexUrl = pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href;
  const frame = { url: indexUrl };
  const win = { senderFrame: frame, sender: { mainFrame: frame } };
  const foreignFrame = { url: 'https://example.invalid/' };
  const foreign = { senderFrame: foreignFrame, sender: { mainFrame: foreignFrame } };

  /** One office: a session in `mode`, the real router, the real remote ops, and a store and log that record. */
  async function office(o: { mode?: PermMode; enabled?: boolean; caps?: R; confirm?: AutopilotOpsDeps['confirm']; org?: AutopilotOpsDeps['org']; fingerprint?: AutopilotOpsDeps['fingerprint']; remoteConfirm?: (id: string) => Promise<boolean>; live?: boolean; setupWaitMs?: number; ensureLive?: AutopilotOpsDeps['ensureLive'] } = {}) {
    handlers.clear();
    const fake = new FakeAdapter({ capabilities: o.caps ?? { autopilot: AP, remote: true, remoteService: { name: 'GitHub', host: 'github.com', mobile: 'GitHub Mobile' } } } as never);
    const desc = { id: 'fake', displayName: 'Fake', create: () => fake, detect: async () => ({ state: 'ready' }), capabilities: fake.capabilities } as unknown as AdapterDescriptor;
    const router = createRouter(createRegistry([desc]));
    router.instance('fake');
    (fake as unknown as { setRemote: unknown }).setRemote = async (_s: string, on: boolean) => ({ ok: true, on, url: 'https://github.com/x' });
    const mode = o.mode ?? 'allow';
    const id = await fake.start({ workspace: __dirname, permissionMode: mode, quiet: true });
    router.bind(id, 'fake');
    const a: AgentInfo = { id, name: 'proj', cwd: __dirname, folders: [__dirname], permMode: mode, adapterId: 'fake', model: 'm', status: 'idle' } as unknown as AgentInfo;
    const agents = new Map<string, AgentInfo>([[id, a]]);
    const saved: Array<[string, string]> = [];
    const logs: string[] = [];
    const says: string[] = [];
    const warns: string[] = [];
    const pushed: unknown[] = [];
    const asked: Array<{ message: string; detail: string; ok: string }> = [];
    const opsDeps = { agents, router, store: { setPermMode: (k: string, m: string) => void saved.push(['folder', m]), setSessionMode: (k: string, s: string, m: string) => void saved.push(['session', m]), setMaxAiCredits: () => assert.fail('FR-022: never the folder cap') }, wsKey: (x: AgentInfo) => x.cwd, log: (x: AgentInfo, d: string, t: string) => void logs.push(`${d}: ${t}`), orgRefusal: undefined as undefined | ((x: AgentInfo, m: PermMode) => string | undefined) } as never as import('../src/main/agentops').OpsDeps;
    let onAuto: (id: string) => boolean = () => false;
    const remoteOps = createRemoteOps({ known: (x) => agents.has(x), adapterOf: (x) => router.forAgent(x), open: async () => undefined, modeOf: (x) => agents.get(x)?.permMode, confirm: o.remoteConfirm, autopilotOn: (x) => onAuto(x) });
    const ops = createAutopilotOps({
      agents, router, ops: opsDeps, enabled: () => o.enabled !== false, remoteOn: (x) => remoteOps.engaged(x), org: o.org ?? (async () => undefined),
      confirm: o.confirm ?? (async (t) => { asked.push(t); return true; }), ensureLive: o.ensureLive ?? (async () => undefined), setupWaitMs: o.setupWaitMs, changed: (x) => void pushed.push(x.autopilot ?? null), appName: () => 'Fake', folderLabel: (x) => x.cwd, fingerprint: o.fingerprint,
      log: (x, d, t) => void logs.push(`${d}: ${t}`), say: (_x, l) => void says.push(l), warn: (l) => void warns.push(l),
    });
    onAuto = (x) => ops.engaged(x);
    opsDeps.endAutopilot = (x) => ops.endForMode(x);
    opsDeps.autopilotStopSeen = (x) => ops.stopSeen(x);
    router.setEventGuard((e) => ops.accepts(e));
    router.onEvent((e) => ops.onEvent(e));
    const seen: AgentEvent[] = [];
    router.onEvent((e) => void seen.push(e));
    register({ agents, router, agentState: { ensure: () => undefined, noteSend: () => undefined, noteSendFailed: () => undefined, isBusy: () => false, remove: () => undefined } as never, opsDeps, remoteOps, autopilot: ops, mcpSecrets: () => [], logMcp: () => undefined, getScheduler: () => undefined, getCheckpointStore: () => undefined, vsChatRefs: new Map(), continued: new Map(), wsKey: (x: AgentInfo) => x.cwd, asEffort: () => undefined, addMany: async () => ({ ok: true, agents: [] }) as never, addWorkspace: async () => a, sendOp: async () => ({ ok: true }), ensureLive: async () => undefined, readyAdapterIds: async () => new Set(), forgetOpenSession: () => undefined, maskHistory: (_i: unknown, h: unknown) => h } as never);
    const call = (ch: string, ...args: unknown[]) => Promise.resolve(handlers.get(ch)!(win, ...args)) as Promise<R>;
    const emit = (e: R): void => (fake as unknown as { emit(s: string, b: R): void }).emit(id, e);
    return { fake, id, a, agents, router, saved, logs, says, warns, pushed, asked, ops, remoteOps, opsDeps, call, seen, emit };
  }
  const turnOn = (x: { call: (c: string, ...a: unknown[]) => Promise<R>; id: string }, s: unknown = { limit: 5 }) => x.call('agents:setAutopilot', x.id, s);
  const onCalls = (x: { fake: FakeAdapter }): AutopilotSettings[] => x.fake.autopilotCalls.filter((c) => c.settings).map((c) => c.settings as AutopilotSettings);

  // ---- the gate (spec *Changes*, Phase 3 gate): off refuses first, whatever else is true, and nothing moves ----
  {
    const x = await office({ enabled: false, mode: 'read-only', confirm: async () => assert.fail('no dialog in the default build') as never, org: async () => assert.fail('off refuses first, before it reads anything') as never });
    assert.deepStrictEqual(await turnOn(x), { ok: false, error: NOT_AVAILABLE });
    assert.strictEqual(x.a.autopilot, undefined);
    assert.strictEqual(x.a.permMode, 'read-only');
    assert.deepStrictEqual(x.saved, []);
    assert.deepStrictEqual(x.fake.autopilotCalls, []);
    assert.deepStrictEqual(await x.call('agents:setAutopilot', x.id, null), { ok: true, mode: 'read-only' }, 'off is never refused: nothing to do');
    const list = [{ id: 'a', capabilities: { autopilot: AP, usage: {} } }, { id: 'b', capabilities: { usage: {} } }];
    assert.ok(!('autopilot' in windowAdapters(list, false)[0].capabilities), 'the window never hears of the capability');
    assert.ok('usage' in windowAdapters(list, false)[0].capabilities);
    assert.strictEqual(windowAdapters(list, true), list);
  }

  // ---- T030: not from the app, validation, capability ----
  {
    const x = await office();
    assert.throws(() => handlers.get('agents:setAutopilot')!(foreign, x.id, { limit: 5 }), /did not come from its own window/, 'FR-004: window only');
    assert.deepStrictEqual(x.asked, []);
    for (const bad of [{ limit: 0 }, { limit: 1001 }, { limit: 1.5 }, { limit: '5' }, { limit: NaN }, { limit: 5, hours: 0.5 }, { limit: 5, hours: 169 }, { limit: 5, hours: '2' }, { limit: 5, cap: -1 }, { limit: 5, cap: 'x' }, { limit: 5, cap: Infinity }, [], 'x', 7]) {
      const r = await turnOn(x, bad);
      assert.strictEqual(r.ok, false, JSON.stringify(bad));
    }
    assert.deepStrictEqual(x.asked, [], 'a refused value never reaches the dialog');
    assert.deepStrictEqual(onCalls(x), []);
    assert.strictEqual((await x.call('agents:setAutopilot', 'nobody', { limit: 5 })).ok, false);
    assert.strictEqual((await x.call('agents:setAutopilot', { toString: () => x.id }, { limit: 5 })).ok, false);
    const none = await office({ caps: {} });
    assert.match(String((await turnOn(none)).error), /no Autopilot/);
  }
  assert.deepStrictEqual(readSettings({ limit: 5, cap: 10 }, 'aiu'), { ok: true, settings: { limit: 5, hours: 2, cap: 30 }, raised: true }, 'D9');
  assert.strictEqual(readSettings({ limit: 5, cap: 0.001 }, 'usd').ok, false);
  assert.strictEqual(readSettings({ limit: 5, cap: 1.5 }, 'tokens').ok, false);
  assert.strictEqual(readSettings({ limit: 5, cap: 5 }, null).ok, false);
  assert.deepStrictEqual(readSettings({ limit: 1000, hours: 168 }, 'usd'), { ok: true, settings: { limit: 1000, hours: 168 } });

  // ---- FR-002, FR-055, D13: from Read-only and Ask first the dialog says so, and nothing changes until it is accepted ----
  for (const mode of ['read-only', 'ask'] as PermMode[]) {
    let release: (v: boolean) => void = () => undefined;
    const x = await office({ mode, confirm: (t) => { x0.asked.push(t); return new Promise((res) => { release = res; }); } });
    const x0 = x;
    const p = turnOn(x);
    await until(() => x.asked.length === 1);
    assert.match(x.asked[0].detail, new RegExp(`from ${mode === 'ask' ? 'Ask first' : 'Read-only'} to Allow all, and it stays Allow all after Autopilot ends\\. New sessions in .* start in Allow all\\.`));
    assert.strictEqual(x.a.permMode, mode, 'the folder is unchanged until it is accepted');
    assert.deepStrictEqual(x.saved, []);
    assert.deepStrictEqual(onCalls(x), []);
    release(true);
    const r = await p;
    assert.strictEqual(r.ok, true);
    assert.strictEqual(x.a.permMode, 'allow');
    assert.deepStrictEqual(x.saved, [['folder', 'allow'], ['session', 'allow']], 'FR-005: only `allow` is ever saved');
    assert.ok(!JSON.stringify(x.saved).includes('autopilot'));
    assert.ok(x.logs.some((l) => l.startsWith('autopilot-on')));
    assert.ok(x.logs.some((l) => /^mode-change/.test(l)));
  }
  // already in Allow all: no folder sentence, and setModeOp is not called: nothing saved or logged as a mode change
  {
    const x = await office();
    const r = await turnOn(x);
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.autopilot, { limit: 5, hours: 2 });
    assert.ok(!/to Allow all/.test(x.asked[0].detail));
    assert.deepStrictEqual(x.saved, []);
    assert.match(x.asked[0].message, /^Autopilot for proj\?$/);
    assert.strictEqual(x.asked[0].ok, 'Start Autopilot');
    assert.match(x.asked[0].detail, /No spend cap: Autopilot stops when the task is done, at the turn limit, after 2 hours/);
    assert.match(x.asked[0].detail, /Not verified on a real session yet\./);
    assert.strictEqual((await turnOn(x)).ok, false, 'already on');
  }
  // Cancel changes nothing
  for (const mode of ['read-only', 'allow'] as PermMode[]) {
    const x = await office({ mode, confirm: async () => false });
    const r = await turnOn(x);
    assert.deepStrictEqual([r.ok, r.cancelled], [false, true]);
    assert.strictEqual(x.a.permMode, mode);
    assert.strictEqual(x.a.autopilot, undefined);
    assert.deepStrictEqual(x.saved, []);
    assert.deepStrictEqual(x.fake.autopilotCalls, []);
    assert.deepStrictEqual(x.logs, []);
  }
  // the gate is asked again after the dialog
  {
    const gate = { mode: 'ask' as PermMode, enabled: true };
    const x = await office(Object.assign(gate, { confirm: async () => { gate.enabled = false; return true; } }));
    assert.strictEqual((await turnOn(x)).error, NOT_AVAILABLE);
    assert.strictEqual(x.a.permMode, 'ask');
    assert.deepStrictEqual(onCalls(x), []);
  }
  // the page's word is never enough: without the native answer nothing is on
  {
    let asked = 0;
    const x = await office({ confirm: async () => { asked++; return false; } });
    await x.call('agents:setAutopilot', x.id, { limit: 5, confirmed: true, ok: true });
    assert.strictEqual(asked, 1, 'a value from the page does not skip the dialog');
    assert.strictEqual(x.a.autopilot, undefined);
  }
  // warnings: above 20, above 2 hours, past 3 sessions (T099), always acceptable; the cap in the unit, or the no-cap line; hostile names are plain
  {
    const base = { name: 'n', app: 'Copilot', folder: '/f', mode: 'allow' as PermMode, unit: 'aiu' as const, others: 0, verified: false };
    const s = (x: Partial<typeof base> & { settings: AutopilotSettings; spent?: number; ownCap?: number; raised?: boolean }) => dialogText({ ...base, ...x });
    assert.ok(s({ settings: { limit: 20 } }).detail.indexOf('Above 20') < 0);
    assert.match(s({ settings: { limit: 21 } }).detail, /Above 20 extra turns, this run can spend much more before it stops\./);
    assert.ok(s({ settings: { limit: 5, hours: 2 } }).detail.indexOf('Above 2 hours') < 0);
    assert.match(s({ settings: { limit: 5, hours: 3 } }).detail, /Above 2 hours/);
    assert.ok(!/already on Autopilot/.test(s({ others: 2, settings: { limit: 5 } }).detail));
    assert.match(s({ others: 3, settings: { limit: 5 } }).detail, /3 sessions are already on Autopilot\. Each one spends on its own\./);
    assert.match(s({ settings: { limit: 40, hours: 8 } }).detail, /If Durbar cannot read this folder's changes it cannot see a lack of progress: then only the 40 turns, the 8 hours or Stop end the run\./, 'said when no cap is set');
    assert.ok(!/cannot see a lack/.test(s({ settings: { limit: 5, cap: 40 } }).detail));
    assert.match(s({ settings: { limit: 5, cap: 30 }, raised: true, spent: 2 }).detail, /Spend cap: 30 AI credits for this session in total \(2 AI credits so far\)\.\nCopilot's smallest cap is 30 AI credits, so Autopilot uses 30\./);
    assert.match(s({ settings: { limit: 5, cap: 40 }, ownCap: 35 }).detail, /This session's limit of 35 AI credits is lower/);
    assert.match(s({ settings: { limit: 5 }, ownCap: 35 }).detail, /This session's limit of 35 AI credits still applies/);
    assert.match(dialogText({ ...base, unit: 'tokens', settings: { limit: 5, cap: 9000 } }).detail, /9000 tokens for this run\. Codex finishes the turn/);
    assert.match(dialogText({ ...base, unit: 'usd', settings: { limit: 5, cap: 2 } }).detail, /\$2 \(Claude's estimate\) for this session in total/);
    const hostile = dialogText({ ...base, name: 'x‮reversed\n\u0007<img src=x onerror=1>' , folder: '/a⁦b\nc', settings: { limit: 5 } });
    assert.ok(!/[‮⁦\u0007]/.test(hostile.message + hostile.detail));
    assert.ok(!hostile.message.includes('\n'), 'one line');
    assert.strictEqual(plainLine('😀'.repeat(3) + 'x'.repeat(200), 10).length, 10);
    // T099 through main: three on, the fourth is warned and can accept
    const y = await office();
    for (let i = 0; i < 3; i++) y.agents.set(`o${i}`, { id: `o${i}`, autopilot: { limit: 1 } } as never);
    assert.strictEqual((await turnOn(y)).ok, true);
    assert.match(y.asked[0].detail, /3 sessions are already on Autopilot/);
    const z = await office();
    z.agents.set('o', { id: 'o', autopilot: { limit: 1 } } as never);
    await turnOn(z);
    assert.ok(!/already on Autopilot/.test(z.asked[0].detail));
  }
  // a cap at or below what the session spent is refused with both numbers, before the dialog
  {
    const x = await office();
    x.emit({ type: 'usage', nanoAiu: 40e9 });
    const r = await turnOn(x, { limit: 5, cap: 35 });
    assert.match(String(r.error), /35 AI credits is not above what this session has spent \(40 AI credits\)/);
    assert.deepStrictEqual(x.asked, []);
  }

  // ---- FR-002: failures leave a known state ----
  {
    const x = await office({ mode: 'ask' });
    x.opsDeps.orgRefusal = () => 'Blocked by your organization';
    const r = await turnOn(x);
    assert.deepStrictEqual([r.ok, r.error], [false, 'Blocked by your organization']);
    assert.strictEqual(x.a.permMode, 'ask');
    assert.deepStrictEqual(onCalls(x), []);
    const y = await office({ mode: 'ask' });
    y.fake.setAutopilot = async () => { throw new Error('the app said no'); };
    const ry = await turnOn(y);
    assert.strictEqual(ry.ok, false);
    assert.strictEqual(y.a.permMode, 'allow', 'FR-002: mode changed and Autopilot failed: stays in Allow all');
    assert.strictEqual(y.a.autopilot, undefined);
    assert.match(y.says.join(), /stay in Allow all/);
    assert.strictEqual(y.ops.engaged(y.id), false, 'nothing left in flight');
  }

  // ---- FR-070: organization: a refusal, a failed read, or no read, all refuse, before the dialog and after it ----
  {
    const x = await office({ mode: 'ask', org: async () => 'Blocked by policy: Autopilot runs in Allow all, so it is blocked too.' });
    assert.match(String((await turnOn(x)).error), /Blocked by policy/);
    assert.deepStrictEqual(x.asked, []);
    assert.strictEqual(x.a.permMode, 'ask');
    const y = await office({ org: async () => { throw new Error('read failed'); } });
    assert.strictEqual((await turnOn(y)).error, ORG_UNREAD);
    assert.deepStrictEqual(y.asked, []);
    let n = 0;
    const z = await office({ mode: 'read-only', org: async () => (++n > 1 ? 'Blocked now' : undefined) });
    assert.strictEqual((await turnOn(z)).error, 'Blocked now', 'read again after the dialog');
    assert.strictEqual(z.a.permMode, 'read-only');
    assert.deepStrictEqual(onCalls(z), []);
    const cache = (p: unknown) => new OrgPolicyCache({ ids: () => ['c'], adapter: () => ({ displayName: 'C', readOrgPolicy: p as () => never }) });
    assert.strictEqual(await cache(() => emptyOrgPolicy('C')).autopilotRefusal('c'), undefined, 'no policy: free');
    assert.match(String(await cache(() => { throw new Error('x'); }).autopilotRefusal('c')), /could not read/, 'a read that throws refuses here, where Allow all only advises');
    assert.match(String(await cache(() => wholeOrgPolicy('C', [], ['bad'], 'doubt')).autopilotRefusal('c')), /could not read/);
    assert.match(String(await cache(() => wholeOrgPolicy('C', [], ['bad'], 'fatal')).autopilotRefusal('c')), /blocked too/);
    assert.match(String(await cache(() => ({ ...emptyOrgPolicy('C'), found: true, modes: { allow: 'blocked' } })).autopilotRefusal('c')), /blocked too/);
    assert.match(String(await cache(() => ({ ...emptyOrgPolicy('C'), runtimeUnread: 'failed' })).autopilotRefusal('c')), /could not read/, 'the runtime did not answer: the file is not enough');
    assert.match(String(await cache(() => ({ ...emptyOrgPolicy('C'), runtimeUnread: 'none' })).autopilotRefusal('c')), /could not read/);
    assert.match(String(await new OrgPolicyCache({ ids: () => [], adapter: () => undefined }).autopilotRefusal('nope')), /could not read/, 'no read at all');
    assert.match(String(await cache(() => ({ ...emptyOrgPolicy('C'), unreadable: true })).autopilotRefusal('c')), /could not read/, 'unreadable, and nothing found');
    assert.strictEqual(await new OrgPolicyCache({ ids: () => ['c'], adapter: () => ({ displayName: 'C', readOrgPolicy: () => wholeOrgPolicy('C', [], ['bad'], 'doubt') }) }).refusal('c', { mode: 'allow' }), undefined, 'Allow all itself is unchanged: advice');
    assert.strictEqual((await readCopilotOrgPolicy(undefined, () => emptyOrgPolicy('C'))).runtimeUnread, 'none');
    assert.strictEqual((await readCopilotOrgPolicy({ rpc: { managedSettings: { resolve: async () => { throw new Error('x'); } } } } as never, () => emptyOrgPolicy('C'))).runtimeUnread, 'failed');
  }

  // ---- T039, FR-007: never with remote control, both directions ----
  {
    const x = await office({ mode: 'ask', org: async () => assert.fail('remote control refuses first') as never });
    assert.strictEqual((await x.remoteOps.setRemote(x.id, true)).ok, true);
    assert.strictEqual((await turnOn(x)).error, REMOTE_ON);
    assert.deepStrictEqual(x.asked, [], 'before the dialog');
    assert.strictEqual(x.a.permMode, 'ask');

    const y = await office({ remoteConfirm: async () => assert.fail('refused before its dialog') as never });
    assert.strictEqual((await turnOn(y)).ok, true);
    const r = await y.remoteOps.setRemote(y.id, true);
    assert.deepStrictEqual([r.ok, /on Autopilot/.test(String(r.error))], [false, true], 'its own check, not only the mode');
    // the state changes behind `modeOf`: a session on Autopilot that is somehow not `allow` is still refused (a test pins that this cannot open it)
    y.a.permMode = 'ask';
    assert.strictEqual((await y.remoteOps.setRemote(y.id, true)).ok, false);

    // a raise during Autopilot's own dialog: remote control came on while it was open
    let release: (v: boolean) => void = () => undefined;
    const z = await office({ mode: 'ask', confirm: () => new Promise((res) => { release = res; }) });
    const p = turnOn(z);
    await until(() => z.ops.engaged(z.id));
    await tick();
    assert.strictEqual((await z.remoteOps.setRemote(z.id, true)).ok, false, 'while the dialog is open remote control is refused too');
    z.remoteOps.setRemote; // (the other order below)
    release(true);
    await p;
    assert.ok(z.a.autopilot, 'and Autopilot goes on');

    // remote control comes on while Autopilot's dialog is open, by any path: seen after it, and nothing moves
    let rel1: (v: boolean) => void = () => undefined;
    const rc = await office({ mode: 'ask', confirm: () => new Promise((res) => { rel1 = res; }) });
    const prc = turnOn(rc);
    await until(() => rc.ops.engaged(rc.id));
    await tick();
    (rc.remoteOps as unknown as { engaged: (id: string) => boolean }).engaged = () => true;
    rel1(true);
    assert.strictEqual((await prc).error, REMOTE_ON, 'checked again after the native dialog');
    assert.strictEqual(rc.a.permMode, 'ask');
    assert.deepStrictEqual(rc.saved, []);
    assert.deepStrictEqual(onCalls(rc), []);

    // the other order: remote control's dialog is open while Autopilot is accepted
    let rel2: (v: boolean) => void = () => undefined;
    const w = await office({ mode: 'ask', remoteConfirm: () => new Promise((res) => { rel2 = res; }) });
    const rp = w.remoteOps.setRemote(w.id, true);
    await tick();
    assert.strictEqual((await turnOn(w)).error, REMOTE_ON, 'remote on its way counts');
    assert.strictEqual(w.a.autopilot, undefined);
    rel2(false);
    await rp;
    assert.strictEqual(w.remoteOps.engaged(w.id), false);

    // Autopilot turned on while remote control's dialog was open is seen after that dialog (the race the review found on a sibling)
    let rel3: (v: boolean) => void = () => undefined;
    const v = await office({ mode: 'ask', remoteConfirm: () => new Promise((res) => { rel3 = res; }) });
    let vCalls = 0;
    const vf = v.fake as unknown as { setRemote: (s: string, on: boolean) => Promise<unknown> };
    const vReal = vf.setRemote;
    vf.setRemote = async (a0, a1) => { vCalls++; return vReal.call(v.fake, a0, a1); };
    const rp3 = v.remoteOps.setRemote(v.id, true);
    await tick();
    v.a.permMode = 'allow'; // a raise during the dialog, by any path
    rel3(true);
    const r3 = await rp3;
    assert.strictEqual(r3.ok, false);
    assert.match(String(r3.error), /off in Allow all/);
    assert.strictEqual(v.remoteOps.has(v.id), false);
    assert.strictEqual(vCalls, 0, 'the app was never asked');

    // remote control comes on while Autopilot's adapter call is in flight: it comes back down
    const u = await office({ mode: 'allow' });
    const realSet = u.fake.setAutopilot!;
    u.fake.setAutopilot = async (s, c, why) => { if (c) (u.remoteOps as unknown as { engaged: (id: string) => boolean }).engaged = () => true; await realSet.call(u.fake, s, c, why); };
    const ru = await turnOn(u);
    assert.strictEqual(ru.error, REMOTE_ON);
    assert.strictEqual(u.a.autopilot, undefined);
    assert.strictEqual(u.fake.autopilotCalls.at(-1)?.settings, null, 'the adapter was told off again');

    // the app turned remote on and Autopilot came up meanwhile: remote goes back off
    let answered = 0;
    const t = await office({ mode: 'ask' });
    const tf = t.fake as unknown as { setRemote: (s: string, on: boolean) => Promise<unknown> };
    const setR = tf.setRemote;
    tf.setRemote = async (s, on) => { answered++; if (on) t.a.autopilot = { limit: 5 }; return setR.call(t.fake, s, on); };
    const rt = await t.remoteOps.setRemote(t.id, true);
    assert.strictEqual(rt.ok, false);
    assert.strictEqual(answered, 2, 'told off again');
    assert.strictEqual(t.remoteOps.engaged(t.id), false);

    // the plan answer of FR-060: Phase 4; today no such answer is accepted anywhere, with remote control on or off
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'ipc', 'questions.ts'), 'utf8');
    assert.ok(!/approve-autopilot/.test(src), 'the plan card has no Autopilot answer until T042');
  }

  // ---- FR-051, T030: another mode ends it first; a person can always get down ----
  {
    const x = await office();
    await turnOn(x);
    const r = await x.call('agents:setMode', x.id, 'read-only', {});
    assert.strictEqual(r.ok, true);
    assert.strictEqual(x.a.autopilot, undefined);
    assert.strictEqual(x.a.permMode, 'read-only');
    const order = x.fake.autopilotCalls.map((c) => c.settings === null ? `off:${c.reason}` : 'on');
    assert.deepStrictEqual(order, ['on', 'off:stopped']);

    const y = await office();
    await turnOn(y);
    y.opsDeps.orgRefusal = () => 'Blocked';
    const ry = await y.call('agents:setMode', y.id, 'ask', {});
    assert.strictEqual(ry.ok, false);
    assert.strictEqual(y.a.autopilot, undefined, 'the switch was refused and Autopilot still ended');
    assert.strictEqual(y.a.permMode, 'allow');

    const z = await office();
    await turnOn(z);
    const before = z.saved.length;
    const rz = await z.call('agents:setMode', z.id, 'allow', {});
    assert.deepStrictEqual([rz.ok, rz.mode], [true, 'allow']);
    assert.strictEqual(z.a.autopilot, undefined, 'Allow all from Autopilot is only a stop');
    assert.strictEqual(z.saved.length, before, 'nothing saved twice');
    // a stop that fails fails closed
    const w = await office();
    await turnOn(w);
    w.fake.setAutopilot = async () => { throw new Error('dead child'); };
    const rw = await w.ops.off(w.id);
    assert.strictEqual(rw.ok, true);
    assert.strictEqual(w.a.autopilot, undefined);
    assert.strictEqual(w.fake.isLive(w.id), false, 'FR-054: its process went');
    assert.match(w.says.join(), /could not confirm that Autopilot stopped/);
  }

  // ---- FR-050: Stop before anything is awaited ----
  {
    const x = await office();
    await turnOn(x);
    x.emit({ type: 'autopilot', phase: 'started', runId: 'r1', n: 0, limit: 5 });
    assert.ok(x.a.autopilot?.run);
    let hung = false;
    x.fake.interrupt = () => { hung = true; return new Promise(() => undefined); };
    void x.call('agents:stop', x.id);
    assert.strictEqual(x.a.autopilot, undefined, 'state down in the same tick');
    assert.strictEqual(hung, true, 'the adapter told in the same tick');
    // during the dialog: Stop wins over a later yes
    let release: (v: boolean) => void = () => undefined;
    const y = await office({ mode: 'ask', confirm: () => new Promise((res) => { release = res; }) });
    const p = turnOn(y);
    await until(() => y.ops.engaged(y.id));
    await tick();
    await y.call('agents:stop', y.id);
    release(true);
    const r = await p;
    assert.strictEqual(r.error, CHANGED);
    assert.strictEqual(y.a.permMode, 'ask', 'nothing moved');
    assert.deepStrictEqual(onCalls(y), []);
    // during the adapter's call
    const z = await office();
    let go: () => void = () => undefined;
    const real = z.fake.setAutopilot!;
    z.fake.setAutopilot = async (s, c, why) => { if (c) await new Promise<void>((res) => { go = res; }); await real.call(z.fake, s, c, why); };
    const pz = turnOn(z);
    await until(() => onHold(go));
    await z.call('agents:stop', z.id);
    go();
    const rz = await pz;
    assert.strictEqual(rz.ok, false);
    assert.strictEqual(z.a.autopilot, undefined);
    assert.strictEqual(z.fake.autopilotCalls.at(-1)?.settings, null);
    // a failed interrupt on Autopilot ends the session
    const w = await office();
    await turnOn(w);
    w.fake.interrupt = async () => { throw new Error('no answer'); };
    const rw = await w.call('agents:stop', w.id);
    assert.match(String(rw?.error), /could not confirm/);
    assert.strictEqual(w.fake.isLive(w.id), false);
    // the mode changes during the dialog
    let rel4: (v: boolean) => void = () => undefined;
    const m = await office({ mode: 'ask', confirm: () => new Promise((res) => { rel4 = res; }) });
    const pm = turnOn(m);
    await until(() => m.ops.engaged(m.id));
    await tick();
    m.a.permMode = 'read-only';
    rel4(true);
    assert.strictEqual((await pm).error, CHANGED, 'the dialog named another mode');
    assert.deepStrictEqual(m.saved, []);
    // removed during the dialog
    let rel5: (v: boolean) => void = () => undefined;
    const g = await office({ confirm: () => new Promise((res) => { rel5 = res; }) });
    const pg = turnOn(g);
    await until(() => g.ops.engaged(g.id));
    await tick();
    g.agents.delete(g.id);
    rel5(true);
    assert.strictEqual((await pg).error, CHANGED);
    assert.deepStrictEqual(onCalls(g), []);
    // two at once: one dialog
    let rel6: (v: boolean) => void = () => undefined;
    let dlg = 0;
    const two = await office({ confirm: () => { dlg++; return new Promise((res) => { rel6 = res; }); } });
    const p1 = turnOn(two);
    await tick();
    const second = await turnOn(two);
    assert.strictEqual(second.ok, false);
    await until(() => dlg === 1);
    rel6(true);
    assert.strictEqual((await p1).ok, true);
    assert.strictEqual(dlg, 1);
  }

  // ---- S3, D8, FR-005, FR-052: main's state follows every end ----
  for (const reason of ['cap', 'limit', 'no-progress', 'blocked', 'stopped', 'error']) {
    const x = await office();
    await turnOn(x);
    x.emit({ type: 'autopilot', phase: 'started', runId: 'r1', n: 0, limit: 5 });
    x.emit({ type: 'autopilot', phase: 'continued', runId: 'r1', n: 2, limit: 5 });
    assert.strictEqual(x.a.autopilot?.run?.continuation, 2);
    x.emit({ type: 'autopilot', phase: 'ended', runId: 'r1', n: 2, limit: 5, reason });
    assert.strictEqual(x.a.autopilot, undefined, `${reason} returns to Allow all`);
    assert.strictEqual(x.a.permMode, 'allow');
    assert.ok(x.logs.some((l) => l.startsWith(`autopilot-end: Autopilot ended: ${reason}`)), reason);
  }
  {
    const x = await office();
    await turnOn(x);
    x.emit({ type: 'autopilot', phase: 'started', runId: 'r1', n: 0, limit: 5 });
    x.emit({ type: 'autopilot', phase: 'ended', runId: 'r1', n: 0, limit: 5, reason: 'done' });
    assert.deepStrictEqual(x.a.autopilot, { limit: 5, hours: 2, run: undefined }, 'D8: stays on, no run');
    await x.call('agents:end', x.id);
    assert.strictEqual(x.a.autopilot, undefined, 'FR-052');
    const y = await office();
    await turnOn(y);
    y.emit({ type: 'status', status: 'stopped' });
    assert.strictEqual(y.a.autopilot, undefined, 'a session that closed by any path');
    const z = await office();
    await turnOn(z);
    z.emit({ type: 'status', status: 'idle', intent: 'Autopilot ended when this session closed. It is in Allow all.' });
    assert.strictEqual(z.a.autopilot, undefined, 'a sign-in refresh: no stopped status, the FR-005 line');
    // a helper's status is not the session's (FR-008)
    const h = await office();
    await turnOn(h);
    h.emit({ type: 'status', status: 'stopped', agentId: 'helper' });
    assert.ok(h.a.autopilot);
    const start = await office();
    assert.strictEqual(start.a.autopilot, undefined, 'FR-005: a new AgentInfo starts without it');
  }

  // ---- T095, FR-082: every autopilot event and question.autoAnswered, through the real router ----
  {
    const x = await office();
    await turnOn(x);
    const good = { type: 'autopilot', phase: 'started', runId: 'r1', n: 0, limit: 5 };
    x.emit(good);
    assert.strictEqual(x.seen.filter((e) => e.type === 'autopilot').length, 1);
    const bad: R[] = [
      { type: 'autopilot', phase: 'nonsense', runId: 'r1', n: 0, limit: 5 },
      { type: 'autopilot', phase: 'continued', runId: 'r1', n: 9, limit: 5 },
      { type: 'autopilot', phase: 'continued', runId: 'r1', n: 1, limit: 5000 },
      { type: 'autopilot', phase: 'continued', runId: '<img src=x onerror=1>', n: 1, limit: 5 },
      { type: 'autopilot', phase: 'continued', runId: 'r1', n: 1, limit: 5, agentId: 'helper' },
      { type: 'autopilot', phase: 'ghp_' + 'a'.repeat(36) + '\nx', runId: 'r1', n: 1, limit: 5 },
      { type: 'question', phase: 'asked', requestId: 'q', questions: [{ question: 'q?', options: [] }], autoAnswered: 'yes' },
    ];
    for (const b of bad) x.emit(b);
    assert.strictEqual(x.seen.filter((e) => e.type === 'autopilot').length, 1, 'no bad one reached a listener');
    assert.strictEqual(x.seen.filter((e) => e.type === 'question').length, 0);
    assert.strictEqual(x.warns.length, bad.length, 'each dropped with one line, however many listeners there are');
    assert.ok(x.warns.every((w) => !w.includes('ghp_a') && !/[\n\r]/.test(w)), 'masked');
    assert.ok(x.a.autopilot, 'a dropped end changes nothing');
    assert.strictEqual(x.a.autopilot?.run?.continuation, 0);
    // a malformed end: dropped, and main's run does not stand on it: the adapter is told, the window hears, the chat says so
    for (const bad of [{ reason: 'ghp_' + 'a'.repeat(36) }, { reason: 'done', spend: { unit: 'x', value: -1 } }]) {
      const m = await office();
      await turnOn(m);
      m.emit({ type: 'autopilot', phase: 'started', runId: 'r1', n: 0, limit: 5 });
      m.emit({ type: 'autopilot', phase: 'ended', runId: 'r1', n: 1, limit: 5, ...bad });
      assert.strictEqual(m.seen.filter((e) => e.type === 'autopilot').length, 1, 'not forwarded');
      assert.strictEqual(m.a.autopilot, undefined, 'no run left standing');
      await tick();
      assert.deepStrictEqual(m.fake.autopilotCalls.at(-1), { sessionId: m.id, settings: null, reason: 'error' });
      assert.strictEqual(m.pushed.at(-1), null);
      assert.match(m.says.join(), /could not read how its run ended/);
      assert.ok(m.warns.every((w) => !w.includes('ghp_a')));
    }
    x.emit({ type: 'question', phase: 'asked', requestId: 'q1', questions: [{ question: 'q?', options: [] }], autoAnswered: true });
    assert.strictEqual(x.seen.filter((e) => e.type === 'question').length, 1);
    // a plain question and other events pass untouched, in the default build too
    const off = await office({ enabled: false });
    off.emit({ type: 'question', phase: 'asked', requestId: 'q2', questions: [{ question: 'real?', options: [] }] });
    off.emit({ type: 'output', delta: 'x' });
    assert.strictEqual(off.seen.length, 2);
    assert.deepStrictEqual(off.warns, []);
    // a question "decided" while main has no Autopilot would hide the buttons of one that waits
    off.emit({ type: 'question', phase: 'asked', requestId: 'q3', questions: [{ question: 'real?', options: [] }], autoAnswered: true });
    off.emit({ type: 'autopilot', phase: 'started', runId: 'r9', n: 0, limit: 5 });
    assert.strictEqual(off.seen.length, 2, 'dropped in the default build');
    assert.strictEqual(off.warns.length, 2);
    await tick();
    assert.deepStrictEqual(off.fake.autopilotCalls.at(-1), { sessionId: off.id, settings: null, reason: 'error' }, 'a run main does not count is stopped, not left going');
    // the FR-005 line on a session that lives on: its adapter hears too
    const live = await office();
    await turnOn(live);
    live.emit({ type: 'status', status: 'idle', intent: 'Autopilot ended when this session closed. It is in Allow all.' });
    assert.strictEqual(live.fake.autopilotCalls.at(-1)?.settings, null);
  }

  // ---- T031, FR-023: no progress ----
  {
    const prints = ['a', 'a', 'a', 'b'];
    const x = await office({ fingerprint: async () => prints.shift() });
    await turnOn(x);
    x.emit({ type: 'autopilot', phase: 'started', runId: 'r1', n: 0, limit: 9 });
    x.emit({ type: 'autopilot', phase: 'continued', runId: 'r1', n: 1, limit: 9 });
    await tick();
    assert.ok(!x.fake.autopilotCalls.some((c) => c.reason === 'no-progress'), 'one unchanged is not enough');
    x.emit({ type: 'autopilot', phase: 'continued', runId: 'r1', n: 2, limit: 9 });
    await until(() => x.fake.autopilotCalls.some((c) => c.reason === 'no-progress'));
    assert.strictEqual(x.a.autopilot, undefined);
    // a change resets the count; a read that fails is not "unchanged"
    const seq: Array<string | undefined | Error> = ['a', 'a', 'b', 'b', new Error('git'), 'b', 'b', 'c'];
    const y = await office({ fingerprint: async () => { const v = seq.shift(); if (v instanceof Error) throw v; return v; } });
    await turnOn(y);
    y.emit({ type: 'autopilot', phase: 'started', runId: 'r1', n: 0, limit: 9 });
    for (let n = 1; n <= 7; n++) y.emit({ type: 'autopilot', phase: 'continued', runId: 'r1', n, limit: 9 });
    await tick();
    await tick();
    assert.ok(!y.fake.autopilotCalls.some((c) => c.reason === 'no-progress'), 'never two unchanged in a row');
    // not a git folder: a write or a shell command is the progress
    const z = await office({ fingerprint: async () => null });
    await turnOn(z);
    z.emit({ type: 'autopilot', phase: 'started', runId: 'r1', n: 0, limit: 9 });
    z.emit({ type: 'toolCall', callId: 'c', tool: 'bash', phase: 'start' });
    z.emit({ type: 'autopilot', phase: 'continued', runId: 'r1', n: 1, limit: 9 });
    await tick();
    z.emit({ type: 'toolCall', callId: 'c2', tool: 'read_file', phase: 'start' });
    z.emit({ type: 'autopilot', phase: 'continued', runId: 'r1', n: 2, limit: 9 });
    await tick();
    assert.ok(!z.fake.autopilotCalls.some((c) => c.reason === 'no-progress'), 'first had a shell command');
    z.emit({ type: 'autopilot', phase: 'continued', runId: 'r1', n: 3, limit: 9 });
    await until(() => z.fake.autopilotCalls.some((c) => c.reason === 'no-progress'));
    // a run that ended while the runner was busy is left alone
    let open: (v: string) => void = () => undefined;
    const w = await office({ fingerprint: () => new Promise((res) => { open = res; }) });
    await turnOn(w);
    w.emit({ type: 'autopilot', phase: 'started', runId: 'r1', n: 0, limit: 9 });
    w.emit({ type: 'autopilot', phase: 'ended', runId: 'r1', n: 0, limit: 9, reason: 'done' });
    open('a');
    await tick();
    assert.ok(w.a.autopilot, 'done: still on');
    // the real runner: read-only argv through the given exec; not a repo is null; a failed diff rejects
    const calls: string[][] = [];
    const exec = async (a: string[]) => { calls.push(a); return a.includes('status') ? '## main\0 M a\0' : 'diff'; };
    const f1 = await folderFingerprint('/f', exec as never);
    assert.ok(typeof f1 === 'string' && f1.length === 64);
    assert.ok(calls.every((c) => c.includes('status') || c.includes('diff') || c.includes('rev-parse')), 'read-only');
    assert.strictEqual(await folderFingerprint('/f', (async () => { throw new Error('fatal: not a git repository (or any of the parent directories): .git'); }) as never), null);
    await assert.rejects(folderFingerprint('/f', (async () => { throw new Error('timeout'); }) as never), /timeout/, 'a status that failed is not "not git": it is not known');
    await assert.rejects(folderFingerprint('/f', (async (a: string[]) => { if (a.includes('diff')) throw new Error('too big'); return '## main\0'; }) as never));
    // the real runner and real git: no fake could see that the runner refuses an option
    const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-099-fp-')));
    try {
      const git = (d: string, ...a: string[]): void => void execFileSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@e', '-c', 'commit.gpgsign=false', ...a], { stdio: 'ignore' });
      const repo = path.join(scratch, 'repo');
      fs.mkdirSync(repo);
      git(repo, 'init', '-q');
      fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
      const unborn0 = await folderFingerprint(repo);
      assert.ok(typeof unborn0 === 'string', 'a repository with no commit yet has a fingerprint');
      assert.strictEqual(await folderFingerprint(repo), unborn0, 'unborn: the same twice');
      git(repo, 'add', 'a.txt');
      const unborn1 = await folderFingerprint(repo);
      assert.notStrictEqual(unborn1, unborn0, 'unborn: a staged file shows');
      fs.writeFileSync(path.join(repo, 'a.txt'), 'two\n');
      assert.notStrictEqual(await folderFingerprint(repo), unborn1, 'unborn: an edit shows');
      git(repo, 'add', 'a.txt');
      git(repo, 'commit', '-qm', 'x');
      const f0 = await folderFingerprint(repo);
      assert.ok(typeof f0 === 'string');
      assert.strictEqual(await folderFingerprint(repo), f0, 'the same twice');
      fs.writeFileSync(path.join(repo, 'a.txt'), 'three\n');
      const f1 = await folderFingerprint(repo);
      assert.notStrictEqual(f1, f0, 'an edit shows');
      fs.writeFileSync(path.join(repo, 'a.txt'), 'four\n');
      assert.notStrictEqual(await folderFingerprint(repo), f1, 'a second edit to a file already changed shows: the diff, not only the status');
      const plain = path.join(scratch, 'plain');
      fs.mkdirSync(plain);
      assert.strictEqual(await folderFingerprint(plain), null, 'not a git folder');
      await assert.rejects(folderFingerprint(path.join(scratch, 'gone')));
      // through main: two unchanged continuations in a real repository end the run
      const real = await office({ fingerprint: () => folderFingerprint(repo) });
      await turnOn(real);
      real.emit({ type: 'autopilot', phase: 'started', runId: 'r1', n: 0, limit: 9 });
      real.emit({ type: 'autopilot', phase: 'continued', runId: 'r1', n: 1, limit: 9 });
      real.emit({ type: 'autopilot', phase: 'continued', runId: 'r1', n: 2, limit: 9 });
      await until(() => real.fake.autopilotCalls.some((c) => c.reason === 'no-progress'));
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }

  // ---- review: a setup that hangs is bounded; Stop and End always release; a late answer never re-engages ----
  {
    const hang = <T>(): Promise<T> => new Promise<T>(() => undefined);
    const a1 = await office({ org: () => hang(), setupWaitMs: 15 });
    assert.strictEqual((await turnOn(a1)).error, ORG_UNREAD, 'a read that hangs refuses');
    assert.strictEqual(a1.ops.engaged(a1.id), false);
    const a2 = await office({ mode: 'ask', ensureLive: () => hang(), setupWaitMs: 15 });
    a2.fake.isLive = () => false;
    const r2 = await turnOn(a2);
    assert.match(String(r2.error), /did not answer in time/);
    assert.strictEqual(a2.ops.engaged(a2.id), false);
    assert.strictEqual(a2.a.permMode, 'ask', 'nothing moved');
    // the adapter's call hangs: limit, told off at once, and told off again if its answer comes later
    const a3 = await office({ setupWaitMs: 15 });
    const real3 = a3.fake.setAutopilot!;
    let answer3: () => void = () => undefined;
    a3.fake.setAutopilot = async (s, c, why) => { if (c) await new Promise<void>((res) => { answer3 = res; }); await real3.call(a3.fake, s, c, why); };
    assert.match(String((await turnOn(a3)).error), /did not answer in time/);
    assert.strictEqual(a3.ops.engaged(a3.id), false);
    assert.strictEqual(a3.a.autopilot, undefined);
    const offs = a3.fake.autopilotCalls.filter((c) => c.settings === null).length;
    answer3();
    await tick();
    assert.ok(a3.fake.autopilotCalls.filter((c) => c.settings === null).length > offs, 'a late on is taken straight back');
    assert.strictEqual(a3.a.autopilot, undefined, 'and does not re-engage');
    assert.strictEqual(a3.ops.engaged(a3.id), false);
    // Stop and End release at once, with no limit near
    for (const how of ['agents:stop', 'agents:end'] as const) {
      const b1 = await office({ org: () => hang() });
      const p1 = turnOn(b1);
      await until(() => b1.ops.engaged(b1.id));
      void b1.call(how, b1.id);
      assert.strictEqual(b1.ops.engaged(b1.id), false, `${how}: released in the same tick`);
      assert.strictEqual((await p1).error, CHANGED, `${how}: the hung read ended`);
      const b2 = await office({ confirm: () => hang() });
      const p2 = turnOn(b2);
      await until(() => b2.ops.engaged(b2.id));
      await tick();
      void b2.call(how, b2.id);
      assert.strictEqual((await p2).error, CHANGED, `${how}: a dialog with no answer`);
      const b3 = await office();
      b3.fake.stop = () => hang();
      const real = b3.fake.setAutopilot!;
      let go: () => void = () => undefined;
      b3.fake.setAutopilot = async (s, c, why) => { if (c) await new Promise<void>((res) => { go = res; }); await real.call(b3.fake, s, c, why); };
      const p3 = turnOn(b3);
      await until(() => onHold(go));
      void b3.call(how, b3.id);
      assert.strictEqual((await p3).ok, false, `${how}: the adapter's hung call`);
      go();
      await tick();
      assert.strictEqual(b3.a.autopilot, undefined, 'its late answer changes nothing');
      assert.strictEqual(b3.ops.engaged(b3.id), false);
      // and it can be turned on again after
      const b4 = await office({ org: () => hang(), setupWaitMs: 15 });
      await turnOn(b4);
      b4.ops.stopSeen(b4.id);
      assert.strictEqual(b4.ops.engaged(b4.id), false);
    }
    // a run started during setup: the guard stops it, and the answer is not ok
    const c1 = await office();
    const realC = c1.fake.setAutopilot!;
    let goC: () => void = () => undefined;
    c1.fake.setAutopilot = async (s, k, why) => { if (k) await new Promise<void>((res) => { goC = res; }); await realC.call(c1.fake, s, k, why); };
    const pc = turnOn(c1);
    await until(() => onHold(goC));
    c1.emit({ type: 'autopilot', phase: 'started', runId: 'r7', n: 0, limit: 5 });
    goC();
    const rc1 = await pc;
    assert.strictEqual(rc1.ok, false, 'not "on" while the adapter was told off');
    assert.strictEqual(c1.a.autopilot, undefined);
    await tick();
    assert.ok(c1.fake.autopilotCalls.some((c) => c.settings === null));
    // End during setup: a status stopped, or a session that is simply gone
    const c2 = await office();
    const realC2 = c2.fake.setAutopilot!;
    let goC2: () => void = () => undefined;
    c2.fake.setAutopilot = async (s, k, why) => { if (k) await new Promise<void>((res) => { goC2 = res; }); await realC2.call(c2.fake, s, k, why); };
    const pc2 = turnOn(c2);
    await until(() => onHold(goC2));
    c2.emit({ type: 'status', status: 'stopped' });
    goC2();
    assert.strictEqual((await pc2).ok, false);
    assert.strictEqual(c2.a.autopilot, undefined);
    const c3 = await office();
    const realC3 = c3.fake.setAutopilot!;
    let goC3: () => void = () => undefined;
    c3.fake.setAutopilot = async (s, k, why) => { if (k) await new Promise<void>((res) => { goC3 = res; }); await realC3.call(c3.fake, s, k, why); };
    const pc3 = turnOn(c3);
    await until(() => onHold(goC3));
    c3.fake.isLive = () => false;
    goC3();
    assert.strictEqual((await pc3).ok, false, 'not live: not on');
    assert.strictEqual(c3.a.autopilot, undefined);
  }

  // ---- review: errors are masked, then cut, in main: a bare token across the cut leaves no prefix ----
  {
    const token = 'ghp_' + 'abcDEF123'.repeat(5);
    for (const pad of [190, 280, 295]) {
      const x = await office({ mode: 'ask' });
      x.fake.setAutopilot = async () => { throw new Error('x'.repeat(pad) + ' ' + token + ' end'); };
      const r = await turnOn(x);
      assert.ok(!/ghp_|abcDEF/.test(String(r.error)), `refused: ${pad}`);
      assert.ok(String(r.error).length <= 300);
      assert.ok(!/ghp_|abcDEF/.test(x.says.join()), `the chat line: ${pad}`);
      const y = await office();
      await turnOn(y);
      y.fake.setAutopilot = async () => { throw new Error('y'.repeat(pad) + ' ' + token); };
      const ry = await y.ops.off(y.id);
      assert.ok(!/ghp_|abcDEF/.test(String(ry.note)), `the note: ${pad}`);
    }
  }

  // ---- review: main's state reaches the window with no event: a stop with no run, turning on, a closed session ----
  {
    const x = await office();
    await turnOn(x);
    assert.deepStrictEqual(x.pushed, [{ limit: 5, hours: 2 }]);
    await x.call('agents:stop', x.id);
    assert.deepStrictEqual(x.pushed.at(-1), null, 'Stop on a typed turn: no run, no ended event, and the chip follows');
    const y = await office();
    await turnOn(y);
    y.emit({ type: 'status', status: 'stopped' });
    assert.strictEqual(y.pushed.at(-1), null);
    const z = await office();
    await turnOn(z);
    await z.call('agents:setMode', z.id, 'allow', {});
    assert.strictEqual(z.pushed.at(-1), null);
    const w = await office();
    await turnOn(w);
    w.ops.forget(w.id);
    assert.strictEqual(w.pushed.at(-1), null);
  }

  // ---- both `forget` calls: what the session spent goes with it, also where the adapter's stop says nothing ----
  {
    const x = await office();
    x.fake.stop = async () => undefined;
    x.emit({ type: 'usage', nanoAiu: 40e9 });
    await x.call('agents:end', x.id);
    assert.strictEqual((await turnOn(x, { limit: 5, cap: 35 })).ok, true, 'agents:end forgets');
    const y = await office();
    y.fake.stop = async () => undefined;
    y.agents.set('other', { id: 'other', cwd: y.a.cwd } as never);
    y.emit({ type: 'usage', nanoAiu: 40e9 });
    assert.strictEqual((await y.call('agents:remove', y.id)).ok, true);
    y.agents.set(y.id, y.a);
    y.router.bind(y.id, 'fake');
    assert.strictEqual((await turnOn(y, { limit: 5, cap: 35 })).ok, true, 'agents:remove forgets');
  }

  // ---- T098, FR-009: Stop, and only Stop ----
  {
    const x = await office();
    await turnOn(x);
    for (const notStop of [null, undefined, 'stop', {}, { kind: 'stop', limit: 5 }, { kind: 'send', text: 'hi' }, { kind: 'mode', mode: 'allow' }, { kind: 'cap', cap: 1 }, { kind: 'answer' }, { kind: 'on' }, ['stop']]) {
      assert.strictEqual((await x.ops.remoteStop(x.id, notStop)).ok, false, JSON.stringify(notStop));
      assert.ok(x.a.autopilot, 'still on');
    }
    assert.strictEqual((await x.ops.remoteStop(x.id, { kind: 'stop' })).ok, true);
    assert.strictEqual(x.a.autopilot, undefined);
    assert.strictEqual(x.fake.autopilotCalls.at(-1)?.reason, 'stopped');
    assert.strictEqual((await x.ops.remoteStop(x.id, { kind: 'stop' })).ok, false, 'never turns anything on');
    assert.strictEqual(onCalls(x).length, 1);
    const main0 = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'), 'utf8');
    const under = (d: string): string[] => fs.readdirSync(path.join(__dirname, '..', '..', d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? under(path.join(d, e.name)) : [path.join(d, e.name)]));
    const reach = under('src').filter((f) => /\.(ts|js)$/.test(f) && !f.endsWith('autopilotops.ts') && /remoteStop/.test(fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8')));
    assert.deepStrictEqual(reach, [], '[KNOWN GAP]: no transport reaches it yet');
    assert.ok(main0);
  }

  // ---- T032: a due schedule on a session on Autopilot is not sent, and a stored `autopilot` is refused ----
  {
    let sends = 0;
    let onAuto = true;
    const doc = { pausedAll: false, schedules: [{ id: 'abcd1234', folder: '/f', prompt: 'p', every: 60, at: 1 }] };
    const timers: Array<() => void> = [];
    const clock = { t: 1_000_000 };
    const make = (d: unknown, send = async () => { sends++; return 's1'; }) => new Scheduler(d as never, { now: () => clock.t, mono: () => clock.t, isBusy: () => false, hasSession: () => true, send, setTimer: (_ms: number, fn: () => void) => { timers.push(fn); return 0; }, clearTimer: () => undefined, save: () => undefined, changed: () => undefined, onAutopilot: () => onAuto, capUnitOf: () => undefined } as never);
    const s = make(JSON.parse(JSON.stringify(doc)));
    const sch = s.doc.schedules[0] as { next?: number; last?: { outcome: string } };
    sch.next = clock.t - 1;
    await s.tick();
    assert.strictEqual(sends, 0, 'not sent');
    assert.strictEqual(sch.last?.outcome, 'skipped-autopilot', 'the run log says why');
    assert.deepStrictEqual(s.runsOf('abcd1234').map((r) => r.outcome), ['skipped-autopilot']);
    assert.strictEqual((await s.runNow('abcd1234')).ok, false, 'Run now too');
    assert.strictEqual(sends, 0);
    onAuto = false;
    sch.next = clock.t - 1;
    await s.tick();
    assert.strictEqual(sends, 1, 'off Autopilot it goes as before');
    // turned on while the send waited for its session: main's send throws, and it is the same outcome
    const t = make(JSON.parse(JSON.stringify(doc)), async () => { throw AUTOPILOT_HELD; });
    const tc = t.doc.schedules[0] as { next?: number; last?: { outcome: string } };
    tc.next = clock.t - 1;
    await t.tick();
    assert.strictEqual(tc.last?.outcome, 'skipped-autopilot');
    // stored
    const { parseSchedules } = await import('../src/main/schedules');
    const parsed = parseSchedules(JSON.stringify({ schedules: [{ id: 'efgh5678', folder: '/f', prompt: 'p', every: 60, at: 1, mode: 'autopilot' }] }), clock.t);
    assert.strictEqual(parsed.schedules[0].mode, 'autopilot', 'kept, so it is refused and not sent in the session\'s mode');
    const st = make(parsed);
    onAuto = false;
    const sc = st.doc.schedules[0] as { next?: number; last?: { outcome: string } };
    sc.next = clock.t - 1;
    const sent0 = sends;
    await st.tick();
    assert.strictEqual(sends, sent0, 'a stored autopilot is never sent');
    assert.strictEqual(sc.last?.outcome, 'skipped-autopilot');
    // an Edit or a Pause keeps the marker: it stays refused, and never runs in the session's mode
    const kept = st.save({ id: 'efgh5678', edit: true, prompt: 'new words', every: 60 }, () => true);
    assert.strictEqual(kept.ok, true, JSON.stringify(kept));
    assert.strictEqual((kept as { schedule: { mode?: string } }).schedule.mode, 'autopilot', 'an edit keeps it');
    const paused = st.save({ id: 'efgh5678', folder: '/f', prompt: 'new words', every: 60, paused: true }, () => true);
    assert.strictEqual((paused as { schedule: { mode?: string } }).schedule.mode, 'autopilot', 'a Pause keeps it');
    // a loop: not a pass, and when it went on Autopilot during the send, not an error either
    const loopDoc = (): unknown => ({ pausedAll: false, schedules: [{ id: 'loop1234', folder: '/f', prompt: 'p', target: { session: 's1', agent: 'copilot' }, loop: { minDelay: 5, maxDelay: 60, defaultDelay: 30, maxPasses: 9, passes: 2, endAt: clock.t + 1e9 }, next: clock.t - 1 }] });
    let loopSends = 0;
    onAuto = true;
    const lp = make(parseSchedules(JSON.stringify(loopDoc()), clock.t), async () => { loopSends++; return 's1'; });
    (lp.doc.schedules[0] as { next?: number }).next = clock.t - 1;
    await lp.tick();
    assert.strictEqual(loopSends, 0, 'a due pass is not sent');
    assert.strictEqual(lp.runsOf('loop1234')[0]?.outcome, 'skipped-autopilot');
    assert.strictEqual(lp.doc.schedules[0].loop?.passes, 2, 'not a pass');
    onAuto = false;
    const lr = make(parseSchedules(JSON.stringify(loopDoc()), clock.t), async () => { throw AUTOPILOT_HELD; });
    (lr.doc.schedules[0] as { next?: number }).next = clock.t - 1;
    await lr.tick();
    assert.strictEqual(lr.runsOf('loop1234')[0]?.outcome, 'skipped-autopilot', 'the race: not failed');
    const lc = lr.doc.schedules[0].loop!;
    assert.strictEqual(lc.passes, 2, 'the race: not a pass');
    assert.ok(!lc.inPass && !lc.ended);
    assert.ok(!lc.errorStreak, 'the race: no error counted');
    // the door: stays there
    let doorSends = 0;
    onAuto = true;
    const dr = make(JSON.parse(JSON.stringify(doc)), async () => { doorSends++; return 's1'; });
    assert.strictEqual(await dr.releaseDoorRun('abcd1234', 'p'), 'busy');
    assert.strictEqual(doorSends, 0);
    onAuto = false;
    const dr2 = make(JSON.parse(JSON.stringify(doc)), async () => { throw AUTOPILOT_HELD; });
    assert.strictEqual(await dr2.releaseDoorRun('abcd1234', 'p'), 'busy', 'the race too');
    const made = st.save({ folder: '/f', prompt: 'p', every: 60, mode: 'autopilot' }, () => true);
    assert.strictEqual(made.ok, false);
    assert.match(String((made as { error?: string }).error), /not available/);
    assert.strictEqual((await st.runNow('efgh5678')).ok, false);
  }

  // ---- T030: the Claude replay ----
  {
    const lines = [{ type: 'user', message: { content: '/goal clear' } }, { type: 'user', message: { content: 'hello' } }].map((o) => JSON.stringify(o)).join('\n');
    assert.deepStrictEqual(claudeHistoryFromText(lines, {}, true).items.map((i) => (i as { text?: string }).text), ['hello'], "FR-053: Durbar's own clear is left out once wired");
    assert.deepStrictEqual(claudeHistoryFromText(lines).items.map((i) => (i as { text?: string }).text), ['/goal clear', 'hello'], 'the default build: unchanged');
  }

  // ---- main.ts: the lines that hand this over cannot run here ----
  const mainTs = codeOf(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'), 'utf8'));
  for (const line of [
    "const autopilotOn = (): boolean => AUTOPILOT_WIRED || autopilotTestGate(process.env, app.isPackaged);",
    "confirm: (o) => nativeConfirm(win, o),",
    "remoteOn: (id) => remoteOps.engaged(id),",
    "org: (a) => orgPolicies.autopilotRefusal(appIdOf(a.id)),",
    "router.setEventGuard((e) => autopilotOps.accepts(e));",
    "autopilotOn: (id) => autopilotOps.engaged(id) });",
    "endAutopilot: (a) => autopilotOps.endForMode(a), autopilotStopSeen: (id) => autopilotOps.stopSeen(id)",
    "windowAdapters(infos, autopilotOn())",
    "if (autopilotOps.engaged(a.id)) throw AUTOPILOT_HELD;",
    "if (autopilotOn()) query.simautopilot = '1';",
    "changed: (a) => toRenderer('agents:autopilot', { id: a.id, autopilot: a.autopilot ?? null }),",
  ]) assert.ok(mainTs.includes(line), `main.ts: ${line}`);
  assert.ok(mainTs.indexOf('router.setEventGuard(') < mainTs.indexOf("router.onEvent((e) => toRenderer('agent:event'"), 'the guard is set before the window hears anything');
  const sim = codeOf(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'simguard.ts'), 'utf8'));
  assert.ok(!sim.includes('agents:setAutopilot'), 'not on SIM_OPEN_CHANNELS');
  assert.strictEqual(dialogs.length, 0, 'no native box was asked in this file');
  process.exitCode = 0;
  console.log('test-autopilot-ipc: OK');
}
/** Text without comments: a commented-out line pins nothing. */
const codeOf = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const onHold = (go: () => void): boolean => go.toString() !== '() => undefined';
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));
async function until(fn: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) { if (fn()) return; await tick(); }
  assert.fail('until: timed out');
}
void main();
