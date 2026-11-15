/** A chat keeps a bounded transcript (spec 005 FR-238, FR-239, issue #1380): src/renderer/chattrim.js on jsdom and on plain objects, and its
 * wiring in app.js, index.html and the build. `npm run test:chattrim`. No credits spent, no Electron. */
import assert from 'assert';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const R = path.join(ROOT, 'src', 'renderer');
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CT = require(path.join(R, 'chattrim.js')) as any;

// ---- the constant and the words ----
assert.deepStrictEqual({ ...CT.CHAT_KEEP }, { messages: 300, blocks: 300, budget: 2000 }, 'FR-238: 300 messages, 300 blocks per growing timeline, 2,000 leaf blocks per chat');
assert.ok(Object.isFrozen(CT.CHAT_KEEP), 'the caps are a constant');
assert.strictEqual(CT.noteText(1234), 'Earlier messages and steps are not kept in this view (1,234 removed)');
assert.ok(!/lost|deleted|gone forever/i.test(CT.noteText(5)), 'the line never says the agent app lost them');

// ---- planDrop: oldest first, pinned skipped, exactly down to keep ----
assert.deepStrictEqual(CT.planDrop(5, 5, () => false), [], 'at the cap nothing goes');
assert.deepStrictEqual(CT.planDrop(6, 5, () => false), [0], 'one over: the oldest goes');
assert.deepStrictEqual(CT.planDrop(10, 3, () => false), [0, 1, 2, 3, 4, 5, 6]);
assert.deepStrictEqual(CT.planDrop(10, 3, (i: number) => i === 0 || i === 2), [1, 3, 4, 5, 6, 7, 8], 'pinned count but never go');
assert.deepStrictEqual(CT.planDrop(4, 1, () => true), [], 'all pinned: nothing goes');
assert.deepStrictEqual(CT.planDrop(3, 0, () => false), [0, 1, 2]);
assert.deepStrictEqual(CT.planDrop(3, -2, () => false), [0, 1, 2], 'a bad keep is 0');
assert.deepStrictEqual(CT.planDrop(0, 3, () => false), []);
{ // asks only what it needs: stops as soon as enough are dropped
  let asked = 0;
  CT.planDrop(1000, 990, () => { asked++; return false; });
  assert.strictEqual(asked, 10, 'pinned() is asked of the 10 oldest only');
}

// ---- a transcript on jsdom ----
function page() {
  const { window } = new JSDOM('<!doctype html><body><div id="chat"></div></body>');
  const doc = window.document;
  const div = (cls: string, parent: Element, text = '') => { const d = doc.createElement('div'); d.className = cls; d.textContent = text; parent.appendChild(d); return d; };
  // a card with its own buttons (as pendingCardOf wants them: `:scope > .note-actions button`)
  const card = (cls: string, parent: Element, text = '') => { const d = div(cls, parent, text); const row = div('note-actions', d); const b = doc.createElement('button'); b.textContent = 'OK'; row.appendChild(b); return d; };
  return { doc, div, card };
}
{
  const { doc, div, card } = page();
  const el = div('chat-inner', doc.getElementById('chat'));
  for (let i = 0; i < 20; i++) div('msg user', el, 'm' + i);
  const perm = card('note perm pending', el, 'Allow?'); // index 20
  const settled = div('note perm settled', el, 'answered'); // index 21
  const holder = div('msg agent', el); card('note perm question', holder, 'Which one?'); // a closed turn that holds an open question
  const mcp = div('note info cline mcp-line', el, 'MCP');
  const sign = div('note perm signin settled', el, 'sign in'); // settled, but the caller names it live
  for (let i = 0; i < 20; i++) div('msg user', el, 'n' + i);
  const keep = { messages: 10, blocks: 10, budget: 1e9 };
  const r = CT.trimChat({ el, T: null, live: new Set([sign]), keep });
  assert.ok(perm.parentNode === el, 'an open permission card is never removed');
  assert.ok(holder.parentNode === el, 'a message that holds an open question is never removed');
  assert.ok(mcp.parentNode === el, 'the MCP line (updated by its reference) stays');
  assert.ok(sign.parentNode === el, 'a live element the caller names stays');
  assert.ok(settled.parentNode !== el, 'a settled card can go');
  assert.strictEqual(el.children.length, 10, 'down to the cap exactly');
  assert.strictEqual(r.removed, 45 - 10);
  assert.deepStrictEqual([...el.children].slice(4).map((x: Element) => x.textContent), ['n14', 'n15', 'n16', 'n17', 'n18', 'n19'], 'the newest stay, in order');
  // stable: a second pass removes nothing
  assert.strictEqual(CT.trimChat({ el, T: null, live: new Set([sign]), keep }).removed, 0, 'stable when called again');
  // the note neither counts nor goes
  const note = doc.createElement('div'); note.className = 'note info ' + CT.NOTE_CLASS; el.insertBefore(note, el.firstChild);
  assert.strictEqual(CT.trimChat({ el, T: null, live: new Set([sign]), keep }).removed, 0, 'the note does not count toward the cap');
  div('msg user', el, 'n20');
  assert.strictEqual(CT.trimChat({ el, T: null, live: new Set([sign]), keep }).removed, 1);
  assert.ok(note.parentNode === el && el.firstElementChild === note, 'the note stays first');
}

