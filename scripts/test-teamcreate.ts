/**
 * Unit tests, spec 111 T011 (FR-034, FR-035, FR-039, FR-040, FR-043; the delta of 2026-11-15): `TeamOps.create` (`teams:create`), the team record of
 * `folders.ts` (`parseTeamRecord`, `setTeamRecord`) and the real count behind `resolveTarget`, over fake apps, models, store, room and office.
 * No Electron (the handler section uses a stand-in), no adapter (a fake with a start counter that must stay 0), no credits. Data is invented;
 * token-like data is built at run time. Timing uses large inputs and wide limits.
 *
 * Mutants: the COMPILED `teamops.js` / `folders.js` copied next to the original under a unique name with one text replacement (read with LF first,
 * so a CRLF checkout matches; compiled with `vm.Script` before it runs, so none dies of a syntax error); this file runs again against the copy
 * (`TEAMCREATE_OPS`, `TEAMCREATE_FOLDERS`). Each must die in ITS section (printed on stderr as `SECTION x FAILED`). An anchor that does not match fails
 * loudly. Paths of the target key are checked with the `path` module of the injected platform (win32 and posix whatever the host).
 * NOT driven here (needs Electron): `addLazyMember` and the wiring in `main.ts`; the `main` section reads its source for what it must never call.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import vm from 'vm';
import type { TeamOpsDeps, CreateOk, CreateFail, LazyMemberSpec, Target } from '../src/main/teamops';
import type { StoredTemplate } from '../src/main/teamstore';
import type { AdapterInfo } from '../src/shared/adapters';
import type { AgentInfo, ModelChoice } from '../src/shared/api';
import type { TeamMember } from '../src/shared/teamtemplate';
import { LIMITS } from '../src/shared/teamtemplate';
import type { TeamRecord } from '../src/main/folders';

const OPS = process.env.TEAMCREATE_OPS ?? 'teamops';
const FOLD = process.env.TEAMCREATE_FOLDERS ?? 'folders';
const IS_COPY = process.env.TEAMCREATE_OPS !== undefined || process.env.TEAMCREATE_FOLDERS !== undefined;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { TeamOps, resolveTargetFrom, pathExists } = require('../src/main/' + OPS) as typeof import('../src/main/teamops');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FolderStore, parseTeamRecord, parseSavedFolders } = require('../src/main/' + FOLD) as typeof import('../src/main/folders');

let n = 0;
const ok = (c: unknown, m: string): void => { n++; assert.ok(c, m); };
const eq = <T>(a: T, b: T, m: string): void => { n++; assert.deepStrictEqual(a, b, m); };
let failed = 0;
const sections: [string, () => Promise<void> | void][] = [];
const section = (name: string, fn: () => Promise<void> | void): void => { sections.push([name, fn]); };

// ---------------------------------------------------------------------------------------------------------------- fakes
const hexId = (i: number): string => i.toString(16).padStart(32, '0');
const MARK = 'Marker' + '-' + 'Zq7';
const caps = (over: Record<string, unknown>) => ({ caps: true, ...over }) as unknown as AdapterInfo['capabilities'];
const app = (id: string, state: AdapterInfo['state'], c: Record<string, unknown> = {}): AdapterInfo => ({ id, displayName: id, state, capabilities: caps(c) });
const APPS: AdapterInfo[] = [
  app('copilot', 'ready'), app('claude', 'ready', { capUnit: 'usd' }), app('codex', 'ready', { caps: false }), app('oldapp', 'not-signed-in'),
];
const model = (id: string, o: Partial<ModelChoice> = {}): ModelChoice => ({ id, name: id, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', ...o }) as ModelChoice;
const MODELS: Record<string, ModelChoice[]> = {
  copilot: [model('alpha-1'), model('beta-2'), model('blocked-7', { orgBlocked: 'Your organization blocks it.' }), model('xh-8', { efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high' })],
  claude: [model('sonnet-x'), model('opus-y')],
  codex: [model('codex-z')],
};
const mem = (i: number, o: Partial<TeamMember> = {}): TeamMember => ({ memberId: hexId(i), name: `Member ${i}`, role: `role${i}`, brief: `${MARK} brief ${i}`, app: 'copilot', permMode: 'read-only', sendBrief: true, ...o }) as TeamMember;
const tpl = (members: TeamMember[], o: Partial<StoredTemplate> = {}): StoredTemplate => ({ id: 'tmpl1', origin: 'own', createdAt: 1, updatedAt: 1, name: 'Squad A', members, ...o }) as StoredTemplate;
const tok = (i: number): string => String(i).repeat(32).slice(0, 32).replace(/[^0-9a-f]/g, 'a');
const isFail = (v: unknown): CreateFail => { assert.ok((v as CreateFail).ok === false, 'expected a refusal, got ' + JSON.stringify(v).slice(0, 200)); return v as CreateFail; };
const isOk = (v: unknown): CreateOk => { assert.ok((v as CreateOk).ok === true, 'expected ok, got ' + JSON.stringify(v).slice(0, 200)); return v as CreateOk; };

interface Room { team?: TeamRecord; savedCap?: number }
interface World {
  ops: InstanceType<typeof TeamOps>; log: string[]; starts: { n: number }; office: Map<string, AgentInfo>; rooms: Map<string, Room>; store: Map<string, StoredTemplate>; clock: { t: number };
  bound: Set<string>; announced: string[]; built: LazyMemberSpec[]; names: Array<{ src: string; id: string; name: string }>; set: (o: Partial<TeamOpsDeps>) => void; fail: { commit: boolean; placeAt: number; announceAt: number; missing: boolean; rollbackFails: number; rollbackThrows: number };
  preview: (target?: Target, id?: string) => Promise<string>;
}
let tokenN = 0;
function world(templates: StoredTemplate[], rooms: Record<string, Room> = {}, o: Partial<TeamOpsDeps> = {}): World {
  const store = new Map(templates.map((t) => [t.id, t]));
  const rm = new Map(Object.entries(rooms));
  const clock = { t: 1_000_000 };
  const log: string[] = [], built: LazyMemberSpec[] = [], names: World['names'] = [];
  const office = new Map<string, AgentInfo>();
  const bound = new Set<string>(), announced: string[] = [];
  const starts = { n: 0 };
  const fail = { commit: false, placeAt: -1, announceAt: -1, missing: false, rollbackFails: 0, rollbackThrows: 0 };
  let announcedN = 0;
  let ids = 0, placed = 0;
  const adapterOf = (a: string) => ({ capabilities: { caps: true }, start: () => { starts.n++; } }) as { capabilities: unknown; start(): void; a?: string };
  const create = {
    room: (key: string) => { const r = rm.get(key); return { count: r?.team?.members.length ?? 0, savedCap: r?.savedCap, team: r?.team, known: r !== undefined }; },
    // answers by key: normally every room's key is there; `missing` = the target is gone while another folder is still there
    exists: (k: string): boolean => fail.missing ? k === 'other-folder' : k.startsWith('key-'),
    build: (s: LazyMemberSpec): AgentInfo => { log.push('build'); built.push(s); adapterOf(s.app); return { id: 'agent-' + ++ids, name: 'room', alias: s.name, cwd: s.key, permMode: s.mode, model: s.model ?? '', effort: s.effort, maxAiCredits: s.cap, adapterId: s.app, lazy: true } as unknown as AgentInfo; },
    commit: (key: string, team: TeamRecord, infos: AgentInfo[]): boolean => {
      log.push('commit');
      if (fail.commit) return false;
      const r = rm.get(key) ?? {}; rm.set(key, { ...r, team });
      for (const i of infos) names.push({ src: i.adapterId ?? 'copilot', id: i.id, name: i.alias ?? '' });
      return true;
    },
    // a place that fails does so AFTER it bound the agent and put it in the office (the worst case of `main.ts`)
    place: (i: AgentInfo): void => { bound.add(i.id); office.set(i.id, i); if (placed++ === fail.placeAt) throw new Error('boom ' + MARK); log.push('place:' + i.id); },
    unplace: (id: string): void => { log.push('unplace:' + id); office.delete(id); bound.delete(id); },
    announce: (i: AgentInfo): void => { if (announcedN++ === fail.announceAt) throw new Error('window gone ' + MARK); log.push('announce:' + i.id); announced.push(i.id); },
    rollback: (key: string, previous: TeamRecord | undefined, _names: unknown, removeRoom: boolean): boolean => {
      log.push('rollback');
      if (fail.rollbackThrows > 0) { fail.rollbackThrows--; throw new Error('disk gone ' + MARK); }
      if (fail.rollbackFails > 0) { fail.rollbackFails--; return false; }
      const r = rm.get(key); if (!r) return true;
      if (previous) rm.set(key, { ...r, team: previous }); else if (removeRoom) rm.delete(key); else rm.set(key, { ...r, team: undefined });
      return true;
    },
    adapterOf,
  };
  const deps: TeamOpsDeps = {
    store: () => ({ get: (id: string) => { const t = store.get(id); return t ? (JSON.parse(JSON.stringify(t)) as StoredTemplate) : undefined; } }),
    adapters: async () => APPS,
    models: async (id: string) => { if (!(id in MODELS)) throw new Error('no list'); return MODELS[id]; },
    defaultCapAiu: () => 60,
    resolveTarget: async (t: Target) => { const key = 'room' in t ? 'key-' + t.room : 'key-picked'; const r = rm.get(key); return { ok: true as const, key, existing: r?.team?.members.length ?? 0, savedCap: r?.savedCap }; },
    now: () => clock.t,
    newToken: () => tok(++tokenN % 9 + 1) + '',
    newMemberId: () => hexId(900 + ids++),
    create,
    ...o,
  };
  const ops = new TeamOps(deps);
  const w: World = { ops, log, starts, office, bound, announced, rooms: rm, store, clock, built, names, set: (x) => Object.assign(deps, x), fail, preview: async (target: Target = { room: 'r1' }, id = 'tmpl1') => { const r = await ops.createPreview(target, id); assert.ok(r.ok, 'preview'); return (r as { token: string }).token; } };
  return w;
}
const created = async (w: World, choices: unknown = { rows: {} }, target: Target = { room: 'r1' }): Promise<CreateOk | CreateFail> => w.ops.create(await w.preview(target), choices);

// ---------------------------------------------------------------------------------------------------------------- 1. nothing starts
section('nothing', async () => {
  const w = world([tpl([mem(1), mem(2, { app: 'claude', model: 'sonnet-x' }), mem(3, { app: 'codex' })])]);
  const r = isOk(await created(w));
  eq([r.added, r.existing, r.agents.length], [3, 0, 3], 'three members created, none there before');
  eq(w.starts.n, 0, 'the fake adapter was started 0 times');
  eq(r.agents.map((a) => a.id), ['agent-1', 'agent-2', 'agent-3'], 'the template\'s order');
  ok(r.agents.every((a) => (a as { lazy?: boolean }).lazy === true), 'every member is a not-started agent');
  eq(w.log, ['build', 'build', 'build', 'commit', 'place:agent-1', 'place:agent-2', 'place:agent-3', 'announce:agent-1', 'announce:agent-2', 'announce:agent-3'], 'built with no effect, then ONE write, then placed in the office, then the window is told');
  eq(w.built.map((b) => [b.app, b.model, b.mode, b.name]), [['copilot', undefined, 'read-only', 'Member 1'], ['claude', 'sonnet-x', 'read-only', 'Member 2'], ['codex', undefined, 'read-only', 'Member 3']], 'what main builds each member from');
  const team = w.rooms.get('key-r1')!.team!;
  eq(team.members.map((m) => [m.memberId, m.name, m.role, m.app, m.mode, m.sessions]), [[hexId(1), 'Member 1', 'role1', 'copilot', 'read-only', [{ id: 'agent-1' }]], [hexId(2), 'Member 2', 'role2', 'claude', 'read-only', [{ id: 'agent-2' }]], [hexId(3), 'Member 3', 'role3', 'codex', 'read-only', [{ id: 'agent-3' }]]], 'the record keeps each member and its session id');
  eq(team.templates, ['Squad A'], 'the template\'s name is in the record');
  eq(team.members[0].brief, `${MARK} brief 1`, 'the brief is in the record');
  eq(w.names.map((x) => x.name), ['Member 1', 'Member 2', 'Member 3'], 'each member\'s name is its session name');
  eq(r.agents[0].alias, 'Member 1', 'the agent shows the member name');
});

// ---------------------------------------------------------------------------------------------------------------- 2. only the choices of the call
section('choices', async () => {
  // the preview's own state (a row changed to another app through previewRow) is display: create uses only what it is sent
  const w = world([tpl([mem(1, { model: 'alpha-1' })])]);
  const token = await w.preview();
  const pr = await w.ops.previewRow(token, hexId(1), { app: 'claude' });
  ok((pr as { ok: boolean }).ok, 'the row was changed in the preview');
  const r = isOk(await w.ops.create(token, { rows: {} }));
  eq([w.built[0].app, w.built[0].model], ['copilot', 'alpha-1'], 'the entry\'s own choices are not used: the template\'s app and model');
  eq(r.added, 1, 'created');
  // a choice sent with the call counts
  const w2 = world([tpl([mem(1, { model: 'alpha-1' }), mem(2)])]);
  isOk(await created(w2, { rows: { [hexId(1)]: { app: 'claude', model: 'opus-y' }, [hexId(2)]: { include: false } } }));
  eq(w2.built.map((b) => [b.app, b.model]), [['claude', 'opus-y']], 'another app and model, and a row left out');
  eq(w2.rooms.get('key-r1')!.team!.members.map((m) => m.memberId), [hexId(1)], 'the left-out row is not in the record');
  // another app: model and effort of the template are not carried over
  const w3 = world([tpl([mem(1, { model: 'alpha-1', effort: 'high' })])]);
  isOk(await created(w3, { rows: { [hexId(1)]: { app: 'claude' } } }));
  eq([w3.built[0].model, w3.built[0].effort], [undefined, undefined], 'a new app does not take the old model or effort');
  // empty
  const w4 = world([tpl([mem(1)])]);
  const e = isFail(await created(w4, { rows: { [hexId(1)]: { include: false } } }));
  eq([e.code, w4.log], ['empty', []], 'no row included: empty, nothing built');
});

// ---------------------------------------------------------------------------------------------------------------- 3. the token
section('token', async () => {
  const w = world([tpl([mem(1)])]);
  const t = await w.preview();
  isOk(await w.ops.create(t, { rows: {} }));
  const again = isFail(await w.ops.create(t, { rows: {} }));
  eq(again.code, 'expired', 'a token is used once');
  eq(w.office.size, 1, 'the second use created nothing');
  const w2 = world([tpl([mem(1)])]);
  const t2 = await w2.preview();
  w2.clock.t += 600_000;
  eq(isFail(await w2.ops.create(t2, { rows: {} })).code, 'expired', 'an expired token');
  eq(w2.log, [], 'nothing built');
  const w3 = world([tpl([mem(1)])]);
  const a = await w3.preview({ room: 'r1' });
  const b = await w3.preview({ room: 'r2' });
  eq(isFail(await w3.ops.create(a, { rows: {} })).code, 'expired', 'a token of another preview (another room) is refused');
  isOk(await w3.ops.create(b, { rows: {} }));
  ok(w3.rooms.has('key-r2') && !w3.rooms.has('key-r1'), 'the team went to the room of THAT preview');
  for (const bad of [undefined, null, 5, 'x', '', 'g'.repeat(32), {}, []]) eq(isFail(await w3.ops.create(bad, { rows: {} })).code, 'expired', 'a wrong token');
  // a refusal still consumes the token (a new preview is needed)
  const w4 = world([tpl([mem(1)])]);
  const t4 = await w4.preview();
  eq(isFail(await w4.ops.create(t4, { rows: { nope: {} } })).code, 'invalid', 'invalid choices');
  eq(isFail(await w4.ops.create(t4, { rows: {} })).code, 'expired', 'the token was consumed');
});

// ---------------------------------------------------------------------------------------------------------------- 4. the template changed
section('snapshot', async () => {
  const w = world([tpl([mem(1), mem(2)])]);
  const t = await w.preview();
  w.store.set('tmpl1', tpl([mem(1), mem(2, { role: 'other' })], { updatedAt: 2 }));
  eq(isFail(await w.ops.create(t, { rows: {} })).code, 'changed', 'a template edited after the preview is refused');
  eq(w.log, [], 'nothing built');
  const t2 = await w.preview();
  w.store.delete('tmpl1');
  eq(isFail(await w.ops.create(t2, { rows: {} })).code, 'changed', 'a template deleted after the preview is refused');
  // the same member edited without a new `updatedAt` is still a change (the snapshot is compared whole)
  const w2 = world([tpl([mem(1)])]);
  const t3 = await w2.preview();
  w2.store.set('tmpl1', tpl([mem(1, { brief: 'changed brief' })]));
  eq(isFail(await w2.ops.create(t3, { rows: {} })).code, 'changed', 'a member brief changed');
  eq(w2.office.size, 0, 'nothing created');
});

section('snapshot2', async () => {
  // edited or deleted DURING the awaits (a slow adapters() list): checked again right before the write
  for (const how of ['edited', 'deleted']) {
    const w2 = world([tpl([mem(1), mem(2)])]);
    const t2 = await w2.preview();
    w2.set({ adapters: async () => { await new Promise((r) => setTimeout(r, 5)); if (how === 'edited') w2.store.set('tmpl1', tpl([mem(1), mem(2, { role: 'edited' })], { updatedAt: 2 })); else w2.store.delete('tmpl1'); return APPS; } });
    const e = isFail(await w2.ops.create(t2, { rows: {} }));
    eq([e.code, w2.log, w2.office.size, w2.rooms.size], ['changed', [], 0, 0], 'a template ' + how + ' while create waited: changed, nothing built or written');
  }
  // an unchanged one still passes with a slow list
  const w3 = world([tpl([mem(1)])]);
  const t3 = await w3.preview();
  w3.set({ adapters: async () => { await new Promise((r) => setTimeout(r, 5)); return APPS; } });
  isOk(await w3.ops.create(t3, { rows: {} }));
});

// ---------------------------------------------------------------------------------------------------------------- 5. a row that needs a choice
section('needschoice', async () => {
  const t = [mem(1), mem(2, { app: 'oldapp' }), mem(3, { model: 'blocked-7' })];
  const w = world([tpl(t)]);
  const e = isFail(await created(w));
  eq([e.code, w.log], ['needschoice', []], 'rows that need a choice: refused, nothing built');
  const w2 = world([tpl(t)]);
  const e2 = isFail(await created(w2, { rows: { [hexId(2)]: { include: false } } }));
  eq(e2.code, 'needschoice', 'one row still needs a choice (the blocked model)');
  const w3 = world([tpl(t)]);
  isOk(await created(w3, { rows: { [hexId(2)]: { include: false }, [hexId(3)]: { model: 'beta-2' } } }));
  eq(w3.built.map((b) => [b.app, b.model]), [['copilot', undefined], ['copilot', 'beta-2']], 'left out, and another model: created');
  const w4 = world([tpl(t)]);
  isOk(await created(w4, { rows: { [hexId(2)]: { app: 'claude' }, [hexId(3)]: { model: '' } } }));
  eq(w4.built.map((b) => [b.app, b.model]), [['copilot', undefined], ['claude', undefined], ['copilot', undefined]], 'another app; the app default model');
  // a model the app does not offer, and an app that does not exist
  const w5 = world([tpl([mem(1)])]);
  eq(isFail(await created(w5, { rows: { [hexId(1)]: { model: 'nope-1' } } })).code, 'needschoice', 'a model not offered');
  eq(isFail(await created(world([tpl([mem(1)])]), { rows: { [hexId(1)]: { app: 'zzz' } } })).code, 'needschoice', 'an unknown app');
  // models that cannot be listed
  const w6 = world([tpl([mem(1, { model: 'alpha-1' })])], {}, { models: async () => { throw new Error('boom ' + MARK); } });
  const e6 = isFail(await created(w6));
  eq(e6.code, 'needschoice', 'models that cannot be listed need a choice');
  ok(!JSON.stringify(e6).includes('boom'), 'the error text is not in the answer');
});

// ---------------------------------------------------------------------------------------------------------------- 6. arguments
section('arguments', async () => {
  const bad: unknown[] = [
    null, 5, 'x', [], { rows: [] }, {}, { rows: {}, extra: 1 }, { rows: {}, allowConfirmed: 'yes' }, { rows: { nope: {} } }, { rows: { [hexId(7)]: {} } },
    { rows: { [hexId(1)]: 5 } }, { rows: { [hexId(1)]: { include: 'no' } } }, { rows: { [hexId(1)]: { app: 'A B' } } }, { rows: { [hexId(1)]: { app: 5 } } },
    { rows: { [hexId(1)]: { model: '../x' } } }, { rows: { [hexId(1)]: { effort: 'Ludi crous' } } }, { rows: { [hexId(1)]: { extra: 1 } } },
    { rows: { [hexId(1)]: { cap: 5 } } }, { rows: { [hexId(1)]: { cap: { unit: 'eur', amount: 5 } } } }, { rows: { [hexId(1)]: { cap: { unit: 'aiu' } } } },
    { rows: { [hexId(1)]: { cap: { unit: 'aiu', amount: 5, x: 1 } } } }, { rows: { [hexId(1)]: { cap: { unit: 'aiu', amount: 'x'.repeat(40) } } } },
    { rows: { [hexId(1)]: { cap: { unit: 'aiu', amount: -3 } } } }, { rows: { [hexId(1)]: { cap: { unit: 'aiu', amount: 'ten' } } } }, { rows: { [hexId(1)]: { cap: { unit: 'usd', amount: 5 } } } },
  ];
  for (const c of bad) {
    const w = world([tpl([mem(1)])]);
    const e = isFail(await created(w, c));
    ok(e.code === 'invalid', 'invalid choices: ' + JSON.stringify(c).slice(0, 60));
    eq(w.log, [], 'nothing built');
    ok(e.errors.length === 1 && !JSON.stringify(e).includes(MARK) && !/x{20}|Ludi crous|\.\.\/x/.test(JSON.stringify(e)), 'fixed words, no value echoed');
  }
  // exactly LIMITS.members rows are read (a bound one below the limit would refuse a full team)
  const full = Array.from({ length: LIMITS.members }, (_, i) => mem(i + 1));
  isOk(await created(world([tpl(full)]), { rows: Object.fromEntries(full.map((m) => [m.memberId, {}])) }));
  // 9 rows: the bound on the rows object itself answers (not the later 'row not in this preview')
  eq(isFail(await created(world([tpl([mem(1)])]), { rows: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [hexId(i + 1), {}])) })).errors, ['Choices: rows not valid.'], 'nine rows: refused by the bound');
  // an amount of 33 characters that is a valid number is refused for its length; 32 is read
  eq(isFail(await created(world([tpl([mem(1)])]), { rows: { [hexId(1)]: { cap: { unit: 'aiu', amount: '0'.repeat(31) + '45' } } } })).code, 'invalid', 'an amount of 33 characters');
  isOk(await created(world([tpl([mem(1)])]), { rows: { [hexId(1)]: { cap: { unit: 'aiu', amount: '0'.repeat(30) + '45' } } } }));
  // too many rows
  const rows: Record<string, object> = {};
  for (let i = 1; i <= 9; i++) rows[hexId(i)] = {};
  eq(isFail(await created(world([tpl([mem(1)])]), { rows })).code, 'invalid', 'more than 8 rows');
  // a hostile object whose trap throws rejects out of `create` (the handler answers the fixed `failed`)
  const w2 = world([tpl([mem(1)])]);
  await assert.rejects(async () => w2.ops.create(await w2.preview(), new Proxy({}, { ownKeys() { throw new Error('trap'); } })), /trap/, 'a throwing trap is not swallowed');
  n++;
  // size: 200,000 keys are judged by count, fast
  const big: Record<string, number> = {};
  for (let i = 0; i < 200_000; i++) big['k' + i] = i;
  const w3 = world([tpl([mem(1)])]);
  const t0 = Date.now();
  const e3 = isFail(await created(w3, { rows: big }));
  ok(e3.code === 'invalid' && Date.now() - t0 < 1500, 'a huge rows object is refused quickly');
  // a valid limit, then the same limit as text
  const w4 = world([tpl([mem(1)])]);
  isOk(await created(w4, { rows: { [hexId(1)]: { cap: { unit: 'aiu', amount: '45.5' } } } }));
  eq(w4.built[0].cap, 45.5, 'a limit as text is read by parseCapIn');
});

// ---------------------------------------------------------------------------------------------------------------- 7. mode
section('modes', async () => {
  const run = async (m: Partial<TeamMember>, o: Partial<StoredTemplate>, choices: unknown): Promise<string> => { const w = world([tpl([mem(1, m)], o)]); isOk(await created(w, choices)); return w.built[0].mode; };
  eq(await run({ permMode: 'read-only' }, {}, { rows: {}, allowConfirmed: true }), 'read-only', 'read-only stays');
  eq(await run({ permMode: 'ask' }, {}, { rows: {} }), 'ask', 'ask stays');
  eq(await run({ permMode: 'allow' }, {}, { rows: {} }), 'ask', 'an own Allow all nobody confirmed enters as Ask');
  eq(await run({ permMode: 'allow' }, {}, { rows: {}, allowConfirmed: false }), 'ask', 'allowConfirmed false: Ask');
  eq(await run({ permMode: 'allow' }, {}, { rows: {}, allowConfirmed: true }), 'allow', 'an own Allow all the person confirmed');
  eq(await run({ permMode: 'allow' }, { origin: 'imported' }, { rows: {}, allowConfirmed: true }), 'ask', 'an imported Allow all enters as Ask, confirmed or not');
  eq(await run({ permMode: 'allow' }, { origin: 'imported' }, { rows: {} }), 'ask', 'an imported Allow all enters as Ask');
  eq(await run({ permMode: 'read-only' }, { origin: 'imported' }, { rows: {}, allowConfirmed: true }), 'read-only', 'an imported read-only is not raised');
  const odd = await run({ permMode: 'autopilot' as never }, {}, { rows: {}, allowConfirmed: true });
  eq(odd, 'read-only', 'a mode the template should not hold is read-only (Autopilot never)');
  // the record holds the same mode as the agent
  const w = world([tpl([mem(1, { permMode: 'allow' })])]);
  isOk(await created(w, { rows: {} }));
  eq([w.rooms.get('key-r1')!.team!.members[0].mode, w.built[0].mode], ['ask', 'ask'], 'record and agent agree');
  const all = JSON.stringify([w.built, w.rooms.get('key-r1')]);
  ok(!/autopilot/i.test(all), 'Autopilot is nowhere');
});

// ---------------------------------------------------------------------------------------------------------------- 8. effort
section('effort', async () => {
  const run = async (m: Partial<TeamMember>, o: Partial<StoredTemplate>, choices: unknown = { rows: {} }): Promise<string | undefined> => { const w = world([tpl([mem(1, m)], o)]); isOk(await created(w, choices)); return w.built[0].effort; };
  eq(await run({ model: 'xh-8', effort: 'xhigh' }, {}), 'xhigh', 'an own effort is kept');
  eq(await run({ model: 'xh-8', effort: 'xhigh' }, { origin: 'imported' }), 'high', 'an imported effort above the default falls to the default');
  eq(await run({ model: 'xh-8', effort: 'xhigh' }, { origin: 'imported' }, { rows: { [hexId(1)]: { effort: 'xhigh' } } }), 'xhigh', 'the person picked it');
  eq(await run({ model: 'alpha-1', effort: 'low' }, { origin: 'imported' }), 'low', 'an imported effort at or below the default is kept');
  eq(await run({ model: 'alpha-1', effort: 'max' as never }, {}), 'medium', 'an effort the model does not offer falls to its default');
  eq(await run({ effort: 'high' }, { origin: 'imported' }), undefined, 'the app default model with an imported effort: none taken');
  eq(await run({ effort: 'high' }, {}), 'high', 'the app default model with an own effort: kept');
  eq(await run({ model: 'alpha-1', effort: 'high' }, {}, { rows: { [hexId(1)]: { effort: '' } } }), undefined, 'the person cleared it');
});

// ---------------------------------------------------------------------------------------------------------------- 9. limits
section('limits', async () => {
  const cap = async (m: Partial<TeamMember>, room: Room, choices: unknown = { rows: {} }): Promise<{ cap: number | undefined; rec: unknown }> => {
    const w = world([tpl([mem(1, m)])], { 'key-r1': room });
    isOk(await created(w, choices));
    return { cap: w.built[0].cap, rec: w.rooms.get('key-r1')!.team!.members[0].cap };
  };
  eq((await cap({ cap: { unit: 'aiu', amount: 40 } }, {})).cap, 40, 'the member\'s own limit');
  eq((await cap({}, {})).cap, 60, 'the settings default');
  eq((await cap({}, { savedCap: 45 })).cap, 45, 'the room\'s saved limit, not the default of 60');
  eq((await cap({ cap: { unit: 'aiu', amount: 40 } }, { savedCap: 45 })).cap, 40, 'the member\'s own limit before the saved one');
  eq((await cap({}, { savedCap: 45 }, { rows: { [hexId(1)]: { cap: { unit: 'aiu', amount: 35 } } } })).cap, 35, 'the person\'s limit');
  eq((await cap({ app: 'claude' }, {})).cap, undefined, 'a dollar app has no default limit');
  eq((await cap({ app: 'claude', cap: { unit: 'usd', amount: 2 } }, {})).rec, { unit: 'usd', amount: 2 }, 'a dollar limit is kept in its unit');
  eq((await cap({ app: 'claude' }, {}, { rows: { [hexId(1)]: { cap: { unit: 'usd', amount: '1.5' } } } })).cap, 1.5, 'a dollar limit chosen');
  eq((await cap({ app: 'codex' }, { savedCap: 45 })).cap, undefined, 'an app with no limit gets none');
  // another app: the limit is dropped, never converted, a sent one is ignored
  eq((await cap({ cap: { unit: 'aiu', amount: 40 } }, {}, { rows: { [hexId(1)]: { app: 'claude' } } })).cap, undefined, 'another app drops the member\'s limit');
  eq((await cap({}, {}, { rows: { [hexId(1)]: { app: 'claude', cap: { unit: 'aiu', amount: 3 } } } })).cap, undefined, 'a limit sent with another app is ignored');
  // the saved limit and the settings default are not rounded: the record must still parse whole (the real `setTeamRecord` compares them)
  for (const [room, def, want] of [[{ savedCap: 33.333 }, 60, 33.33], [{}, 77.777, 77.78]] as const) {
    const w = world([tpl([mem(1)])], { 'key-r1': room }, { defaultCapAiu: () => def });
    isOk(await created(w));
    const team = w.rooms.get('key-r1')!.team!;
    eq([w.built[0].cap, team.members[0].cap], [want, { unit: 'aiu', amount: want }], 'the effective limit is rounded by the parser the record uses');
    eq(parseTeamRecord(team), team, 'the record parses whole');
  }
  // refused
  for (const [m, c] of [[{}, { unit: 'usd', amount: 3 }], [{ app: 'claude' }, { unit: 'aiu', amount: 3 }], [{ app: 'codex' }, { unit: 'aiu', amount: 3 }], [{}, { unit: 'aiu', amount: 0 }], [{}, { unit: 'aiu', amount: 'abc' }]] as const) {
    const w = world([tpl([mem(1, m as Partial<TeamMember>)])]);
    const e = isFail(await created(w, { rows: { [hexId(1)]: { cap: c } } }));
    eq([e.code, w.log], ['invalid', []], 'a limit that does not fit the unit is refused: ' + JSON.stringify([m, c]));
  }
  // a limit sent for a Codex row that changed app to Codex is refused too (the app has none)
  const w = world([tpl([mem(1)])]);
  eq(isFail(await created(w, { rows: { [hexId(1)]: { app: 'codex', cap: { unit: 'aiu', amount: 3 } } } })).code, 'invalid', 'a limit for an app with none');
});

// ---------------------------------------------------------------------------------------------------------------- 10. at most 8 members
section('cap8', async () => {
  const eight = Array.from({ length: 8 }, (_, i) => mem(i + 1));
  const w = world([tpl(eight)]);
  const r = isOk(await created(w));
  eq([r.added, w.rooms.get('key-r1')!.team!.members.length], [8, 8], 'eight members fit');
  // existing + new over 8
  const w2 = world([tpl([mem(1), mem(2), mem(3), mem(4)])], { 'key-r1': { team: teamOf(6, 'Old') } });
  const e = isFail(await created(w2));
  eq([e.code, e.errors], ['full', ['This room has 6 team members; this template adds 4; at most 8']], 'the counts are in the words');
  eq([w2.log, w2.office.size, w2.rooms.get('key-r1')!.team!.members.length], [[], 0, 6], 'nothing built, nothing written');
  // one over (6 + 3 = 9; 8 + 1 = 9) is refused
  eq(isFail(await created(world([tpl([mem(1), mem(2), mem(3)])], { 'key-r1': { team: teamOf(6, 'Old') } }))).errors, ['This room has 6 team members; this template adds 3; at most 8'], '6 + 3 is one too many');
  eq(isFail(await created(world([tpl([mem(1)])], { 'key-r1': { team: teamOf(8, 'Old') } }))).errors, ['This room has 8 team members; this template adds 1; at most 8'], 'a full room takes none');
  // exactly 8 after is fine
  const w3 = world([tpl([mem(1), mem(2)])], { 'key-r1': { team: teamOf(6, 'Old') } });
  isOk(await created(w3));
  eq(w3.rooms.get('key-r1')!.team!.members.length, 8, '6 + 2 = 8');
  // the count is the room's record, not the token's `existing` (the preview said 0, then the record grew)
  const w4 = world([tpl([mem(1), mem(2), mem(3)])]);
  const t4 = await w4.preview();
  w4.rooms.set('key-r1', { team: teamOf(7, 'Old') });
  eq(isFail(await w4.ops.create(t4, { rows: {} })).code, 'full', 'the real count, read at create');
  // a left-out row is not counted
  const w5 = world([tpl([mem(1), mem(2), mem(3)])], { 'key-r1': { team: teamOf(6, 'Old') } });
  isOk(await created(w5, { rows: { [hexId(3)]: { include: false } } }));
  // two creates at once in one room (slow apps, so both wait): not both pass 5 + 5 > 8
  const w6 = world([tpl([mem(1), mem(2), mem(3), mem(4), mem(5)])], {}, { adapters: async () => { await new Promise((r) => setTimeout(r, 3)); return APPS; } });
  const ta = await w6.preview();
  const first = w6.ops.create(ta, { rows: {} });
  const tb = await w6.preview();
  const second = await w6.ops.create(tb, { rows: {} });
  const res = [await first, second];
  eq(res.filter((x) => x.ok).length, 1, 'only one of two concurrent creates passes');
  eq(res.filter((x) => !x.ok).map((x) => (x as CreateFail).code), ['full'], 'the other is refused for the count');
  eq(w6.rooms.get('key-r1')!.team!.members.length, 5, 'still 5');
  const w8 = world([tpl([mem(1), mem(2), mem(3), mem(4), mem(5)])]);
  const ta8 = await w8.preview(); const tb8 = await w8.preview(); // the first token is dropped by the second preview
  eq(isFail(await w8.ops.create(ta8, { rows: {} })).code, 'expired', 'one token alive at a time');
  isOk(await w8.ops.create(tb8, { rows: {} }));
});
function teamOf(count: number, name: string, from = 100): TeamRecord {
  return { templates: [name], members: Array.from({ length: count }, (_, i) => ({ memberId: hexId(from + i), name: 'Old ' + i, role: 'r', sendBrief: true, app: 'copilot', mode: 'read-only' as const, sessions: [{ id: 'old-' + i }] })) };
}

// ---------------------------------------------------------------------------------------------------------------- 11. a second template appends
section('append', async () => {
  const w = world([tpl([mem(1), mem(2)]), tpl([mem(3)], { id: 'tmpl2', name: 'Squad B' })]);
  isOk(await created(w));
  const t2 = await w.preview({ room: 'r1' }, 'tmpl2');
  isOk(await w.ops.create(t2, { rows: {} }));
  const rec = w.rooms.get('key-r1')!.team!;
  eq([rec.templates, rec.members.map((m) => m.memberId)], [['Squad A', 'Squad B'], [hexId(1), hexId(2), hexId(3)]], 'the second template appends its members and its name');
  // the same template again: not twice the same name; the member ids that clash get new ones
  const t3 = await w.preview({ room: 'r1' }, 'tmpl1');
  isOk(await w.ops.create(t3, { rows: {} }));
  const rec2 = w.rooms.get('key-r1')!.team!;
  eq(rec2.templates, ['Squad A', 'Squad B'], 'a name is not added twice');
  eq(rec2.members.length, 5, 'five members');
  const ids = rec2.members.map((m) => m.memberId);
  eq(new Set(ids).size, 5, 'every memberId in the record is different');
  eq(ids.slice(0, 3), [hexId(1), hexId(2), hexId(3)], 'the first ones keep their ids');
  ok(ids.slice(3).every((x) => /^[0-9a-f]{32}$/.test(x) && ![hexId(1), hexId(2), hexId(3)].includes(x)), 'new 128-bit ids');
  eq(rec2.members.slice(3).map((m) => m.sessions[0].id).every((s) => s.startsWith('agent-')), true, 'with their own sessions');
  // other rooms are separate
  const t4 = await w.preview({ room: 'r2' }, 'tmpl1');
  isOk(await w.ops.create(t4, { rows: {} }));
  eq(w.rooms.get('key-r2')!.team!.members.length, 2, 'another room has its own record');
  // the room's older members and names are kept untouched
  eq(w.rooms.get('key-r1')!.team!.members.slice(0, 2).map((m) => m.name), ['Member 1', 'Member 2'], 'older members are kept');
});

// ---------------------------------------------------------------------------------------------------------------- 12. atomicity
section('atomicity', async () => {
  const w = world([tpl([mem(1), mem(2)])]);
  w.fail.commit = true;
  const e = isFail(await created(w));
  eq([e.code, e.errors], ['failed', ['The team could not be created.']], 'a write that fails: failed, fixed words');
  eq([w.office.size, w.log.filter((l) => l.startsWith('place')).length], [0, 0], 'nothing was put in the office');
  eq(w.starts.n, 0, 'nothing started');
  // a place that throws on the 2nd of 3: the WHOLE batch goes (the one that threw too), the window was told of none, the record is as before
  const old = teamOf(2, 'Old');
  const w2 = world([tpl([mem(1), mem(2), mem(3)])], { 'key-r1': { team: old } });
  w2.fail.placeAt = 1;
  await assert.rejects(async () => created(w2), /boom/, 'the throw is not swallowed here (the handler answers failed)');
  n++;
  eq([w2.office.size, w2.bound.size, w2.announced, w2.rooms.get('key-r1')!.team, w2.rooms.get('key-r1')!.team!.members.length], [0, 0, [], old, 2], 'agents, router, window, record and count are as before');
  eq(w2.log.filter((l) => l.startsWith('unplace')).sort(), ['unplace:agent-1', 'unplace:agent-2', 'unplace:agent-3'], 'every member of the batch is removed, the one that threw too');
  eq(w2.log.includes('rollback'), true, 'the record was put back');
  // the same, in a room the write created: the room is not left
  const w2b = world([tpl([mem(1), mem(2)])]);
  w2b.fail.placeAt = 0;
  await assert.rejects(async () => created(w2b), /boom/, 'a throw at the first');
  n++;
  eq([w2b.rooms.has('key-r1'), w2b.office.size, w2b.announced], [false, 0, []], 'a room the write created is removed again');
  // a room that existed without a record: its entry stays, the record goes
  const w2c = world([tpl([mem(1), mem(2)])], { 'key-r1': { savedCap: 45 } });
  w2c.fail.placeAt = 1;
  await assert.rejects(async () => created(w2c), /boom/, 'a throw in a known room');
  n++;
  eq([w2c.rooms.get('key-r1'), w2c.office.size], [{ savedCap: 45, team: undefined }, 0], 'the room stays without a record');
  // a rollback that throws does not change the answer (the original throw)
  const w2d = world([tpl([mem(1), mem(2)])], {}, {});
  w2d.fail.placeAt = 1;
  (w2d as unknown as { set(o: object): void }).set({});
  const dd = (w2d.ops as unknown as { deps: { create: { rollback(): boolean } } }).deps.create;
  dd.rollback = () => { throw new Error('rb'); };
  await assert.rejects(async () => created(w2d), /boom/, 'a failing rollback: the same throw');
  n++;
  eq(w2d.office.size, 0, 'the agents are gone anyway');
  // an `announce` that throws (the 2nd of 3): the team exists and stays, nothing is undone, the answer is ok
  const w2e = world([tpl([mem(1), mem(2), mem(3)])]);
  w2e.fail.announceAt = 1;
  const r2e = isOk(await created(w2e));
  eq([r2e.added, w2e.office.size, w2e.rooms.get('key-r1')!.team!.members.length, w2e.log.filter((l) => l.startsWith('unplace') || l === 'rollback')], [3, 3, 3, []], 'a failing announce: all placed, record intact, no unplace, no rollback');
  eq(w2e.announced, ['agent-1', 'agent-3'], 'the others were still announced');
  // the rollback's own write fails: tried once more (the second works: the record is back; both fail: still failed, no more tries)
  const w2f = world([tpl([mem(1), mem(2), mem(3)])], { 'key-r1': { team: old } });
  w2f.fail.placeAt = 1; w2f.fail.rollbackFails = 1;
  await assert.rejects(async () => created(w2f), /boom/, 'a throw with a rollback that fails once');
  n++;
  eq([w2f.log.filter((l) => l === 'rollback').length, w2f.rooms.get('key-r1')!.team], [2, old], 'the rollback was retried once and the record is back');
  const w2g = world([tpl([mem(1), mem(2), mem(3)])], { 'key-r1': { team: old } });
  w2g.fail.placeAt = 1; w2g.fail.rollbackFails = 5;
  await assert.rejects(async () => created(w2g), /boom/, 'a rollback that keeps failing: failed all the same');
  n++;
  eq(w2g.log.filter((l) => l === 'rollback').length, 2, 'two tries and no more');
  // the rollback THROWS (both tries): tried twice, the answer is still the original failure, and the record stays as the failed write left it (the KNOWN GAP: said, not hidden)
  const w2i = world([tpl([mem(1), mem(2), mem(3)])], { 'key-r1': { team: old } });
  w2i.fail.placeAt = 1; w2i.fail.rollbackThrows = 5;
  await assert.rejects(async () => created(w2i), /boom/, 'a rollback that throws: the answer is the failure of the place, not the rollback\'s');
  n++;
  eq([w2i.log.filter((l) => l === 'rollback').length, w2i.office.size, w2i.rooms.get('key-r1')!.team!.members.length], [2, 0, 5], 'two tries, no agent left, the record keeps the batch (ghost members, a KNOWN GAP)');
  // a rollback that throws once and then works: the record is back
  const w2j = world([tpl([mem(1), mem(2), mem(3)])], { 'key-r1': { team: old } });
  w2j.fail.placeAt = 1; w2j.fail.rollbackThrows = 1;
  await assert.rejects(async () => created(w2j), /boom/, 'a rollback that throws once');
  n++;
  eq([w2j.log.filter((l) => l === 'rollback').length, w2j.rooms.get('key-r1')!.team], [2, old], 'tried again, the record is back');
  // the real `exists` of main.ts (`pathExists`): a folder there, then removed (a real temp dir)
  const dirX = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-teamcreate-x-'));
  try { ok(pathExists(dirX) === true, 'a folder that is there'); fs.rmSync(dirX, { recursive: true, force: true }); ok(pathExists(dirX) === false, 'a folder removed meanwhile'); } finally { fs.rmSync(dirX, { recursive: true, force: true }); }
  // the folder is gone when the token is used: failed, nothing built or written
  const w2h = world([tpl([mem(1)])]);
  const t2h = await w2h.preview();
  w2h.fail.missing = true;
  const e2h = isFail(await w2h.ops.create(t2h, { rows: {} }));
  eq([e2h.code, w2h.log, w2h.rooms.size], ['failed', [], 0], 'a folder that is not there any more: failed before any effect');
  // a name the session-name rule refuses: nothing is created, never under another name
  const secret = 'ghp' + '_' + 'A1b2C3d4'.repeat(5);
  const w3 = world([tpl([mem(1, { name: secret })])]);
  const e3 = isFail(await created(w3));
  eq([e3.code, w3.log], ['failed', []], 'a name that is refused: failed before any effect');
  ok(!JSON.stringify(e3).includes('ghp'), 'no value in the answer');
  // a build that throws: no effect, the throw reaches the handler
  const w4 = world([tpl([mem(1)])], {}, { create: { exists: () => true, room: () => ({ count: 0 }), build: () => { throw new Error('x'); }, commit: () => { throw new Error('no'); }, place: () => undefined, unplace: () => undefined, announce: () => undefined, rollback: () => true } });
  await assert.rejects(async () => created(w4), /x/, 'a build that throws');
  n++;
  // no `create` dependency (the simulator): failed
  const w5 = world([tpl([mem(1)])], {}, { create: undefined });
  eq(isFail(await created(w5)).code, 'failed', 'without the dependency: failed');
});

// ---------------------------------------------------------------------------------------------------------------- 13. the folder store
section('folders', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-teamcreate-'));
  try {
    const file = path.join(dir, 'folders.json');
    const ws = path.join(dir, 'proj');
    const store = new FolderStore(file);
    store.load();
    const rec: TeamRecord = teamOf(2, 'Squad A');
    const names = [{ src: 'copilot', id: 'old-0', name: 'First' }, { src: 'copilot', id: 'old-1', name: 'Second' }];
    ok(store.setTeamRecord(ws, rec, names), 'a room that is not in the store is created with the record');
    const f = store.get(ws)!;
    eq([f.permMode, f.hidden, f.model, f.adapterId, f.team?.members.length], ['read-only', false, undefined, undefined, 2], 'read-only, no model, no adapter id');
    eq(f.sessionNames?.map((x) => x.name), ['First', 'Second'], 'names written in the same write');
    ok(!f.sessionNames!.some((x) => x.inApp || x.pending), 'Durbar-only names');
    const again = new FolderStore(file);
    eq(again.load().find((x) => x.workspace === ws)?.team, rec, 'the record comes back from the file');
    // an older file: no `team` key; and `team` is written only when it exists
    const plain = path.join(dir, 'plain.json');
    const p = new FolderStore(plain); p.load();
    p.upsert({ workspace: ws, permMode: 'ask' });
    ok(!fs.readFileSync(plain, 'utf8').includes('"team"'), 'no team key when there is no team');
    eq(new FolderStore(plain).load()[0].team, undefined, 'a folder file without team reads as before');
    ok(p.setTeamRecord(ws, rec), 'a room that is in the store keeps its entry');
    eq([p.get(ws)!.permMode, p.get(ws)!.team?.members.length], ['ask', 2], 'its mode is kept');
    // a refused record or name changes nothing
    for (const bad of [null, {}, { templates: [], members: [] }, { templates: [], members: [{ memberId: 'x' }] }, { templates: [], members: [...rec.members, { memberId: 'bad' }] }]) {
      eq(store.setTeamRecord(path.join(dir, 'other'), bad), false, 'a record that does not parse whole is refused: ' + JSON.stringify(bad).slice(0, 40));
    }
    ok(!store.get(path.join(dir, 'other')), 'nothing was added');
    eq(store.setTeamRecord(path.join(dir, 'other'), rec, [{ src: 'copilot', id: '../x', name: 'N' }]), false, 'a name entry that does not parse');
    eq(store.setTeamRecord('relative/path', rec), false, 'a relative path is refused');
    ok(!store.get('relative/path'), 'not added');
    // the write fails: the in-memory state is put back (a new room is removed, an old one keeps its team and names)
    const blocked = path.join(dir, 'blocker');
    fs.writeFileSync(blocked, 'x');
    const bad = new FolderStore(path.join(blocked, 'folders.json')); bad.load();
    eq(bad.setTeamRecord(ws, rec, names), false, 'a write that fails answers false');
    ok(!bad.get(ws), 'a new room is not left in memory');
    bad.upsert({ workspace: ws, permMode: 'ask' });
    const before = JSON.stringify(bad.get(ws));
    eq(bad.setTeamRecord(ws, rec, names), false, 'a write that fails, room already there');
    eq(JSON.stringify(bad.get(ws)), before, 'team and names are put back');
    // lengths in code points (the template store's rule): 3,000 emojis are 6,000 UTF-16 units and a valid brief
    const emoji = '\u{1F600}';
    const withBrief = (brief: string, extra: object = {}): TeamRecord => ({ templates: ['T'], members: [{ ...teamOf(1, 'x').members[0], brief, ...extra }] });
    eq(parseTeamRecord(withBrief(emoji.repeat(3000)))!.members[0].brief, emoji.repeat(3000), 'a brief of 3,000 emojis is kept');
    eq(parseTeamRecord(withBrief(emoji.repeat(4001))), undefined, 'a member with a brief of 4,001 code points is dropped (never kept with sendBrief true)');
    eq(parseTeamRecord(withBrief(emoji.repeat(4000)))!.members[0].brief, emoji.repeat(4000), 'exactly 4,000 code points is kept');
    eq(parseTeamRecord(withBrief('a'.repeat(2001), { briefFrom: 'file' })), undefined, 'a brief from a file over 2,000: the member is dropped');
    eq(parseTeamRecord(withBrief('a'.repeat(2000), { briefFrom: 'file' }))!.members[0].brief, 'a'.repeat(2000), 'and 2,000 is kept');
    eq(parseTeamRecord(withBrief('x\n'.repeat(80) + 'x')), undefined, 'more than 80 lines: the member is dropped');
    const f2 = path.join(dir, 'brief.json');
    const sb = new FolderStore(f2); sb.load();
    ok(sb.setTeamRecord(ws, withBrief(emoji.repeat(3000))), 'a record with a 3,000-emoji brief is saved');
    eq(new FolderStore(f2).load()[0].team!.members[0].brief, emoji.repeat(3000), 'and read back whole');
    // a record that would lose a FIELD (not a member) is refused whole, and nothing is written
    const sc = new FolderStore(path.join(dir, 'lossy.json')); sc.load();
    for (const lossy of [withBrief(emoji.repeat(4001)), withBrief('x', { cap: { unit: 'aiu', amount: -1 } }), withBrief('x', { profile: 'bad id!' }), withBrief('x', { model: '../m' }), withBrief('x', { mode: 'autopilot' }), withBrief('x', { effort: 'Bad Effort' })]) {
      eq(sc.setTeamRecord(ws, lossy), false, 'a record that would lose a field is refused: ' + JSON.stringify(lossy).slice(0, 50));
    }
    ok(!sc.get(ws) && !fs.existsSync(path.join(dir, 'lossy.json')), 'nothing was added or written');
    // the record is checked when it is READ, as the template store checks its file (Opus read of T011)
    const good = teamOf(1, 'x').members[0];
    const badRec = (o: object): TeamRecord => ({ templates: [], members: [{ ...good, ...o } as never] });
    eq(parseTeamRecord(badRec({})) !== undefined, true, 'the plain member is fine');
    eq(parseTeamRecord({ templates: [], members: [{ memberId: 'a'.repeat(32), name: 'Ana', role: 'Tester', brief: 'ok \u202E evil \ud800', sendBrief: 'no', app: 'copilot', mode: 'ask', sessions: [] }] }), undefined, 'the reported repro: dropped');
    for (const [label, o] of [['a lone surrogate', { brief: 'a \ud800 b' }], ['a bidi override', { brief: 'a \u202E b' }], ['a zero-width character', { brief: 'a \u200B b' }], ['a hidden character in the name', { name: 'A\u202Eb' }],
      ['sendBrief "no"', { sendBrief: 'no' }], ['sendBrief 0', { sendBrief: 0 }], ['sendBrief missing', { sendBrief: undefined }], ['a brief that is not text', { brief: 5 }],
      ['a bad profile', { profile: 'bad id!' }], ['a bad model', { model: '../m' }], ['a bad cap', { cap: { unit: 'aiu', amount: -1 } }], ['a cap with an extra key', { cap: { unit: 'aiu', amount: 40, x: 1 } }], ['an app with capitals', { app: 'Bad App' }]] as const) {
      eq(parseTeamRecord(badRec(o)), undefined, label + ': the member is dropped');
    }
    const secret = 'ghp' + '_' + 'A1b2C3d4'.repeat(5);
    const masked = parseTeamRecord(badRec({ brief: 'use ' + secret + ' now' }));
    ok(!JSON.stringify(masked ?? '').includes(secret), 'a token in the brief never comes back as it was');
    // the session ids of a member are checked when READ with the strict `sessionIdOk` (letters, digits, `_`, `-`; at most 100): a path, a drive letter, a dot, a colon, a leading `-`, a space, a number, a 101-character id and a repeat are dropped
    const longId = 'a'.repeat(101);
    const sess = parseTeamRecord(badRec({ sessions: [{ id: '../x' }, { id: 'a/../x' }, { id: 'a/../../x' }, { id: 'C:/x' }, { id: 'a..b' }, { id: 'x:y' }, { id: '-a' }, { id: longId }, { id: 'ok1' }, { id: 'ok1', briefSent: true }, { id: 'a b' }, { id: 5 }, { id: 'ok_2-x', briefSent: true }, { id: 'a'.repeat(100) }] }));
    eq(sess?.members[0].sessions, [{ id: 'ok1' }, { id: 'ok_2-x', briefSent: true }, { id: 'a'.repeat(100) }], 'read: paths, `C:/x`, dots, a colon, `-a`, a space, a number, 101 characters and a repeat are dropped; the good ids (100 characters too) stay')
    // the template names of the record are cleaned when READ: a bidi control or a token never comes back as it was
    const tok = 'team ' + secret;
    const tn = parseTeamRecord({ ...badRec({}), templates: ['Fine', 'Ev\u202Eil', tok, 'Fine'] })!.templates;
    ok(tn.includes('Fine') && tn.filter((x) => x === 'Fine').length === 1, 'read: a good template name stays, once');
    ok(!tn.some((x) => /[\u202A-\u202E\u2066-\u2069]/.test(x) || x.includes(secret)), 'read: a bidi-control name and a token-shaped name come back cleaned or dropped');
    eq(new FolderStore(path.join(dir, 'tok.json')).setTeamRecord(ws, badRec({ brief: 'use ' + secret + ' now' })), false, 'a record whose brief would be masked is refused whole');
    // restoreTeamRecord: the record from before, the names of the batch dropped, a created room removed
    const sr = new FolderStore(path.join(dir, 'restore.json')); sr.load();
    const prevRec = teamOf(1, 'Old', 500);
    ok(sr.setTeamRecord(ws, prevRec, [{ src: 'copilot', id: 'old-0', name: 'Keep' }]), 'a first record');
    const grown: TeamRecord = { templates: ['Old', 'New'], members: [...prevRec.members, ...teamOf(1, 'New', 600).members] };
    ok(sr.setTeamRecord(ws, grown, [{ src: 'copilot', id: 'new-0', name: 'Gone' }]), 'a second batch');
    ok(sr.restoreTeamRecord(ws, prevRec, [{ src: 'copilot', id: 'old-0', name: 'Keep' }], false), 'restored');
    eq([sr.get(ws)!.team, sr.get(ws)!.sessionNames?.map((x) => x.name)], [parseTeamRecord(prevRec), ['Keep']], 'the previous record is back and the batch\'s name is gone');
    eq(new FolderStore(path.join(dir, 'restore.json')).load()[0].team, parseTeamRecord(prevRec), 'also on disk');
    const sn = new FolderStore(path.join(dir, 'restore2.json')); sn.load();
    ok(sn.setTeamRecord(ws, prevRec, [{ src: 'copilot', id: 'x-0', name: 'Z' }]), 'a new room');
    ok(sn.restoreTeamRecord(ws, undefined, undefined, true) && !sn.get(ws), 'a room the batch created is removed');
    ok(sn.restoreTeamRecord(ws, undefined, undefined, true), 'a room that is gone is fine');
    const sk = new FolderStore(path.join(dir, 'restore3.json')); sk.load();
    sk.upsert({ workspace: ws, permMode: 'ask' });
    ok(sk.setTeamRecord(ws, prevRec) && sk.restoreTeamRecord(ws, undefined, undefined, false) && sk.get(ws)!.team === undefined && sk.get(ws)!.permMode === 'ask', 'a known room keeps its entry without the record');
    const sf = new FolderStore(path.join(blocked, 'r.json')); sf.load();
    sf.upsert({ workspace: ws, permMode: 'ask' });
    const snapshot = JSON.stringify(sf.get(ws));
    eq(sf.restoreTeamRecord(ws, undefined, undefined, true), false, 'a failed write answers false');
    eq(JSON.stringify(sf.get(ws)), snapshot, 'and the room stays as it was');
    // parseTeamRecord
    eq(parseTeamRecord(null), undefined, 'null');
    const nine = { templates: Array.from({ length: 12 }, (_, i) => 'T' + i), members: teamOf(12, 'x').members };
    const p9 = parseTeamRecord(nine)!;
    eq([p9.members.length, p9.templates.length], [8, 8], 'at most 8 members and 8 names');
    const dup = parseTeamRecord({ templates: ['A', 'A'], members: [teamOf(1, 'x').members[0], teamOf(1, 'x').members[0]] })!;
    eq([dup.members.length, dup.templates], [1, ['A']], 'a repeated member id and a repeated name are dropped');
    const odd = parseTeamRecord({ templates: [], members: [{ ...teamOf(1, 'x').members[0], mode: 'autopilot', app: 'Bad App', cap: { unit: 'aiu', amount: -1 } }, { ...teamOf(1, 'x').members[0], mode: 'autopilot', memberId: hexId(5) }] })!;
    eq([odd.members.length, odd.members[0].mode, odd.members[0].cap], [1, 'read-only', undefined], 'a bad app drops the member; an odd mode reads as read-only');
    // a huge file with a team is parsed quickly
    const t0 = Date.now();
    parseSavedFolders(JSON.stringify({ folders: [{ workspace: ws, permMode: 'ask', team: { templates: [], members: Array.from({ length: 30_000 }, (_, i) => teamOf(1, 'x', i + 1).members[0]) } }] }));
    ok(Date.now() - t0 < 10_000, 'a record with 30,000 members is read quickly (only 8 kept)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------------- 13b. real store: what create writes survives a read, a rollback keeps every older name
section('realstore', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-teamcreate-'));
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { checkTeamTemplate } = require('../src/shared/teamtemplate') as typeof import('../src/shared/teamtemplate');
    const ws = path.join(dir, 'proj');
    const make = (file: string, templates: StoredTemplate[], failAt = -1) => {
      const store = new FolderStore(path.join(dir, file)); store.load();
      let i = 0, p = 0;
      const create = {
        exists: (): boolean => true,
        room: (key: string) => { const f = store.get(key); return { count: f?.team?.members.length ?? 0, savedCap: f?.maxAiCredits, team: f?.team, known: f !== undefined, sessionNames: f?.sessionNames?.map((x) => ({ ...x })) }; },
        build: (s_: LazyMemberSpec): AgentInfo => ({ id: 'agent-' + ++i, alias: s_.name, adapterId: s_.app, cwd: s_.key, lazy: true }) as unknown as AgentInfo,
        commit: (key: string, team: TeamRecord, infos: AgentInfo[]): boolean => store.setTeamRecord(key, team, infos.map((x) => ({ src: x.adapterId ?? 'copilot', id: x.id, name: x.alias ?? '' }))),
        place: (): void => { if (p++ === failAt) throw new Error('boom'); },
        unplace: (): void => undefined, announce: (): void => undefined,
        rollback: (key: string, previous: TeamRecord | undefined, names: unknown, removeRoom: boolean): boolean => store.restoreTeamRecord(key, previous, names, removeRoom),
      };
      const w = world(templates, {}, { create, resolveTarget: async () => ({ ok: true as const, key: ws, existing: store.get(ws)?.team?.members.length ?? 0 }) });
      return { store, w };
    };
    // a template as the store holds it (checked at level own): the record created from it is read back whole
    const checked = checkTeamTemplate({ name: 'Squad  A', description: 'd', members: [
      { name: 'Ana  Smith', role: 'QA  lead', brief: 'Check the plan.\nThen ' + '\u{1F600}'.repeat(3000), app: 'copilot', permMode: 'ask', sendBrief: true, cap: { unit: 'aiu', amount: 40 } },
      { name: 'Bo', role: 'Dev', app: 'claude', permMode: 'read-only', sendBrief: false, cap: { unit: 'usd', amount: 2.5 }, profile: 'my-agent', model: 'sonnet-x', effort: 'low' },
    ] }, 'own');
    assert.ok(checked.ok, 'the fixture template passes the store check');
    const t = { ...(checked as { template: object }).template, id: 'tmpl1', origin: 'own', createdAt: 1, updatedAt: 1, members: (checked as { template: { members: TeamMember[] } }).template.members.map((m, k) => ({ ...m, memberId: hexId(k + 1) })) } as unknown as StoredTemplate;
    const { store, w } = make('a.json', [t]);
    const r = isOk(await created(w));
    eq(r.added, 2, 'created through the real store');
    const back = new FolderStore(path.join(dir, 'a.json')).load().find((f) => f.workspace === ws)!;
    eq(back.team, store.get(ws)!.team, 'the record read back from the file is the record that was written (nothing lost, nothing masked twice)');
    eq(back.team!.members.map((m) => m.sendBrief), [true, false], 'sendBrief is kept as written');
    // a rollback gives back every older name: 200 names, a batch of 3 whose place throws on the 2nd
    const three = tpl([mem(1), mem(2), mem(3)]);
    const m2 = make('b.json', [three], 1);
    m2.store.upsert({ workspace: ws, permMode: 'ask' });
    for (let i = 0; i < 200; i++) assert.ok(m2.store.setSessionName(ws, 'copilot', 's' + i, 'Name ' + i));
    const before = JSON.parse(JSON.stringify(m2.store.get(ws)!.sessionNames));
    eq(before.length, 200, 'a full list of names');
    await assert.rejects(async () => created(m2.w), /boom/, 'the place throws');
    n++;
    eq(m2.store.get(ws)!.sessionNames, before, 'the names are exactly as before (the oldest ones were not lost)');
    eq([m2.store.get(ws)!.team, m2.store.get(ws)!.permMode], [undefined, 'ask'], 'no record, the room as it was');
    eq(new FolderStore(path.join(dir, 'b.json')).load()[0].sessionNames, before, 'also on disk');
    // a room with NO names: the rollback gives back "none", not the batch's names
    const m3 = make('c.json', [three], 1);
    m3.store.upsert({ workspace: ws, permMode: 'ask' });
    eq(m3.store.get(ws)!.sessionNames, undefined, 'a room with no names to start with');
    await assert.rejects(async () => created(m3.w), /boom/, 'the place throws in a room with no names');
    n++;
    eq([m3.store.get(ws)!.sessionNames, m3.store.get(ws)!.team], [undefined, undefined], 'no names and no record in memory');
    eq(new FolderStore(path.join(dir, 'c.json')).load()[0].sessionNames, undefined, 'no names on disk either');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------------- 14. the real count behind resolveTarget
async function targetRun(P: path.PlatformPath, label: string): Promise<void> {
  const W = (...parts: string[]): string => P.resolve(P.sep, 'w', ...parts);
  const proj = W('proj'), picked = W('proj') + P.sep;
  const agents = [{ id: 'agent-1', key: proj }];
  const counts: Record<string, number> = { [proj]: 3 };
  const env = (teamCount?: (k: string) => number) => ({
    agents: () => agents, wsKey: (a: { key: string }) => a.key, resolveCwd: (x: string) => ({ cwd: x.replace(/[\\/]+$/, '') }), savedCap: () => undefined,
    pick: async () => picked, platform: P === path.win32 ? 'win32' : 'linux', realpath: (x: string) => x, ...(teamCount ? { teamCount } : {}),
  });
  const T = (t: object, e: object) => resolveTargetFrom(t as never, e as never) as Promise<{ ok: boolean; existing?: number; key?: string }>;
  const real = path.resolve;
  path.resolve = P.resolve;
  try {
    eq((await T({ room: 'agent-1' }, env((k) => counts[k] ?? 0))).existing, 3, label + ': the room\'s real count');
    eq((await T({ pick: true }, env((k) => counts[k] ?? 0))).existing, 3, label + ': a picked folder that is that room: the same count');
    eq((await T({ room: 'agent-1' }, env())).existing, 0, label + ': no count function: 0');
    for (const v of [-1, 9, 1.5, NaN, '3', null, undefined]) eq((await T({ room: 'agent-1' }, env(() => v as number))).existing, 0, label + ': an unusable count is 0');
  } finally { path.resolve = real; }
}
section('target', async () => {
  await targetRun(path.win32, 'win32');
  await targetRun(path.posix, 'posix');
});

// ---------------------------------------------------------------------------------------------------------------- 15. handler
section('handler', async () => {
  if (IS_COPY) return;
  const Module = require('module') as { _load: (r: string, ...a: unknown[]) => unknown };
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const origLoad = Module._load;
  Module._load = function (request: string, ...rest: unknown[]): unknown {
    if (request === 'electron') return { ipcMain: { handle: (c: string, f: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(c, f) }, app: {} };
    return origLoad.call(this, request, ...rest);
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
    const t = require('../src/main/ipc/teams') as typeof import('../src/main/ipc/teams');
    const { pathToFileURL } = require('url') as typeof import('url');
    const frame = { url: pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href };
    const win = { senderFrame: frame, sender: { mainFrame: frame } };
    const other = { url: 'https://example.invalid/' };
    const secret = 'ghp' + '_' + 'A1b2C3d4'.repeat(5);
    const throwing = { create: async () => { throw new Error('secret ' + secret); } } as unknown as InstanceType<typeof TeamOps>;
    t.register({ getOps: () => undefined, getTeamOps: () => throwing });
    const call = async (e: unknown, ...a: unknown[]): Promise<{ ok: boolean; code?: string; errors?: string[] }> => (await handlers.get('teams:create')!(e, ...a)) as never;
    const bad = await call(win, tok(1), { rows: {} });
    eq([bad.ok, bad.code, bad.errors], [false, 'failed', ['The team templates could not be used.']], 'a throw answers the fixed failed');
    ok(!JSON.stringify(bad).includes(secret), 'the throw\'s text is not in the answer');
    let refused = false;
    try { refused = (await call({ senderFrame: other, sender: { mainFrame: other } }, tok(1), { rows: {} })).ok === false; } catch { refused = true; }
    ok(refused, 'another page is refused');
    handlers.clear();
    const w = world([tpl([mem(1)])]);
    t.register({ getOps: () => undefined, getTeamOps: () => w.ops });
    const token = await w.preview();
    const good = (await call(win, token, { rows: {} })) as unknown as CreateOk;
    ok(good.ok === true && good.added === 1, 'the real ops through the handler');
    const hostile = new Proxy({}, { ownKeys() { throw new Error('trap ' + secret); } });
    const h = await call(win, await w.preview(), hostile);
    eq([h.ok, h.code], [false, 'failed'], 'a hostile argument: failed');
    ok(!JSON.stringify(h).includes('trap'), 'no word of the trap');
    handlers.clear();
    t.register({ getOps: () => undefined, getTeamOps: () => undefined });
    eq((await call(win, tok(1), { rows: {} })).code, 'invalid', 'no ops (the simulator): fixed words');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ok(!(require('../src/main/simguard') as typeof import('../src/main/simguard')).simChannelOpen('teams:create'), 'closed in the simulator');
  } finally { Module._load = origLoad; handlers.clear(); }
});

// ---------------------------------------------------------------------------------------------------------------- 16. main.ts never starts a member
section('main', () => {
  if (IS_COPY) return;
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'), 'utf8').replace(/\r\n/g, '\n');
  const at = src.indexOf('function addLazyMember(');
  ok(at > 0, 'addLazyMember is in main.ts');
  const body = src.slice(at, src.indexOf('\n}\n', at));
  const lazy = src.slice(src.indexOf('function lazyInfo('), src.indexOf('\n}\n', src.indexOf('function lazyInfo(')));
  for (const part of [body, lazy]) ok(!/\.start\(|ensureLive|startGuardOp|sendOp|addWorkspace|router\.bind|agents\.set|toRenderer/.test(part), 'building a member starts nothing and puts nothing in the office');
  ok(/lazy: true/.test(lazy), 'the not-started flag');
  ok(/lazyInfo\(f\.workspace/.test(src), 'restoreFolders uses the same path');
  const create = src.slice(src.indexOf('create: {'), src.indexOf('resolveTarget: (t)', src.indexOf('create: {')));
  ok(/\bexists: pathExists,/.test(create) && /import \{[^}]*\bpathExists\b[^}]*\} from '\.\/teamops'/.test(src), 'the wiring asks the real folder check (pathExists), not a stub');
  ok(/build: addLazyMember/.test(create) && !/ensureLive|startGuardOp|\.start\(/.test(create), 'the wiring builds with addLazyMember and starts nothing');
  // T011 wiring (the 8-member cap, the rollback, the key-to-count of the target, the names written with the record): none of it can run without Electron
  ok(/room: \(key\) => \{[^\n]*\bcount: f\?\.team\?\.members\.length \?\? 0,[^\n]*\bsavedCap: f\?\.maxAiCredits,[^\n]*\bteam: f\?\.team,[^\n]*\bknown: f !== undefined,[^\n]*\bsessionNames: f\?\.sessionNames\?\.map/.test(create), 'room(): the count is the saved record\'s member count (the cap of 8), with the saved limit, team, known and names');
  ok(/rollback: \(key, previous, previousNames, removeRoom\) => !!folderStore && folderStore\.restoreTeamRecord\(key, previous, previousNames, removeRoom\),/.test(create), 'rollback hands the record, the names and the flag to restoreTeamRecord in its own order');
  ok(/restoreTeamRecord\(workspace: string, previous: unknown, previousNames: unknown, removeRoom: boolean\)/.test(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'folders.ts'), 'utf8')), 'restoreTeamRecord takes (key, previous, previousNames, removeRoom), the order main.ts calls it in');
  ok(/commit: \(key, team, infos\) => !!folderStore && folderStore\.setTeamRecord\(key, team, infos\.map\(\(i\) => \(\{ src: i\.adapterId \?\? DEFAULT_ADAPTER, id: i\.id, name: i\.alias \?\? '' \}\)\)\),/.test(create), 'commit writes each member as { src: its adapter (default when none), id, name: its alias or empty }');
  ok(/place: \(info\) => \{ router\.bind\(info\.id, info\.adapterId \?\? DEFAULT_ADAPTER\); agents\.set\(info\.id, info\); \},/.test(create), 'place binds the agent to its app, then puts it in the office');
  ok(/unplace: \(id\) => \{ agents\.delete\(id\); agentState\.remove\(id\); router\.unbind\(id\); \},/.test(create), 'unplace removes the agent from the office, its state and the router (no ghost after a failed place)');
  ok(/announce: \(info\) => toRenderer\('agent:added', info\),/.test(create), 'announce tells the window with agent:added');
  const target = src.slice(src.indexOf('resolveTarget: (t)'), src.indexOf('pick: async', src.indexOf('resolveTarget: (t)')));
  ok(/teamCount: \(key\) => folderStore\?\.get\(key\)\?\.team\?\.members\.length \?\? 0,/.test(target), 'resolveTarget counts the target room\'s members from the saved record');
});

// ---------------------------------------------------------------------------------------------------------------- run
(async () => {
  for (const [name, fn] of sections) {
    try { await fn(); } catch (e) { failed++; console.error(`SECTION ${name} FAILED`); console.error(e instanceof Error ? e.message.slice(0, 240) : 'failed'); if (process.env.TEAMCREATE_TRACE && e instanceof Error) console.error(e.stack); }
  }
  if (failed > 0) { console.error(`teamcreate: ${failed} section(s) failed`); process.exit(1); }
  if (IS_COPY) { console.log(`teamcreate (copy): ${n} checks passed`); return; }
  // ------------------------------------------------------------------------------------------------------------ mutants, on copies
  const root = path.join(__dirname, '..', 'src', 'main');
  const origOps = fs.readFileSync(path.join(root, 'teamops.js'), 'utf8');
  const origFold = fs.readFileSync(path.join(root, 'folders.js'), 'utf8');
  const mutate = (text: string, m: { name: string; from: string; to: string }): string => {
    const lf = text.replace(/\r\n/g, '\n');
    assert.ok(lf.includes(m.from), 'mutant anchor not found: ' + m.name);
    return lf.split(m.from).join(m.to);
  };
  const mutants: { name: string; from: string; to: string; section: string; file?: 'folders' }[] = [
    { name: 'the entry\'s own choices are trusted instead of the call\'s', from: 'const appChanged = app !== m.app;', to: 'const appChanged = app !== m.app; { const c0 = e.choices.get(String(m.memberId)); if (c0) { rc.app = c0.app; rc.model = c0.model; } }', section: 'choices' },
    { name: 'the snapshot is not compared', from: '(0, util_1.isDeepStrictEqual)(now, t)', to: 'true', section: 'snapshot' },
    { name: 'an adapter is started', from: 'const infos = picked.map((x) => dep.build({ ...x.spec, key: e.key }));', to: 'const infos = picked.map((x) => dep.build({ ...x.spec, key: e.key })); dep.adapterOf(picked[0].spec.app).start();', section: 'nothing' },
    { name: 'an own Allow all enters as Allow all unconfirmed', from: "if (mode === 'allow' && (imported || choices.allowConfirmed !== true))", to: "if (mode === 'allow' && imported)", section: 'modes' },
    { name: 'an imported Allow all is kept', from: "if (mode === 'allow' && (imported || choices.allowConfirmed !== true))", to: "if (mode === 'allow' && choices.allowConfirmed !== true)", section: 'modes' },
    { name: 'Autopilot is set', from: 'mode: x.spec.mode,', to: "mode: 'autopilot',", section: 'modes' },
    { name: 'the mode is raised to Allow all', from: "let mode = (0, agentops_1.validMode)(m.permMode);", to: "let mode = 'allow';", section: 'modes' },
    { name: 'an await between the count and the write', from: 'const room = dep.room(e.key);', to: 'const room = dep.room(e.key); await new Promise((r) => setTimeout(r, 40));', section: 'cap8' },
    { name: 'the cap of 8 counts one short', from: 'if (have + picked.length > teamtemplate_1.LIMITS.members)', to: 'if (have + picked.length > teamtemplate_1.LIMITS.members + 1)', section: 'cap8' },
    { name: 'the cap of 8 ignores the existing members', from: 'if (have + picked.length > teamtemplate_1.LIMITS.members)', to: 'if (picked.length > teamtemplate_1.LIMITS.members)', section: 'cap8' },
    { name: 'the count is the token\'s existing, not the real one', from: 'const have = Number.isInteger(room.count) && room.count > 0 ? room.count : 0;', to: 'const have = e.existing;', section: 'cap8' },
    { name: 'the token can be used twice', from: 'const e = this.takeToken(tokenIn);', to: 'const e = this.live && this.live.token === tokenIn ? this.live : this.takeToken(tokenIn);', section: 'token' },
    { name: 'the room\'s saved limit is ignored', from: 'cleanCap(dep.room(e.key).savedCap)', to: 'undefined', section: 'limits' },
    { name: 'the second template overwrites the record', from: 'members: [...(room.team?.members ?? []), ...made]', to: 'members: [...made]', section: 'append' },
    { name: 'the template names are not kept', from: 'const names = [...(room.team?.templates ?? [])];', to: 'const names = [];', section: 'append' },
    { name: 'a clashing member id is kept', from: 'while (taken.has(memberId))', to: 'while (false)', section: 'append' },
    { name: 'the record is written after the agents are placed', from: 'if (!dep.commit(e.key, team, infos))', to: 'for (const i of infos) dep.place(i);\n        if (!dep.commit(e.key, team, infos))', section: 'atomicity' },
    { name: 'a failed write is ignored', from: 'if (!dep.commit(e.key, team, infos))', to: 'if (dep.commit(e.key, team, infos) && false)', section: 'atomicity' },
    { name: 'the write comes before the checks', from: 'const e = this.takeToken(tokenIn);', to: 'const e = this.takeToken(tokenIn); if (e && this.deps.create) this.deps.create.commit(e.key, { templates: [], members: [] }, []);', section: 'arguments' },
    { name: 'placed agents are not removed after a throw', from: 'for (const info of infos) {\n                try {\n                    dep.unplace(info.id);', to: 'for (const info of []) {\n                try {\n                    dep.unplace(info.id);', section: 'atomicity' },
    { name: 'a row that needs a choice is created', from: 'if (row.needsChoice)', to: 'if (false)', section: 'needschoice' },
    { name: 'a limit sent with another app counts', from: 'if (!appChanged) {', to: 'if (true) {', section: 'limits' },
    { name: 'a limit in the wrong unit is converted', from: 'if (rc.cap.unit !== unit)', to: 'if (false)', section: 'limits' },
    { name: 'a limit for an app with none is taken', from: "if (unit === 'none')\n                    return cfail('invalid', 'Choices, limit: not valid.');", to: 'if (false)\n                    return cfail(\'invalid\', \'x\');', section: 'limits' },
    { name: 'an unknown row id is ignored', from: "return cfail('invalid', 'Choices: a row is not in this preview.');", to: 'continue;', section: 'arguments' },
    { name: 'the imported effort is raised (picked always)', from: "picked: rc.effort !== undefined && rc.effort !== '', appChanged,", to: 'picked: true, appChanged,', section: 'effort' },
    { name: 'the real count of a room is 0', from: 'const teamCountOf = (env, key) => { const n = env.teamCount?.(key);', to: 'const teamCountOf = (env, key) => { const n = 0;', section: 'target' },
    { name: 'the record is saved smaller when a member does not parse', from: '!(0, util_1.isDeepStrictEqual)(rec, JSON.parse(JSON.stringify(team)))', to: '!rec || rec.members.length !== team.members.length', section: 'folders', file: 'folders' },
    { name: 'a new room is left in memory after a failed write', from: 'if (created)\n            this.folders = this.folders.filter((f) => f !== cur);', to: 'if (created) { }', section: 'folders', file: 'folders' },
    { name: 'a failed write keeps the team', from: 'cur.team = before.team;', to: '', section: 'folders', file: 'folders' },
    { name: 'a new room gets Allow all', from: "cur = { workspace, permMode: 'read-only', hidden: false };", to: "cur = { workspace, permMode: 'allow', hidden: false };", section: 'folders', file: 'folders' },
    { name: 'a new room is hidden', from: "cur = { workspace, permMode: 'read-only', hidden: false };", to: "cur = { workspace, permMode: 'read-only', hidden: true };", section: 'folders', file: 'folders' },
    { name: 'a record has more than 8 members', from: 'if (members.length >= teamtemplate_1.LIMITS.members)', to: 'if (members.length >= 99)', section: 'folders', file: 'folders' },
    { name: 'an odd mode is read as Allow all', from: "permMode: o.mode === 'ask' || o.mode === 'allow' ? o.mode : 'read-only'", to: "permMode: o.mode === 'ask' ? o.mode : 'allow'", section: 'folders', file: 'folders' },
    { name: 'a failing announce is propagated', from: 'dep.announce(info);\n            }\n            catch { /* the team exists', to: 'dep.announce(info);\n            }\n            catch (e) { throw e; /* the team exists', section: 'atomicity' },
    { name: 'the default limit is not normalized', from: 'const c = (0, credits_1.parseCapIn)(unit === \'none\' ? undefined : unit, cap);', to: 'const c = cap;', section: 'limits' },
    { name: 'the rollback is not retried', from: 'attempt < 2 && !back', to: 'attempt < 1 && !back', section: 'atomicity' },
    { name: 'the folder check is asked about the wrong key', from: 'dep.exists(e.key)', to: "dep.exists('')", section: 'atomicity' },
    { name: 'a rollback that throws counts as done', from: 'catch {\n                    back = false;', to: 'catch {\n                    back = true;', section: 'atomicity' },
    { name: 'a missing folder is not noticed', from: "if (!dep.exists(e.key))", to: 'if (false)', section: 'atomicity' },
    { name: 'the rows object is not bounded', from: 'moreKeysThan)(rowsIn, teamtemplate_1.LIMITS.members)', to: 'moreKeysThan)(rowsIn, 1000)', section: 'arguments' },
    { name: 'a room with no names keeps the batch names after a rollback', from: 'cur.sessionNames = parseSessionNames(previousNames);', to: 'cur.sessionNames = parseSessionNames(previousNames) ?? cur.sessionNames;', section: 'realstore', file: 'folders' },
    { name: 'the rows bound is one below the limit', from: 'moreKeysThan)(rowsIn, teamtemplate_1.LIMITS.members)', to: 'moreKeysThan)(rowsIn, teamtemplate_1.LIMITS.members - 1)', section: 'arguments' },
    { name: 'the real exists always says yes', from: 'fs.existsSync(key)', to: 'true', section: 'atomicity' },
    { name: 'the real exists always says no', from: 'fs.existsSync(key)', to: 'false', section: 'atomicity' },
    { name: 'the amount text is not bounded', from: 'amount.length <= 32', to: 'amount.length <= 1000', section: 'arguments' },
    { name: 'the snapshot is compared only once', from: "if (!this.unchanged(t))\n            return cfail('changed', CHANGED_NOW);", to: 'if (false)\n            return cfail(\'changed\', CHANGED_NOW);', section: 'snapshot2' },
    { name: 'a throw at place removes only the first agent', from: 'for (const info of infos) {\n                try {\n                    dep.unplace(info.id);', to: 'for (const info of infos.slice(0, 1)) {\n                try {\n                    dep.unplace(info.id);', section: 'atomicity' },
    { name: 'the agent whose place threw stays', from: 'for (const info of infos) {\n                try {\n                    dep.unplace(info.id);', to: 'for (const info of infos.slice(0, 1).concat(infos.slice(2))) {\n                try {\n                    dep.unplace(info.id);', section: 'atomicity' },
    { name: 'the record is not put back after a throw', from: 'back = dep.rollback(e.key, room.team, room.sessionNames, room.known === false) === true;', to: 'back = true;', section: 'atomicity' },
    { name: 'a room the write created stays after a throw', from: 'room.known === false) === true;', to: 'false) === true;', section: 'atomicity' },
    { name: 'the window is told before every member is placed', from: 'for (const info of infos)\n                dep.place(info);', to: 'for (const info of infos) {\n                dep.place(info);\n                dep.announce(info);\n            }', section: 'atomicity' },
    { name: 'a record that loses a field is saved', from: '!(0, util_1.isDeepStrictEqual)(rec, JSON.parse(JSON.stringify(team)))', to: 'false', section: 'folders', file: 'folders' },
    { name: 'the record is not checked when read', from: 'const r = (0, teamtemplate_1.checkMember)(cand, \'own\');', to: 'const r = { ok: true, member: { name: cand.name, role: cand.role, app: cand.app, permMode: cand.permMode, sendBrief: cand.sendBrief, brief: cand.brief, briefFrom: cand.briefFrom, profile: cand.profile, model: cand.model, effort: cand.effort, cap: cand.cap } };', section: 'folders', file: 'folders' },
    { name: 'a non-boolean sendBrief is read as true', from: "if (typeof o.sendBrief !== 'boolean')\n        return undefined;", to: 'if (false)\n        return undefined;', section: 'folders', file: 'folders' },
    { name: 'a restore does not put the older names back', from: 'cur.sessionNames = parseSessionNames(previousNames);', to: 'cur.sessionNames = (cur.sessionNames ?? []).filter((x) => !/^agent-/.test(x.id));', section: 'realstore', file: 'folders' },
    { name: 'a restore keeps the new record', from: 'if (prev)\n            cur.team = prev;\n        else\n            delete cur.team;', to: '', section: 'folders', file: 'folders' },
    { name: 'a session id is checked with the loose rule of the names (`/`, `.`, `:` pass)', from: "(0, sessionid_1.sessionIdOk)(typeof o.app === 'string' ? o.app : undefined, x.id)", to: 'exports.SESSION_NAME_ID.test(x.id)', section: 'folders', file: 'folders' },
    { name: 'a session id is not checked when read', from: "(0, sessionid_1.sessionIdOk)(typeof o.app === 'string' ? o.app : undefined, x.id)", to: 'true', section: 'folders', file: 'folders' },
    { name: 'a session id has no length bound in the parser path (a 101-character id is cut to 100 and kept)', from: "(0, sessionid_1.sessionIdOk)(typeof o.app === 'string' ? o.app : undefined, x.id) && !sessions.some((y) => y.id === x.id))\n                sessions.push({ id: x.id,", to: "(0, sessionid_1.sessionIdOk)(typeof o.app === 'string' ? o.app : undefined, x.id.slice(0, 100)) && !sessions.some((y) => y.id === x.id))\n                sessions.push({ id: x.id.slice(0, 100),", section: 'folders', file: 'folders' },
    { name: 'a repeated session id is kept', from: ' && !sessions.some((y) => y.id === x.id))', to: ')', section: 'folders', file: 'folders' },
    { name: 'a template name of the record is not cleaned when read', from: 'const n = (0, names_1.cleanDisplayName)(t, 60);', to: 'const n = typeof t === \'string\' ? t : undefined;', section: 'folders', file: 'folders' },
    { name: 'a restore leaves the created room', from: 'if (removeRoom && !prev)', to: 'if (false)', section: 'folders', file: 'folders' },
  ] as never;
  const base = (m: { file?: string }): string => (m.file === 'folders' ? origFold : origOps);
  const lost = mutants.filter((m) => !base(m).replace(/\r\n/g, '\n').includes(m.from)).map((m) => m.name);
  assert.deepStrictEqual(lost, [], 'mutant anchors not found');
  for (const m of mutants) {
    const crlf = base(m).replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
    ok(mutate(crlf, m).length > 0, 'the anchor of "' + m.name + '" is found in a CRLF source');
  }
  assert.throws(() => mutate('no such text', mutants[0]), /mutant anchor not found: /, 'a missing anchor says so');
  let killed = 0, k = 0;
  for (const m of mutants) {
    k++;
    const isF = m.file === 'folders';
    const uniq = `${isF ? 'folders' : 'teamops'}.mutant-${process.pid}-${k}`;
    const file = path.join(root, uniq + '.js');
    try {
      const mutated = mutate(base(m), m);
      try { new vm.Script(mutated, { filename: uniq }); } catch (e) { assert.fail('mutant is not valid JavaScript (' + m.name + '): ' + (e as Error).message); }
      fs.writeFileSync(file, mutated);
      const r = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, isF ? { TEAMCREATE_FOLDERS: uniq } : { TEAMCREATE_OPS: uniq }), encoding: 'utf8', timeout: 120000 });
      assert.notStrictEqual(r.status, 0, 'mutant NOT killed: ' + m.name);
      const died = [...r.stderr.matchAll(/SECTION (\w+) FAILED/g)].map((x) => x[1]);
      if (process.env.TEAMCREATE_LABELS) console.log(m.name + ' => ' + (died.join(',') || '(no section: ' + (r.stderr.split('\n').find((l) => /Error/.test(l)) ?? 'silent exit') + ')'));
      assert.ok(died.includes(m.section), `mutant "${m.name}" must die in section "${m.section}", it died in: ${died.join(',') || r.stderr.slice(0, 200)}`);
      killed++;
    } finally { fs.rmSync(file, { force: true }); }
  }
  assert.strictEqual(killed, mutants.length);
  console.log(`teamcreate: ${n} checks passed, ${killed} mutants killed`);
})().catch((e) => { console.error(e); process.exit(1); });
