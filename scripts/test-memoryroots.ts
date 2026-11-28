/**
 * Spec 116 T006 (FR-020, FR-021, FR-023, constitution II): the office memory folder reaches each adapter as a READ path and never as a write root.
 * `npm run test:memoryroots`. Fake runtimes only, no process, no account, no credits. Paths are invented temp folders.
 *
 * Reused (FR-031): `FakeCopilot`/`FakeClient` (`fakes/copilot-sdk`), `FakeCodexServer` (`fakes/codex-app-server`), `fakeSpawn`/`FakeClaudeChild`/
 * `SANDBOX_HOST_OK` (`fakes/claude-cli`), `FakeAdapter` (`src/adapters/fake`), `tmpDir` (`test-tmp`), `codexProfileArgs`, `claudeArgs`.
 *
 * Mutants: like `test-memoryops.ts` (one text replacement in the COMPILED module, an anchor that must match exactly once, each mutant must die in ITS
 * section) but the replacement is made while the module loads (`Module.prototype._compile`), so no file is written and parallel suites are not
 * disturbed. This file runs again in a child with `MEMORYROOTS_MUTANT`.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { spawnSync } from 'child_process';

interface Mutant { name: string; file: string; from: string; to: string; section: string }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module') as { prototype: { _compile: (this: unknown, content: string, filename: string) => unknown } };
const MUT = process.env.MEMORYROOTS_MUTANT ? (JSON.parse(process.env.MEMORYROOTS_MUTANT) as Mutant) : undefined;
if (MUT) {
  const proto = Module.prototype;
  const orig = proto._compile;
  let hit = 0;
  proto._compile = function (this: unknown, content: string, filename: string) {
    if (filename.split(path.sep).join('/').endsWith(MUT.file)) {
      const lf = content.replace(/\r\n/g, '\n');
      assert.ok(lf.includes(MUT.from), 'mutant anchor not found: ' + MUT.name);
      content = lf.split(MUT.from).join(MUT.to);
      hit++;
    }
    return orig.call(this, content, filename);
  };
  process.on('exit', () => { if (hit === 0) console.error('mutant file never loaded: ' + MUT.name); });
}

import { PermissionBroker } from '../src/adapters/permissions';
import type { BrokerEvent } from '../src/adapters/permissions';
import { decideTool, preToolUseDecision, readIsInsideRoots } from '../src/adapters/claudeModes';
import { codexProfileArgs } from '../src/adapters/codexModes';
import { ClaudeAdapter, claudeArgs } from '../src/adapters/claude';
import { createCliTransport } from '../src/adapters/claudeTransport';
import { CodexAdapter } from '../src/adapters/codex';
import { FakeAdapter } from '../src/adapters/fake';
import type { AgentEvent, PermissionInfo, PermissionMode, StartOptions } from '../src/adapters/types';
import { startOptionsOf } from '../src/main/startopts';
import { MemoryOps } from '../src/main/memoryops';
import { SettingsStore } from '../src/main/settings';
import { FakeClient, FakeCopilot } from './fakes/copilot-sdk';
import { FakeCodexServer } from './fakes/codex-app-server';
import { FakeClaudeChild, fakeSpawn, SANDBOX_HOST_OK } from './fakes/claude-cli';
import { tmpDir } from './test-tmp';

let n = 0;
const eq = <T>(a: T, b: T, m: string): void => { n++; assert.deepStrictEqual(a, b, m); };
const ok = (c: unknown, m: string): void => { n++; assert.ok(c, m); };

const base = tmpDir('durbar-memroots-');
// the NATIVE real path, as main and Codex's roots use it: on Windows the JS `realpathSync` keeps a short 8.3 name (RUNNER~1) that never matches a native root (F5)
const real = (p: string): string => fs.realpathSync.native(p);
const proj = real((fs.mkdirSync(path.join(base, 'proj')), path.join(base, 'proj')));
const mem = real((fs.mkdirSync(path.join(base, 'mem')), path.join(base, 'mem')));
const memSibling = real((fs.mkdirSync(path.join(base, 'mem-other')), path.join(base, 'mem-other')));
const outside = real((fs.mkdirSync(path.join(base, 'outside')), path.join(base, 'outside')));
fs.writeFileSync(path.join(mem, 'note.md'), 'a note');
fs.writeFileSync(path.join(outside, 'secret.txt'), 'not for the agent');
let linkOk = true;
try { fs.symlinkSync(outside, path.join(mem, 'link'), 'dir'); } catch { linkOk = false; } // Windows without the privilege: the link cases say so and are skipped
const IN = path.join(mem, 'note.md');
const NEW_IN = path.join(mem, 'sub', 'new.md');
const VIA_LINK = path.join(mem, 'link', 'secret.txt');
const SIBLING = path.join(memSibling, 'x.md');
const OUT = path.join(outside, 'secret.txt');

const MODES: PermissionMode[] = ['read-only', 'ask', 'allow'];

/** the permission records of an event list, by request id */
const permsOf = (events: AgentEvent[], id: string): PermissionInfo[] =>
  events.flatMap((e) => ('permission' in e && e.permission && (e.permission as PermissionInfo).requestId === id ? [e.permission as PermissionInfo] : []));