// ---- the open turn: blocks trimmed, bookkeeping forgotten, live blocks kept ----
{
  const { doc, div, card } = page();
  const el = div('chat-inner', doc.getElementById('chat'));
  div('msg user', el, 'ask');
  const m = div('msg agent', el); const tl = div('tl', m);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const T: any = { tl, chat: null, chipEls: {}, think: null, chipsEl: null, bubble: null, typing: null, actId: null };
  const boxes: Element[] = [];
  for (let i = 0; i < 30; i++) {
    const box = div('chips', tl); boxes.push(box);
    const chip = div('chip', box, 'c' + i); T.chipEls['call' + i] = { el: chip, state: i === 0 ? 'run' : 'ok', box };
    div('think', tl, 't' + i);
  }
  const ask = card('note perm pending', tl, 'Allow?'); // an open card inside the turn
  T.think = { el: tl.children[1], body: null }; // a stale reference: the turn's first thinking block (it is about to go)
  T.chipsEl = boxes[29]; T.bubble = div('bubble caret', tl, 'typing…'); T.typing = div('typing', tl); T.actId = 'call0';
  const live = new Set<Element>([m, T.typing, T.bubble, T.chipsEl]);
  const r = CT.trimChat({ el, T, live, keep: { messages: 10, blocks: 12, budget: 1e9 } });
  assert.strictEqual(tl.children.length, 12, 'the open turn is cut to its cap');
  assert.ok(ask.parentNode === tl && T.typing.parentNode === tl && T.bubble.parentNode === tl && T.chipsEl.parentNode === tl, 'the open card, typing line, live bubble and chip row stay');
  assert.ok(m.parentNode === el, 'the open turn\'s own message stays');
  for (const [k, c] of Object.entries(T.chipEls) as Array<[string, { el: Element }]>) assert.ok(tl.contains(c.el), `chipEls keeps only chips still in the turn (${k})`);
  assert.ok(!T.chipEls.call0 && T.chipEls.call29, 'the removed chip\'s reference is gone, the newest stays');
  assert.strictEqual(T.think, null, 'a removed thinking block is forgotten');
  assert.strictEqual(r.actGone, true, 'the waiting line\'s chip went: the caller names the next one');
  assert.ok(T.chipsEl && T.bubble, 'live references stay');
  assert.strictEqual(CT.trimChat({ el, T, live, keep: { messages: 10, blocks: 12, budget: 1e9 } }).removed, 0, 'stable when called again');
  // a turn whose timeline is not in this chat is not touched
  const other = page(); const el2 = other.div('chat-inner', other.doc.getElementById('chat'));
  assert.strictEqual(CT.trimChat({ el: el2, T, live, keep: { messages: 10, blocks: 1, budget: 1e9 } }).removed, 0, 'another chat\'s turn is left alone');
}

