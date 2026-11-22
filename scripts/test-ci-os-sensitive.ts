/**
 * Unit test (spec 117 FR-012, O2; T045): the `os_sensitive` output of .github/scripts/ci-changes.js, which decides whether a pull
 * request's diff starts the Windows UI shards of ui-platforms.yml. It FAILS CLOSED: only a plain path on the OS-neutral list that no
 * OS-sensitive line names is neutral, an empty diff is sensitive, and the base branch's copy decides (ci-changes.sh), with a missing or
 * inexact output read as true. Each rule has a fixture here and a mutant (a changed copy of ci-changes.js or ci-changes.sh) that dies at
 * its own labelled assert. In-memory trees, a throwaway git repository for the wrapper; no network, no Electron, no shell strings.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const ROOT = path.join(__dirname, '..', '..');
const FILE = path.join(ROOT, '.github', 'scripts', 'ci-changes.js');
interface Io { read(p: string): string | null; readBase(p: string): string | null; isFile(p: string): boolean; isDir(p: string): boolean }
type Cc = { osSensitive: (files: unknown, io: Io) => boolean; gitIo: (root: string) => Io };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cc = require(FILE) as Cc;

// ---- a small tree: src/shared and src/adapters files with and without OS modules (head and base kept apart) ----
const head: Record<string, string> = {
  'src/shared/pure.ts': "import type { A } from './types';\nexport const x = (a: A) => a;\n",
  'src/shared/types.ts': 'export type A = number;\n',
  'src/adapters/pure.ts': "import { x } from '../shared/pure';\nexport const y = x;\n",
  'src/shared/usesfs.ts': "import * as fs from 'fs';\nexport const r = fs.readFileSync;\n",
  'src/shared/via-helper.ts': "import { r } from './usesfs';\nexport const z = r;\n",
  'src/shared/node-prefix.ts': "const p = require('node:path');\nmodule.exports = p.join;\n",
  'src/shared/subpath.ts': "import { readFile } from 'fs/promises';\nexport { readFile };\n",
  'src/shared/platform.ts': "export const win = process.platform === 'win32';\n",
  'src/shared/json-import.ts': "const data = require('./data.json');\nexport default data;\n",
  'src/shared/outside.ts': "import { q } from '../../scripts/helper';\nexport default q;\n",
  'src/shared/fs-removed.ts': 'export const nothing = 1;\n',
};
const base: Record<string, string> = {
  'src/shared/fs-removed.ts': "import * as fs from 'fs';\nexport const nothing = fs;\n",
  'src/shared/deleted-pure.ts': 'export const gone = 1;\n',
};
const fakeIo: Io = {
  read: (p) => (p in head ? head[p] : null),
  readBase: (p) => (p in base ? base[p] : p in head ? head[p] : null),
  isFile: (p) => p in head,
  isDir: () => false,
};

const SENSITIVE: Array<[string, string]> = [
  // the main process, preload, build and packaging, dependencies, CI files, unknown paths
  ['src/main/main.ts', 'main process'], ['src/main/appmenu.ts', 'main process (the app menu)'], ['src/preload/preload.ts', 'preload'],
  ['build/icon.icns', 'build'], ['package.json', 'dependencies'], ['package-lock.json', 'lockfile'], ['electron-builder.yml', 'electron-builder config'],
  ['tsconfig.json', 'compiler config'], ['.github/workflows/ci.yml', 'a workflow'], ['.github/scripts/ci-changes.js', 'the decision itself'],
  ['.github/actions/npm-ci/action.yml', 'a CI action'], ['scripts/after-pack.js', 'a packaging script'], ['scripts/fakes/claude.js', 'a fake agent CLI'],
  ['scripts/run-tests.js', 'the test runner'], ['zz/new.js', 'an unknown folder'], ['LICENSE', 'an unknown top-level file'], ['scripts/fixtures', 'a file named like a neutral folder'],
  // OS-sensitive lines inside the neutral prefixes
  ['src/renderer/keys.js', 'the shortcut keys'], ['src/renderer/browserpane.js', 'the browser pane'], ['src/renderer/fonts/x.woff2', 'a font'],
  ['docs/site/fonts/x.ttf', 'a font under docs'], ['scripts/driver-helpers.js', 'the driver helpers'], ['scripts/ui-suite.js', 'the suite runner'],
  ['scripts/check-office-overlap.js', 'the office layout check'], ['scripts/check-theme-geometry.js', 'theme geometry'], ['scripts/check-parallel.js', 'the office job runner'],
  ['docs/agent-setup/setup.sh', 'a shell script under docs'], ['src/renderer/x.ps1', 'a PowerShell script'], ['scripts/test-x.sh', 'a shell test'],
  // src/shared and src/adapters that use an OS module, or cannot be read
  ['src/shared/usesfs.ts', 'imports fs'], ['src/shared/via-helper.ts', 'imports a file that imports fs'], ['src/shared/node-prefix.ts', "requires 'node:path'"],
  ['src/shared/subpath.ts', "imports 'fs/promises'"], ['src/shared/platform.ts', 'reads process.platform'], ['src/shared/json-import.ts', 'an import that resolves to no source file'],
  ['src/shared/outside.ts', 'an import that leaves src/'], ['src/shared/fs-removed.ts', 'its base used fs'], ['src/shared/never-was.ts', 'unreadable on both sides'],
  ['src/shared/data.json', 'a non-source file in src/shared'],
  // case tricks (one folder on a case-insensitive checkout)
  ['Src/renderer/app.js', 'case: Src/'], ['src/Renderer/app.js', 'case: Renderer/'], ['SRC/main/x.ts', 'case: SRC/main'], ['Docs/a.md', 'case: Docs/'],
  ['src/renderer/KEYS.js', 'case: KEYS.js'], ['src/renderer/BrowserPane.js', 'case: BrowserPane.js'], ['scripts/Driver-Helpers.js', 'case: Driver-Helpers.js'], ['scripts/check-Office-Overlap.js', 'case: check-Office-Overlap.js'],
  ['src/renderer/x.WOFF2', 'case: .WOFF2'], ['docs/X.SH', 'case: .SH'], ['Scripts/shots-001-welcome.js', 'case: Scripts/'],
  // odd paths
  ['src/renderer/../main/x.ts', 'a .. segment'], ['./src/renderer/a.js', 'a leading ./'], ['src/renderer/./a.js', 'a . segment'], ['src//renderer/a.js', 'an empty segment'],
  ['/src/renderer/a.js', 'absolute'], [' src/renderer/a.js', 'a leading blank'], ['src/renderer/a.js ', 'a trailing blank'], ['docs/..\\src\\main\\x.ts', 'backslashes (src/main on Windows)'],
  ['src\\main\\x.ts', 'backslashes into src/main'], ['src/renderer/a\u0007.js', 'a control character'], ['src/renderer/a.js\n', 'a newline'], ['', 'an empty name'],
];
const NEUTRAL: Array<[string, string]> = [
  ['docs/a.md', 'docs'], ['specs/117-delivery-speed-2/spec.md', 'specs'], ['changelog.d/x.md', 'a changelog fragment'], ['README.md', 'top-level Markdown'],
  ['src/renderer/app.js', 'a renderer module'], ['src/renderer/styles.css', 'renderer styles'], ['src/renderer/realoffice/sets/office/a.webp', 'a renderer picture'],
  ['scripts/shots-001-welcome.js', 'a driver'], ['scripts/check-office-ops.js', 'a check driver'], ['scripts/test-ci-changes.ts', 'a unit test'],
  ['scripts/fixtures/themes/check-dark.json', 'a fixture'], ['src/shared/pure.ts', 'a src/shared file with no OS module'],
  ['src/adapters/pure.ts', 'a src/adapters file importing a pure shared file'], ['src/shared/deleted-pure.ts', 'a deleted src/shared file that used no OS module'],
];

/** Every way a copy of the decision gets os_sensitive wrong, as labels; empty = right. */
function problems(c: Cc): string[] {
  const bad: string[] = [];
  for (const [f, why] of SENSITIVE) {
    if (!c.osSensitive([f], fakeIo)) bad.push(`${JSON.stringify(f)} (${why}) is neutral`);
    if (!c.osSensitive(['docs/a.md', f], fakeIo)) bad.push(`${JSON.stringify(f)} (${why}) beside a doc is neutral`);
  }
  for (const [f, why] of NEUTRAL) if (c.osSensitive([f], fakeIo)) bad.push(`${f} (${why}) is sensitive`);
  if (c.osSensitive(NEUTRAL.map(([f]) => f), fakeIo)) bad.push('the neutral paths together are sensitive');
  if (!c.osSensitive([], fakeIo)) bad.push('an empty diff is neutral');
  if (!c.osSensitive(undefined, fakeIo) || !c.osSensitive('docs/a.md', fakeIo)) bad.push('a diff that is not a list is neutral');
  return bad;
}
assert.deepStrictEqual(problems(cc), [], 'FR-012: os_sensitive is false only for a non-empty diff of plain, OS-neutral paths');