interface Target {
  /** starts a session in `proj`; returns the session id */
  start(mode: PermissionMode, readOnly: string[] | undefined): Promise<string>;
  /** a tool call through that adapter's own broker */
  request(sid: string, req: Record<string, unknown>): Promise<{ kind: string }>;
  /** every pending question, answered "no" (so a request waiting for the user settles) */
  denyPending(sid: string): void;
  events: AgentEvent[];
  /** a write the way THIS adapter builds it (Claude Code `permissionLikeOf`: path + fileName; Codex `codexPermission`: fileName + paths; others fileName) */
  write?(p: string): Record<string, unknown>;
}

/** what one request came to: `read:<allowedBy kind>`, `denied`, `asked` (pending, waits for the user) or `approved` */
async function outcome(t: Target, sid: string, req: Record<string, unknown>): Promise<string> {
  const id = String(req.toolCallId);
  const p = t.request(sid, req);
  const settled = await Promise.race([p.then((r) => r), new Promise<null>((r) => setTimeout(() => r(null), 25))]);
  if (settled === null) { // still waiting: the user is being asked
    const asked = permsOf(t.events, id).some((x) => x.state === 'pending');
    t.denyPending(sid);
    await p;
    return asked ? 'asked' : 'waiting-without-card';
  }
  const ps = permsOf(t.events, id);
  if (settled.kind !== 'approve-once') return ps.some((x) => x.state === 'denied') ? 'denied' : 'rejected';
  const by = ps.find((x) => x.allowedBy)?.allowedBy;
  return by ? `read:${by.kind}` : 'approved';
}

let ctr = 0;
const read = (p: string): Record<string, unknown> => ({ kind: 'read', path: p, toolCallId: 'r' + ++ctr });
const write = (t: Target, p: string): Record<string, unknown> => ({ ...(t.write ? t.write(p) : { kind: 'write', fileName: p }), toolCallId: 'w' + ++ctr });

// ---------- the four targets ----------
function fakeTarget(): Target {
  const ad = new FakeAdapter();
  const events: AgentEvent[] = [];
  ad.onEvent((e) => events.push(e));
  const brokerOf = (sid: string) => (ad as unknown as { sessions: Map<string, { broker: PermissionBroker }> }).sessions.get(sid)!.broker;
  return {
    events,
    start: (mode, readOnlyFolders) => ad.start({ workspace: proj, permissionMode: mode, quiet: true, ...(readOnlyFolders ? { readOnlyFolders } : {}) }),
    request: (sid, req) => brokerOf(sid).request(req as never),
    denyPending: (sid) => { brokerOf(sid).denyPendingByUser(); },
  };
}

function copilotTarget(): Target & { client: FakeClient } {
  const client = new FakeClient();
  const ad = new FakeCopilot(client);
  const events: AgentEvent[] = [];
  ad.onEvent((e) => events.push(e));
  const handler = (sid: string) => client.sessions.get(sid)!.config.onPermissionRequest as (r: unknown) => Promise<{ kind: string }>;
  const brokerOf = (sid: string) => (ad as unknown as { sessions: Map<string, { broker: PermissionBroker }> }).sessions.get(sid)!.broker;
  return {
    client,
    events,
    start: (mode, readOnlyFolders) => ad.start({ workspace: proj, model: 'auto', permissionMode: mode, quiet: true, ...(readOnlyFolders ? { readOnlyFolders } : {}) }),
    request: (sid, req) => handler(sid)(req),
    denyPending: (sid) => { brokerOf(sid).denyPendingByUser(); },
  };
}

const tick = (ms = 2): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, f: () => T | undefined, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v !== undefined && v !== false) return v;
    if (Date.now() > end) throw new assert.AssertionError({ message: `timed out waiting for ${what}` });
    await tick();
  }
}