// ---- Read-only denials (issue 1380 review): never settled; only the newest carries the button, only it stays ----
{
  const { doc, div, card } = page();
  const el = div('chat-inner', doc.getElementById('chat'));
  const denied: Element[] = [];
  for (let i = 0; i < 40; i++) { const m = div('msg agent', el); denied.push(div('note perm', m, 'denied ' + i)); }
  const newest = denied[39]; const row = div('note-actions', newest); const b = doc.createElement('button'); b.dataset.act = 'ro-ask'; row.appendChild(b);
  const keep = { messages: 5, blocks: 5, budget: 1e9 };
  CT.trimChat({ el, T: null, live: new Set(), keep });
  assert.strictEqual(el.children.length, 5, 'button-less denials are not pinned: the cap holds');
  assert.ok(el.contains(newest), 'the newest denial, with its button, stays');
  assert.strictEqual(CT.waitingCard(denied[0]), false, 'a denial without a button is not a waiting card');
  assert.strictEqual(CT.waitingCard(newest), true, 'one with its own button is');
  // a button deeper down (not in the card's own actions row) does not pin it
  const odd = div('note perm', el, 'x'); const inner = div('psbx', odd); div('note-actions', inner).appendChild(doc.createElement('button'));
  assert.strictEqual(CT.waitingCard(odd), false, 'only the card\'s own actions row counts');
  // a 1,600-turn run of denials stays at the cap (the reviewer's case: 1,601 messages before)
  const el3 = div('chat-inner', doc.getElementById('chat'));
  for (let i = 0; i < 1600; i++) { const m = div('msg agent', el3); div('note perm', m, 'd' + i); }
  CT.trimChat({ el: el3, T: null, live: new Set(), keep: { messages: 300, blocks: 300, budget: 2000 } });
  assert.strictEqual(el3.children.length, 300, '1,600 denials: 300 kept');
}

// ---- the budget: whole messages, oldest first, pinned never; stable ----
{
  const { doc, div, card } = page();
  const el = div('chat-inner', doc.getElementById('chat'));
  const turns: Element[] = [];
  for (let i = 0; i < 30; i++) { const m = div('msg agent', el); div('meta', m); const tl = div('tl', m); for (let k = 0; k < 10; k++) div('think', tl, 't' + i + '.' + k); turns.push(m); }
  const pinnedTurn = turns[0]; card('note perm pending', pinnedTurn.querySelector('.tl') as Element, 'Allow?'); // 11 leaves, holds a waiting card
  for (let i = 0; i < 5; i++) div('msg user', el, 'u' + i); // 1 leaf each
  assert.strictEqual(CT.leafTotal(el), 30 * 10 + 1 + 5, 'leaves: a message counts its timeline\'s blocks, else 1');
  const keep = { messages: 300, blocks: 300, budget: 100 };
  assert.strictEqual(CT.over({ el, keep, tls: [] }), true, 'over the budget');
  const r = CT.trimChat({ el, T: null, live: new Set(), keep });
  assert.ok(CT.leafTotal(el) <= 100, 'within the budget: ' + CT.leafTotal(el));
  assert.ok(el.contains(pinnedTurn), 'a message holding a waiting card stays, whatever its size');
  assert.ok(turns.slice(1, 22).every((m) => !el.contains(m)), 'the oldest whole messages went');
  assert.ok(turns.slice(22).every((m) => el.contains(m)), 'the newest stay');
  assert.strictEqual(r.removed, 21, 'whole messages, each counted once (306 - 21 x 10 = 96 leaves)');
  assert.strictEqual(CT.trimChat({ el, T: null, live: new Set(), keep }).removed, 0, 'stable when called again');
  assert.strictEqual(CT.over({ el, keep, tls: [] }), false, 'and no longer over');
  { // a drop that lands exactly on the budget stops there
    const { doc: d2, div: v2 } = page(); const e2 = v2('chat-inner', d2.getElementById('chat'));
    for (let i = 0; i < 30; i++) { const m = v2('msg agent', e2); const tl = v2('tl', m); for (let k = 0; k < 10; k++) v2('think', tl); }
    assert.strictEqual(CT.trimChat({ el: e2, T: null, live: new Set(), keep: { messages: 300, blocks: 300, budget: 100 } }).removed, 20, '300 leaves, budget 100: 20 messages go, 100 stay');
    assert.strictEqual(CT.leafTotal(e2), 100);
  }
  // exactly at the budget is not over: a chat of 96 leaves with a budget of 96 loses nothing
  assert.strictEqual(CT.trimChat({ el, T: null, live: new Set(), keep: { messages: 300, blocks: 300, budget: CT.leafTotal(el) } }).removed, 0, 'at the budget exactly, nothing goes');
  // the note neither counts as a message for over() nor as a leaf
  const n = div('note info ' + CT.NOTE_CLASS, el, 'note'); el.insertBefore(n, el.firstChild);
  const k2 = { messages: el.children.length - 1, blocks: 300, budget: 1e9 };
  assert.strictEqual(CT.over({ el, keep: k2, tls: [], noteIn: true }), false, 'a chat at its cap with the note is not over');
  assert.strictEqual(CT.over({ el, keep: k2, tls: [], noteIn: false }), true, '(counting the note would put it over)');
  // spec 005 FR-240: two lines at the top (FR-238's and the helpers' line, a sibling `.chat-trim` note): `noteIn` is their number
  const n2 = div('note info sub-gone ' + CT.NOTE_CLASS, el, 'helpers'); el.insertBefore(n2, n.nextSibling);
  const k3 = { messages: el.children.length - 2, blocks: 300, budget: 1e9 };
  assert.strictEqual(CT.over({ el, keep: k3, tls: [], noteIn: 2 }), false, 'a chat at its cap with both lines is not over (noteIn 2)');
  assert.strictEqual(CT.over({ el, keep: k3, tls: [], noteIn: 1 }), true, '(counting one line as a message would put it over)');
  assert.strictEqual(CT.over({ el, keep: k3, tls: [], noteIn: true }), true, 'true still means one line');
}

