/**
 * "New": a finished agent's reply that nobody has seen yet (spec 001 FR-170..FR-177, spec 005 FR-176, FR-177, issue #691). The state machine of
 * `src/renderer/unread.js` (complete while the chat is shown, complete elsewhere, open, no second alert, mark as read, forget), `isShown`, the
 * lounge rule in `shutters.js` (an unread agent keeps its desk; once read it rolls in), and the source checks that keep the page wired to it
 * (the marker is set on the Done event only, read by the chat being shown and by Mark as read, never by closing the chat; it is not a state; no
 * announcement for a hidden folder; not kept across a restart). `npm run test:unread`. No credits spent.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';

const R = path.join(__dirname, '..', '..', 'src', 'renderer');
type Shown = { selected?: string | null; panelOpen?: boolean; visible?: boolean; tab?: string | null; notesOpen?: boolean };
type Tracker = { complete(id: string, shown: boolean): 'seen' | 'marked' | 'already'; read(id: string): boolean; forget(id: string): void; has(id: string): boolean; ids(): string[]; size: number };
const U = require(path.join(R, 'unread.js')) as { isShown(id: string, s: Shown): boolean; create(): Tracker };
const S = require(path.join(R, 'shutters.js')) as { finished(x: Record<string, unknown>): boolean; kindOf(x: Record<string, unknown>): string | null; roomPlan(l: Record<string, unknown>[]): Map<string, string> };
let n = 0;
const eq = (a: unknown, b: unknown, m: string): void => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c: unknown, m: string): void => { assert.ok(c, m); n++; };

// ---- the state machine (FR-171) ----
{
  const t = U.create();
  eq(t.complete('a', false), 'marked', 'a completion while the chat is elsewhere is unread');
  ok(t.has('a') && t.size === 1, 'and it is held');
  eq(t.complete('a', false), 'already', 'a second end-of-turn event for an unread agent does not alert again');
  eq(t.complete('a', false), 'already', 'nor does a third');
  eq(t.size, 1, 'still one marker');
  eq(t.complete('b', true), 'seen', 'a completion while its chat is shown is read at once');
  ok(!t.has('b'), 'and never held');
  eq(t.complete('a', true), 'seen', 'a completion while the chat is shown also reads an older marker');
  ok(!t.has('a'), 'the older marker is gone');
  t.complete('c', false); t.complete('d', false);
  eq(t.ids().sort(), ['c', 'd'], 'several sessions are unread at once');
  eq(t.read('c'), true, 'opening the chat of one clears that one');
  eq(t.read('c'), false, 'clearing twice reports nothing to clear');
  eq(t.ids(), ['d'], 'the others stay');
  eq(t.complete('c', false), 'marked', 'a new completion after a read marks again');
  t.forget('c'); t.forget('d'); t.forget('zz');
  eq(t.size, 0, 'a session that goes away drops its marker');
  eq(t.complete('', false), 'seen', 'no id: nothing is held');
  eq(t.complete(undefined as unknown as string, false), 'seen', 'no id (undefined): nothing is held');
  eq(t.size, 0, 'nothing held for a missing id');
}

// ---- when the chat is shown (spec 005 FR-176) ----
{
  const base: Shown = { selected: 'a', panelOpen: true, visible: true, tab: 'chat', notesOpen: false };
  ok(U.isShown('a', base), 'panel open on that agent, window visible, Chat tab, no drawer: shown');
  ok(U.isShown('a', { ...base, tab: null }), 'no tab information means the Chat tab');
  ok(!U.isShown('b', base), 'another agent is selected: not shown');
  ok(!U.isShown('a', { ...base, panelOpen: false }), 'the panel is closed (the office): not shown');
  ok(!U.isShown('a', { ...base, selected: null }), 'nothing selected: not shown');
  ok(!U.isShown('a', { ...base, visible: false }), 'the window is hidden: not shown');
  ok(!U.isShown('a', { ...base, tab: 'browser' }), 'the Browser tab is in front: not shown');
  ok(!U.isShown('a', { ...base, notesOpen: true }), 'the Notes drawer covers the log: not shown');
  ok(!U.isShown('', base) && !U.isShown(undefined as unknown as string, base), 'no id: not shown');
  ok(!U.isShown('a', undefined as unknown as Shown), 'no state: not shown');
  ok(!U.isShown('a', { ...base, panelOpen: 1 as unknown as boolean }), 'only a real true counts');
}

// ---- the lounge rule (FR-173) ----
{
  const mk = (id: string, o: Record<string, unknown> = {}) => ({ id, state: 'done', paused: false, limit: false, away: false, replied: true, helpersBusy: false, since: 60000, ...o });
  ok(S.finished(mk('a')), 'a finished agent rests');
  ok(!S.finished(mk('a', { unread: true })), 'an unread finished agent does not');
  eq(S.kindOf(mk('a', { unread: true })), null, 'it keeps its desk');
  eq(S.kindOf(mk('a', { unread: false })), 'recent', 'once read it goes to the couch (finished a minute ago)');
  eq(S.kindOf(mk('a', { unread: false, since: 3600000 })), 'old', 'or a bed when it finished long ago');
  const room = [mk('a', { unread: true }), mk('b', { state: 'working' })];
  eq([...S.roomPlan(room)], [], 'with another agent at work and this one unread, nobody rolls in');
  const room2 = [mk('a', { unread: true }), mk('b')];
  eq([...S.roomPlan(room2)].map((x) => x[0]), ['b'], 'an unread agent counts as one that keeps its desk: the read one rolls in');
  const room3 = [mk('a'), mk('b'), mk('c', { state: 'working' })];
  eq([...S.roomPlan(room3)].map((x) => x[0]).sort(), ['a', 'b'], 'read agents roll in as before');
}

// ---- the page is wired to it (source checks) ----
const app = fs.readFileSync(path.join(R, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(R, 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(R, 'index.html'), 'utf8');
const bp = fs.readFileSync(path.join(R, 'browserpane.js'), 'utf8');
const assets = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'copy-assets.js'), 'utf8');
ok(/<script src="unread\.js"><\/script>/.test(html) && html.indexOf('<script src="unread.js">') < html.indexOf('<script src="app.js">'), 'unread.js loads before app.js');
ok(/'unread\.js'/.test(assets), 'unread.js is copied into the build');
ok(/if\(was\)\{noteCompleted\(a\);setState\(a,'done'/.test(app), 'the marker is set on the Done event (a turn that worked), before the state is drawn');
ok(!/noteCompleted\(a\);setState\(a,'idle'/.test(app) && (app.match(/noteCompleted\(/g) || []).length === 2, 'noteCompleted is called only there (plus its definition)');
ok(/function noteCompleted\(a\)\{\s*if\(a\.parent\)return;/.test(app), 'a helper is never marked');
ok(/UNREAD\.complete\(a\.id,chatShownNow\(a\.id\)\)/.test(app), 'a completion asks whether its chat is shown');
ok(/if\(roomShown\(rm\)\)announce\(/.test(app) || /rm&&roomShown\(rm\)\)\{announce\(/.test(app), 'the announcement is only for a folder that is on the shown floors (FR-174)');
ok(/else if\(r==='seen'\)UNREAD_AT\.delete/.test(app) && /if\(r==='marked'\)\{UNREAD_AT\.set/.test(app), 'only a new marker starts the pulse and the announcement');
ok(/function syncSeen\(\)\{const id=ui\.selected;if\(id&&UNREAD\.has\(id\)&&chatShownNow\(id\)\)\{UNREAD\.read\(id\)/.test(app), 'syncSeen reads only the open, shown chat');
const closeP = app.slice(app.indexOf('function closePanel()'), app.indexOf('/* ---------------- events'));
ok(!/UNREAD|syncSeen|markRead/.test(closeP), 'closing the chat does not clear the marker');
ok(/BP\.mount\(a\);[^\n]*\n\s*syncSeen\(\);/.test(app), 'opening a chat reads its reply, after the tab is known');
ok(/document\.addEventListener\('visibilitychange',syncSeen\)/.test(app), 'the window coming back reads the open chat');
ok(/NT\.ret=null; syncSeen\(\);/.test(app), 'closing the Notes drawer reads the uncovered chat');
ok(/host\.chatShown\(id\)/.test(bp) && /chatShown:\(\)=>syncSeen\(\)/.test(app), 'the Chat tab coming back reads the chat');
ok(/unread:isUnread\(a\),since:sinceLast\(a\)/.test(app), 'the lounge input carries the marker');
ok(!/a\.state='unread'|setState\(a,'unread'/.test(app) && !/vis\(a\)[^;]*isUnread/.test(app), 'unread is not a state: vis(a) and the counts do not read it');
const stats = app.slice(app.indexOf('function renderStats()'), app.indexOf('function renderFilter()'));
ok(!/UNREAD|isUnread/.test(stats), 'the header counts do not read the marker');
ok((app.match(/UNREAD\.forget\(agents\[i\]\.id\)/g) || []).length === 3, 'a removed session drops its marker in all three removal paths');
ok(/if\(SIM&&!window\.__durbarSimReplayed\)return;/.test(app), 'the simulator start-up script is not news');
for (const [what, re] of [['card', /desk card is-\$\{st\}\$\{isUnread\(a\)/], ['desk', /desk is-\$\{st\}\$\{isUnread\(a\)/]] as const) ok(re.test(app), `the ${what} gets is-unread`);
ok((app.match(/\$\{unreadWords\(/g) || []).length === 4, 'card, desk, list row and strip item names say it');
ok((app.match(/unreadHTML\([ax]\)/g) || []).length === 4, "the badge is on the card, the desk, the list row and the strip item");
ok(/data-op="read" class="mm-read"/.test(app) && /if\(op==='read'\)\{markRead\(a\);return;\}/.test(app), 'the card menu has Mark as read');
ok(/e\.key==='F10'&&e\.shiftKey\)\|\|e\.key==='ContextMenu'\)\)return;\s*const d=e\.target&&e\.target\.closest&&e\.target\.closest\('\.desk\[data-id\], \.lrow\[data-id\], \.ro-plate\[data-id\]'\)/.test(app), 'Shift+F10 on a desk (or a Real office plate) opens the card menu');
ok(/\.unread-mark\{[^}]*font-size:11px/.test(css), 'the badge text is 11px (never under 10.5px)');
ok(/\.unread-mark i\{/.test(css) && /\.desk\.is-waiting::after[^{]*\{[^}]*box-shadow:[^}]*var\(--hl\)/.test(css) && /--hl:var\(--desk-new\)/.test(css) && /--hl:var\(--desk-needs\)/.test(css) && !/\.desk[^{]*\{outline:\d/.test(css), 'a dot and a glow (no outline) besides the colour');
ok(/@media \(prefers-reduced-motion:no-preference\)\{\.unread-mark\.fresh\{animation:unread-pulse/.test(css), 'the pulse only when motion is allowed');
ok(/const unreadFresh=a=>!REDUCED&&!reducedMotion\(\)&&/.test(app), 'and the page does not add the pulse class under reduced motion');
ok(/@media \(prefers-reduced-motion:no-preference\)\{\s*\.desk\.is-waiting \.pp,[^@]*hl-enter[^@]*hl-glow/.test(css) && !/^\.desk[^{]*\{[^}]*animation:hl-/m.test(css) && /\.pp\{transform-box:view-box;transform-origin/.test(css) && !/\.desk(\.[a-z-]+)*\{[^}]*transform:scale/.test(css), 'the desk zoom and glow breathe only when motion is allowed (FR-178)');
ok(!/localStorage[^;]*unread|unread[^;]*localStorage/i.test(app), 'the marker is not stored (FR-176: not kept across a restart)');

console.log(`[unread] ${n} checks passed`);

// review on #774 (Paco): the per-id announcement note and the glow's entry time are dropped wherever the agent is dropped (agent, folder, floor)
{
  const sites = app.match(/UNREAD\.forget\(agents\[i\]\.id\);/g) || [];
  const clean = app.match(/UNREAD\.forget\(agents\[i\]\.id\);UNREAD_AT\.delete\(agents\[i\]\.id\);UNREAD_SAID\.delete\(agents\[i\]\.id\);HL_AT\.delete\(agents\[i\]\.id\);/g) || [];
  ok(sites.length >= 3 && clean.length === sites.length, 'every removal path clears UNREAD_SAID and HL_AT with the marker (' + clean.length + '/' + sites.length + ')');
}