function claudeTarget(): Target & { ad: ClaudeAdapter; sp: ReturnType<typeof fakeSpawn>; session(sid: string): { roots: string[]; readRoots: string[]; broker: PermissionBroker } } {
  const sp = fakeSpawn();
  sp.next = (c: FakeClaudeChild): void => {
    c.onWrite = (o) => {
      if (o.type === 'control_request' && (o.request as { subtype: string }).subtype === 'initialize') setTimeout(() => c.send({ type: 'control_response', response: { subtype: 'success', request_id: o.request_id, response: {} } }), 0);
      else if (o.type === 'user') setTimeout(() => c.send({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } }), 0);
    };
  };
  const ad = new ClaudeAdapter({
    autopilot: { wired: false },
    sandboxFacts: SANDBOX_HOST_OK,
    claudePath: async () => '/usr/local/bin/claude',
    makeTransport: (x) => createCliTransport({ file: x.file, args: claudeArgs(x.launch), cwd: x.cwd, env: x.env, handlers: x.handlers, spawn: sp.spawn, closeGraceMs: 10, killGraceMs: 10 }),
    sessionExists: () => false,
    claudeMd: () => undefined,
    env: () => ({ PATH: '/usr/bin' }),
  });
  const events: AgentEvent[] = [];
  ad.onEvent((e) => events.push(e));
  const session = (sid: string) => (ad as unknown as { sessions: Map<string, { roots: string[]; readRoots: string[]; broker: PermissionBroker }> }).sessions.get(sid)!;
  return {
    ad, sp, session, events,
    start: (mode, readOnlyFolders) => ad.start({ workspace: proj, permissionMode: mode, quiet: true, ...(readOnlyFolders ? { readOnlyFolders } : {}) }),
    write: (p) => ({ kind: 'write', toolName: 'Write', path: p, fileName: p }),
    request: (sid, req) => session(sid).broker.request(req as never),
    denyPending: (sid) => { session(sid).broker.denyPendingByUser(); },
  };
}

function codexTarget(): Target & { server: FakeCodexServer } {
  const server = new FakeCodexServer();
  const ad = new CodexAdapter({ spawn: server.spawn, locate: async () => ({ path: path.join(os.tmpdir(), 'fake-codex-bin'), version: '0.163.0' }), platform: 'linux', env: {}, appVersion: '9.9.9', closeGraceMs: 20, killGraceMs: 20 });
  const events: AgentEvent[] = [];
  ad.onEvent((e) => events.push(e));
  const brokerOf = (sid: string) => (ad as unknown as { sessions: Map<string, { broker: PermissionBroker }> }).sessions.get(sid)!.broker;
  return {
    server, events,
    write: (p) => ({ kind: 'write', fileName: p, paths: [p] }),
    start: (mode, readOnlyFolders) => ad.start({ workspace: proj, permissionMode: mode, quiet: true, ...(readOnlyFolders ? { readOnlyFolders } : {}) }),
    request: (sid, req) => brokerOf(sid).request(req as never),
    denyPending: (sid) => { brokerOf(sid).denyPendingByUser(); },
  };
}

/** The permission matrix every adapter must give (T006): reads inside are quiet and tagged, writes are never opened. */
async function matrix(make: () => Target, label: string): Promise<void> {
  // memory ON: Read-only and Ask first
  for (const mode of ['read-only', 'ask'] as const) {
    const t = make();
    const sid = await t.start(mode, [mem]);
    eq(await outcome(t, sid, read(IN)), 'read:in-memory', `${label} ${mode}: a read inside the memory folder is approved and tagged in-memory`);
    eq(await outcome(t, sid, read(NEW_IN)), 'read:in-memory', `${label} ${mode}: a read of a path not there yet, inside the folder, is the same`);
    eq(await outcome(t, sid, read(path.join(proj, 'a.ts'))), 'read:in-folder', `${label} ${mode}: a read in the project folder keeps its own reason`);
    eq(await outcome(t, sid, write(t, IN)), mode === 'ask' ? 'asked' : 'denied', `${label} ${mode}: a write inside the memory folder is ${mode === 'ask' ? 'asked' : 'denied'}`);
    eq(await outcome(t, sid, write(t, NEW_IN)), mode === 'ask' ? 'asked' : 'denied', `${label} ${mode}: so is a new file there`);
    const outRead = mode === 'ask' ? 'asked' : 'denied';
    eq(await outcome(t, sid, read(OUT)), outRead, `${label} ${mode}: a read outside everything is ${outRead}`);
    eq(await outcome(t, sid, read(SIBLING)), outRead, `${label} ${mode}: a sibling folder that only shares the name prefix is outside`);
    if (linkOk) eq(await outcome(t, sid, read(VIA_LINK)), outRead, `${label} ${mode}: a read through a link out of the memory folder is outside`);
  }
  // Allow all: unchanged (a read is the mode's own reason, never in-memory; a write the mode's own approval)
  for (const withMem of [true, false]) {
    const t = make();
    const sid = await t.start('allow', withMem ? [mem] : undefined);
    eq(await outcome(t, sid, read(IN)), 'read:allow-all', `${label} allow (memory ${withMem ? 'on' : 'off'}): a read says Allow all, as before`);
    eq((await t.request(sid, write(t, IN))).kind, 'approve-once', `${label} allow: a write is approved by the mode, as before`);
  }
  // memory OFF: nothing is added
  for (const mode of ['read-only', 'ask'] as const) {
    for (const opts of [undefined, []] as const) {
      const t = make();
      const sid = await t.start(mode, opts as string[] | undefined);
      const outRead = mode === 'ask' ? 'asked' : 'denied';
      eq(await outcome(t, sid, read(IN)), outRead, `${label} ${mode} memory off (${opts ? 'empty list' : 'no list'}): the folder is just outside`);
      eq(await outcome(t, sid, read(path.join(proj, 'a.ts'))), 'read:in-folder', `${label} ${mode} memory off: the project folder is unchanged`);
    }
  }
  // a hostile or broken list: relative paths and non-strings are not roots
  const t = make();
  const sid = await t.start('read-only', ['relative/folder', '', 7 as unknown as string, mem]);
  eq(await outcome(t, sid, read(IN)), 'read:in-memory', `${label}: a bad entry in the list is skipped, a good one still works`);
  eq(await outcome(t, sid, read(path.resolve('relative/folder/x'))), 'denied', `${label}: a relative entry is not a root`);
}

