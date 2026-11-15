/**
 * Unit tests, spec 111 T007 (FR-010, FR-023, FR-100, FR-133): `TeamsIpcOps`, the handlers of `teams:list`, `teams:put`, `teams:delete`,
 * `teams:duplicate` and `teams:markMine`, on the real `TeamTemplateStore` over a temporary folder (and a failing file system for `failed`).
 * No Electron, no credits. Non-ASCII is written as \u escapes; token-like data is built at run time.
 *
 * Mutants (2026-11-12, each applied to the COMPILED module as a text replacement, the named section must fail, then restored; the runner is
 * a throwaway script, an anchor that no longer matches fails loudly):
 *   1 an edit removes the file mark (`next.briefFrom = 'file'` dropped)        -> keepsMarkOnEdit
 *   2 duplicate drops the mark (store: `delete copy.members[i].briefFrom`)      -> duplicateKeepsMark
 *   3 members matched by position, not by memberId                             -> reorder
 *   4 a memberId from the window is accepted on create                         -> createRefusesMemberId
 *   5 markMine accepts extra arguments                                         -> markMine
 *   6 an error that carries the value                                          -> noValueInErrors
 *   7 put creates with the origin of the value                                 -> windowCannotImport
 *   8 an unknown memberId accepted                                             -> noValueInErrors (its count of refusals; the unique hex value) and memberIdRules
 *   9 a repeated memberId accepted                                            -> memberIdRules
 *  10 the unknown-memberId error carries the value                            -> noValueInErrors
 *  11 put accepts a stored member without a memberId (it is skipped)          -> storedIds
 *  12 repeated stored ids: the first (or last) wins instead of a refusal      -> storedIds
 *  13 the store does not give ids at the load                                 -> storedIds
 *  14 putImported gives no ids                                                -> storedIds
 *  15 the argument is copied with a spread (getters run)                      -> ownDataOnly
 *  16 the members count is judged after the copy, not before                  -> limitsAndShapes
 *  17 the memberId format is not checked                                     -> limitsAndShapes (the error words differ)
 *  18, 19 the id length cap raised to 1000, lowered to 63                    -> limitsAndShapes
 *  20, 21 the array cap of the copy raised to 100,000, lowered to 9,999      -> limitsAndShapes
 *  22, 23 the nesting cap raised to 9, lowered to 7                          -> limitsAndShapes
 *  24 a handler lets a throw out                                             -> handlersNeverThrow (the real handlers on a fake Electron)
 *  25, 26 `setAside` always false / always true                              -> listSetAside
 *  27 putImported keeps the ids the caller passed                            -> storedIds
 *  29, 30 the template-key / member-key bound removed                         -> bounds
 *  31..34 each key bound one more / one fewer (32 and 64)                    -> bounds
 *  35 the key bound of nested objects removed                                -> bounds
 *  36 the value budget counted per array instead of in total                  -> bounds
 *  37, 38 the budget 5,001 / 4,999 (the 5,000 boundary is exact)               -> bounds
 *  39 primitives not counted in the budget                                   -> bounds
 *  40 the `len > b.left` refusal before an array's items are read removed    -> bounds (a sparse `new Array(6000)` says "too large" with it, "send plain data" without)
 *  41, 47 null / undefined not counted in the budget                          -> bounds
 *  46 `moreKeysThan` without the own-key filter                              -> inheritedKeys
 *  EQUIVALENT (survives, on purpose): 28 the second `members.length > 8` check, after the copy: the first check (before the copy) already
 *  refuses every list that is too long, and the copy keeps its length; the second is defence in depth only. Mutants were run on COPIES of the
 *  compiled JS (a throwaway runner under the scratchpad). The review of #1640 reported surviving mutants without naming them, so the ones above
 *  (format, id length, 10,000, members count, nesting) were rebuilt from the code's own limits.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TeamsIpcOps } from '../src/main/teamsipc';
import { TeamTemplateStore, type TeamFs } from '../src/main/teamstore';

let n = 0;
const ok = (c: unknown, m: string): void => { n++; assert.ok(c, m); };
const eq = <T>(a: T, b: T, m: string): void => { n++; assert.deepStrictEqual(a, b, m); };
/** every section runs; a failed one is named on stderr (the mutant runner reads the names) and the run ends with a failure */
let failed = 0;
const section = (name: string, fn: () => void): void => { try { fn(); } catch (e) { failed++; console.error(`SECTION ${name} FAILED`); console.error(e instanceof Error ? e.message.slice(0, 200) : 'failed'); } };