// the real tree: the spec's named files, a real src/shared file that uses fs, and a renderer-only diff
{
  const real = cc.gitIo(ROOT);
  for (const f of ['src/main/appmenu.ts', 'src/renderer/keys.js', 'src/renderer/browserpane.js', 'src/shared/pathdirs.ts', 'src/preload/preload.ts', 'package.json']) {
    assert.ok(fs.existsSync(path.join(ROOT, ...f.split('/'))), `the real tree has ${f}`);
    assert.strictEqual(cc.osSensitive([f], real), true, `real tree: ${f} is OS-sensitive`);
  }
  assert.strictEqual(cc.osSensitive(['src/renderer/app.js', 'src/renderer/styles.css', 'scripts/shots-001-welcome.js', 'docs/development.md'], real), false, 'real tree: a renderer feature with its driver and docs is not OS-sensitive');
}

// ---- mutants of the decision: each dies at its own assert ----
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require('module') as { new (id: string, parent: unknown): { filename: string; paths: string[]; exports: unknown; _compile(src: string, file: string): void }; _nodeModulePaths(dir: string): string[] };
const source = fs.readFileSync(FILE, 'utf8');
function variant(from: string, to: string): Cc {
  assert.strictEqual(source.split(from).length - 1, 1, `mutant anchor occurs once: ${from}`);
  const m = new Module(FILE, null);
  m.filename = FILE; m.paths = Module._nodeModulePaths(path.dirname(FILE));
  m._compile(source.replace(from, () => to), FILE);
  return m.exports as Cc;
}
const NEUTRAL_RE = "const OS_NEUTRAL = /^(docs\\/|specs\\/|changelog\\.d\\/|src\\/renderer\\/|scripts\\/fixtures\\/|scripts\\/(test|shots|check)-[\\w.-]+\\.(ts|js)$)|^[^/]+\\.md$/;";
const KEYS = '/^src\\/renderer\\/(keys|browserpane)\\.js$/i,';
const FONTS = '/\\.(ttf|otf|woff2?|ttc)$/i,';
const PLUMBING = '/^scripts\\/(driver-helpers|ui-suite|check-parallel|check-office-overlap|check-theme-geometry|check-mac-titlebar)\\.js$/i,';
const SHELL = '/\\.(sh|ps1|cmd|bat)$/i,';
const mutants: Array<[string, Cc, RegExp]> = [
  ['all of src/ neutral', variant(NEUTRAL_RE, NEUTRAL_RE.replace('src\\/renderer\\/', 'src\\/')), /^"src\/main\/main\.ts" \(main process\) is neutral$/],
  ['any top-level file neutral', variant(NEUTRAL_RE, NEUTRAL_RE.replace('^[^/]+\\.md$', '^[^/]+$')), /^"package\.json" \(dependencies\) is neutral$/],
  ['every scripts/ file neutral', variant(NEUTRAL_RE, NEUTRAL_RE.replace('scripts\\/fixtures\\/|', 'scripts\\/|')), /^"scripts\/after-pack\.js" \(a packaging script\) is neutral$/],
  ['.github/ neutral', variant(NEUTRAL_RE, NEUTRAL_RE.replace('^(docs\\/|', '^(\\.github\\/|docs\\/|')), /^"\.github\/scripts\/ci-changes\.js" \(the decision itself\) is neutral$/],
  ['neutral list in any case', variant(NEUTRAL_RE, NEUTRAL_RE.replace(/\/;$/, '/i;')), /^"Src\/renderer\/app\.js" \(case: Src\/\) is neutral$/],
  ['keys.js dropped', variant(KEYS, KEYS.replace('keys|', '')), /^"src\/renderer\/keys\.js" \(the shortcut keys\) is neutral$/],
  ['browserpane.js dropped', variant(KEYS, KEYS.replace('|browserpane', '')), /^"src\/renderer\/browserpane\.js" \(the browser pane\) is neutral$/],
  ['the keys line case-sensitive', variant(KEYS, KEYS.replace(/\/i,$/, '/,')), /^"src\/renderer\/KEYS\.js" \(case: KEYS\.js\) is neutral$/],
  ['fonts dropped', variant(FONTS, '/$^/,'), /^"src\/renderer\/fonts\/x\.woff2" \(a font\) is neutral$/],
  ['fonts case-sensitive', variant(FONTS, FONTS.replace(/\/i,$/, '/,')), /^"src\/renderer\/x\.WOFF2" \(case: \.WOFF2\) is neutral$/],
  ['driver plumbing dropped', variant(PLUMBING, '/$^/,'), /^"scripts\/check-office-overlap\.js" \(the office layout check\) is neutral$/],
  ['driver plumbing case-sensitive', variant(PLUMBING, PLUMBING.replace(/\/i,$/, '/,')), /^"scripts\/check-Office-Overlap\.js" \(case: check-Office-Overlap\.js\) is neutral$/],
  ['shell scripts dropped', variant(SHELL, '/$^/,'), /^"docs\/agent-setup\/setup\.sh" \(a shell script under docs\) is neutral$/],
  ['odd paths not refused', variant("const osPlainPath = (f) => typeof f === 'string' &&", "const osPlainPath = (f) => true || typeof f === 'string' &&"), /^"src\/renderer\/\.\.\/main\/x\.ts" \(a \.\. segment\) is neutral$/],
  ['backslashes allowed', variant("!/[\\\\\\u0000-\\u001f\\u007f]/.test(f)", "!/[\\u0000-\\u001f\\u007f]/.test(f)"), /^"docs\/\.\.\\\\src\\\\main\\\\x\.ts" \(backslashes \(src\/main on Windows\)\) is neutral$/],
  ['an empty diff neutral', variant('return list.length === 0 || list.some', 'return list.some'), /^an empty diff is neutral$/],
  ['one neutral path is enough (every, not some)', variant('list.some((f) => osPath(f, io))', 'list.every((f) => osPath(f, io))'), /^"src\/main\/main\.ts" \(main process\) beside a doc is neutral$/],
  ['a non-list diff neutral', variant('const list = Array.isArray(files) ? files : [];', 'const list = Array.isArray(files) ? files : [files].filter(Boolean);'), /^a diff that is not a list is neutral$/],
  ['src/shared not read', variant('if (OS_SHARED.test(f)) return sharedUsesOs(f, io);', 'if (OS_SHARED.test(f)) return false;'), /^"src\/shared\/usesfs\.ts" \(imports fs\) is neutral$/],
  ['the base text not read', variant('const texts = [io.read(p), io.readBase(p)]', 'const texts = [io.read(p)]'), /^"src\/shared\/fs-removed\.ts" \(its base used fs\) is neutral$/],
  ['imports not followed', variant('        todo.push(hit);\n', '\n'), /^"src\/shared\/via-helper\.ts" \(imports a file that imports fs\) is neutral$/],
  ['an unresolved import allowed', variant('if (!hit) return true;', 'if (!hit) continue;'), /^"src\/shared\/json-import\.ts" \(an import that resolves to no source file\) is neutral$/],
  ['an import out of src/ allowed', variant("if (!rel.startsWith('src/')) return true;", "if (!rel.startsWith('src/')) continue;"), /^"src\/shared\/outside\.ts" \(an import that leaves src\/\) is neutral$/],
  ['node: prefix missed', variant("['\"`](?:node:)?(?:fs|", "['\"`](?:fs|"), /^"src\/shared\/node-prefix\.ts" \(requires 'node:path'\) is neutral$/],
  ['module subpaths missed', variant('(?:\\/[\\w/]*)?[\'"`]', '[\'"`]'), /^"src\/shared\/subpath\.ts" \(imports 'fs\/promises'\) is neutral$/],
  ['process.platform missed', variant('\\bprocess\\s*\\.\\s*(?:platform|', '\\bprocess\\s*\\.\\s*(?:'), /^"src\/shared\/platform\.ts" \(reads process\.platform\) is neutral$/],
  ['unreadable on both sides allowed', variant('if (!texts.length) return true;', 'if (!texts.length) continue;'), /^"src\/shared\/never-was\.ts" \(unreadable on both sides\) is neutral$/],
  ['nothing neutral (Windows on every PR)', variant(NEUTRAL_RE, 'const OS_NEUTRAL = /$^/;'), /^src\/renderer\/app\.js \(a renderer module\) is sensitive$/],
];
for (const [name, c, want] of mutants) {
  const bad = problems(c);
  assert.ok(bad.some((b) => want.test(b)), `mutant "${name}" dies at its own assert (got: ${bad.slice(0, 3).join('; ') || 'nothing'})`);
}

