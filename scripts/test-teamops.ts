/**
 * Unit tests, spec 111 T007 (FR-010, FR-023, FR-100, FR-133): `TeamsOps`, the handlers of `teams:list`, `teams:put`, `teams:delete`,
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
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TeamsOps } from '../src/main/teamsops';
import { TeamTemplateStore, type TeamFs } from '../src/main/teamstore';

let n = 0;
const ok = (c: unknown, m: string): void => { n++; assert.ok(c, m); };
const eq = <T>(a: T, b: T, m: string): void => { n++; assert.deepStrictEqual(a, b, m); };
/** every section runs; a failed one is named on stderr (the mutant runner reads the names) and the run ends with a failure */
let failed = 0;
const section = (name: string, fn: () => void): void => { try { fn(); } catch (e) { failed++; console.error(`SECTION ${name} FAILED`); console.error(e instanceof Error ? e.message.slice(0, 200) : 'failed'); } };

const HEX = /^[0-9a-f]{32}$/;
/** a 32-hex value nobody else uses, built at run time: it must never come back in a result */
const HEXVAL = ('9a' + '4c').repeat(8);
const TOKEN = 'ghp' + '_' + 'A1b2C3d4'.repeat(5); // 40 chars, built at run time
const real: TeamFs = {
  openSync: (f, fl) => fs.openSync(f, fl), fstatSync: (fd) => fs.fstatSync(fd), readSync: (fd, b, o, l, p) => fs.readSync(fd, b, o, l, p), closeSync: (fd) => fs.closeSync(fd),
  mkdirSync: (d, o) => fs.mkdirSync(d, o), lstatSync: (p) => fs.lstatSync(p), writeFileSync: (f, d, o) => fs.writeFileSync(f, d, o),
  renameSync: (a, b) => fs.renameSync(a, b), rmSync: (p, o) => fs.rmSync(p, o), readdirSync: (d) => fs.readdirSync(d),
  fsyncFile: (f) => { const fd = fs.openSync(f, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } },
};
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-teamops-'));
let dirN = 0;
function setup(over: Partial<TeamFs> = {}, pre?: string): { ops: TeamsOps; store: TeamTemplateStore; file: string } {
  const dir = path.join(root, `d${++dirN}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'team-templates.json');
  if (pre !== undefined) fs.writeFileSync(file, pre);
  let k = 0;
  const mint = (): string => (0x1000 + ++k + dirN * 100000).toString(16).padStart(32, 'c'); // 32 hex digits, never 'a' or 'b' repeated
  const store = new TeamTemplateStore(file, { fs: { ...real, ...over } as TeamFs, newMemberId: mint, pause: () => undefined });
  return { ops: new TeamsOps({ store: () => store, newMemberId: mint }), store, file };
}
const mem = (name: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ name, role: 'Dev', app: 'claude', permMode: 'read-only', sendBrief: false, ...extra });
const A = 'a'.repeat(32), B = 'b'.repeat(32), C = 'd'.repeat(32);
/** An imported template with marked briefs, seeded through the store's own import path (main only). */
function seedImported(s: { store: TeamTemplateStore }, brief = 'Check it.'): { id: string; ids: string[] } {
  const r = s.store.putImported({ name: 'Crew', members: [mem('A', { memberId: A, brief, briefFrom: 'file' }), mem('B', { memberId: B, brief: 'plain' }), mem('C', { memberId: C, brief: 'Test it.', briefFrom: 'file' })] });
  assert.ok(r.ok);
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
  // putImported: every member gets one, a given one is kept when unique
  const p = g.store.putImported({ name: 'Imp', members: [mem('A', { briefFrom: 'file' }), mem('B', { memberId: A }), mem('C', { memberId: A })] });
  const pi = p.ok ? p.template.members.map((m) => m.memberId as string) : [];
  ok(pi.length === 3 && pi.every((i) => HEX.test(i)) && new Set(pi).size === 3 && pi[1] === A, 'putImported gives every member its own id');
  // defence in depth: a store that holds a stored template with an id-less or repeated member (a fake, the real store prevents it)
  const bad = (members: unknown[]): TeamsOps => {
    const t0 = { id: 'x1', name: 'Crew', origin: 'imported', createdAt: 1, updatedAt: 1, members };
    const fake = { get: (id: string) => (id === 'x1' ? JSON.parse(JSON.stringify(t0)) : undefined), isBlocked: () => false, list: () => [], put: () => { throw new Error('must not save'); } };
    return new TeamsOps({ store: () => fake as unknown as TeamTemplateStore });
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
  const one = (b: string, extra: Record<string, unknown> = {}): ReturnType<TeamsOps['put']> => ops.put({ id: s.id, name: 'Crew', members: [mem('A', { memberId: A, brief: b, ...extra }), mem('B', { memberId: B, brief: 'plain' }), mem('C', { memberId: C, brief: 'Test it.' })] });
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
  eq(ops.list(), { ok: true, templates: [], blocked: false }, 'an empty list');
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
if (failed > 0) { console.error(`test-teamops: ${failed} section(s) failed`); process.exit(1); }
console.log(`test-teamops: ${n} checks passed`);
