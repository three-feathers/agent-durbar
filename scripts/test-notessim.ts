/** Spec 083 T014 (FR-060, constitution IV, issue 699): the simulator's notes: in memory, masked, seeded by `simnotes=`. `npm run test:notes`. Runs the real src/renderer/sim.ts with no window and no disk. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import type { AgentInfo, DurbarApi } from '../src/shared/api';
import type { Note, NotesFail, NotesView, NotesWrote } from '../src/shared/notes';
import * as redactModule from '../src/shared/redact';

const GH = 'gh' + 'p_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5';
const ROOT = path.join(__dirname, '..', '..');
const simSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'sim.ts'), 'utf8');
const js = ts.transpileModule(simSrc, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;

function make(search: string, withMask = true): DurbarApi {
  const win: Record<string, unknown> = {
    setTimeout: (f: () => void, ms: number) => setTimeout(f, Math.min(ms, 4)),
    setInterval: () => 1,
    location: { search },
    ...(withMask ? { DurbarRedact: redactModule } : {}),
  };
  new Function('window', js)(win);
  return (win.__durbarSim as { create(o: { n: number; freeze?: boolean }): DurbarApi }).create({ n: 15, freeze: true });
}
const must = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => { assert.ok(r.ok, JSON.stringify(r)); return r as Extract<T, { ok: true }>; };
const view = (r: NotesView): Extract<NotesView, { ok: true }> => must(r);

async function main(): Promise<void> {
  // nothing on disk, nothing sent anywhere: the notes block of sim.ts uses no storage or network
  const block = simSrc.slice(simSrc.indexOf('function simNotesApi'), simSrc.indexOf('/** Spec 005 FR-026: a simulated diff'));
  assert.ok(block.length > 2000);
  assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|require\(|\bfs\b|writeFile|bridge\./.test(block), 'sim notes touch no storage, disk or network');
  assert.ok(!/gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}/.test(block), 'the simulator notes hold no token-shaped literal: they are built at run time');

  // default: empty folder, every call answered in memory
  {
    const sim = make('');
    const agents = await sim.listAgents();
    const a = agents[0];
    const sameFolder = agents.find((x: AgentInfo) => x.id !== a.id && x.cwd === a.cwd);
    const elsewhere = agents.find((x: AgentInfo) => x.cwd !== a.cwd)!;
    const N = sim as Required<Pick<DurbarApi, 'notesList' | 'notesSave' | 'notesAdd' | 'notesUpdate' | 'notesDelete' | 'notesDeleteAll' | 'notesStartOver' | 'notesSetFile' | 'onNotesChanged'>>;
    assert.ok(Object.values(N).every((f) => typeof f === 'function'), 'every notes call exists on the simulator bridge');
    const events: string[] = [];
    const off = N.onNotesChanged((v) => events.push(v.fingerprint));
    assert.strictEqual(view(await N.notesList(a.id)).notes.length, 0);
    const typed = must(await N.notesAdd(a.id, { text: '# Typed idea\n\nbody' })) as Extract<NotesWrote, { ok: true }>;
    assert.ok(typed.note && typed.note.title === 'Typed idea' && typed.note.from === 'typed' && typed.note.rev === 1);
    const saved = must(await N.notesSave(a.id, { role: 'agent', ord: 2, text: `plan with ${GH}`, from: 'agent' })) as Extract<NotesWrote, { ok: true }>;
    assert.ok(saved.note!.hidden && !saved.note!.text.includes(GH.slice(6, 18)) && saved.note!.source!.role === 'agent', 'masked before kept, with the link');
    const again = must(await N.notesSave(a.id, { role: 'agent', ord: 2, text: `plan with ${GH}`, from: 'agent' })) as Extract<NotesWrote, { ok: true }>;
    assert.ok(again.existing && again.note!.id === saved.note!.id, 'the same message twice: one note');
    assert.strictEqual(view(await N.notesList(a.id)).notes.length, 2);
    if (sameFolder) assert.strictEqual(view(await N.notesList(sameFolder.id)).notes.length, 2, 'two chats of one folder share its notes');
    assert.strictEqual(view(await N.notesList(elsewhere.id)).notes.length, 0, 'another folder has its own');
    const up = must(await N.notesUpdate(a.id, typed.note!.id, 1, { done: true, title: 'Renamed' })) as Extract<NotesWrote, { ok: true }>;
    assert.deepStrictEqual([up.note!.rev, up.note!.done, up.note!.title], [2, true, 'Renamed']);
    const stale = await N.notesUpdate(a.id, typed.note!.id, 1, { title: 'late' }) as NotesFail;
    assert.ok(!stale.ok && stale.code === 'stale' && stale.current!.title === 'Renamed');
    assert.ok(!(await N.notesDelete(a.id, typed.note!.id, 1)).ok, 'a stale delete is refused');
    must(await N.notesDelete(a.id, typed.note!.id, 2));
    assert.ok(!(await N.notesAdd(a.id, { text: '   ' })).ok);
    assert.ok(!(await N.notesList('nope')).ok);
    must(await N.notesStartOver(a.id));
    // controls are removed before the mask: a token split by one is still masked, and a typed title with one is refused
    for (const sep of ['\u0001', '\u001b', '\u0085', '\u007f', '\u000b']) {
      const w = must(await N.notesAdd(a.id, { text: `x ${GH.slice(0, 12)}${sep}${GH.slice(12)} y` })) as Extract<NotesWrote, { ok: true }>;
      assert.ok(!/ghp_|a1B2c3/.test(w.note!.text + w.note!.title), `sim: split by U+${sep.charCodeAt(0).toString(16)} masked`);
      const u = must(await N.notesUpdate(a.id, w.note!.id, 1, { text: `${GH.slice(0, 12)}${sep}${GH.slice(12)}` })) as Extract<NotesWrote, { ok: true }>;
      assert.ok(!/ghp_|a1B2c3/.test(u.note!.text), 'sim update: masked');
      assert.ok(!(await N.notesUpdate(a.id, w.note!.id, 2, { title: 'a' + sep + 'b' })).ok, 'sim: a title with a control is refused');
    }
    assert.deepStrictEqual(await N.notesSetFile(a.id, true), { ok: true, demo: true, message: 'Demo: no file written' });
    assert.ok(events.length >= 4, 'changes are announced');
    off();
    const before = events.length;
    must(await N.notesAdd(a.id, { text: 'after unsubscribe' }));
    assert.strictEqual(events.length, before, 'unsubscribed');
    // the cap: the 301st is refused
    must(await N.notesDeleteAll(a.id));
    for (let i = 0; i < 300; i++) must(await N.notesAdd(a.id, { text: 'n' + i }));
    const over = await N.notesAdd(a.id, { text: 'one more' }) as NotesFail;
    assert.ok(!over.ok && over.code === 'cap' && /300 notes/.test(over.error));
  }

  // the seeds
  {
    const some = make('?simnotes=some');
    const a = (await some.listAgents())[0];
    const l = view(await some.notesList!(a.id)).notes;
    assert.strictEqual(l.length, 3);
    assert.strictEqual(l.filter((n: Note) => n.done).length, 1, 'one done');
    assert.strictEqual(new Set(l.map((n: Note) => n.source?.session).filter(Boolean)).size, 2, 'notes from two sessions');
    assert.ok(l.some((n: Note) => n.source?.session === a.id), 'one from this session');
    const many = make('?simnotes=many');
    const am = (await many.listAgents())[0];
    assert.strictEqual(view(await many.notesList!(am.id)).notes.length, 300);
    assert.ok(!(await many.notesAdd!(am.id, { text: 'x' })).ok, 'a full folder refuses the next');
    const long = make('?simnotes=long');
    const al = (await long.listAgents())[0];
    const ln = view(await long.notesList!(al.id)).notes[0];
    assert.ok(ln.title.length === 80 && ln.text.length > 15_000 && ln.text.length <= 16_000, `a long note: title ${ln.title.length}, text ${ln.text.length}`);
    const secret = make('?simnotes=secret');
    const as = (await secret.listAgents())[0];
    const sn = view(await secret.notesList!(as.id)).notes;
    assert.ok(sn.length >= 1 && sn[0].hidden && sn[0].text.includes('[redacted]') && !JSON.stringify(sn).includes(GH.slice(6, 18)), 'the secret seed is masked, with its tokens built at run time');
  }

  // masking is a must: without it the simulator refuses to keep a note (fails closed)
  {
    const sim = make('', false);
    const a = (await sim.listAgents())[0];
    const r = await sim.notesAdd!(a.id, { text: `token ${GH}` }) as NotesFail;
    assert.ok(!r.ok && /Masking is not available/.test(r.error));
    assert.strictEqual(view(await sim.notesList!(a.id)).notes.length, 0);
  }
  console.log('notes simulator: in memory, masked, seeded (some, many, long, secret), 300 cap, stale refused, change events');
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