const sections: Array<[string, () => Promise<void>]> = [];
const section = (name: string, fn: () => Promise<void>): void => { sections.push([name, fn]); };

section('broker', async () => {
  // the broker itself: two lists, two reasons, a write never looks at either
  const ev: BrokerEvent[] = [];
  const b = new PermissionBroker({ roots: [proj], mode: 'read-only', emit: (e) => ev.push(e) });
  b.allowReadPaths([path.join(outside, 'attached.png')]);
  b.allowReadPaths([mem], 'in-memory');
  eq(b.memoryReadRoots(), [mem], 'the broker names its memory roots');
  const by = async (p: string): Promise<unknown> => { ev.length = 0; await b.request({ kind: 'read', path: p, toolCallId: 'x' } as never); return ev.map((e) => ('permission' in e ? e.permission.allowedBy?.kind : undefined)).find(Boolean); };
  eq(await by(path.join(outside, 'attached.png')), 'attachment', 'an attached file keeps the attachment reason');
  eq(await by(IN), 'in-memory', 'a memory file says in-memory');
  eq((await b.request({ kind: 'write', fileName: IN, toolCallId: 'w' } as never)).kind, 'reject', 'a write in the memory folder is rejected in Read-only');
  // attachments never turn into memory roots, and the other way round
  const b2 = new PermissionBroker({ roots: [proj], mode: 'read-only', emit: () => undefined });
  b2.allowReadPaths([mem]);
  eq(b2.memoryReadRoots(), [], 'the default reason is the attachment one');
});

