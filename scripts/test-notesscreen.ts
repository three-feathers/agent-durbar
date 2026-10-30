/**
 * Spec 083 T034a (FR-044, FR-045, issue 699): the pure helpers of the per-folder Notes screen (src/renderer/notesscreen.js,
 * window.DurbarNotesScreen), with the drawer's own search (notes.js), DurbarNav.rank and the page's masking. `npm run test:notes-core`.
 * No credits, no disk.
 */
import * as assert from 'assert';
import * as path from 'path';
import { redact } from '../src/shared/redact';
import type { Note } from '../src/shared/notes';

const R = path.join(__dirname, '..', '..', 'src', 'renderer');
type G = { open: Note[]; done: Note[] };
const NSX = require(path.join(R, 'notesscreen.js')) as {
  groups(n: unknown): G; filter(g: G, q: unknown, s: unknown, r: unknown, m: unknown): G; menuLabel(n: unknown): string; doneLabel(n: unknown): string; EMPTY: string;
  pickAgent(list: unknown, room: string, sel: string, panelOpen: boolean, ok?: (a: { id: string }) => boolean): { id: string; over: boolean } | null;
  neighbours(ids: unknown, id: string): { next: string; prev: string };
};
const DN = require(path.join(R, 'notes.js')) as { search: unknown; countOf(n: unknown, s?: string): { total: number }; slashEntries(n: unknown, s?: string): unknown[] };
const { rank } = require(path.join(R, 'navigator.js')) as { rank: unknown };
const ST = require(path.join(R, 'safetext.js')) as { create(o: unknown): { mask(t: unknown): string } };
const { cutText } = require(path.join(R, 'cuttext.js')) as { cutText: (t: unknown, n: number) => string };
const SAFE = ST.create({ redact: (t: string) => redact(t, {}), cut: cutText });
const mask = (t: string): string => SAFE.mask(t);

const T0 = Date.parse('2026-10-24T10:00:00.000Z');
const mk = (id: string, o: Partial<Note> = {}, s = 0): Note => ({
  id: 'n-' + id.padStart(12, '0'), title: 'Note ' + id, text: 'text ' + id, createdAt: new Date(T0 + s * 1000).toISOString(), updatedAt: new Date(T0 + s * 1000).toISOString(),
  rev: 1, done: false, from: 'typed', fileEdited: false, hidden: false, ...o,
} as Note);
const titles = (l: Note[]): string[] => l.map((n) => n.title);

// ---- FR-044/FR-045: the two groups, newest first; no session split ----
{
  const ns = [mk('1', { title: 'Old' }, 1), mk('2', { title: 'New', source: { app: 'copilot', session: 'S1', role: 'agent', ord: 0, digest: 'a'.repeat(16), at: '' } } as Partial<Note>, 5),
    mk('3', { title: 'Done old', done: true }, 2), mk('4', { title: 'Done new', done: true }, 9), mk('5', { title: 'Mid' }, 3)];
  const g = NSX.groups(ns);
  assert.deepStrictEqual(titles(g.open), ['New', 'Mid', 'Old'], 'not done, newest first, whatever the session');
  assert.deepStrictEqual(titles(g.done), ['Done new', 'Done old'], 'done notes in their own group, newest first');
  // equal times: ties by id, stable whatever the input order
  const a = mk('7', {}, 0), b = mk('8', {}, 0);
  assert.deepStrictEqual(NSX.groups([a, b]).open.map((n) => n.id), NSX.groups([b, a]).open.map((n) => n.id));
  // hostile input: never throws, drops what is not a note
  assert.deepStrictEqual(NSX.groups(null), { open: [], done: [] });
  assert.deepStrictEqual(NSX.groups([null, 1, 'x', {}, { id: '' }, { id: 5 }]).open.length, 0);
  // a done note is out of the "/" list and the header count (FR-045), and in the screen's Done group
  assert.strictEqual(DN.countOf(ns, 'S1').total, 3);
  assert.strictEqual(DN.slashEntries(ns, 'S1').length, 3);
  assert.strictEqual(NSX.groups(ns).done.length + NSX.groups(ns).open.length, ns.length, 'the screen shows every note');
  assert.strictEqual(NSX.doneLabel(2), 'Done (2)');
  assert.strictEqual(NSX.doneLabel(undefined), 'Done (0)');
}