// ---- the wrapper (ci-changes.sh) on a throwaway repository: the BASE copy decides, a missing or inexact output is true ----
let haveBash = true;
try { execFileSync('bash', ['-c', 'exit 0'], { stdio: 'ignore', shell: false }); } catch { haveBash = false; }
if (haveBash) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-os-'));
  const wrapper = fs.readFileSync(path.join(ROOT, '.github', 'scripts', 'ci-changes.sh'), 'utf8');
  const write = (repo: string, rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(repo, ...rel.split('/'))), { recursive: true }); fs.writeFileSync(path.join(repo, ...rel.split('/')), text); };
  const git = (repo: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...a], { cwd: repo, stdio: 'ignore', shell: false });
  let n = 0;
  /** A repository whose base commit holds `decision` as ci-changes.js (and the wrapper under test), then a PR commit of `change`. */
  const repoWith = (decision: string, change: Record<string, string>, sh = wrapper): string => {
    const repo = path.join(tmp, `r${n++}`);
    fs.mkdirSync(repo);
    write(repo, '.github/scripts/ci-changes.js', decision);
    write(repo, '.github/scripts/ci-changes.sh', sh);
    write(repo, 'scripts/safe-print.js', fs.readFileSync(path.join(ROOT, 'scripts', 'safe-print.js'), 'utf8'));
    write(repo, 'src/renderer/app.js', '// app\n');
    git(repo, 'init', '-q'); git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'base');
    for (const [rel, text] of Object.entries(change)) write(repo, rel, text);
    git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'the pull request');
    return repo;
  };
  const bash = (repo: string, ev = 'pull_request'): string => {
    const out = path.join(tmp, `out${n++}`);
    execFileSync('bash', [path.join('.github', 'scripts', 'ci-changes.sh')], { cwd: repo, env: { ...process.env, EVENT_NAME: ev, GITHUB_OUTPUT: out }, stdio: 'ignore', shell: false });
    return fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  };
  const lastOs = (text: string): string | null => { const ls = text.split('\n').filter((l) => l.startsWith('os_sensitive=')); return ls.length ? ls[ls.length - 1] : null; };
  const realDecision = source;
  // a renderer-only PR: the real base copy says false
  assert.strictEqual(lastOs(bash(repoWith(realDecision, { 'src/renderer/app.js': '// app, changed\n' }))), 'os_sensitive=false', 'wrapper: a renderer-only pull request is not OS-sensitive');
  // the PR edits the decision to always say false and changes src/main: the base copy runs, so true
  const liar = "require('fs').appendFileSync(process.env.GITHUB_OUTPUT, 'code=true\\nthemes=false\\nui=true\\nmacos=true\\nos_sensitive=false\\n');\n";
  const edited = repoWith(realDecision, { '.github/scripts/ci-changes.js': liar, 'src/main/main.ts': '// main\n' });
  assert.strictEqual(lastOs(bash(edited)), 'os_sensitive=true', 'wrapper: a PR that edits ci-changes.js to say false still gets the base decision (true)');
  // mutant: a wrapper that runs the PR's own copy is fooled
  const RUN_BASE = 'node "$tmp/.github/scripts/ci-changes.js" --root .';
  assert.strictEqual(wrapper.split(RUN_BASE).length - 1, 1, 'mutant anchor: the wrapper runs the base copy');
  const prCopy = repoWith(realDecision, { '.github/scripts/ci-changes.js': liar, 'src/main/main.ts': '// main\n' }, wrapper.replace(RUN_BASE, 'node .github/scripts/ci-changes.js --root .'));
  assert.strictEqual(lastOs(bash(prCopy)), 'os_sensitive=false', 'mutant: a wrapper running the PR copy says false (so running the base copy is what keeps it true)');
  // a base copy older than the output (it writes the four old lines only), or one whose value is not exact: true is appended
  const old = "require('fs').appendFileSync(process.env.GITHUB_OUTPUT, 'code=true\\nthemes=false\\nui=true\\nmacos=true\\n');\n";
  const says = (v: string) => `require('fs').appendFileSync(process.env.GITHUB_OUTPUT, 'code=true\\nthemes=false\\nui=true\\nmacos=true\\nos_sensitive=${v}\\n');\n`;
  const docs = { 'docs/a.md': 'x\n' };
  assert.strictEqual(lastOs(bash(repoWith(old, docs))), 'os_sensitive=true', 'wrapper: a base copy that writes no os_sensitive line gets true');
  for (const v of ['FALSE', 'False', 'false ', '', 'no', '0']) assert.strictEqual(lastOs(bash(repoWith(says(v), docs))), 'os_sensitive=true', `wrapper: os_sensitive=${JSON.stringify(v)} is not exact: true`);
  assert.strictEqual(bash(repoWith(says('false'), docs)), 'code=true\nthemes=false\nui=true\nmacos=true\nos_sensitive=false\n', 'wrapper: an exact false is kept as it is (nothing appended)');
  assert.strictEqual(bash(repoWith(says('true'), docs)), 'code=true\nthemes=false\nui=true\nmacos=true\nos_sensitive=true\n', 'wrapper: an exact true is kept as it is');
  // mutant: without the guard, a base copy with no os_sensitive line leaves the output missing
  const guard = /\n# spec 117 FR-012 \(T045\)[^]*?\nfi\n$/;
  assert.ok(guard.test(wrapper), 'mutant anchor: the os_sensitive guard ends the wrapper');
  assert.strictEqual(lastOs(bash(repoWith(old, docs, wrapper.replace(guard, '\n')))), null, 'mutant: without the guard the output has no os_sensitive (so the guard is what writes true)');
  // every other event: true from the wrapper itself
  for (const ev of ['push', 'merge_group', 'schedule', 'workflow_dispatch', '']) assert.strictEqual(lastOs(bash(repoWith(realDecision, docs), ev)), 'os_sensitive=true', `wrapper: ${ev || 'no event'} gives os_sensitive=true`);
  fs.rmSync(tmp, { recursive: true, force: true });
} else console.log('ci-os-sensitive: bash not found, the wrapper part is skipped here (CI runs it on every OS)');

console.log(`ci-os-sensitive: ok (${SENSITIVE.length} sensitive and ${NEUTRAL.length} neutral fixtures, ${mutants.length} mutants${haveBash ? ', wrapper' : ''})`);