section('fake', () => matrix(fakeTarget, 'fake'));
section('copilot', async () => {
  await matrix(copilotTarget, 'copilot');
  // the SDK option that may grant writes is never given the memory folder (T005 R1), create and resume, any mode
  for (const mode of MODES) {
    const t = copilotTarget();
    await t.start(mode, [mem]);
    ok(!('additionalDirectories' in t.client.created[0]), `copilot ${mode}: no additionalDirectories for the memory folder`);
    const again = new FakeClient();
    await new FakeCopilot(again).start({ workspace: proj, model: 'auto', permissionMode: mode, quiet: true, resumeSessionId: 'old-1', readOnlyFolders: [mem] });
    ok(again.resumed.length === 1 && !('additionalDirectories' in again.resumed[0].config), `copilot ${mode}: nor on resume`);
  }
});
section('claude', async () => {
  await matrix(() => claudeTarget(), 'claude');
  for (const mode of MODES) {
    const t = claudeTarget();
    const sid = await t.start(mode, [mem]);
    const s = t.session(sid);
    eq(s.roots, [proj], `claude ${mode}: the session roots are the project folder only (they become --add-dir and write roots)`);
    eq(s.readRoots, [mem], `claude ${mode}: the memory folder is in the separate read list`);
    await t.ad.send(sid, { text: 'hi' });
    const call = await until('spawn', () => t.sp.calls[0]);
    ok(!call.args.includes('--add-dir'), `claude ${mode}: no --add-dir at all`);
    ok(!call.args.some((a) => a.includes(mem)), `claude ${mode}: the memory folder is on no argument of the CLI`);
  }
  // the read-only hook (preToolUseDecision), through the adapter's own method, and the pure decisions
  const t = claudeTarget();
  const sid = await t.start('read-only', [mem]);
  const s = t.session(sid);
  const hook = (tool: string, input: Record<string, unknown>) => (t.ad as unknown as { hookDecision(s: unknown, tool: string, i: unknown, id: string): Promise<Record<string, unknown>> }).hookDecision(s, tool, input, 'u');
  eq(await hook('Read', { file_path: IN }), {}, 'claude hook, Read-only: a read inside the memory folder has no objection');
  ok(JSON.stringify(await hook('Read', { file_path: OUT })).includes('deny'), 'claude hook, Read-only: a read outside is denied');
  ok(JSON.stringify(await hook('Write', { file_path: IN })).includes('deny'), 'claude hook, Read-only: a write inside the memory folder is denied');
  ok(JSON.stringify(await hook('Edit', { file_path: NEW_IN })).includes('deny'), 'claude hook, Read-only: an edit there is denied');
  if (linkOk) ok(JSON.stringify(await hook('Read', { file_path: VIA_LINK })).includes('deny'), 'claude hook, Read-only: a read through a link out of the folder is denied');
  // F3: a RELATIVE entry is no root: not in the session's list, and a read there is denied by the hook
  const rel = claudeTarget();
  const rsid = await rel.start('read-only', ['relative/dir']);
  eq(rel.session(rsid).readRoots, [], 'F3 claude: a relative readOnlyFolders entry gives no read root');
  const relHook = (f: string) => (rel.ad as unknown as { hookDecision(s: unknown, tool: string, i: unknown, id: string): Promise<Record<string, unknown>> }).hookDecision(rel.session(rsid), 'Read', { file_path: f }, 'u');
  ok(JSON.stringify(await relHook(path.resolve('relative/dir/x'))).includes('deny'), 'F3 claude hook: a read under the relative entry (resolved) is denied');
  const roots = [proj];
  eq(decideTool('read-only', 'Read', { file_path: IN }, roots, undefined, [mem]).behavior, 'allow', 'decideTool read-only: read inside');
  eq(decideTool('ask', 'Read', { file_path: IN }, roots, undefined, [mem]).behavior, 'allow', 'decideTool ask: read inside');
  eq(decideTool('read-only', 'Write', { file_path: IN }, roots, undefined, [mem]).behavior, 'deny', 'decideTool read-only: write inside is denied');
  eq(decideTool('ask', 'Write', { file_path: IN }, roots, undefined, [mem]).behavior, 'ask', 'decideTool ask: write inside is asked');
  eq(decideTool('ask', 'Read', { file_path: OUT }, roots, undefined, [mem]).behavior, 'ask', 'decideTool ask: read outside is asked');
  eq(decideTool('allow', 'Write', { file_path: IN }, roots, undefined, [mem]).behavior, 'allow', 'decideTool allow: unchanged');
  eq(decideTool('read-only', 'Read', { file_path: IN }, roots, undefined, undefined).behavior, 'deny', 'decideTool: no read list, the folder is outside');
  eq(decideTool('read-only', 'Grep', { pattern: 'x', path: mem }, roots, undefined, [mem]).behavior, 'allow', 'a Grep in the memory folder is a read');
  ok(readIsInsideRoots('Glob', { pattern: '*.md' }, roots, undefined, [mem]), 'a Glob with no path stays in the first session root');
  // a folder rule that allows the Write tool covers the TOOL, never a file in the memory folder (writeIsInsideRoots never sees the read list)
  ok(preToolUseDecision('read-only', 'Write', { file_path: IN }, roots, undefined, ['Write'], [mem]) !== undefined, 'a folder rule allowing Write does not open the memory folder to writes');
  eq(preToolUseDecision('read-only', 'Write', { file_path: path.join(proj, 'a.ts') }, roots, undefined, ['Write'], [mem]), undefined, 'the same rule still allows a write in the project folder');
  eq(preToolUseDecision('read-only', 'Read', { file_path: IN }, roots, undefined, ['Read'], [mem]), undefined, 'a folder rule allowing Read still passes a memory read');
});
section('codex', async () => {
  await matrix(codexTarget, 'codex');
  for (const mode of ['read-only', 'ask'] as const) {
    const t = codexTarget();
    await t.start(mode, [mem]);
    eq(t.server.spawns[0].args, ['app-server', ...codexProfileArgs([mem])], `codex ${mode}: one extra "<memory>"="read" entry in the durbar_ro profile`);
    ok(t.server.spawns[0].args.join(' ').includes(`"${mem.replace(/\\/g, '\\\\')}"="read"`), `codex ${mode}: that entry is a read entry`);
    ok(!/"write"|"deny"/.test(t.server.spawns[0].args.join(' ')), `codex ${mode}: the profile has no write entry`);
    const ts = t.server.requests('thread/start')[0].params as { runtimeWorkspaceRoots?: string[] };
    eq(ts.runtimeWorkspaceRoots, [proj], `codex ${mode}: runtimeWorkspaceRoots (the workspace, where writes can go) is the project folder only`);
  }
  for (const withMem of [true, false]) {
    const t = codexTarget();
    await t.start('allow', withMem ? [mem] : undefined);
    eq(t.server.spawns[0].args, ['app-server', ...codexProfileArgs()], `codex allow (memory ${withMem ? 'on' : 'off'}): the profile gets nothing`);
    const ts = t.server.requests('thread/start')[0].params as { runtimeWorkspaceRoots?: string[] };
    ok(!(ts.runtimeWorkspaceRoots ?? []).includes(mem), 'codex allow: not a workspace root either');
  }
  for (const opts of [undefined, []] as const) {
    const t = codexTarget();
    await t.start('read-only', opts as string[] | undefined);
    eq(t.server.spawns[0].args, ['app-server', ...codexProfileArgs()], 'codex, memory off: the profile is the old one');
  }
  // a quote or a control character in a path never reaches the TOML (codexReadRoot), the profile only gets narrower
  const bad = codexTarget();
  await bad.start('read-only', [mem + '"x', mem + '\n']);
  eq(bad.server.spawns[0].args, ['app-server', ...codexProfileArgs()], 'codex: an unsafe path is left out');
});