// ---- the message cap keeps the newest message of each side too (review on #1431): 400 notes after the question and the reply ----
{
  const { doc, div } = page();
  const el = div('chat-inner', doc.getElementById('chat'));
  div('msg user', el, 'old Q'); div('msg agent', el, 'old A');
  const q = div('msg user', el, 'Q'); const r = div('msg agent', el, 'A');
  const notes: Element[] = []; for (let i = 0; i < 400; i++) notes.push(div('note info', el, 'n' + i));
  CT.trimChat({ el, T: null, live: new Set(), keep: CT.CHAT_KEEP });
  assert.ok(el.contains(q) && el.contains(r), 'the newest question and reply stay under the message cap');
  assert.strictEqual(el.children.length, 300, 'down to the cap');
  assert.ok(!el.contains(notes[0]) && el.contains(notes[399]), 'the oldest notes went first, the newest stay');
  assert.strictEqual(CT.trimChat({ el, T: null, live: new Set(), keep: CT.CHAT_KEEP }).removed, 0, 'stable when called again');
}

// ---- the budget never empties a chat (review round 2): the newest messages stay; one closed message over the budget loses its oldest blocks ----
{
  const { doc, div } = page();
  const big = (parent: Element, n: number) => { const m = div('msg agent', parent); div('meta', m); const tl = div('tl', m); for (let k = 0; k < n; k++) div(k % 2 ? 'chips' : 'think', tl, 'b' + k); div('bubble', tl, 'FINAL-REPLY-MARK'); return m; };
  const keep = CT.CHAT_KEEP;
  assert.deepStrictEqual([...CT.KEEP_ROLES], ['user', 'agent'], 'the newest message of the person and the newest reply are never removed whole');
  // a chat whose only messages are the question and a closed turn of 2,600 calls (a burst with no frame, or a hidden window)
  const el = div('chat-inner', doc.getElementById('chat'));
  const q = div('msg user', el, 'Q-BIG'); const m = big(el, 2600);
  const r = CT.trimChat({ el, T: null, live: new Set(), keep });
  assert.ok(el.contains(q) && el.contains(m), 'the question and the giant reply stay');
  assert.ok(CT.leafTotal(el) <= keep.budget, 'within the budget: ' + CT.leafTotal(el));
  assert.strictEqual(m.querySelector('.tl')!.lastElementChild!.textContent, 'FINAL-REPLY-MARK', 'its newest block (the reply) stays');
  assert.strictEqual(r.removed, 2601 + 1 - 1 - (keep.budget - 1), 'its oldest blocks went, each counted');
  assert.strictEqual(CT.trimChat({ el, T: null, live: new Set(), keep }).removed, 0, 'stable when called again');
  // alone in its chat: never 0 messages
  const el1 = div('chat-inner', doc.getElementById('chat')); const m1 = big(el1, 2600);
  CT.trimChat({ el: el1, T: null, live: new Set(), keep });
  assert.ok(el1.contains(m1) && el1.children.length === 1, 'a chat of one giant message keeps it');
  // with older messages: they go whole first, and the giant one is cut only for what is left over
  const el2 = div('chat-inner', doc.getElementById('chat'));
  const olds: Element[] = []; for (let i = 0; i < 10; i++) olds.push(big(el2, 20));
  const q2 = div('msg user', el2, 'Q2'); const m2 = big(el2, 2600);
  CT.trimChat({ el: el2, T: null, live: new Set(), keep });
  assert.ok(olds.every((o) => !el2.contains(o)), 'the older messages went whole');
  assert.ok(el2.contains(q2) && el2.contains(m2), 'the newest two stay');
  assert.ok(CT.leafTotal(el2) <= keep.budget && CT.leafTotal(el2) >= keep.budget - 1, 'within the budget, and no more cut than needed: ' + CT.leafTotal(el2));
  // a budget smaller than what must stay: the reply is the last block cut never reaches
  const el4 = div('chat-inner', doc.getElementById('chat')); div('msg user', el4, 'Q4'); const m4 = big(el4, 10);
  CT.trimChat({ el: el4, T: null, live: new Set(), keep: { messages: 300, blocks: 300, budget: 1 } });
  assert.strictEqual(m4.querySelector('.tl')!.children.length, 1, 'cut down to one block');
  assert.strictEqual(m4.querySelector('.tl')!.lastElementChild!.textContent, 'FINAL-REPLY-MARK', 'and that block is the reply');
  // notes after the reply (Stopped by you, a dropped switch, a fresh-session note) do not use up the protection (review round 3)
  for (const notes of [1, 2]) {
    const e5 = div('chat-inner', doc.getElementById('chat'));
    for (let i = 0; i < 3; i++) big(e5, 30);
    const q5 = div('msg user', e5, 'Q5'); const m5 = big(e5, 2600);
    const ns: Element[] = []; for (let i = 0; i < notes; i++) ns.push(div('note info', e5, 'note ' + i));
    CT.trimChat({ el: e5, T: null, live: new Set(), keep });
    assert.ok(e5.contains(q5) && e5.contains(m5), `${notes} note(s) after the reply: the question and the reply stay`);
    assert.strictEqual(m5.querySelector('.tl')!.lastElementChild!.textContent, 'FINAL-REPLY-MARK', `${notes} note(s): the reply block stays`);
    assert.ok(CT.leafTotal(e5) <= keep.budget, `${notes} note(s): within the budget (${CT.leafTotal(e5)})`);
  }
  // two queued messages of the person after the reply (round 4): the reply still stays, and so does the newest of the person
  { const e6 = div('chat-inner', doc.getElementById('chat'));
    for (let i = 0; i < 3; i++) big(e6, 30);
    div('msg user', e6, 'Q1'); const m6 = big(e6, 2600); const u1 = div('msg user', e6, 'queued 1'); const u2 = div('msg user', e6, 'queued 2');
    CT.trimChat({ el: e6, T: null, live: new Set(), keep });
    assert.ok(e6.contains(m6) && e6.contains(u2), 'with two queued messages after it, the reply and the newest of the person stay');
    assert.strictEqual(m6.querySelector('.tl')!.lastElementChild!.textContent, 'FINAL-REPLY-MARK', 'the reply block stays');
    assert.ok(CT.leafTotal(e6) <= keep.budget, 'within the budget: ' + CT.leafTotal(e6));
    void u1; }
  // a waiting card inside the giant message stays
  const el3 = div('chat-inner', doc.getElementById('chat')); const m3 = big(el3, 2600); const tl3 = m3.querySelector('.tl')!;
  const cardEl = div('note perm pending', tl3, 'Allow?'); div('note-actions', cardEl).appendChild(doc.createElement('button')); tl3.insertBefore(cardEl, tl3.firstChild);
  CT.trimChat({ el: el3, T: null, live: new Set(), keep });
  assert.ok(tl3.contains(cardEl), 'a waiting card inside it is not cut');
}

