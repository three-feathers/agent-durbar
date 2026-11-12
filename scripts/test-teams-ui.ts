/** Spec 111 T008: Settings > Team templates, the pure part of `src/renderer/teams.js` (rows, actions, words) and the page copy of the shared
 *  validator (`dist/renderer/teamcheck.js`, made by `scripts/copy-assets.js`, so run `npm run build` first). `npm run test:teams-ui`. No Electron. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

const ROOT = path.join(__dirname, '..', '..');
type Row = { id: string; name: string; origin: 'starter' | 'own' | 'imported'; originWord: string; count: number; apps: string[] };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const T = require(path.join(ROOT, 'src', 'renderer', 'teams.js')) as {
  rowsOf: (l: unknown, s?: unknown) => Row[];
  actionsOf: (r: Partial<Row>) => { id: string; label: string; disabled?: boolean; why?: string }[];
  summaryText: (r: Partial<Row>) => string;
  refusalText: (r: unknown, what?: string) => string;
};
let checks = 0;
const ok = (c: unknown, m: string): void => { assert.ok(c, m); checks++; };
const eq = (a: unknown, b: unknown, m: string): void => { assert.deepStrictEqual(a, b, m); checks++; };

// rows: starters first, then the person's; one origin word each; junk skipped
const mem = (app: string): { app: string } => ({ app });
const rows = T.rowsOf([{ id: 'a1', name: 'Mine', origin: 'own', members: [mem('x'), mem('y'), mem('x')] }, { id: 'b2', name: 'Theirs', origin: 'imported', members: [mem('x')] }, null, 5],
  [{ id: 's1', name: 'Reviewers', members: [mem('x')] }]);
eq(rows.map((r) => [r.id, r.origin, r.originWord]), [['s1', 'starter', 'Built in'], ['a1', 'own', 'Yours'], ['b2', 'imported', 'Imported']], 'starters first; the three origin words');
eq(rows[1].apps, ['x', 'y'], 'one entry per app');
eq(T.rowsOf(undefined, undefined), [], 'no list is no rows');
eq(T.rowsOf([{ id: 'z', name: 'N', origin: '__proto__', members: 'no' }])[0].origin, 'own', 'an unknown origin word is never shown as one');

// actions: criterion 1 and 4
const labels = (r: Partial<Row>): string[] => T.actionsOf(r).map((a) => a.label);
eq(labels({ origin: 'starter' }), ['Use…', 'Duplicate'], 'a starter shows Use and Duplicate only');
eq(labels({ origin: 'own' }), ['Use…', 'Edit…', 'Duplicate', 'Export…', 'Delete'], 'an own template shows every action');
eq(labels({ origin: 'imported' }), ['Use…', 'Edit…', 'Duplicate', 'Export…', 'Delete'], 'an imported one too');
const exp = T.actionsOf({ origin: 'own' }).find((a) => a.id === 'export');
ok(exp && exp.disabled === true && !!exp.why, 'Export is disabled and says why');
eq(T.actionsOf({ origin: 'own' }).filter((a) => a.disabled).length, 1, 'only Export is disabled');

// words
eq(T.summaryText({ count: 1, apps: ['x'] }), '1 member · x', 'one member');
eq(T.summaryText({ count: 4, apps: ['a', 'b', 'c', 'd', 'e'] }), '4 members · a, b, c and 2 more', 'a long app list is cut');
const secret = 'tok' + 'en-' + 'abcdef123456';
for (const [res, re] of [
  [{ ok: false, code: 'invalid', errors: ['Member 1, name: ' + secret], blocked: false }, /not accepted/],
  [{ ok: false, code: 'changed', errors: [], blocked: false }, /changed somewhere else/],
  [{ ok: false, code: 'failed', errors: [], blocked: false }, /could not be saved/],
  [{ ok: false, code: 'failed', errors: [], blocked: true }, /cannot be read or set aside/],
  [null, /did not work/],
] as [unknown, RegExp][]) {
  const t = T.refusalText(res, 'The copy');
  ok(re.test(t), 'words for ' + JSON.stringify(res && (res as { code: string }).code) + ': ' + t);
  ok(!t.includes(secret) && !/Member 1/.test(t), 'no error text or value reaches the words');
}

// wiring: the script is copied, loaded, and the section is in Settings
ok(/'teams\.js'/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8')), 'copy-assets copies teams.js');
const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
ok(html.includes('<script src="teams.js">') && html.includes('<script src="teamcheck.js">'), 'both scripts have their tag');
ok(html.indexOf('teamcheck.js') < html.indexOf('src="sim.js"'), 'the validator copy loads before the simulator');
ok(/id="tmH">Team templates</.test(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'screens.js'), 'utf8')), 'Settings has the Team templates heading');
const sim = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'sim.ts'), 'utf8');
ok(/checkTeamTemplate\(draft, 'own'\)/.test(sim), 'the simulator put uses the shared validator');

// the page copy of the validator: the real limits and name key
const file = path.join(ROOT, 'dist', 'renderer', 'teamcheck.js');
assert.ok(fs.existsSync(file), 'dist/renderer/teamcheck.js is missing: run `npm run build` first');
const win: Record<string, unknown> = {};
win.self = win;
vm.runInNewContext(fs.readFileSync(file, 'utf8'), win);
const C = win.DurbarTeamCheck as { checkTeamTemplate: (v: unknown, l: 'own' | 'imported') => { ok: boolean; errors?: string[] }; nameKey: (n: string) => string; LIMITS: { members: number } };
ok(C && typeof C.checkTeamTemplate === 'function', 'the page has the validator');
const member = (i: number): Record<string, unknown> => ({ name: 'M' + i, role: 'Dev', app: 'x', permMode: 'read-only', sendBrief: false });
const real = require(path.join(ROOT, 'dist', 'shared', 'teamtemplate.js')) as typeof C & { LIMITS: { members: number } };
const skel = require(path.join(ROOT, 'dist', 'shared', 'skeleton.js')) as { nameKey: (n: string) => string };
eq(C.LIMITS.members, real.LIMITS.members, 'the page limit is the real limit');
const nine = { name: 'T', members: Array.from({ length: C.LIMITS.members + 1 }, (_, i) => member(i)) };
ok(C.checkTeamTemplate(nine, 'own').ok === false, 'more members than the limit are refused');
ok(C.checkTeamTemplate({ name: 'T', members: nine.members.slice(0, C.LIMITS.members) }, 'own').ok === true, 'the limit itself is fine');
eq(JSON.parse(JSON.stringify(C.checkTeamTemplate(nine, 'own'))), JSON.parse(JSON.stringify(real.checkTeamTemplate(nine, 'own'))), 'the page and main refuse the same way');
eq(C.nameKey('Réview'), skel.nameKey('Réview'), 'the same name key');
eq(C.nameKey('Réview'), C.nameKey('Réview'), 'an NFD spelling is the same name');
console.log(`test-teams-ui: ${checks} checks passed`);