section('startopts', async () => {
  const src = { permMode: 'ask' as const };
  ok(!('readOnlyFolders' in startOptionsOf(src, proj, 'm', undefined)), 'no list: the field is not there');
  ok(!('readOnlyFolders' in startOptionsOf(src, proj, 'm', undefined, [])), 'an empty list: the field is not there');
  eq(startOptionsOf(src, proj, 'm', undefined, [mem]).readOnlyFolders, [mem], 'the memory folder goes on');
  const given = [mem];
  startOptionsOf(src, proj, 'm', undefined, given).readOnlyFolders!.push('x');
  eq(given, [mem], 'the caller list is copied');
});

section('off', async () => {
  const VB = '/work/example.invalid'; const vMem = VB + '/mem'; const vSib = VB + '/mem-other';
  // MemoryOps.readRoots: empty while off, refused, not found; re-checked, never the stored path
  const store = { folder: undefined as string | undefined, on: false, keep: false, get memoryFolder() { return this.folder; }, get memoryOn() { return this.on && this.folder !== undefined; }, get memoryKeepInGit() { return this.keep; }, setMemory: () => true, setMemoryOn: () => true };
  const links: Record<string, string> = {};
  const missing: string[] = [];
  let ctxThrows = false;
  let checkThrows = false;
  const mk = (office: string[] = []): MemoryOps => new MemoryOps({
    store: () => store as never,
    pick: async () => null,
    flavor: { path: path.posix, platform: 'linux' }, // invented POSIX paths: pure logic, the same on every OS
    ctx: () => (ctxThrows ? (() => { throw new Error('ctx broke'); })() : {
      home: path.posix.join(VB, 'home'), userData: path.posix.join(VB, 'userdata'), env: {}, agentHomes: [path.posix.join(VB, 'agenthome')],
      realpath: (p: string) => { if (missing.includes(p)) throw new Error('ENOENT'); return links[p] ?? p; },
      lstat: (p: string) => { if (missing.includes(p)) throw new Error('ENOENT'); return { isDirectory: () => true }; },
    } as never),
    officeFolders: () => { if (checkThrows) throw new Error('a plain error, not a workspace file one'); return office; },
  });
  const ops = mk();
  eq(ops.readRoots(), [], 'no folder stored: nothing');
  store.folder = vMem; store.on = false;
  eq(ops.readRoots(), [], 'a folder stored but the memory off: nothing');
  store.on = true;
  eq(ops.readRoots(), [vMem], 'on and fine: the real path');
  links[vMem] = vSib;
  eq(ops.readRoots(), [vSib], 'a link repointed since: the NEW real path, T002 runs again');
  delete links[vMem];
  missing.push(vMem);
  eq(ops.readRoots(), [], 'the folder is gone (not found): nothing');
  missing.length = 0;
  eq(mk([vMem]).readRoots(), [], 'the folder became an office folder (refused): nothing, though it is still stored');
  store.folder = path.posix.join(VB, 'home');
  eq(ops.readRoots(), [], 'a stored folder that is now refused (the home folder): nothing');
    store.folder = path.posix.join(VB, 'agenthome', 'sub');
  eq(ops.readRoots(), [], 'a stored folder now inside an agent home (ctx.agentHomes, as pick and apply see it): nothing');
  store.folder = vMem;
  eq(ops.readRoots(), [vMem], 'the same ctx still accepts a fine folder');
  // F2: any throw while re-checking gives none, never the stored path
  ctxThrows = true;
  eq(ops.readRoots(), [], 'F2: the ctx throws: no read root, not the stored path');
  ctxThrows = false; checkThrows = true;
  eq(ops.readRoots(), [], 'F2: the office list throws something else: no read root');
  checkThrows = false;
  // F1: the session being started is not in the office yet; the caller names its folders
  eq(ops.readRoots([VB + '/work']), [vMem], 'F1: a starting folder elsewhere gets the memory folder');
  eq(ops.readRoots([VB]), [], 'F1: a starting folder that HOLDS the memory folder gets none');
  eq(ops.readRoots([vMem + '/sub']), [], 'F1: a starting folder INSIDE the memory folder gets none');
  eq(ops.readRoots([vMem]), [], 'F1: a starting folder that IS the memory folder gets none');
  eq(ops.readRoots([]), [vMem], 'F1: no starting folder named: as before');
  store.folder = 'relative/path';
  eq(ops.readRoots(), [], 'a stored relative path: nothing');
});