// ---- a running helper's timeline is trimmed as the open turn's; plan() then apply() with onDrop before removal ----
{
  const { doc, div } = page();
  const el = div('chat-inner', doc.getElementById('chat'));
  const m = div('msg agent', el); const tl = div('tl', m); const sub = div('subblk running', tl); const stl = div('tl', sub);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ST: any = { tl: stl, chipEls: {}, think: null, chipsEl: null, bubble: null, typing: div('typing', stl), actId: null };
  for (let i = 0; i < 20; i++) { const b = div('chips', stl); ST.chipEls['s' + i] = { el: div('chip', b) }; }
  stl.insertBefore(ST.typing, stl.firstChild); // oldest place: only the helper's live set keeps it
  const seen: boolean[] = [];
  const r = CT.trimChat({ el, T: null, live: new Set([m]), keep: { messages: 10, blocks: 5, budget: 1e9 }, subs: [{ T: ST, live: new Set([ST.typing]) }], onDrop: (x: Element) => seen.push(el.contains(x)) });
  assert.strictEqual(stl.children.length, 5, 'the helper\'s timeline is cut to the cap');
  assert.ok(stl.contains(ST.typing) && el.contains(sub), 'its typing line and the running block stay');
  assert.strictEqual(Object.keys(ST.chipEls).length, 4, 'its chip references follow');
  assert.strictEqual(r.removed, 16);
  assert.ok(seen.length === 16 && seen.every(Boolean), 'onDrop sees each block before it leaves the chat');
}