const HEX = /^[0-9a-f]{32}$/;
const F32 = 'f'.repeat(32);
/** a 32-hex value nobody else uses, built at run time: it must never come back in a result */
const HEXVAL = ('9a' + '4c').repeat(8);
const TOKEN = 'ghp' + '_' + 'A1b2C3d4'.repeat(5); // 40 chars, built at run time
const real: TeamFs = {
  openSync: (f, fl) => fs.openSync(f, fl), fstatSync: (fd) => fs.fstatSync(fd), readSync: (fd, b, o, l, p) => fs.readSync(fd, b, o, l, p), closeSync: (fd) => fs.closeSync(fd),
  mkdirSync: (d, o) => fs.mkdirSync(d, o), lstatSync: (p) => fs.lstatSync(p), writeFileSync: (f, d, o) => fs.writeFileSync(f, d, o),
  renameSync: (a, b) => fs.renameSync(a, b), rmSync: (p, o) => fs.rmSync(p, o), readdirSync: (d) => fs.readdirSync(d),
  fsyncFile: (f) => { const fd = fs.openSync(f, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } },
};
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-teamsipc-'));
let dirN = 0;
function setup(over: Partial<TeamFs> = {}, pre?: string): { ops: TeamsIpcOps; store: TeamTemplateStore; file: string } {
  const dir = path.join(root, `d${++dirN}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'team-templates.json');
  if (pre !== undefined) fs.writeFileSync(file, pre);
  let k = 0;
  const mint = (): string => (0x1000 + ++k + dirN * 100000).toString(16).padStart(32, 'c'); // 32 hex digits, never 'a' or 'b' repeated
  const store = new TeamTemplateStore(file, { fs: { ...real, ...over } as TeamFs, newMemberId: mint, pause: () => undefined });
  return { ops: new TeamsIpcOps({ store: () => store, newMemberId: mint }), store, file };
}
const mem = (name: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ name, role: 'Dev', app: 'claude', permMode: 'read-only', sendBrief: false, ...extra });
/** the three member ids of `seedImported`: `putImported` gives FRESH ids, so they are read back from its result */
let A = 'a'.repeat(32), B = 'b'.repeat(32), C = 'd'.repeat(32);
/** An imported template with marked briefs, seeded through the store's own import path (main only). */
function seedImported(s: { store: TeamTemplateStore }, brief = 'Check it.'): { id: string; ids: string[] } {
  const r = s.store.putImported({ name: 'Crew', members: [mem('A', { memberId: A, brief, briefFrom: 'file' }), mem('B', { memberId: B, brief: 'plain' }), mem('C', { memberId: C, brief: 'Test it.', briefFrom: 'file' })] });
  assert.ok(r.ok);
  if (r.ok) [A, B, C] = r.template.members.map((m) => m.memberId as string);
  return { id: r.ok ? r.template.id : '', ids: [A, B, C] };
}
const members = (r: { ok: boolean }): Record<string, unknown>[] => (r as unknown as { template: { members: Record<string, unknown>[] } }).template.members;
const refused = (r: { ok: boolean; code?: string }, code = 'invalid'): boolean => r.ok === false && r.code === code;
const text = (v: unknown): string => JSON.stringify(v);

section('wrongInputs', () => {
  const { ops, store } = setup();
  seedImported({ store });
  for (const v of [undefined, null, 'x', 42, true, [], [mem('A')], () => 1, Object.create({ name: 'x', members: [mem('A')] }), { name: 'T' }, { name: 'T', members: 'x' }, { name: 'T', members: {} },
    { name: 'T', members: [] }, { name: 7, members: [mem('A')] }, { name: 'T', members: [null] }, { name: 'T', members: ['x'] }, { name: 'T', members: [[]] },
    { name: 'T', members: Array.from({ length: 9 }, (_, i) => mem('M' + i)) }, { name: 'T', members: [mem('A', { app: 7 })] }, { name: 'T', members: [Object.create(mem('A'))] },
    { id: 7, name: 'T', members: [mem('A')] }, { id: '', name: 'T', members: [mem('A')] }, { id: 'x'.repeat(65), name: 'T', members: [mem('A')] }, { id: 'nope', name: 'T', members: [mem('A')] }]) {
    const r = ops.put(v);
    ok(refused(r), `put refuses ${text(v)?.slice(0, 40)}`);
    ok(Array.isArray((r as { errors: string[] }).errors) && (r as { errors: string[] }).errors.length > 0, 'an error is named');
  }
  eq(store.list().length, 1, 'nothing was written');
  for (const v of [undefined, null, 1, {}, [], '', 'x'.repeat(65)]) { ok(refused(ops.delete(v)), 'delete refuses a bad id'); ok(refused(ops.duplicate(v)), 'duplicate refuses a bad id'); }
  ok(refused(ops.duplicate('missing')), 'duplicate of an unknown id');
  eq(ops.delete('missing'), { ok: true, removed: false }, 'delete of an unknown id writes nothing');
  const proto = JSON.parse('{"__proto__":{"id":"x"},"name":"T","members":[{"name":"A","role":"Dev","app":"claude","permMode":"read-only","sendBrief":false}]}') as unknown;
  ok(ops.put(proto).ok, 'an own __proto__ key is data, ignored as an unknown key, and sets no prototype');
});

section('storedIds', () => {
  const doc = (members: unknown[]): string => JSON.stringify({ format: 'agent-durbar-team-templates', schemaVersion: 1, templates: [{ id: 't1', name: 'Crew', origin: 'imported', createdAt: 1, updatedAt: 1, members }] });
  // a hand-edited file: a marked member without a memberId, and two members with the same one
  const s = setup({}, doc([mem('A', { brief: 'Check it.', briefFrom: 'file' }), mem('B', { memberId: B, briefFrom: 'file' }), mem('C', { memberId: B }), mem('D', { memberId: 'not hex' })]));
  eq(s.store.list().length, 0, 'a member with a bad memberId still sets the whole template aside (the validator\'s rule)');
  const g = setup({}, doc([mem('A', { brief: 'Check it.', briefFrom: 'file' }), mem('B', { memberId: B, briefFrom: 'file' }), mem('C', { memberId: B }), mem('D')]));
  const t = g.store.get('t1')!;
  const ids = t.members.map((m) => m.memberId as string);
  ok(ids.every((i) => HEX.test(i)) && new Set(ids).size === 4, 'the store gives a new memberId to a member with none and to the second one of a repeated id');
  eq(ids[1], B, 'the first holder of an id keeps it');
  eq(t.members.map((m) => m.briefFrom), ['file', 'file', undefined, undefined], 'every mark stays');
  const r = g.ops.put({ id: 't1', name: 'Crew', members: t.members.map((m) => mem(m.name, { memberId: m.memberId })) });
  eq(members(r).map((m) => m.briefFrom), ['file', 'file', undefined, undefined], 'a window put (no marks sent) keeps them: the id-less member did not lose its mark');
  ok(g.ops.markMine('t1', ids[0]).ok, 'markMine works on the member that had no id');
  // putImported: a fresh id for every member, the mark stays
  const p = g.store.putImported({ name: 'Imp', members: [mem('A', { briefFrom: 'file' }), mem('B', { memberId: A }), mem('C', { memberId: F32 })] });
  const pi = p.ok ? p.template.members.map((m) => m.memberId as string) : [];
  ok(p.ok && p.template.members[0].briefFrom === 'file', 'the mark stays on import'); ok(pi.length === 3 && pi.every((i) => HEX.test(i)) && new Set(pi).size === 3 && !pi.includes(A) && !pi.includes(F32), 'putImported gives every member a FRESH id and drops the ones the caller passed');
  // defence in depth: a store that holds a stored template with an id-less or repeated member (a fake, the real store prevents it)
  const bad = (members: unknown[]): TeamsIpcOps => {
    const t0 = { id: 'x1', name: 'Crew', origin: 'imported', createdAt: 1, updatedAt: 1, members };
    const fake = { get: (id: string) => (id === 'x1' ? JSON.parse(JSON.stringify(t0)) : undefined), isBlocked: () => false, list: () => [], put: () => { throw new Error('must not save'); } };
    return new TeamsIpcOps({ store: () => fake as unknown as TeamTemplateStore });
  };
  for (const ms of [[mem('A', { briefFrom: 'file' }), mem('B', { memberId: B })], [mem('A', { memberId: A, briefFrom: 'file' }), mem('B', { memberId: A })], [mem('A', { memberId: A, briefFrom: 'file' }), mem('B')]]) {
    const o = bad(ms);
    ok(refused(o.put({ id: 'x1', name: 'Crew', members: [mem('A', { memberId: A }), mem('B', { memberId: B })] })), 'put refuses a stored template whose ids are not one each');
    ok(refused(o.put({ id: 'x1', name: 'Crew', members: [mem('N')] })), 'even when the window sends no id at all');
    ok(refused(o.markMine('x1', A)) && refused(o.markMine('x1', B)), 'markMine refuses it too');
    ok((o.put({ id: 'x1', name: 'Crew', members: [mem('N')] }) as { errors: string[] }).errors[0].includes('reload'), 'and says to reload');
  }
});

section('ownDataOnly', () => {
  const { ops, store } = setup();
  const s = seedImported({ store });
  let ran = 0;
  const g = { name: 'T', members: [mem('A')] } as Record<string, unknown>;
  Object.defineProperty(g, 'id', { enumerable: true, get() { ran++; return s.id; } });
  ok(refused(ops.put(g)) && ran === 0, 'an id that is a getter is refused and never runs (no create branch, no update branch)');
  const m = mem('A'); Object.defineProperty(m, 'role', { enumerable: true, get() { ran++; return 'Dev'; } });
  ok(refused(ops.put({ name: 'T', members: [m] })) && ran === 0, 'a member field that is a getter is refused');
  const boom = { name: 'T', members: [mem('A')] } as Record<string, unknown>;
  Object.defineProperty(boom, 'description', { enumerable: true, get() { ran++; throw new Error('secret ' + TOKEN); } });
  const rb = ops.put(boom);
  ok(refused(rb) && ran === 0 && !text(rb).includes(TOKEN), 'a getter that throws a value: it does not run and nothing leaks');
  const deep = { name: 'T', members: [mem('A', { cap: { unit: 'usd' } })] } as Record<string, unknown>;
  Object.defineProperty((deep.members as Record<string, unknown>[])[0].cap as object, 'amount', { enumerable: true, get() { ran++; return 1; } });
  ok(refused(ops.put(deep)) && ran === 0, 'a nested getter too');
  const calls: string[] = [];
  const spy = new Proxy({ name: 'T', members: [mem('A')] }, { get(t, k) { calls.push('get'); throw new Error(TOKEN); }, getOwnPropertyDescriptor(t, k) { return Reflect.getOwnPropertyDescriptor(t, k); } });
  const rp = ops.put(spy);
  ok(!text(rp).includes(TOKEN) && !calls.includes('get'), 'a Proxy: its get trap is never called');
  const liar = new Proxy({ name: 'T', members: [mem('A')] }, { ownKeys() { throw new Error(TOKEN); } });
  const rl = ops.put(liar);
  ok(refused(rl) && !text(rl).includes(TOKEN), 'a Proxy that throws on its keys: refused, no value in the answer');
  const liar2 = new Proxy({ name: 'T', members: [mem('A')] }, { getOwnPropertyDescriptor(t, k) { const d = Reflect.getOwnPropertyDescriptor(t, k); return d && k === 'name' ? { configurable: true, enumerable: true, get() { throw new Error(TOKEN); } } : d; } });
  const r2 = ops.put(liar2);
  ok(refused(r2) && !text(r2).includes(TOKEN), 'a Proxy that shows a getter: refused');
  const cyc: Record<string, unknown> = { name: 'T', members: [mem('A')] }; cyc.self = cyc;
  ok(refused(ops.put(cyc)), 'a cycle is refused, not followed for ever');
  const fn = { name: 'T', members: [mem('A', { brief: () => 1 })] };
  ok(refused(ops.put(fn)), 'a function value is refused');
  eq(store.list().length, 2, 'only the transparent Proxy was stored (it holds plain data); every refusal wrote nothing');
});

section('noValueInErrors', () => {
  const { ops, store } = setup();
  const s = seedImported({ store });
  const out: unknown[] = [
    ops.put({ name: TOKEN, members: [mem('A')] }), ops.put({ name: 'T', members: [mem('A', { role: TOKEN })] }), ops.put({ name: 'T', members: [mem(TOKEN)] }),
    ops.put({ name: 'T', members: [mem('A', { app: TOKEN })] }), ops.put({ name: 'T', members: [mem('A', { permMode: TOKEN })] }), ops.put({ name: 'T', members: [mem('A', { model: TOKEN + ' x' })] }),
    ops.put({ name: 'T', members: [mem('A', { memberId: TOKEN })] }), ops.put({ name: 'T', members: [mem('A', { briefFrom: TOKEN })] }), ops.put({ name: 'T', members: [mem('A', { shellCmd: TOKEN })] }),
    ops.put({ name: 'T', members: [mem('A', { brief: TOKEN + '​' })] }), ops.put({ name: 'T', description: TOKEN.repeat(10), members: [mem('A')] }),
    ops.put({ id: s.id, name: 'T', members: [mem('A', { memberId: TOKEN })] }), ops.put({ id: s.id, name: 'T', members: [mem('A', { memberId: A, briefFrom: TOKEN })] }),
    ops.put({ id: s.id, name: 'T', members: [mem('A', { memberId: 'e'.repeat(32), brief: TOKEN })] }), ops.put({ id: TOKEN, name: 'T', members: [mem('A')] }), ops.put({ id: TOKEN + TOKEN, name: 'T', members: [mem('A')] }),
    ops.delete(TOKEN), ops.delete(TOKEN + TOKEN), ops.duplicate(TOKEN), ops.markMine(TOKEN, TOKEN), ops.markMine(s.id, TOKEN), ops.markMine(s.id, TOKEN, TOKEN), ops.markMine(s.id, 'e'.repeat(32)),
    ops.put({ name: 'T', members: [mem('A', { brief: 'x' }), { ...mem('B'), [TOKEN]: 1 }] }),
    ops.put({ id: s.id, name: 'T', members: [mem('A', { memberId: HEXVAL })] }), ops.markMine(s.id, HEXVAL), ops.put({ name: 'T', members: [mem('A', { memberId: HEXVAL })] }), ops.delete(HEXVAL), ops.duplicate(HEXVAL),
    ops.put({ id: s.id, name: 'T', members: [mem('A', { memberId: A }), mem('A2', { memberId: A, brief: HEXVAL })] }),
  ];
  for (const r of out) { ok(!text(r).includes(HEXVAL), `no unique hex value in a result: ${text(r).slice(0, 100)}`); ok(!text(r).includes(TOKEN), `an error never carries the value: ${text(r).slice(0, 100)}`); }
  ok(out.filter((r) => (r as { ok: boolean }).ok === false).length >= 20, 'most were refused (an unknown key is only ignored)');
});

section('createRefusesMemberId', () => {
  const { ops, store } = setup();
  ok(refused(ops.put({ name: 'T', members: [mem('A', { memberId: A })] })), 'a memberId from the window refuses a creation');
  ok(refused(ops.put({ name: 'T', members: [mem('A', { memberId: undefined })] })), 'even an undefined one (the key is there)');
  ok(refused(ops.put({ name: 'T', members: [mem('A', { briefFrom: 'file' })] })), 'the window cannot set the mark on a creation');
  eq(store.list().length, 0, 'nothing stored');
  const r = ops.put({ name: 'T', members: [mem('A'), mem('B')] });
  ok(r.ok, 'a plain creation works');
  const ids = members(r).map((m) => m.memberId as string);
  ok(ids.every((i) => HEX.test(i)) && new Set(ids).size === 2, 'main gives each member its own 128-bit hex id');
  ok(!members(r).some((m) => 'briefFrom' in m), 'no mark');
});

section('windowCannotImport', () => {
  const { ops, store } = setup();
  const r = ops.put({ name: 'T', origin: 'imported', id: undefined, createdAt: 5, updatedAt: 5, members: [mem('A')] });
  ok(r.ok && r.template.origin === 'own', 'a window put creates own whatever origin it sends');
  ok(r.ok && r.template.createdAt > 5, 'main sets the times');
  const u = ops.put({ id: r.ok ? r.template.id : '', origin: 'imported', name: 'T2', members: [{ ...members(r)[0] }] });
  ok(u.ok && u.template.origin === 'own', 'an update cannot turn it into imported');
  const s = seedImported({ store });
  const u2 = ops.put({ id: s.id, origin: 'own', name: 'Crew', members: [mem('A', { memberId: A }), mem('B', { memberId: B }), mem('C', { memberId: C })] });
  ok(u2.ok && u2.template.origin === 'imported', 'an imported template stays imported when edited');
  ok(typeof (ops as unknown as Record<string, unknown>).putImported === 'undefined', 'putImported is not on the ops');
});

section('keepsMarkOnEdit', () => {
  const { ops, store } = setup();
  const s = seedImported({ store }, 'x'.repeat(1999));
  const one = (b: string, extra: Record<string, unknown> = {}): ReturnType<TeamsIpcOps['put']> => ops.put({ id: s.id, name: 'Crew', members: [mem('A', { memberId: A, brief: b, ...extra }), mem('B', { memberId: B, brief: 'plain' }), mem('C', { memberId: C, brief: 'Test it.' })] });
  let r = one('x'.repeat(1999) + 'y');
  ok(r.ok, 'a one-character edit is saved');
  eq(members(r).map((m) => m.briefFrom), ['file', undefined, 'file'], 'the window sent no mark: both marks stay');
  ok(refused(one('x'.repeat(2001))), 'the 2,000 limit stays with the mark');
  ok(refused(one(Array.from({ length: 41 }, () => 'l').join('\n'))), 'so does the 40-line limit');
  ok(one('x'.repeat(2000)).ok, 'exactly 2,000 characters is fine');
  r = one('short', { briefFrom: 'file' });
  eq(members(r).map((m) => m.briefFrom), ['file', undefined, 'file'], 'echoing the mark the window read changes nothing');
  ok(refused(ops.put({ id: s.id, name: 'Crew', members: [mem('A', { memberId: A }), mem('B', { memberId: B, briefFrom: 'file' }), mem('C', { memberId: C })] })), 'the window cannot set a mark on a member without one');
  for (const bad of ['x', null, 1, true, {}]) ok(refused(one('ok', { briefFrom: bad })), 'any other briefFrom is refused');
  ok(refused(ops.put({ id: s.id, name: 'Crew', members: [mem('A', { memberId: A }), mem('B', { memberId: B }), { ...mem('X', { briefFrom: 'file' }) }] })), 'a new member cannot arrive with the mark');
  eq(store.get(s.id)?.members.map((m) => m.briefFrom), ['file', undefined, 'file'], 'the store still has both marks after the refusals');
});

section('duplicateKeepsMark', () => {
  const { ops, store } = setup();
  const s = seedImported({ store });
  const r = ops.duplicate(s.id);
  ok(r.ok, 'duplicate works');
  eq(members(r).map((m) => m.briefFrom), ['file', undefined, 'file'], 'the copy keeps the marks');
  const ids = members(r).map((m) => m.memberId as string);
  ok(ids.every((i) => HEX.test(i)) && new Set(ids).size === 3 && !ids.some((i) => s.ids.includes(i)), 'every member of the copy has a new memberId');
  ok(r.ok && r.template.origin === 'own' && r.template.id !== s.id && r.template.name === 'Crew copy', 'own, new id, "<name> copy"');
  eq(store.get(s.id)?.members.map((m) => m.memberId), s.ids, 'the source keeps its ids');
  const r2 = ops.duplicate(r.ok ? r.template.id : '');
  ok(r2.ok && !members(r2).some((m) => ids.includes(m.memberId as string)), 'a copy of the copy has new ids again');
  const u = ops.put({ id: r.ok ? r.template.id : '', name: 'Copy', members: members(r).map((m) => ({ ...m })) });
  eq(members(u).map((m) => m.briefFrom), ['file', undefined, 'file'], 'the ids of the copy work for an update');
});

section('reorder', () => {
  const { ops, store } = setup();
  const s = seedImported({ store });
  // A (marked), B (plain), C (marked): reordered to B, C, A
  let r = ops.put({ id: s.id, name: 'Crew', members: [mem('B', { memberId: B }), mem('C', { memberId: C }), mem('A', { memberId: A })] });
  eq(members(r).map((m) => [m.name, m.briefFrom]), [['B', undefined], ['C', 'file'], ['A', 'file']], 'each mark stays with its member, not its place');
  // remove B, add D, then put again
  r = ops.put({ id: s.id, name: 'Crew', members: [mem('D'), mem('C', { memberId: C }), mem('A', { memberId: A })] });
  const m = members(r);
  eq(m.map((x) => [x.name, x.briefFrom]), [['D', undefined], ['C', 'file'], ['A', 'file']], 'a removed member and a new one: the marks follow the ids');
  ok(HEX.test(m[0].memberId as string) && m[0].memberId !== B, 'the new member has a fresh id');
  r = ops.put({ id: s.id, name: 'Crew', members: [mem('A', { memberId: A }), mem('D', { memberId: m[0].memberId }), mem('C', { memberId: C })] });
  eq(members(r).map((x) => [x.name, x.briefFrom]), [['A', 'file'], ['D', undefined], ['C', 'file']], 'and once more');
  ok(refused(ops.put({ id: s.id, name: 'Crew', members: [mem('B', { memberId: B })] })), 'a removed member\'s id is no longer valid');
});

section('memberIdRules', () => {
  const { ops, store } = setup();
  const s = seedImported({ store });
  const other = ops.put({ name: 'Other', members: [mem('Z')] });
  const zid = members(other)[0].memberId;
  const before = text(store.list());
  for (const [label, ms] of [
    ['unknown', [mem('A', { memberId: 'e'.repeat(32) })]], ['twice', [mem('A', { memberId: A }), mem('A2', { memberId: A })]], ['from another template', [mem('A', { memberId: zid })]],
    ['not hex', [mem('A', { memberId: 'g'.repeat(32) })]], ['short', [mem('A', { memberId: 'a'.repeat(31) })]], ['upper case', [mem('A', { memberId: 'A'.repeat(32) })]], ['number', [mem('A', { memberId: 5 })]],
    ['null', [mem('A', { memberId: null })]], ['object', [mem('A', { memberId: { x: 1 } })]], ['proto-like', [mem('A', { memberId: '__proto__' })]], ['constructor', [mem('A', { memberId: 'constructor' })]],
  ] as [string, unknown[]][]) {
    const r = ops.put({ id: s.id, name: 'Crew', members: ms });
    ok(refused(r), `an ${label} memberId is refused`);
  }
  eq(text(store.list()), before, 'nothing changed');
});

section('markMine', () => {
  const { ops, store } = setup();
  const s = seedImported({ store });
  const w = ops.put({ name: 'Mine', members: [mem('Z')] });
  const wid = w.ok ? w.template.id : '';
  const zid = members(w)[0].memberId as string;
  ok(refused(ops.markMine('missing', A)), 'an unknown template');
  ok(refused(ops.markMine(s.id, 'e'.repeat(32))), 'an unknown member');
  ok(refused(ops.markMine(s.id, B)), 'a member without the mark');
  ok(refused(ops.markMine(wid, zid)), 'a member of a window template, without the mark');
  ok(refused(ops.markMine(s.id, zid)), 'a member of another template');
  for (const x of [{ name: 'X' }, { briefFrom: 'file' }, undefined, null, 1, 'x', [A], { memberId: B }]) ok(refused(ops.markMine(s.id, A, x)), `an extra argument is refused (${text(x)})`);
  ok(refused(ops.markMine(s.id, A, undefined, undefined)), 'two extra arguments');
  for (const bad of [[undefined, A], [s.id, undefined], [1, A], [s.id, 1], [{ id: s.id }, A], [s.id, { memberId: A }], [s.id, [A]], ['', A], [s.id, ''], [s.id, 'constructor'], [s.id, '__proto__']] as unknown[][]) {
    ok(refused(ops.markMine(...(bad as [unknown, unknown]))), `wrong types are refused (${text(bad)})`);
  }
  eq(store.get(s.id)?.members.map((m) => m.briefFrom), ['file', undefined, 'file'], 'nothing was removed by the refusals');
  const before = store.get(s.id)!;
  const r = ops.markMine(s.id, A);
  ok(r.ok, 'the real call works');
  eq(members(r).map((m) => m.briefFrom), [undefined, undefined, 'file'], 'only that member lost the mark');
  const after = store.get(s.id)!;
  eq({ ...after, updatedAt: 0, members: after.members.map((m) => ({ ...m, briefFrom: undefined })) }, { ...before, updatedAt: 0, members: before.members.map((m) => ({ ...m, briefFrom: undefined })) }, 'nothing else changed');
  ok(refused(ops.markMine(s.id, A)), 'a second call: the member has no mark any more');
  const big = ops.put({ id: s.id, name: 'Crew', members: [mem('A', { memberId: A, brief: 'x'.repeat(4000) }), mem('B', { memberId: B }), mem('C', { memberId: C })] });
  ok(big.ok, 'a marked-as-mine brief may grow to 4,000');
  ok(refused(ops.put({ id: s.id, name: 'Crew', members: [mem('A', { memberId: A }), mem('B', { memberId: B }), mem('C', { memberId: C, brief: 'x'.repeat(2001) })] })), 'the other one is still limited');
});

section('listDeleteAndLimits', () => {
  const { ops, store } = setup();
  eq(ops.list(), { ok: true, templates: [], blocked: false, setAside: false }, 'an empty list');
  const a = ops.put({ name: 'One', members: [mem('A')] });
  ok(a.ok, 'created');
  const id = a.ok ? a.template.id : '';
  ok(ops.list().templates.length === 1, 'listed');
  eq(ops.delete(id), { ok: true, removed: true }, 'deleted');
  eq(ops.list().templates.length, 0, 'gone');
  for (let i = 0; i < 50; i++) ok(ops.put({ name: 'T' + i, members: [mem('A')] }).ok, 'fill');
  ok(refused(ops.put({ name: 'One more', members: [mem('A')] })), 'the 50-template cap');
  const t0 = Date.now();
  const huge = ops.put({ name: 'x'.repeat(200000), description: 'y'.repeat(200000), members: [mem('A', { brief: 'z'.repeat(1000000) })] });
  ok(refused(huge) && Date.now() - t0 < 2000, 'a huge value is refused quickly');
  ok(refused(ops.put({ name: 'T', members: [mem('A', { brief: 'a\n'.repeat(500000) })] })), 'a million-line brief is refused');
  ok(store.list().length === 50, 'nothing extra stored');
});

section('listSetAside', () => {
  const g = setup();
  eq(g.ops.list(), { ok: true, templates: [], blocked: false, setAside: false }, 'no file: no toast');
  const b = setup({}, 'this is not a template file ' + TOKEN);
  const l1 = b.ops.list();
  ok(l1.setAside === true && l1.templates.length === 0 && !text(l1).includes(TOKEN), 'a bad file set aside: true once, nothing of it in the answer');
  eq(b.ops.list().setAside, false, 'and false after that');
  eq(b.ops.list().setAside, false, 'still false');
});

section('limitsAndShapes', () => {
  const { ops, store } = setup();
  const errOf = (r: { ok: boolean }): string => ((r as unknown as { errors?: string[] }).errors ?? ['(ok)'])[0];
  const s = seedImported({ store });
  // the members count is judged BEFORE the copy: nine members that are accessors would be "not plain data" if the copy came first
  const acc = (): Record<string, unknown> => { const o: Record<string, unknown> = {}; Object.defineProperty(o, 'name', { enumerable: true, get() { return 'x'; } }); return o; };
  eq(errOf(ops.put({ name: 'T', members: Array.from({ length: 9 }, acc) })), 'Members: at most 8.', 'nine members: refused by count, before any copy');
  eq(errOf(ops.put({ name: 'T', members: new Array(10000).fill(0) })), 'Members: at most 8.', '10,000 members: refused by count');
  eq(errOf(ops.put({ name: 'T', members: Array.from({ length: 8 }, acc) })), 'Template: send plain data.', 'eight is under the cap (the copy then refuses the accessors)');
  // ids: the format and the length are judged first, with their own words
  eq(errOf(ops.put({ id: s.id, name: 'T', members: [mem('A', { memberId: 'g'.repeat(32) })] })), 'Member 1, memberId: not valid.', 'a memberId that is not 32 hex: the format is checked');
  eq(errOf(ops.put({ id: s.id, name: 'T', members: [mem('A', { memberId: 'A'.repeat(32) })] })), 'Member 1, memberId: not valid.', 'upper case is not the format');
  eq(errOf(ops.put({ id: s.id, name: 'T', members: [mem('A', { memberId: 'e'.repeat(32) })] })), 'Member 1, memberId: not a member of this template.', 'a well-formed unknown one is said so');
  eq(errOf(ops.markMine(s.id, 'g'.repeat(32))), 'Member id: not valid.', 'markMine: the format is checked');
  eq(errOf(ops.markMine(s.id, 'e'.repeat(32))), 'Member: not found.', 'markMine: a well-formed unknown member');
  const id64 = 'x'.repeat(64), id65 = 'x'.repeat(65);
  eq(errOf(ops.put({ id: id65, name: 'T', members: [mem('A')] })), 'Template id: not valid.', 'put: a 65-character id is refused by length');
  eq(errOf(ops.put({ id: id64, name: 'T', members: [mem('A')] })), 'Template: not found.', 'put: 64 characters is within the length');
  eq(errOf(ops.duplicate(id65)), 'Template id: not valid.', 'duplicate: 65');
  eq(errOf(ops.duplicate(id64)), 'Template: not found.', 'duplicate: 64');
  eq(errOf(ops.delete(id65)), 'Template id: not valid.', 'delete: 65');
  eq(ops.delete(id64), { ok: true, removed: false }, 'delete: 64');
  eq(errOf(ops.markMine(id65, A)), 'Template id: not valid.', 'markMine: 65');
  eq(errOf(ops.markMine(id64, A)), 'Template: not found.', 'markMine: 64');
  eq(errOf(ops.markMine('', A)), 'Template id: not valid.', 'markMine: empty id');
  // the copy: 10,000 items in an array, nesting of 8 levels
  const base = (extra: Record<string, unknown>): Record<string, unknown> => ({ name: 'Deep', members: [mem('A')], ...extra });
  eq(errOf(ops.put(base({ junk: new Array(10000).fill(0) }))), 'Template: too large.', 'an array of 10,000 is over the total budget (the per-array cap is judged after it)');
  eq(errOf(ops.put(base({ junk: new Array(10001).fill(0) }))), 'Template: send plain data.', 'one more than 10,000 is refused by the per-array cap');
  const nest = (k: number): Record<string, unknown> => { let o: Record<string, unknown> = {}; for (let i = 1; i < k; i++) o = { o }; return o; };
  ok(ops.put(base({ junk: nest(8) })).ok, 'eight levels of nesting are copied');
  eq(errOf(ops.put(base({ junk: nest(9) }))), 'Template: send plain data.', 'nine are refused');
  ok(ops.put(Object.assign(Object.create(null) as Record<string, unknown>, base({ name: 'NullProto' }))).ok, 'an object with no prototype is plain data');
  eq(errOf(ops.put(Object.create({ name: 'x', members: [] }))), 'Template: send plain data.', 'an inherited shape is not plain');
  eq(errOf(ops.put('x')), 'Template: send an object.', 'a string is not an object');
  eq(errOf(ops.put([])), 'Template: send an object.', 'an array is not an object');
});

section('bounds', () => {
  const { ops, store } = setup();
  const errOf = (r: { ok: boolean }): string => ((r as unknown as { errors?: string[] }).errors ?? ['(ok)'])[0];
  const full = (i: number): Record<string, unknown> => mem('M' + i, { role: 'Dev ' + i, brief: 'x'.repeat(4000), profile: 'agent-' + i, model: 'model-x', effort: 'high', cap: { unit: 'usd', amount: 5 }, character: 'bob-glasses', sendBrief: true });
  // a real template is far below every bound
  const real = ops.put({ name: 'Real', description: 'd', members: Array.from({ length: 8 }, (_, i) => full(i)) });
  ok(real.ok, 'eight full members (about 100 values) pass every bound: ' + errOf(real));
  const wide = Object.fromEntries(Array.from({ length: 35 }, (_, i) => ['k' + i, i]));
  const m35 = ops.put({ name: 'Wide', members: Array.from({ length: 8 }, (_, i) => ({ ...mem('W' + i), ...wide })) });
  ok(!['Template: too many fields.', 'Member: too many fields.', 'Template: too large.'].includes(errOf(m35)), 'eight members of 35+ keys pass the bounds (the validator then refuses the unknown keys): ' + errOf(m35));
  // template keys: 32 pass, 33 refused, no key named
  const keys = (n: number): Record<string, unknown> => ({ name: 'K', members: [mem('A')], ...Object.fromEntries(Array.from({ length: n - 2 }, (_, i) => ['extra' + i, 1])) });
  ok(ops.put(keys(32)).ok, 'a template with 32 own keys passes');
  eq(errOf(ops.put(keys(33))), 'Template: too many fields.', 'a template with 33 keys is refused');
  ok(!text(ops.put(keys(33))).includes('extra'), 'and no key is named');
  // member keys: 64 pass the bound, 65 refused
  const mk = (n: number): Record<string, unknown> => ({ ...mem('A'), ...Object.fromEntries(Array.from({ length: n - 5 }, (_, i) => ['f' + i, 1])) });
  ok(errOf(ops.put({ name: 'M', members: [mk(64)] })) !== 'Member: too many fields.', 'a member with 64 keys is past the bound (the validator refuses its unknown keys)');
  eq(errOf(ops.put({ name: 'M', members: [mk(65)] })), 'Member: too many fields.', 'a member with 65 keys is refused');
  ok(!text(ops.put({ name: 'M', members: [mk(65)] })).includes('f1'), 'no key named');
  // nested objects are bounded too
  eq(errOf(ops.put({ name: 'N', members: [mem('A')], junk: Object.fromEntries(Array.from({ length: 65 }, (_, i) => ['n' + i, 1])) })), 'Template: too large.', 'a nested object of 65 keys is refused by the copy');
  // the total budget: base = top 1 + name 1 + members 1 + member 1 + 5 fields = 9 values, the junk key's array 1, then its items
  const withJunk = (n: number): Record<string, unknown> => ({ name: 'T', members: [mem('A')], junk: new Array(n).fill(0) });
  ok(ops.put(withJunk(4990)).ok, 'exactly 5,000 values pass');
  eq(errOf(ops.put(withJunk(4991))), 'Template: too large.', 'one more is refused');
  // null and undefined take a unit too (an array of them must not escape the budget)
  for (const [label, fillv] of [['null', null], ['undefined', undefined]] as [string, unknown][]) {
    ok(ops.put({ name: 'T', members: [mem('A')], junk: new Array(4990).fill(fillv) }).ok, `4,990 ${label} items are exactly 5,000 values`);
    eq(errOf(ops.put({ name: 'T', members: [mem('A')], junk: new Array(4991).fill(fillv) })), 'Template: too large.', `one more ${label} is refused`);
  }
  // small arrays each pass the per-array refusal, so only the total can stop them: 100 arrays of 60 are 6,100 values
  for (const [label, fillv] of [['null', null], ['undefined', undefined]] as [string, unknown][]) {
    eq(errOf(ops.put({ name: 'T', members: [mem('A')], junk: Array.from({ length: 100 }, () => new Array(60).fill(fillv)) })), 'Template: too large.', `100 arrays of 60 ${label}: over the total`);
    eq(errOf(ops.put({ name: 'T', members: [mem('A')], junk: Array.from({ length: 90 }, () => Object.fromEntries(Array.from({ length: 60 }, (_, i) => ['k' + i, fillv]))) })), 'Template: too large.', `90 objects of 60 ${label} fields: over the total`);
  }
  const nulls = new Array(4000).fill(null);
  const t1 = Date.now();
  eq(errOf(ops.put({ name: 'T', members: [mem('A')], extra: Array.from({ length: 4000 }, () => nulls) })), 'Template: too large.', '4,000 arrays of 4,000 nulls: refused by the total');
  ok(Date.now() - t1 < 1500, 'and quickly');
  // a sparse array is judged by its length first (the budget), not by its first hole
  eq(errOf(ops.put({ name: 'T', members: [mem('A')], junk: new Array(6000) })), 'Template: too large.', 'a sparse array of 6,000 is "too large"');
  // the budget is ONE for the whole copy, not one per array
  eq(errOf(ops.put({ name: 'T', members: [mem('A')], junk: Array.from({ length: 17 }, () => new Array(300).fill(0)) })), 'Template: too large.', '17 arrays of 300 (each far under the per-array cap) are over the total');
  // the cost: both cases of the second read, with invented data, refused in milliseconds
  const many: Record<string, unknown> = { name: 'T', members: [mem('A')] };
  for (let i = 0; i < 800000; i++) many['x' + i] = 1;
  let t0 = Date.now();
  const r1 = ops.put(many);
  const ms1 = Date.now() - t0;
  eq(errOf(r1), 'Template: too many fields.', '800,000 own keys: refused by the key bound');
  const arrays = Array.from({ length: 9999 }, () => new Array(300).fill(0));
  t0 = Date.now();
  const r2 = ops.put({ name: 'T', members: [mem('A')], extra: arrays });
  const ms2 = Date.now() - t0;
  eq(errOf(r2), 'Template: too large.', '9,999 arrays of 300: refused by the budget');
  console.log(`bounds: 800,000 keys refused in ${ms1} ms; 9,999 arrays of 300 refused in ${ms2} ms`);
  ok(ms1 < 8000 && ms2 < 1500, "both are refused, the second in milliseconds (the first is the engine listing 800,000 keys once: about a second here, below the IPC clone of the same object; generous limit)");
});

section('inheritedKeys', () => {
  // a polluted Object.prototype (more than 32 enumerable inherited keys) must not make an honest put fail: only own keys count. Synchronous, cleaned in `finally`.
  const { ops } = setup();
  const names = Array.from({ length: 70 }, (_, i) => 'polluted' + i);
  try {
    for (const k of names) Object.defineProperty(Object.prototype, k, { value: 1, enumerable: true, configurable: true, writable: true });
    const r = ops.put({ name: 'Honest', members: [mem('A')] });
    ok(r.ok, 'an honest put is accepted with 70 inherited enumerable keys on Object.prototype: ' + text(r).slice(0, 80));
  } finally { for (const k of names) delete (Object.prototype as unknown as Record<string, unknown>)[k]; }
  ok(!('polluted0' in {}), 'Object.prototype is clean again');
});

section('handlersNeverThrow', () => {
  // the real handlers of src/main/ipc/teams.ts, registered on a fake Electron: any throw answers one fixed `failed`
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Mod = require('module') as { _load: (r: string, ...a: unknown[]) => unknown };
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const orig = Mod._load;
  Mod._load = function (r: string, ...a: unknown[]): unknown { return r === 'electron' ? { ipcMain: { handle: (c: string, f: (e: unknown, ...x: unknown[]) => unknown) => void handlers.set(c, f), on: () => undefined } } : orig.call(this, r, ...a); };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const g = require('../src/main/ipcguard') as typeof import('../src/main/ipcguard');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const t = require('../src/main/ipc/teams') as typeof import('../src/main/ipc/teams');
    g.initSimGuard(false);
    const boom = (): never => { throw new Error('secret ' + TOKEN); };
    const throwing = { list: boom, put: boom, delete: boom, duplicate: boom, markMine: boom } as unknown as TeamsIpcOps;
    t.register({ getOps: () => throwing });
    eq([...handlers.keys()].sort(), ['teams:delete', 'teams:duplicate', 'teams:list', 'teams:markMine', 'teams:put'], 'the five channels');
    const frame = { url: require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href };
    const sender = { mainFrame: frame };
    const good = { senderFrame: frame, sender };
    for (const [c, args] of [['teams:list', []], ['teams:put', [{}]], ['teams:delete', ['x']], ['teams:duplicate', ['x']], ['teams:markMine', ['x', 'y']]] as [string, unknown[]][]) {
      let r: unknown; let threw = false;
      try { r = handlers.get(c)!(good, ...args); } catch { threw = true; }
      ok(!threw, `${c}: a throw is answered, not rethrown`);
      eq(Object.keys(r as object).sort(), ['blocked', 'code', 'errors', 'ok'], `${c}: the answer has the fixed shape`);
      ok((r as { ok: boolean; code: string }).ok === false && (r as { code: string }).code === 'failed' && !text(r).includes(TOKEN) && !/secret|Error|stack/.test(text(r)), `${c}: failed, with no message, value or stack`);
    }
    // a foreign frame never reaches the ops (ipcHandle refuses it before the handler)
    let reached = false;
    handlers.clear();
    t.register({ getOps: () => { reached = true; return undefined; } });
    const other = { url: 'https://example.invalid/' };
    let refusedFrame = false;
    try { handlers.get('teams:list')!({ senderFrame: other, sender: { mainFrame: other } }); } catch { refusedFrame = true; }
    ok(refusedFrame && !reached, 'a call from another page is refused and never reaches the ops');
  } finally { Mod._load = orig; }
});

section('changedFailedBlocked', () => {
  const s = setup();
  const a = s.ops.put({ name: 'One', members: [mem('A')] });
  ok(a.ok, 'created');
  fs.writeFileSync(s.file, JSON.stringify({ format: 'agent-durbar-team-templates', schemaVersion: 1, templates: [] }) + '\n'); // another instance saved
  const typed = mem('Typed');
  const c = s.ops.put({ name: 'Two', members: [typed] });
  ok(refused(c, 'changed') && c.ok === false && c.errors.length === 1 && c.errors[0].length > 20 && Array.isArray(c.templates), 'a moved file is answered `changed`, with the reloaded list and a readable error');
  ok(s.ops.put({ name: 'Two', members: [typed] }).ok, 'the save offered again works after the reload');
  const f = setup({ writeFileSync: () => { throw new Error('disk ' + TOKEN); } });
  const r = f.ops.put({ name: 'One', members: [mem('A')] });
  ok(refused(r, 'failed') && !text(r).includes(TOKEN) && (r as { errors: string[] }).errors[0].length > 10, 'a failed write is `failed`, with a readable error and no detail');
  eq(f.ops.list().templates.length, 0, 'nothing is shown as saved');
  eq(f.ops.delete('x'), { ok: true, removed: false }, 'delete of an unknown id writes nothing');
  const b = setup({ renameSync: () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); } }, 'not json at all ' + TOKEN);
  ok(b.ops.list().blocked === true, 'a bad file that cannot be moved shows the notice');
  const br = b.ops.put({ name: 'One', members: [mem('A')] });
  ok(refused(br, 'failed') && (br as { blocked: boolean }).blocked === true && !text(br).includes(TOKEN), 'a save while blocked fails, says blocked, and names nothing of the file');
});

fs.rmSync(root, { recursive: true, force: true });
if (failed > 0) { console.error(`test-teamsipc: ${failed} section(s) failed`); process.exit(1); }
console.log(`test-teamsipc: ${n} checks passed`);