section('sources', async () => {
  const rd = (f: string): string => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
  const vendor = /copilot|claude|codex|anthropic|openai|@github\//i;
  for (const f of ['src/shared/memoryfolder.ts', 'src/main/memoryops.ts', 'src/shared/chatindex.ts', 'src/main/chatindex.ts']) {
    if (!fs.existsSync(path.join(__dirname, '..', '..', f))) continue;
    const code = rd(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\.(copilot|claude|codex)\b/g, ''); // the dot-folders are T002's denylist DATA (an agent app's own folder), not an adapter or an SDK type
    ok(!vendor.test(code), `${f}: no vendor name or SDK type in code (constitution II)`);
  }
  const types = rd('src/adapters/types.ts');
  ok(/readOnlyFolders\?: string\[\]/.test(types) && /kind: 'in-memory'/.test(types), 'StartOptions.readOnlyFolders and AllowedBy in-memory exist');
  const why = rd('src/renderer/whyallowed.js');
  ok(/case 'in-memory':[\s\S]{0,200}Read in your office memory/.test(why), 'the window words: "Read in your office memory"');
  // every adapter (and no one else) names the folder to its broker with the memory reason
  for (const f of ['copilot', 'claude', 'codex', 'fake']) ok(/allowReadPaths\([^)]*readOnlyFolders[^)]*'in-memory'\)/.test(rd(`src/adapters/${f}.ts`)), `${f}.ts gives readOnlyFolders to the broker as in-memory`);
  const copilot = rd('src/adapters/copilot.ts');
  ok(!/additionalDirectories[^\n]*readOnlyFolders|readOnlyFolders[^\n]*additionalDirectories/.test(copilot), 'copilot.ts never mixes readOnlyFolders into additionalDirectories');
  const claude = rd('src/adapters/claude.ts');
  ok(!/addDirs[^\n]*(readRoots|readOnlyFolders)/.test(claude), 'claude.ts never mixes the read list into addDirs');
  const main = rd('src/main/main.ts');
  ok(/startOptionsOf\([^\n]*readRoots\(startingFolders\(a\)\)/.test(main), 'main fills readOnlyFolders from the memory ops, naming the folders of the session being started (F1)');
});