// ---- liveSet: the agent's cards and the open turn's live parts (FR-238) ----
{
  const sign = { n: 'sign' }, fresh = { n: 'fresh' }, m = { n: 'm' }, ty = { n: 'ty' }, th = { n: 'th' }, bu = { n: 'bu' }, ch = { n: 'ch' };
  const L = CT.liveSet({ signCard: sign, freshNote: fresh }, { m, T: { typing: ty, think: { el: th }, bubble: bu, chipsEl: ch } });
  for (const [k, v] of Object.entries({ sign, fresh, m, ty, th, bu, ch })) assert.ok(L.has(v), `liveSet keeps ${k}`);
  assert.strictEqual(CT.liveSet(null, null).size, 0);
  // a settled sign-in card and a fresh note (neither is a waiting card) stay through a trim because they are live
  const { doc, div } = page();
  const el = div('chat-inner', doc.getElementById('chat'));
  const sc = div('note perm signin settled', el, 'signed in'); const fn = div('note fresh', el, 'nearly full'); const row = div('note-actions', fn); row.appendChild(doc.createElement('button'));
  for (let i = 0; i < 20; i++) div('msg user', el, 'u' + i);
  CT.trimChat({ el, T: null, live: CT.liveSet({ signCard: sc, freshNote: fn }, null), keep: { messages: 5, blocks: 5, budget: 1e9 } });
  assert.ok(el.contains(sc) && el.contains(fn), 'the sign-in card and the fresh note stay');
}

// ---- forgetRemoved alone ----
{
  const inside = (x: unknown) => x === 'kept';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const T: any = { chipEls: { a: { el: 'kept' }, b: { el: 'gone' }, c: null }, think: { el: 'gone' }, chipsEl: 'kept', bubble: 'gone', actId: 'a' };
  assert.strictEqual(CT.forgetRemoved(T, inside), false, 'the waiting chip stays: nothing to rename');
  assert.deepStrictEqual(Object.keys(T.chipEls), ['a']);
  assert.strictEqual(T.think, null); assert.strictEqual(T.bubble, null); assert.strictEqual(T.chipsEl, 'kept');
  assert.strictEqual(CT.forgetRemoved(null, inside), false);
}