// ---- FR-043 on the screen: the drawer's search over both groups, on masked text ----
{
  const token = 'gh' + 'p_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5p6q7R8';
  const ns = [mk('1', { title: 'Migrate users' }, 4), mk('2', { title: 'Lunch', text: 'migrate the CACHE' }, 3), mk('3', { title: 'Old migrate', done: true }, 2),
    mk('4', { title: 'Secret', text: 'key ' + token }, 1), mk('5', { title: 'Café ☕ 日本語', text: 'Ünïcode' }, 0)];
  const g = NSX.groups(ns);
  const r = NSX.filter(g, 'MIGRATE', DN.search, rank, mask);
  assert.deepStrictEqual(titles(r.open), ['Migrate users', 'Lunch'], 'title match first, then text, case-insensitive');
  assert.deepStrictEqual(titles(r.done), ['Old migrate'], 'the Done group is searched too');
  assert.strictEqual(NSX.filter(g, '  ', DN.search, rank, mask), g, 'an empty query keeps everything');
  assert.deepStrictEqual(NSX.filter(g, token.slice(4, 20), DN.search, rank, mask).open, [], 'a secret in the stored text never matches (masked first)');
  assert.deepStrictEqual(titles(NSX.filter(g, 'café', DN.search, rank, mask).open), ['Café ☕ 日本語'], 'Unicode title');
  assert.deepStrictEqual(titles(NSX.filter(g, 'ünïcode', DN.search, rank, mask).open), ['Café ☕ 日本語'], 'Unicode text, case-insensitive');
  // fail closed: no search function, a throwing one, a bad answer
  assert.deepStrictEqual(NSX.filter(g, 'x', null, rank, mask), { open: [], done: [] });
  assert.deepStrictEqual(NSX.filter(g, 'x', () => { throw new Error('no'); }, rank, mask), { open: [], done: [] });
  assert.deepStrictEqual(NSX.filter(g, 'x', () => ({ session: 1 }), rank, mask), { open: [], done: [] });
  assert.deepStrictEqual(NSX.filter(g, 'migrate', DN.search, rank, () => { throw new Error('no mask'); }), { open: [], done: [] }, 'no mask: nothing matches');
}

// ---- the folder menu label (D10) ----
assert.strictEqual(NSX.menuLabel(3), 'Notes (3)…');
assert.strictEqual(NSX.menuLabel(0), 'Notes (0)…');
assert.strictEqual(NSX.menuLabel(null), 'Notes…', 'not fetched yet');
assert.strictEqual(NSX.menuLabel(NaN), 'Notes…');
assert.strictEqual(NSX.menuLabel(-1), 'Notes…');
assert.strictEqual(NSX.menuLabel('3'), 'Notes…', 'a number only');
assert.ok(NSX.EMPTY.startsWith('No notes in this folder yet.'));

// ---- which chat the screen reads through (FR-062: an agent id, never a path) ----
{
  const ags = [{ id: 'h1', room: 'r1', parent: 'm1' }, { id: 'm1', room: 'r1' }, { id: 'm2', room: 'r1' }, { id: 'x1', room: 'r2' }, { id: 'dead', room: 'r3' }];
  const live = (a: { id: string }): boolean => a.id !== 'dead';
  assert.deepStrictEqual(NSX.pickAgent(ags, 'r1', 'm2', true, live), { id: 'm2', over: true }, 'the open chat of this folder: Insert can reach its box');
  assert.deepStrictEqual(NSX.pickAgent(ags, 'r1', 'm2', false, live), { id: 'm1', over: false }, 'panel closed: not over a chat');
  assert.deepStrictEqual(NSX.pickAgent(ags, 'r1', 'x1', true, live), { id: 'm1', over: false }, 'another folder\'s chat is open: the first main chat here');
  assert.deepStrictEqual(NSX.pickAgent(ags, 'r1', 'h1', true, live), { id: 'm1', over: false }, 'a helper is never the chat');
  assert.strictEqual(NSX.pickAgent(ags, 'r3', '', false, live), null, 'no live main chat: no screen');
  assert.strictEqual(NSX.pickAgent(ags, 'nope', '', false, live), null);
  assert.strictEqual(NSX.pickAgent(null, 'r1', '', false, live), null);
  assert.strictEqual(NSX.pickAgent(ags, 'r1', 'm1', true, () => false), null, 'notes off for every chat');
  assert.strictEqual(NSX.pickAgent(ags, 'r1', 'm1', true, (() => 'yes') as unknown as (a: { id: string }) => boolean), null, 'only a true answer counts');
}