(async () => {
  let failed = 0;
  for (const [name, fn] of sections) {
    try { await fn(); } catch (e) { failed++; console.error(`SECTION ${name} FAILED`); console.error(e instanceof Error ? e.message.slice(0, 300) : 'failed'); }
  }
  if (failed > 0) { console.error(`memoryroots: ${failed} section(s) failed`); process.exit(1); }
  if (MUT) { console.log(`memoryroots (mutant): ${n} checks passed`); return; }
  if (!linkOk) console.log('memoryroots: symlinks not allowed here, the link cases were skipped');

  const M = (file: string, name: string, from: string, to: string, section: string): Mutant => ({ file, name, from, to, section });
  const mutants: Mutant[] = [
    // the four the task names
    M('src/adapters/claude.js', 'the folder is added to the Claude Code roots (a write root, an --add-dir)', 'const roots = [...new Set([ws.cwd, ...ws.folders])];', 'const roots = [...new Set([ws.cwd, ...ws.folders, ...(options.readOnlyFolders ?? [])])];', 'claude'),
    M('src/adapters/claudeModes.js', 'Claude Code read roots are used for writes', '!writeIsInsideRoots(toolName, input, roots, pathCheck)', '!writeIsInsideRoots(toolName, input, [...(roots ?? []), ...(readRoots ?? [])], pathCheck)', 'claude'),
    M('src/adapters/codex.js', 'Codex runtimeWorkspaceRoots widened with the folder', 'const roots = (0, codexModes_1.codexWorkspaceRoots)([cwd, ...folders], this.realpath);', 'const roots = (0, codexModes_1.codexWorkspaceRoots)([cwd, ...folders, ...(options.readOnlyFolders ?? [])], this.realpath);', 'codex'),
    M('src/main/memoryops.js', 'roots are given while the memory is off', '|| !st.memoryOn)\n            return [];', ')\n            return [];', 'off'),
    // M1: a memory root that also allows writes (a write path of any adapter's shape inside it is approved)
    M('src/adapters/permissions.js', 'M1: a memory root also allows writes', '        const scope = grantScope(req, this.opts.pathCheck?.flavor);', "        if (this.memoryRoots.some((r) => [req.fileName, req.path, ...(req.paths ?? [])].some((q) => typeof q === 'string' && q.startsWith(r))))\n            return this.approveWrite(req);\n        const scope = grantScope(req, this.opts.pathCheck?.flavor);", 'claude'),
    M('src/main/memoryops.js', 'F1: extraOffice is ignored', 'officeFolders: [...office, ...extraOffice]', 'officeFolders: office', 'off'),
    M('src/main/memoryops.js', 'F2: a throw while re-checking gives the stored path', 'catch {\n            return [];\n        }\n    }\n    /** Main', 'catch {\n            return [folder];\n        }\n    }\n    /** Main', 'off'),
    M('src/adapters/claude.js', 'F3: the read list is the raw readOnlyFolders', 'readRoots: broker.memoryReadRoots(),', 'readRoots: options.readOnlyFolders ?? [],', 'claude'),
    // Copilot, T005 R1
    M('src/adapters/copilot.js', 'Copilot additionalDirectories is set to the folder', 'workingDirectory: cwd,', 'workingDirectory: cwd, additionalDirectories: options.readOnlyFolders,', 'copilot'),
    // the other sides of the same rules
    M('src/main/memoryops.js', 'readRoots trusts the stored path (no re-check)', 'return r.ok ? [r.real] : [];', 'return [folder];', 'off'),
    M('src/adapters/permissions.js', 'the memory reason is the attachment one', "const list = reason === 'in-memory' ? this.memoryRoots : this.extraRoots;", 'const list = this.extraRoots;', 'broker'),
    M('src/adapters/permissions.js', 'a memory read is outside for the broker', 'isInsideRoots(req.path, [...roots, ...this.extraRoots, ...this.memoryRoots], this.opts.pathCheck)', 'isInsideRoots(req.path, [...roots, ...this.extraRoots], this.opts.pathCheck)', 'broker'),
    M('src/adapters/codex.js', 'Allow all adds the entry to the profile', "live.mode === 'allow' ? [] : ", '', 'codex'),
    M('src/adapters/codex.js', 'the memory entry is left out of the profile', '[...this.installRoots(file), ...readOnly]', 'this.installRoots(file)', 'codex'),
    M('src/main/startopts.js', 'startOptionsOf always adds the list', '...(readOnlyFolders.length ? { readOnlyFolders: [...readOnlyFolders] } : {})', '...{ readOnlyFolders: [...readOnlyFolders] }', 'startopts'),
  ];
  // anchors: each matches exactly once in the compiled module (LF and CRLF alike), else this fails loudly
  for (const m of mutants) {
    const text = fs.readFileSync(path.join(__dirname, '..', m.file), 'utf8').replace(/\r\n/g, '\n');
    assert.strictEqual(text.split(m.from).length - 1, 1, `the anchor of "${m.name}" matches exactly once in ${m.file}`);
    try { new vm.Script(text.split(m.from).join(m.to), { filename: m.file }); } catch (e) { assert.fail('mutant is not valid JavaScript (' + m.name + '): ' + (e as Error).message); }
  }
  let killed = 0;
  for (const m of mutants) {
    const r = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { MEMORYROOTS_MUTANT: JSON.stringify(m) }), encoding: 'utf8', timeout: 120000 });
    assert.notStrictEqual(r.status, 0, 'mutant NOT killed: ' + m.name);
    const died = [...r.stderr.matchAll(/SECTION (\w+) FAILED/g)].map((x) => x[1]);
    assert.ok(died.includes(m.section), `mutant "${m.name}" must die in section "${m.section}", it died in: ${died.join(',') || r.stderr.slice(0, 200)}`);
    if (/^F\d:/.test(m.name)) assert.ok(r.stderr.includes(m.name.slice(0, 2)), `mutant "${m.name}" must die at its own named assert (${m.name.slice(0, 2)}...), stderr: ${r.stderr.slice(0, 200)}`);
    killed++;
  }
  assert.strictEqual(killed, mutants.length);
  fs.rmSync(base, { recursive: true, force: true });
  console.log(`memoryroots: ${n} checks passed, ${killed} mutants killed`);
})().catch((e) => { console.error(e); process.exit(1); });