// ---- isPinned: unsure is kept ----
assert.strictEqual(CT.isPinned(null, new Set()), true, 'nothing to remove is not removed');
assert.strictEqual(CT.isPinned({ matches() { throw new Error('x'); } }, new Set()), true, 'a selector error keeps the element');
assert.strictEqual(CT.isPinned({ matches(sel: string) { if (/mcp-line/.test(sel)) throw new Error('x'); return false; }, querySelector: () => null, querySelectorAll: () => [] }, new Set()), true, 'an error in the pin selector alone keeps it too');

// ---- 200,000 blocks on plain objects: under 1 s (a generous limit; it is linear) ----
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parent: any = { children: [] as unknown[] };
  for (let i = 0; i < 200_000; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kid: any = { i, removed: false, classList: { contains: () => false }, matches: () => i % 1000 === 0, querySelector: () => null, remove() { kid.removed = true; } };
    parent.children.push(kid);
  }
  const t0 = Date.now();
  const n = CT.trimChildren(parent, 300, new Set(), null);
  const ms = Date.now() - t0;
  assert.ok(ms < 1000, '200,000 blocks trimmed in under 1 s, took ' + ms + ' ms');
  const pinned = parent.children.filter((k: { i: number; removed: boolean }) => k.i % 1000 === 0 && k.removed).length;
  assert.strictEqual(pinned, 0, 'no pinned block went');
  assert.strictEqual(parent.children.filter((k: { removed: boolean }) => !k.removed).length, 300, 'down to 300 (200 pinned among them)');
  assert.strictEqual(n, 200_000 - 300);
}

// ---- plan() over 200,000 messages (caps and budget): under 1 s ----
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kids: any[] = [];
  for (let i = 0; i < 200_000; i++) kids.push({ i, classList: { contains: () => false }, matches: () => i % 997 === 0, querySelector: () => null, querySelectorAll: () => [], childElementCount: 0, contains: () => false, remove() {} });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el: any = { children: kids, childElementCount: kids.length, contains: () => false };
  const t0 = Date.now();
  const drops = CT.plan({ el, keep: CT.CHAT_KEEP, live: new Set(), tls: [] });
  const ms = Date.now() - t0;
  assert.ok(ms < 1000, 'plan over 200,000 messages in under 1 s, took ' + ms + ' ms');
  assert.ok(drops.every((k: { i: number }) => k.i % 997 !== 0), 'no pinned message is planned');
  assert.strictEqual(kids.length - drops.length, 300, '300 kept (pinned ones among them)');
}