// ---- where the focus goes when a row leaves the list (FR-014's rule) ----
assert.deepStrictEqual(NSX.neighbours(['a', 'b', 'c'], 'b'), { next: 'c', prev: 'a' });
assert.deepStrictEqual(NSX.neighbours(['a', 'b', 'c'], 'c'), { next: '', prev: 'b' });
assert.deepStrictEqual(NSX.neighbours(['a'], 'a'), { next: '', prev: '' });
assert.deepStrictEqual(NSX.neighbours(['a'], 'z'), { next: '', prev: '' });
assert.deepStrictEqual(NSX.neighbours(null, 'a'), { next: '', prev: '' });

// ---- a folder at the cap: 300 notes of 16,000 characters, grouped and searched well under a second (generous: CI machines vary) ----
{
  const big = Array.from({ length: 300 }, (_, i) => mk(String(i), { title: 'Title ' + i + ' ünï', text: ('word ' + i + ' ').repeat(2000).slice(0, 16000), done: i % 3 === 0 }, i));
  const t0 = Date.now();
  const g = NSX.groups(big);
  const r = NSX.filter(g, 'word 299', DN.search, rank, mask);
  const ms = Date.now() - t0;
  assert.strictEqual(g.open.length + g.done.length, 300);
  assert.ok(r.open.length + r.done.length >= 1, 'the search finds the note');
  assert.ok(ms < 5000, 'grouped and searched 300 full notes in ' + ms + ' ms');
}

// ---- the wiring the screen relies on (static: the drawer's paths, no new popup, no path sent) ----
{
  const fs = require('fs') as typeof import('fs');
  const app = fs.readFileSync(path.join(R, 'app.js'), 'utf8');
  const scr = fs.readFileSync(path.join(R, 'screens.js'), 'utf8');
  const html = fs.readFileSync(path.join(R, 'index.html'), 'utf8');
  const block = app.slice(app.indexOf('spec 083 FR-044, FR-045 (T034a)'), app.indexOf('/* ---- notes in the "/" list'));
  assert.ok(block.length > 1000, 'the screen block was found');
  assert.ok(!/bridge\.notes\w+\([^)]*(path|cwd|workspaceFile|\.key\b)/.test(block), 'the screen never passes a path or a folder key to main');
  assert.ok(!/createElement\('div'\)[^;]*mode-menu|id='modeMenu'/.test(block), 'no menu element of its own (the row ⋯ is openNoteMenu)');
  assert.ok(/openNoteMenu\(/.test(block) && /editNote\(/.test(block) && /addNoteUi\(/.test(block) && /notesChange\(/.test(block), 'the drawer\'s actions are reused');
  assert.ok(/it\('done','Mark done'/.test(app) && /it\('undone','Mark not done'/.test(app), 'Mark done / Mark not done in the row menu');
  assert.ok(/onScreen\?'[^']*moves to Done \(N\) below':'[^']*stays under Done on the folder\\'s Notes screen'/.test(app) && !/the \/ list/.test(app.slice(app.indexOf('function openNoteMenu'), app.indexOf('function openNoteMenu') + 1500)), 'Mark done subtitle differs on the screen and in the drawer');
  assert.ok(/id="ntAll"[^>]*>All notes of this folder…</.test(app), 'the drawer\'s footer has All notes of this folder…');
  assert.ok(/'Notes of '\+r\.name/.test(app), 'Ctrl+K has Notes of <folder>');
  assert.ok(/data-fact="\$\{act\}"/.test(app) && /it\('notes',NSX\(\)\.menuLabel\(/.test(app), 'the folder ⋯ has Notes (N)…');
  assert.ok(/folderNotes:openNotes/.test(scr) && /kind==='notes'\)paintNotes/.test(scr), 'screens.js gives the frame');
  assert.ok(html.indexOf('<script src="notesscreen.js">') > 0 && html.indexOf('<script src="notesscreen.js">') < html.indexOf('<script src="app.js">'), 'loaded before app.js');
}

console.log('notes screen helpers ok');
