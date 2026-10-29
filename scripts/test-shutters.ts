/**
 * Finished agents rest in the lounge (spec 001 FR-051..FR-057): which agents rest (couch, bed, never), the room rule, the couches, bunks,
 * corner width and "+N asleep" split of `src/renderer/shutters.js`, plus the source checks that keep the page wired to it (resting agents
 * leave the layout search, the lounge is in both densities, the key follows who rests where, the reply line is masked, the room rule's
 * input reads away and busy helpers, the state is data-state and the first is-* class). `npm run test:shutters`. No credits spent.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';

const R = path.join(__dirname, '..', '..', 'src', 'renderer');
type X = { id: string; state: string; paused?: boolean; limit?: boolean; away?: boolean; replied?: boolean; helpersBusy?: boolean; since?: number | null };
const S = require(path.join(R, 'shutters.js')) as {
  RECENT_MS: number;
  OLD_CAP: number;
  COUCH_SEATS: number;
  SEAT_W: number;
  COUCH_PAD: number;
  BUNK_W: number;
  MIN_W: number;
  bunks: (n: number) => number;
  MORE_W: number;
  PAD: number;
  couches: (n: number) => number[];
  turn: (t: number, n: number) => number;
  GAP: number;
  width: (nRecent: number, nBeds: number, more: boolean) => number;
  finished: (x: X) => boolean;
  kindOf: (x: X) => 'recent' | 'old' | null;
  roomPlan: (list: X[]) => Map<string, 'recent' | 'old'>;
  split: <T>(old: T[], cap: number, expanded: boolean) => { shown: T[]; hidden: T[] };
  spoken: (ago: string) => string;
};
const MIN = 60000;
let n = 0;
const eq = (a: unknown, b: unknown, m: string): void => { assert.deepStrictEqual(a, b, m); n++; };

// owner defaults (FR-052)
eq(S.RECENT_MS, 10 * MIN, 'recent means the last 10 minutes');
eq([S.OLD_CAP, S.COUCH_SEATS], [4, 3], 'up to 4 beds; 3 seats a couch');
eq([S.SEAT_W, S.COUCH_PAD, S.BUNK_W, S.MORE_W, S.GAP, S.PAD, S.MIN_W], [64, 8, 72, 52, 6, 8, 150], 'seat 64px, couch frame 8px, bunk 72px, "+N asleep" 52px, gaps 6px, padding 8px, at least 150px (styles.css uses the same)');
eq([0, 1, 2, 3, 4].map(S.bunks), [0, 1, 1, 2, 2], 'two beds to a bunk');

// ---- classification (FR-051, FR-052) ----
const done = (since: number | null, o: Partial<X> = {}): X => Object.assign({ id: 'a', state: 'done', replied: true, since }, o);
eq(S.kindOf(done(0)), 'recent', 'just finished: recent');
eq(S.kindOf(done(2 * MIN)), 'recent', '2 min: recent');
eq(S.kindOf(done(10 * MIN - 1)), 'recent', 'just under 10 min: recent');
eq(S.kindOf(done(10 * MIN)), 'old', '10 min: old');
eq(S.kindOf(done(3 * 3600000)), 'old', '3 h: old');
eq(S.kindOf(done(null)), 'old', 'unknown time: old');
eq(S.kindOf(done(NaN)), 'old', 'NaN time: old');
eq(S.kindOf(done(-5)), 'old', 'a negative time is not trusted: old');
eq(S.kindOf(done(1, { replied: false })), 'recent', 'Done without a reply text still finished');
eq(S.kindOf({ id: 'a', state: 'idle', replied: true, since: MIN }), 'recent', 'Idle after a finished turn: rolls');
eq(S.kindOf({ id: 'a', state: 'idle', replied: false, since: MIN }), null, 'Idle without a reply (never ran): keeps its desk');
for (const st of ['working', 'thinking', 'waiting', 'error'])
  eq(S.kindOf({ id: 'a', state: st, replied: true, since: MIN }), null, `${st}: never rolls`);
eq(S.kindOf(done(MIN, { paused: true })), null, 'paused (coffee break): never rolls');
eq(S.kindOf(done(MIN, { limit: true })), null, 'at its spending limit: never rolls');
eq(S.kindOf(done(MIN, { away: true })), null, 'away at a place (or walking back): never rolls');
eq(S.kindOf(done(MIN, { helpersBusy: true })), null, 'a helper still busy: never rolls');
eq(S.finished(null as unknown as X), false, 'no agent: not finished');

// ---- the room rule (FR-051) ----
const plan = (xs: X[]): Record<string, string> => Object.fromEntries(S.roomPlan(xs));
const w = (id: string, state = 'working'): X => ({ id, state, since: 0 });
const f = (id: string, since: number | null): X => ({ id, state: 'done', replied: true, since });
eq(plan([w('a'), w('b'), f('c', MIN), f('d', 20 * MIN), f('e', 40 * MIN)]), { c: 'recent', d: 'old', e: 'old' }, '2 working + 3 finished: 1 on the couch, 2 asleep');
eq(plan([f('c', MIN), f('d', 20 * MIN)]), {}, 'a room of only finished agents stays as it is');
eq(plan([f('c', MIN)]), {}, 'a lone finished agent stays as it is');
eq(plan([w('a', 'waiting'), f('c', MIN)]), { c: 'recent' }, 'a waiting agent keeps the room open');
eq(plan([w('a', 'error'), f('c', 30 * MIN)]), { c: 'old' }, 'an error keeps the room open');
eq(plan([{ id: 'a', state: 'idle', replied: false, since: null }, f('c', MIN)]), { c: 'recent' }, 'an idle agent that never ran keeps its desk, so the room rolls');
eq(plan([Object.assign(f('a', MIN), { paused: true }), f('c', MIN)]), { c: 'recent' }, 'a paused finished agent keeps its desk');
eq(plan([Object.assign(f('a', MIN), { helpersBusy: true }), f('c', MIN)]), { c: 'recent' }, 'a finished agent with a busy helper keeps its desk');
eq(plan([]), {}, 'an empty room');
eq(plan(undefined as unknown as X[]), {}, 'no list');

// ---- beds and "+N asleep" (FR-052) ----
const L = (k: number): number[] => Array.from({ length: k }, (_, i) => i);
eq(S.split(L(4), 4, false), { shown: L(4), hidden: [] }, '4 sleepers: 4 beds');
eq(S.split(L(5), 4, false), { shown: L(3), hidden: [3, 4] }, '5 sleepers: 3 beds and +2 asleep');
eq(S.split(L(9), 4, false), { shown: L(3), hidden: [3, 4, 5, 6, 7, 8] }, '9 sleepers: 3 beds and +6 asleep');
eq(S.split(L(9), 4, true), { shown: L(9), hidden: [] }, 'expanded: all');
eq(S.split([], 4, false), { shown: [], hidden: [] }, 'none');

// ---- couches (FR-052): 3 seats a couch, then another couch ----
eq(S.couches(0), [], 'nobody on a couch');
eq(S.couches(2), [2], 'two share a couch');
eq(S.couches(3), [3], 'a full couch');
eq(S.couches(5), [3, 2], 'then a second couch');

// ---- whose bubble shows (FR-055): turns go round, deterministic ----
eq([0, 1, 2, 3, 4].map((t) => S.turn(t, 3)), [0, 1, 2, 0, 1], 'turns go round the sleepers');
eq(S.turn(5, 1), 0, 'one sleeper: always that one');
eq(S.turn(3, 0), 0, 'nobody: 0');
eq(S.turn(-1, 3), 2, 'never negative');

// ---- the lounge corner's width (FR-053): what the layout gives up for the resting agents ----
eq(S.width(0, 0, false), 0, 'nobody resting, no corner');
eq(S.width(2, 3, false), 2 * 8 + (2 * 64 + 8) + 6 + 2 * 72 + 6, 'a couch of two and two bunks (the owner\'s 280-320px)');
eq(S.width(3, 4, false), 2 * 8 + (3 * 64 + 8) + 6 + 2 * 72 + 6, 'a full couch and two full bunks');
eq(S.width(0, 3, true), 2 * 8 + 2 * 72 + 52 + 2 * 6, 'two bunks and "+N asleep"');
eq(S.width(5, 0, false), 2 * 8 + (3 * 64 + 8) + 6 + (2 * 64 + 8), 'two couches');
eq(S.width(1, 0, false), 150, 'one on the couch: the corner keeps 150px for its bubble');
eq(S.width(0, 1, false), 150, 'one asleep: 150px');

// ---- spoken time (FR-054) ----
eq(S.spoken('just now'), 'just now', 'just now');
eq(S.spoken('1 min ago'), '1 minute ago', 'one minute');
eq(S.spoken('12 min ago'), '12 minutes ago', 'minutes');
eq(S.spoken('3 h ago'), '3 hours ago', 'hours');
eq(S.spoken('1 d ago'), '1 day ago', 'one day');
eq(S.spoken(''), '', 'unknown');

// ---- the page uses it (source checks; the layout itself is checked in the browser by check:office and check-office-fill) ----
const app = fs.readFileSync(path.join(R, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(R, 'styles.css'), 'utf8');
const ok = (c: boolean, m: string): void => { assert.ok(c, m); n++; };
ok(/const mains=shown\.filter\(a=>!plan\.has\(a\.id\)\)/.test(app), 'officeModel: rolled agents are not desks in the layout search (FR-053)');
ok(/function shutPlan\(r\)\{\s*if\(!shutOn\(\)\)return new Map\(\);\s*return SHUT\.roomPlan\(agents\.filter\(a=>!a\.parent&&a\.room===r\.id\)\.map\(shutInput\)\)/.test(app), 'the room rule reads the whole room, not the status filter, and the setting turns it off');
ok(/\$\{shuttersHTML\(r,rolled\)\}<\/div><\/section>`/.test(app) && /<div class="units-in" style="--cols:\$\{cols\}">\$\{mains\.map\(a=>unitHTML\(a,d\)\)\.join\(''\)\}<\/div>\$\{shuttersHTML\(r,rolled\)\}/.test(app), 'the lounge sits at the end of the desk row, in both the full and the compact room');
ok(/sw=shutW\(r,rolled\), over=2\*D\.rp\+4\+\(sw\?sw\+D\.gap:0\)/.test(app) && /sw\?Math\.floor\(\(aw-over\+D\.gap\)\/\(D\.cw\+D\.gap\)\):Infinity/.test(app) && /widths=mains\.map\(a=>unitWidth\(a,d\)\)\.concat\(sw\?\[sw\]:\[\]\)/.test(app), 'the room width counts the lounge, compact and full (FR-053)');
ok(/const w=SHUT\.width\(recent\.length,shown\.length,more\)/.test(app), 'the corner width comes from shutters.js');
ok(/\.stage \.desk\.shut\{[^}]*width:64px/.test(css) && /\.lg-bunk\{flex:0 0 72px;width:72px/.test(css) && /\.lg-beds>\.shut-more\{width:52px/.test(css) && /\.lg-in\{[^}]*gap:6px/.test(css) && /\.lounge\{[^}]*padding:3px 8px 4px/.test(css), 'the CSS sizes match SEAT_W, BUNK_W, MORE_W, GAP and PAD');
ok(/@container lounge \(min-height:100px\)\{[^}]*\}\.lg-t\{[^}]*-webkit-line-clamp:2/.test(css) && /@container lounge \(min-height:150px\)\{[^}]*\}\.lg-t\{-webkit-line-clamp:3/.test(css), 'bubbles: 1 line in a short row, 2 from 100px, 3 from 150px');
ok(/<span class="name lg-name">\$\{esc\(a\.name\)\}<\/span>/.test(app) && /\.desk\.shut \.lg-name\{[^}]*font-size:10\.5px/.test(css), 'each character shows its name (10.5px)');
ok(/<span class="lg-av"\$\{THEME\.sceneKit\(\)==='crew'\?' style="border-radius:0 0 30% 30%"':''\}>\$\{avatar\(a,'seat'\)\}<\/span>/.test(app) && /<span class="lg-av lying">\$\{avatar\(a\)\}<\/span>/.test(app), 'each resting agent is drawn as its own character (avatar, the theme scene kit)');
ok(/const on=SHUT\.turn\(LOUNGE_TURN,list\.length\)/.test(app) && /k=SHUT\.turn\(LOUNGE_TURN,ts\.length\)/.test(app), 'the render and the timer pick the same bubble (FR-055)');
ok(/\.lg-t\{[^}]*font-size:10\.5px/.test(css) && /\.lg-t\{[^}]*transition:opacity \.6s/.test(css), 'bubble text 10.5px, a gentle fade (off with reduced motion, the global rule)');
ok(/\(m\.rolled\|\|\[\]\)\.map\(x=>\[x\.a\.id,x\.k\]\)/.test(app), 'the layout key follows who rests and where');
ok(/function shutReply\(a,n\)\{[^}]*safeExcerpt\(a\.lastOutput,n,fb\)/.test(app), 'the reply line is masked then cut through the one helper (FR-043, spec 041 FR-065), fail closed');
ok(/<button class="desk shut is-\$\{st\} rest-\$\{k\}\$\{crewBed\?' crew-bed':''\}\$\{roll\}" type="button" data-id="\$\{esc\(a\.id\)\}" data-state="\$\{st\}" data-rest="\$\{k\}" aria-pressed/.test(app), 'resting agents are desk buttons with data-id (click, Enter, arrow keys); the state is data-state and the first is-* class, the resting kind is not an is-* class (review of #554: shots-033 reads the first is-*)');
ok(/<button class="desk card is-\$\{st\}[^"]*" data-id="\$\{esc\(a\.id\)\}" data-state="\$\{st\}"/.test(app) && /desk=`<button class="desk is-\$\{st\}[^"]*" data-id="\$\{esc\(a\.id\)\}" data-state="\$\{st\}"/.test(app), 'every desk button (card and full desk) carries its state as data-state');
ok(!/is-recent|is-old/.test(app + css), 'no is-recent / is-old class left (it read as a state)');
/* FR-051 in the page (review of #554): the room rule's input. `away` and `helpersBusy` must come from the agent, not a constant */
const si = (/const shutInput=a=>\(\{([^\n]*)\}\);/.exec(app) || [])[1] || '';
ok(/(^|,)away:isAway\(a\)(,|$)/.test(si), `shutInput: away comes from isAway (at a place or walking back): ${si}`);
ok(/(^|,)helpersBusy:helpersOf\(a\)\.some\(h=>\{const s=vis\(h\);return s!=='done'&&s!=='idle';\}\)(,|$)/.test(si), `shutInput: helpersBusy is true while any helper is not Done or Idle: ${si}`);
ok(/(^|,)state:vis\(a\)(,|$)/.test(si) && /(^|,)paused:!!a\.paused(,|$)/.test(si) && /(^|,)limit:!!a\.limit(,|$)/.test(si) && /(^|,)replied:!!a\.lastOutput(,|$)/.test(si) && /(^|,)since:sinceLast\(a\)(,|$)/.test(si), `shutInput: state, paused, limit, replied and since come from the agent: ${si}`);
const sizes = [...css.slice(css.indexOf('spec 001 FR-051..FR-055')).matchAll(/font-size:([\d.]+)px/g)].map((m) => parseFloat(m[1]));
ok(sizes.length > 5 && sizes.every((s) => s >= 10.5), `no lounge text under 10.5px (${sizes.join(', ')})`);
ok(/\.desk\.shut:hover \.peek,\.desk\.shut:focus-visible \.peek\{display:flex/.test(css), 'hover and keyboard focus open the peek card');

console.log(`[shutters] ${n} checks passed`);