// ---- wiring: the page loads it, the build copies it, app.js trims from stickyFlush, the task log is bounded ----
{
  const html = fs.readFileSync(path.join(R, 'index.html'), 'utf8');
  const at = html.indexOf('<script src="chattrim.js">'), app = html.indexOf('<script src="app.js">');
  assert.ok(at > 0 && at < app, 'index.html loads chattrim.js before app.js');
  assert.ok(fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8').includes("'chattrim.js'"), 'the build copies chattrim.js');
  const src = fs.readFileSync(path.join(R, 'app.js'), 'utf8');
  const flush = src.slice(src.indexOf('function stickyFlush('), src.indexOf('const thinkScroll='));
  assert.ok(/l\.forEach\(chat=>\{if\(chatTrim\(chat,c\)>0&&c&&chat\.el\.parentNode===c\)openTrimmed=true;\}\)/.test(flush), 'stickyFlush trims every chat it flushes');
  assert.ok(/if\(openTrimmed\)c\._lastTop=c\.scrollTop;/.test(flush), 'only a trim of the open chat resets the scroll baseline (FR-214 keeps its first-scroll rule otherwise)');
  assert.ok(flush.indexOf('chatTrim') < flush.indexOf('c.scrollTop=c.scrollHeight'), 'trimmed before the scroll to the end');
  assert.ok(/const TASK_LOG_KEEP=500;/.test(src) && /L\.length>TASK_LOG_KEEP\)L\.splice\(0,L\.length-TASK_LOG_KEEP\)/.test(src), 'FR-239: the simulator task log keeps the last 500');
  assert.ok(/const CHAT_KEEP_SIM=\(\(\)=>\{const n=SIM\?parseInt\(qs\.get\('simchatkeep'\)/.test(src) && /const K=CHAT_KEEP_SIM\|\|CT\.CHAT_KEEP,/.test(src), 'only the simulator can raise the caps (simchatkeep, for check-chat-visibility)');
  assert.ok(/simchatkeep: '100000'/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'check-chat-visibility.js'), 'utf8')), 'the 4,000-message driver raises the caps');
  assert.ok(/const a=chat\.agent,live=CT\.liveSet\(a,t\);/.test(src), 'app.js takes the live set from chattrim (the sign-in and fresh-note cards in it)');
  const trim = src.slice(src.indexOf('function chatTrim('), src.indexOf('const ordGone='));
  assert.ok(trim.indexOf('CT.over(') > 0 && trim.indexOf('CT.over(') < trim.indexOf('CT.plan('), 'the cheap check comes before any planning');
  assert.ok(!/getBoundingClientRect/.test(trim), 'the trim reads no positions (the open chat is never trimmed while read scrolled up)');
  assert.ok(/for\(const x of el\.querySelectorAll\(':scope > \*, \.tl > \*'\)\)if\(rg\.intersectsNode\(x\)\)live\.add\(x\);/.test(trim), 'a selection keeps every message and block it covers');
  assert.ok(/if\(r\.actGone&&T\)tActNext\(T\);/.test(trim), 'the waiting line names the next running tool when its chip went');
  assert.ok(/ord:ordGone\(root,role\)\+Math\.max\(0,all\.indexOf\(bubble\)\)/.test(src), 'a saved note\'s place counts the removed bubbles (msgInfo)');
  assert.ok(/ord:ordGone\(el,'user'\)\+i/.test(src) && /ord:ordGone\(el,'agent'\)\+i/.test(src), 'the note markers count them too');
  assert.ok(/const at=src\.ord-ordGone\(root,src\.role\);/.test(src), 'Open source finds the place among the bubbles still shown');
  assert.ok(/if\(a\.freshNote&&liveChat\(a\)\.el\.contains\(a\.freshNote\)\)/.test(src) && !/a\.freshNote\.isConnected/.test(src), 'the fresh-session note is looked for in its chat, open or not (isConnected added one at every idle of a closed chat)');
  assert.ok(/if\(document\.hidden\)\{hiddenDirty=true;if\(!hiddenTrimT\)hiddenTrimT=setInterval\(hiddenTrimTick,TRIM_HIDDEN_MS\);\}/.test(src), 'a hidden page (no frames) trims by a slow timer, started by an append');
  assert.ok(/n>=50&&n<=600000\?n:30000/.test(src) && /const n=SIM\?parseInt\(qs\.get\('simtrimtick'\)/.test(src), 'every 30 s; only the simulator may shorten it');
  assert.ok(/if\(!document\.hidden\|\|!hiddenDirty\)\{clearInterval\(hiddenTrimT\);hiddenTrimT=0;return 0;\}/.test(src), 'it stops when shown or when nothing was added');
  assert.ok(/for\(let x of \[document\.activeElement,sel&&sel\.anchorNode,sel&&sel\.focusNode,mm&&mm\._anchor\]\)/.test(trim) && /for\(;x&&x!==el;x=x\.parentNode\)if\(x\.nodeType===1\)live\.add\(x\);/.test(trim) && /m\._anchor=btn;/.test(src), 'the focus, a selection and an open message menu keep their message (and everything around it) live');
  assert.ok(/if\(c&&el\.parentNode===c&&c\.dataset\.pin==='0'\)\{st\.deferred=\(st\.deferred\|\|0\)\+1;trimDeferred=chat;return 0;\}/.test(trim), 'the open chat is not trimmed while the person reads its older messages');
  assert.ok(trim.indexOf('trimDeferred=chat;return 0;') < trim.indexOf('CT.plan('), 'it waits before planning anything');
  assert.ok(/if\(trimDeferred&&!stickyRaf\)stickyRaf=requestAnimationFrame\(stickyFlush\);/.test(src), 'back at the end, the waiting trim runs');
  assert.ok(/chat\.turn=t;/.test(src) && /t\.T\.chat\.turn===t\)t\.T\.chat\.turn=null/.test(src), 'the chat knows its open turn, and forgets it when the turn closes');
}

console.log('chattrim tests passed');
