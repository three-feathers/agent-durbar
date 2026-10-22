/**
 * Finished agents roll in (spec 001 FR-051..FR-053, FR-057): which agents roll in (recent, old, never), the room rule and the "+N" split of
 * `src/renderer/shutters.js`, plus the source checks that keep the page wired to it (rolled agents leave the layout search, the shutter
 * row is in both densities, the key follows the roll, the reply line is masked). `npm run test:shutters`. No credits spent.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';

const R = path.join(__dirname, '..', '..', 'src', 'renderer');
type X = { id: string; state: string; paused?: boolean; limit?: boolean; away?: boolean; replied?: boolean; helpersBusy?: boolean; since?: number | null };
const S = require(path.join(R, 'shutters.js')) as {
  RECENT_MS: number;
  OLD_CAP: number;
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
eq(S.OLD_CAP, 4, 'four old chips before +N');

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
eq(plan([w('a'), w('b'), f('c', MIN), f('d', 20 * MIN), f('e', 40 * MIN)]), { c: 'recent', d: 'old', e: 'old' }, '2 working + 3 finished: 1 strip, 2 chips');
eq(plan([f('c', MIN), f('d', 20 * MIN)]), {}, 'a room of only finished agents stays as it is');
eq(plan([f('c', MIN)]), {}, 'a lone finished agent stays as it is');
eq(plan([w('a', 'waiting'), f('c', MIN)]), { c: 'recent' }, 'a waiting agent keeps the room open');
eq(plan([w('a', 'error'), f('c', 30 * MIN)]), { c: 'old' }, 'an error keeps the room open');
eq(plan([{ id: 'a', state: 'idle', replied: false, since: null }, f('c', MIN)]), { c: 'recent' }, 'an idle agent that never ran keeps its desk, so the room rolls');
eq(plan([Object.assign(f('a', MIN), { paused: true }), f('c', MIN)]), { c: 'recent' }, 'a paused finished agent keeps its desk');
eq(plan([Object.assign(f('a', MIN), { helpersBusy: true }), f('c', MIN)]), { c: 'recent' }, 'a finished agent with a busy helper keeps its desk');
eq(plan([]), {}, 'an empty room');
eq(plan(undefined as unknown as X[]), {}, 'no list');

// ---- the old chips and "+N" (FR-052, the helper strip's rule: never "+1") ----
const L = (k: number): number[] => Array.from({ length: k }, (_, i) => i);
eq(S.split(L(4), 4, false), { shown: L(4), hidden: [] }, '4 chips: all shown');
eq(S.split(L(5), 4, false), { shown: L(5), hidden: [] }, '5 chips: all shown (never "+1")');
eq(S.split(L(7), 4, false), { shown: L(4), hidden: [4, 5, 6] }, '7 chips: 4 and +3');
eq(S.split(L(7), 4, true), { shown: L(7), hidden: [] }, 'expanded: all');
eq(S.split([], 4, false), { shown: [], hidden: [] }, 'none');

// ---- spoken time (FR-054) ----
eq(S.spoken('just now'), 'just now', 'just now');
eq(S.spoken('1 min ago'), '1 minute ago', 'one minute');
eq(S.spoken('12 min ago'), '12 minutes ago', 'minutes');
eq(S.spoken('3 h ago'), '3 hours ago', 'hours');
eq(S.spoken('1 d ago'), '1 day ago', 'one day');
eq(S.spoken(''), '', 'unknown');

// ---- the page uses it (source checks; the layout itself is checked in the browser by check:office and check:office-fill) ----
const app = fs.readFileSync(path.join(R, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(R, 'styles.css'), 'utf8');
const ok = (c: boolean, m: string): void => { assert.ok(c, m); n++; };
ok(/const mains=shown\.filter\(a=>!plan\.has\(a\.id\)\)/.test(app), 'officeModel: rolled agents are not desks in the layout search (FR-053)');
ok(/function shutPlan\(r\)\{\s*if\(!shutOn\(\)\)return new Map\(\);\s*return SHUT\.roomPlan\(agents\.filter\(a=>!a\.parent&&a\.room===r\.id\)\.map\(shutInput\)\)/.test(app), 'the room rule reads the whole room, not the status filter, and the setting turns it off');
ok(/\$\{shuttersHTML\(r,rolled\)\}<\/div><\/section>`/.test(app) && /\$\{shuttersHTML\(r,rolled,free\|\|cols,!free&&mains\.length>0\)\}<\/div><\/section>`/.test(app), 'the shutter group is in both the full and the compact room');
ok(/cols=Math\.max\(1,Math\.min\(shutSlots\(\{mains,rolled\}\),cap\)\)/.test(app) && (app.match(/Math\.max\(\.\.\.openOnly\.map\(shutSlots\)\)/g) || []).length === 2, 'the rolled agents of a room take one grid slot, in the room and in both layout searches');
ok(/\(m\.rolled\|\|\[\]\)\.map\(x=>\[x\.a\.id,x\.k\]\)/.test(app), 'the layout key follows who is rolled and how far');
ok(/L\.excerpt\(a\.lastOutput,R&&typeof R\.redact==='function'\?x=>R\.redact\(x\):null\)/.test(app), 'the reply line is masked on the raw text (FR-043 excerpt), fail closed');
ok(/class="desk shut is-\$\{k\}/.test(app) && /data-id="\$\{esc\(a\.id\)\}" aria-pressed/.test(app), 'strips and chips are desk buttons with data-id (click, Enter, arrow keys)');
ok(/\.desk\.shut \.sh-ago\{font-size:10\.5px/.test(css), 'the smallest shutter text is 10.5px');
const sizes = [...css.slice(css.indexOf('spec 001 FR-051..FR-055')).matchAll(/font-size:([\d.]+)px/g)].map((m) => parseFloat(m[1]));
ok(sizes.length > 5 && sizes.every((s) => s >= 10.5), `no shutter text under 10.5px (${sizes.join(', ')})`);
ok(/\.desk\.shut:hover \.peek,\.desk\.shut:focus-visible \.peek\{display:flex/.test(css), 'hover and keyboard focus unroll');

console.log(`[shutters] ${n} checks passed`);
