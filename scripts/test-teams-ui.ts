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
  actionsOf: (r: Partial<Row>, o?: { full?: boolean }) => { id: string; label: string; disabled?: boolean; why?: string }[];
  summaryText: (r: Partial<Row>) => string;
  refusalText: (r: unknown, what?: string) => string;
  ASIDE_WORDS: string; LOAD_FAILED_WORDS: string; FULL_WORDS: string; EXPORT_WHY: string; MAX_TEMPLATES: number;
  shown: () => boolean;
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

// at the store's limit (review of #1661): Duplicate says why, in the control's own words
const fullActs = T.actionsOf({ origin: 'own' }, { full: true });
const dupF = fullActs.find((a) => a.id === 'duplicate');
ok(dupF && dupF.disabled === true && dupF.why === 'At most 50 templates: delete one first.', 'full: Duplicate is disabled with its reason');
eq(T.actionsOf({ origin: 'starter' }, { full: true }).map((a) => a.id + (a.disabled ? '|off' : '')), ['use', 'duplicate|off'], 'full: a starter keeps Use, loses Duplicate');
eq(T.actionsOf({ origin: 'own' }, { full: false }).filter((a) => a.disabled).length, 1, 'not full: only Export is off');
eq(T.EXPORT_WHY, 'Export comes with import and export, in a later step.', 'the reason of Export');

// the set-aside notice says what happened and no more (the store keeps the valid templates)
eq(T.ASIDE_WORDS, 'The team templates file could not be read, so it was kept aside; templates that could not be read are not in the list.', 'the set-aside words');
eq(T.LOAD_FAILED_WORDS, 'The team templates could not be loaded. Try again.', 'the failed-load words');
ok(!T.shown(), 'the section is not shown before init (and, in the page, only under the simulator)');

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

// the names are text, never markup: no way to run a string from teams.js (a name is the person's, or a file's)
const code = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'teams.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
for (const bad of [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /\beval\b/, /\bFunction\s*\(/, /document\.write/]) ok(!bad.test(code), 'teams.js has no ' + bad.source);

// the page's constant is the store's limit
// eslint-disable-next-line @typescript-eslint/no-var-requires
const shared = require(path.join(ROOT, 'dist', 'shared', 'teamtemplate.js')) as { LIMITS: { templates: number }; CHANGED_TEXT: string };
eq(T.MAX_TEMPLATES, shared.LIMITS.templates, 'the page limit of templates is the store limit');
eq(T.FULL_WORDS, `At most ${shared.LIMITS.templates} templates: delete one first.`, 'the words of the limit follow it');
// main and the simulator say `changed` with one sentence (a shared constant, not a copy)
ok(/import \{[^}]*\bCHANGED_TEXT\b[^}]*\} from '\.\.\/shared\/teamtemplate'/.test(fs.readFileSync(path.join(ROOT, 'src', 'main', 'teamsipc.ts'), 'utf8')), 'teamsipc.ts imports CHANGED_TEXT from the shared module');
ok(!/const CHANGED_TEXT/.test(fs.readFileSync(path.join(ROOT, 'src', 'main', 'teamsipc.ts'), 'utf8')), 'and keeps no copy');
eq(shared.CHANGED_TEXT, 'The team templates file changed while you were editing. It was read again; save once more.', 'the sentence');
// the section is a simulator thing until T009, in both places that decide it
ok(/shown\(\)\{return !!\(X&&X\.sim\)/.test(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'teams.js'), 'utf8')), 'teams.js shows only under X.sim');
ok(/DurbarTeams\.shown\(\)/.test(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'screens.js'), 'utf8')), 'screens.js asks shown()');
ok(/DurbarTeams\.init\(\{bridge,sim:!!SIM/.test(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8')), 'app.js passes the simulator flag');
// the big validator copy is not packaged
ok(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).build.files.includes('!dist/renderer/teamcheck.js'), 'teamcheck.js is left out of the packaged app');
ok(!/role="status"|setAttribute\('role','status'\)[^;]*tmNotice|tmNotice[^;]*role/.test(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'teams.js'), 'utf8')), '#tmNotice has no role (#srAnnounce speaks)');

// wiring: the script is copied, loaded, and the section is in Settings
ok(/'teams\.js'/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8')), 'copy-assets copies teams.js');
const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
ok(html.includes('<script src="teams.js">'), 'teams.js has its tag');
ok(!html.includes('teamcheck.js'), 'the 250 KB validator copy is not in the real page: only the simulator loads it, at its first team call');
ok(/sc\.src = 'teamcheck\.js'/.test(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'sim.ts'), 'utf8')), 'sim.ts loads teamcheck.js itself');
ok(/id="tmH">Team templates</.test(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'screens.js'), 'utf8')), 'Settings has the Team templates heading');
const sim = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'sim.ts'), 'utf8');
ok(/checkTeamTemplate\(draft, 'own'\)/.test(sim), 'the simulator put uses the shared validator');

