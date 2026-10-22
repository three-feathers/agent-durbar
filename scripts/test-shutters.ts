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
  PANEL_W: number;
  SLAT_W: number;
  GAP: number;
  width: (nRecent: number, nSlats: number, more: boolean) => number;
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
eq(S.OLD_CAP, 5, 'up to 6 slats; past that 5 and a +N slat');
eq([S.PANEL_W, S.SLAT_W, S.GAP], [136, 40, 6], 'panel 136px, slat 40px, 6px apart (styles.css uses the same)');

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
eq(S.split(L(5), 5, false), { shown: L(5), hidden: [] }, '5 slats: all shown');
eq(S.split(L(6), 5, false), { shown: L(6), hidden: [] }, '6 slats: all shown (never "+1")');
eq(S.split(L(9), 5, false), { shown: L(5), hidden: [5, 6, 7, 8] }, '9 slats: 5 and +4');
eq(S.split(L(9), 5, true), { shown: L(9), hidden: [] }, 'expanded: all');
eq(S.split([], 5, false), { shown: [], hidden: [] }, 'none');

// ---- the group's width (FR-053): what the layout gives up for the squeezed desks ----
eq(S.width(0, 0, false), 0, 'no group, no width');
eq(S.width(1, 0, false), 136, 'one panel');
eq(S.width(1, 2, false), 136 + 2 * 40 + 2 * 6, '1 panel + 2 slats');
eq(S.width(0, 5, true), 6 * 40 + 5 * 6, '5 slats and a +N slat');
eq(S.width(2, 0, false), 2 * 136 + 6, 'two panels');

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
ok(/\$\{shuttersHTML\(r,rolled\)\}<\/div><\/section>`/.test(app) && /<div class="units-in" style="--cols:\$\{cols\}">\$\{mains\.map\(a=>unitHTML\(a,d\)\)\.join\(''\)\}<\/div>\$\{shuttersHTML\(r,rolled\)\}/.test(app), 'the squeezed group sits at the end of the desk row, in both the full and the compact room');
ok(/sw=shutW\(r,rolled\), over=2\*D\.rp\+4\+\(sw\?sw\+D\.gap:0\)/.test(app) && /sw\?Math\.floor\(\(aw-over\+D\.gap\)\/\(D\.cw\+D\.gap\)\):Infinity/.test(app) && /widths=mains\.map\(a=>unitWidth\(a,d\)\)\.concat\(sw\?\[sw\]:\[\]\)/.test(app), 'the room width counts the squeezed group, compact and full (FR-053)');
ok(/w:SHUT\.width\(recent\.length,shown\.length,hidden\.length>0\|\|fewer\)/.test(app), 'the group width comes from shutters.js');
ok(/\.stage \.desk\.shut\.is-recent\{width:136px/.test(css) && /\.stage \.desk\.shut\.is-old\{width:40px/.test(css) && /\.sh-in>\.shut-more\{width:40px/.test(css) && /\.shutters>\.sh-in\{[^}]*gap:6px/.test(css), 'the CSS widths match PANEL_W, SLAT_W and GAP');
ok(/\.desk\.shut\.is-old \.sh-name[^{]*\{writing-mode:vertical-rl;font-size:11\.5px/.test(css), 'the slat name is vertical text at 11.5px');
ok(/\(m\.rolled\|\|\[\]\)\.map\(x=>\[x\.a\.id,x\.k\]\)/.test(app), 'the layout key follows who is rolled and how far');
ok(/L\.excerpt\(a\.lastOutput,R&&typeof R\.redact==='function'\?x=>R\.redact\(x\):null\)/.test(app), 'the reply line is masked on the raw text (FR-043 excerpt), fail closed');
ok(/class="desk shut is-\$\{k\}/.test(app) && /data-id="\$\{esc\(a\.id\)\}" aria-pressed/.test(app), 'strips and chips are desk buttons with data-id (click, Enter, arrow keys)');
ok(/\.desk\.shut \.sh-ago\{font-size:10\.5px/.test(css), 'the smallest shutter text is 10.5px');
const sizes = [...css.slice(css.indexOf('spec 001 FR-051..FR-055')).matchAll(/font-size:([\d.]+)px/g)].map((m) => parseFloat(m[1]));
ok(sizes.length > 5 && sizes.every((s) => s >= 10.5), `no shutter text under 10.5px (${sizes.join(', ')})`);
ok(/\.desk\.shut:hover \.peek,\.desk\.shut:focus-visible \.peek\{display:flex/.test(css), 'hover and keyboard focus unroll');

console.log(`[shutters] ${n} checks passed`);