// the copy name: the page's function is the store's (one shared function), with the cut by grapheme, joiners and the numbered suffix
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { copyName } = require(path.join(ROOT, 'dist', 'shared', 'teamtemplate.js')) as { copyName: (n: string, t: ReadonlySet<string>) => string | null };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nk = (require(path.join(ROOT, 'dist', 'shared', 'skeleton.js')) as { nameKey: (n: string) => string }).nameKey;
eq(copyName('Alpha', new Set()), 'Alpha copy', 'first copy');
eq(copyName('Alpha', new Set([nk('Alpha copy'), nk('Alpha copy 2')])), 'Alpha copy 3', 'numbered while taken');
eq(copyName('Alpha', new Set([nk('Alpha c\u043ey')])), 'Alpha copy', 'a lookalike of another name is not "Alpha copy"');
eq(copyName('Alpha', new Set([nk('Alpha c\u043epy')])), 'Alpha copy 2', 'a Cyrillic-o lookalike of the copy name counts as taken');
eq(Array.from(copyName('x'.repeat(40), new Set()) as string).length, 40, 'cut to the name limit');
eq(copyName('a'.repeat(30) + '\u0915\u094d', new Set()), 'a'.repeat(30) + '\u0915 copy', 'a trailing virama is dropped');
eq(copyName('A', new Set(Array.from({ length: 60 }, (_, i) => nk(i === 0 ? 'A copy' : `A copy ${i + 1}`)))), null, 'no free name is null');

// the page copy of the validator: the real limits and name key
const file = path.join(ROOT, 'dist', 'renderer', 'teamcheck.js');
assert.ok(fs.existsSync(file), 'dist/renderer/teamcheck.js is missing: run `npm run build` first');
const win: Record<string, unknown> = {};
win.self = win;
vm.runInNewContext(fs.readFileSync(file, 'utf8'), win);
const C = win.DurbarTeamCheck as { checkTeamTemplate: (v: unknown, l: 'own' | 'imported') => { ok: boolean; errors?: string[] }; nameKey: (n: string) => string; LIMITS: { members: number } };
ok(C && typeof C.checkTeamTemplate === 'function', 'the page has the validator');
const pageApi = win.DurbarTeamCheck as unknown as { MEMBER_ID_RE: RegExp; copyName: unknown; CHANGED_TEXT: string };
eq(typeof pageApi.copyName, 'function', 'the page has copyName');
eq(pageApi.CHANGED_TEXT, shared.CHANGED_TEXT, 'the page has the same changed sentence');
// one member-id expression: main imports it, the page bundle carries it, nobody keeps a copy (a copy with another {32} would not be caught by the value alone)
eq(pageApi.MEMBER_ID_RE.source, '^[0-9a-f]{32}$', 'the member id expression');
ok(pageApi.MEMBER_ID_RE.test('a'.repeat(32)) && !pageApi.MEMBER_ID_RE.test('a'.repeat(31)) && !pageApi.MEMBER_ID_RE.test('A'.repeat(32)), 'it takes 32 lower-case hex digits only');
for (const f of ['src/main/teamsipc.ts', 'src/renderer/sim.ts', 'src/main/teamstore.ts']) ok(!/\/\^\[0-9a-f\]\{\d+\}\$\//.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), f + ' keeps no copy of the member id expression');
ok(/MEMBER_ID_RE\b[^;]*\} from '\.\.\/shared\/teamtemplate'/.test(fs.readFileSync(path.join(ROOT, 'src', 'main', 'teamsipc.ts'), 'utf8')), 'teamsipc.ts imports MEMBER_ID_RE');
ok(/check\.MEMBER_ID_RE\.test/.test(sim), 'the fake uses the shared one');
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
