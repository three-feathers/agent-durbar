/**
 * Unit test (spec 117 FR-020, FR-021, T013): scripts/review-profile.js, the one light list; everything else is heavy.
 * A table of changed-path lists with the expected profile, then mutants of the classifier (a widened light list, a dropped heavy
 * veto, renames ignored, the sink rule dropped, one light file hiding a heavy one): each must fail its own named cases.
 * One throwaway git repo in the OS temp dir (head reader); no network, no Electron.
 */
import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as cp from 'child_process';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rp = require(path.join(__dirname, '..', '..', 'scripts', 'review-profile.js')) as {
  createProfile: (c?: Record<string, unknown>) => { classify: (e: Entry[], ctx?: { readFile?: (p: string) => string }) => { profile: string; files: { path: string; profile: string }[] } };
  DEFAULT_CONFIG: { lightRules: Rule[]; heavyVeto: Rule[]; sinkPatterns: RegExp[]; combine: (r: { profile: string }[]) => string };
  validRef: (r: string) => boolean;
  headReader: (head: string, cwd: string) => (p: string) => string;
};
interface Rule { name: string; test: (p: string) => boolean; content?: boolean; loads?: boolean }
type Entry = string | { status: string; path: string; oldPath?: string; patch?: string };

const ui = (s: string): string => `diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n${s}\n`;
const FILES: Record<string, string> = {
  'scripts/check-safe.js': "const x = require('../dist/renderer/theme.js'); // src/renderer/theme.js",
  'scripts/check-loads-main.js': "require('../src/main/convmask.ts')",
  'scripts/check-loads-url.js': "require('../src/shared/url.ts')",
  'scripts/test-plain.ts': "import * as a from 'assert'; // loads src/renderer/office.js",
  'scripts/test-loads-ipc.ts': "import { x } from '../src/main/ipc/x';",
  'scripts/test-loads-gh.ts': "require('./gh-trusted.sh')",
  'scripts/test-safetext.ts': "const S = require(path.join(R, 'safetext.js'));",
  'scripts/test-lookalike-links.ts': "const L = require(path.join(R, 'lookalike.js'));",
  'scripts/test-unlisted-module.ts': "const L = require(path.join(R, 'sandboxtext.js'));",
  'scripts/check-loads-office.js': "const L = require(path.join(R, 'office.js'));",
};
const readFile = (p: string): string => {
  if (/^scripts\/test-[a-z-]+-thing\.ts$/.test(p)) return "import * as a from 'assert';";
  if (!(p in FILES)) throw new Error('unreadable');
  return FILES[p];
};

interface Case { name: string; entries: Entry[]; want: 'heavy' | 'light'; ctx?: boolean }
const CASES: Case[] = [
  // an unlisted file under each heavy root
  ...['src/main/unlisted.ts', 'src/shared/unlisted.ts', 'src/preload/unlisted.ts', 'src/adapters/unlisted.ts', 'scripts/unlisted-trusted.js', 'scripts/foo.sh', '.github/unlisted.md', '.github/workflows/ci.yml']
    .map((p): Case => ({ name: `heavy root: ${p}`, entries: [p], want: 'heavy' })),
  ...['src/main/ipc/x.ts', 'src/main/convmask.ts', 'src/shared/url.ts', 'scripts/gh-trusted.sh', 'scripts/pr-gate.sh', 'scripts/safe-print.js', 'scripts/trusted-authors.txt', 'scripts/claim.sh', 'package.json', 'package-lock.json', 'AGENTS.md', 'CLAUDE.md', 'build/icon.png', 'docs/rules/merge-mechanics.md', 'docs/agent-setup/README.md', 'docs/site/app.js', 'docs/site/index.html', 'docs/site/a.css', 'docs/site/logo.svg', 'docs/pic.svg', 'src/renderer/index.html', 'src/renderer/charencoder.html', 'src/renderer/sub/x.html', 'scripts/some-new-thing.js', 'brand-new-root/file.md', 'src/renderer/office.ts', 'SRC/MAIN/X.ts', 'DOCS/RULES/x.md', 'docs/../src/main/x.ts', '']
    .map((p): Case => ({ name: `heavy path: ${p}`, entries: [p], want: 'heavy' })),
  // light
  ...['docs/guide.md', 'docs/site/blog/post.md', 'docs/site/data.json', 'docs/screenshots/a.png', 'specs/117-x/spec.md', 'changelog.d/117-x.md', 'README.md', 'CHANGELOG.md', 'src/renderer/theme.css', 'src/renderer/styles/office.css', 'src/renderer/assets/a.webp', 'src/renderer/assets/a.woff2', 'src/renderer/sound/a.ogg']
    .map((p): Case => ({ name: `light path: ${p}`, entries: [p], want: 'light' })),
  { name: 'docs-only PR', entries: ['docs/a.md', 'specs/x/tasks.md', 'changelog.d/x.md'], want: 'light' },
  { name: 'css-only PR', entries: ['src/renderer/a.css', 'src/renderer/b.css'], want: 'light' },
  // renderer js content rule
  { name: 'renderer js, no sink', entries: [{ status: 'M', path: 'src/renderer/office.js', patch: ui('+const x = 1 + 2;') }], want: 'light' },
  ...['+el.innerHTML = a;', '-el.outerHTML = a;', '+el.insertAdjacentHTML("beforeend", a);', '+document.write(a);', '+f.srcdoc = a;', '+a.href = u;', '+img.src = u;', '+el.setAttribute("href", u);', '+const s = escHtml(a);', '-function esc(a) {}', '+safeMask(a);', '+maskToken(a);', '+window.agentDurbar.pick();', '+openExternal(u);', '+new URL(u);', '+if (u.protocol === "x") {}', '+const h = "https://x";', '+isLookalike(u);']
    .map((l): Case => ({ name: `renderer line: ${l}`, entries: [{ status: 'M', path: 'src/renderer/office.js', patch: ui(l) }], want: 'heavy' })),
  { name: 'renderer js without a patch', entries: [{ status: 'M', path: 'src/renderer/office.js' }], want: 'heavy' },
  { name: 'renderer js as a bare path', entries: ['src/renderer/office.js'], want: 'heavy' },
  // renames, deletes, statuses
  { name: 'rename out of a heavy path', entries: [{ status: 'R100', oldPath: 'src/main/ipc/x.ts', path: 'docs/x.md' }], want: 'heavy' },
  { name: 'rename into a heavy path', entries: [{ status: 'R090', oldPath: 'docs/x.md', path: 'src/main/ipc/x.ts' }], want: 'heavy' },
  { name: 'copy from a heavy path', entries: [{ status: 'C100', oldPath: 'src/shared/url.ts', path: 'docs/url.md' }], want: 'heavy' },
  { name: 'rename between light paths', entries: [{ status: 'R100', oldPath: 'docs/a.md', path: 'docs/b.md' }], want: 'light' },
  { name: 'heavy deletion', entries: [{ status: 'D', path: 'src/main/convmask.ts' }], want: 'heavy' },
  { name: 'light deletion', entries: [{ status: 'D', path: 'docs/old.md' }], want: 'light' },
  { name: 'type change', entries: [{ status: 'T', path: 'docs/a.md' }], want: 'heavy' },
  { name: 'unmerged status', entries: [{ status: 'U', path: 'docs/a.md' }], want: 'heavy' },
  { name: 'empty diff', entries: [], want: 'heavy' },
  // one light file must not hide a heavy one
  { name: 'light first, heavy last', entries: ['docs/a.md', 'src/main/ipc/x.ts'], want: 'heavy' },
  { name: 'heavy first, light last', entries: ['src/shared/url.ts', 'docs/a.md', 'src/renderer/a.css'], want: 'heavy' },
  { name: 'many light, one unknown', entries: ['docs/a.md', 'docs/b.md', 'specs/a.md', 'whatever/x'], want: 'heavy' },
  // test and driver rule
  { name: 'driver loading only light files', entries: ['scripts/check-safe.js'], want: 'light', ctx: true },
  { name: 'test loading only light files', entries: ['scripts/test-plain.ts'], want: 'light', ctx: true },
  { name: 'driver loading src/main', entries: ['scripts/check-loads-main.js'], want: 'heavy', ctx: true },
  { name: 'driver loading src/shared/url', entries: ['scripts/check-loads-url.js'], want: 'heavy', ctx: true },
  { name: 'test loading an ipc file', entries: ['scripts/test-loads-ipc.ts'], want: 'heavy', ctx: true },
  { name: 'test loading a trust script', entries: ['scripts/test-loads-gh.ts'], want: 'heavy', ctx: true },
  { name: 'test file that cannot be read', entries: ['scripts/test-gone.ts'], want: 'heavy', ctx: true },
  { name: 'driver with no reader', entries: ['scripts/check-safe.js'], want: 'heavy' },
  ...['redact', 'mask', 'trust', 'permiss', 'url', 'path', 'ipc', 'token', 'secret', 'fuzz', 'gate', 'claim', 'safe-print', 'spawn', 'shell', 'credit', 'spend']
    .map((k): Case => ({ name: `test name with "${k}"`, entries: [`scripts/test-${k}-thing.ts`], want: 'heavy', ctx: true })),
  // hole 1: renderer masking and trust modules are heavy by path, with no sink word on the changed line
  ...['safetext', 'lookalike', 'markdown', 'sandboxtext', 'grantlabel', 'whyallowed'].map((m): Case => ({ name: `renderer module by path: ${m}.js`, entries: [{ status: 'M', path: `src/renderer/${m}.js`, patch: ui('+const LIMIT = 3;') }], want: 'heavy' })),
  { name: 'renderer module by path, rename away', entries: [{ status: 'R100', oldPath: 'src/renderer/safetext.js', path: 'src/renderer/plain.js', patch: ui('+const A = 1;') }], want: 'heavy' },
  // hole 2: a test that loads a heavy module by path.join is heavy
  { name: 'test-safetext loads safetext.js by path.join', entries: ['scripts/test-safetext.ts'], want: 'heavy', ctx: true },
  { name: 'test loads lookalike.js by path.join', entries: ['scripts/test-lookalike-links.ts'], want: 'heavy', ctx: true },
  { name: 'test loads sandboxtext.js by path.join (name has no keyword)', entries: ['scripts/test-unlisted-module.ts'], want: 'heavy', ctx: true },
  { name: 'driver loads a light renderer module by path.join', entries: ['scripts/check-loads-office.js'], want: 'light', ctx: true },
  { name: 'shots driver with no reader', entries: ['scripts/shots-x.js'], want: 'heavy' },
];

/** Runs the table against a classifier; returns the names of the cases it got wrong. */
function failures(profile: ReturnType<typeof rp.createProfile>): string[] {
  const bad: string[] = [];
  for (const c of CASES) {
    const got = profile.classify(c.entries, c.ctx ? { readFile } : {}).profile;
    if (got !== c.want) bad.push(c.name);
  }
  return bad;
}

// 1. the real classifier passes every case
const real = rp.createProfile();
assert.deepStrictEqual(failures(real), [], 'the real classifier must pass the whole table');
assert.ok(CASES.length > 80, 'the table has its cases');

// the file list names the non-light paths
const mixed = real.classify(['docs/a.md', 'src/main/x.ts']);
assert.deepStrictEqual(mixed.files.filter((f) => f.profile !== 'light').map((f) => f.path), ['src/main/x.ts']);

// 2. mutants: each dies at its own named cases (and at no case that proves nothing)
const D = rp.DEFAULT_CONFIG;
function mutant(name: string, config: Record<string, unknown>, mustFail: string[]): void {
  const bad = failures(rp.createProfile(config));
  for (const n of mustFail) assert.ok(bad.includes(n), `mutant "${name}" must fail case "${n}"; failed: ${bad.join(' | ') || 'nothing'}`);
  assert.ok(bad.length > 0, `mutant "${name}" survived the table`);
}
const without = (names: string[]): Rule[] => D.heavyVeto.filter((r) => !names.includes(r.name));

mutant('light list widened to src/**', { lightRules: [...D.lightRules, { name: 'src', test: (p: string) => p.startsWith('src/') }], heavyVeto: [] }, ['heavy path: src/main/ipc/x.ts', 'heavy root: src/shared/unlisted.ts']);
mutant('light list widened to scripts/*', { lightRules: [...D.lightRules, { name: 'scripts', test: (p: string) => p.startsWith('scripts/') }], heavyVeto: [] }, ['heavy root: scripts/foo.sh', 'heavy path: scripts/some-new-thing.js']);
mutant('light list widened to everything', { lightRules: [...D.lightRules, { name: 'all', test: () => true }], heavyVeto: [] }, ['heavy path: brand-new-root/file.md', 'many light, one unknown']);
mutant('unknown paths are light', { lightRules: [...D.lightRules, { name: 'unknown', test: (p: string) => !D.heavyVeto.some((r) => r.test(p)) }] }, ['heavy path: brand-new-root/file.md', 'heavy path: scripts/some-new-thing.js']);
mutant('docs/rules veto dropped', { heavyVeto: without(['docs/rules']) }, ['heavy path: docs/rules/merge-mechanics.md']);
mutant('docs/agent-setup veto dropped', { heavyVeto: without(['docs/agent-setup']) }, ['heavy path: docs/agent-setup/README.md']);
mutant('docs/site code veto dropped', { heavyVeto: without(['docs code (the public site and any script under docs)', 'svg']) }, ['heavy path: docs/site/app.js']);
mutant('CSP page veto dropped', { heavyVeto: without(['renderer html (CSP pages)']), lightRules: [...D.lightRules, { name: 'renderer', test: (p: string) => p.startsWith('src/renderer/') }] }, ['heavy path: src/renderer/index.html', 'heavy path: src/renderer/charencoder.html']);
mutant('trust tooling veto dropped', { heavyVeto: without(['scripts shell and trust tooling']), lightRules: [...D.lightRules, { name: 'scripts', test: (p: string) => p.startsWith('scripts/') }] }, ['heavy path: scripts/gh-trusted.sh', 'heavy path: scripts/pr-gate.sh']);
mutant('src/main root dropped', { heavyVeto: without(['src/main']), lightRules: [...D.lightRules, { name: 'src', test: (p: string) => p.startsWith('src/') }] }, ['heavy path: src/main/ipc/x.ts']);
mutant('src/preload root dropped', { heavyVeto: without(['src/preload']), lightRules: [...D.lightRules, { name: 'src', test: (p: string) => p.startsWith('src/') }] }, ['heavy root: src/preload/unlisted.ts']);
mutant('.github root dropped', { heavyVeto: without(['.github']), lightRules: [...D.lightRules, { name: 'gh', test: (p: string) => p.startsWith('.github/') }] }, ['heavy root: .github/unlisted.md']);
mutant('renames ignored (new path only)', { pathsOf: (e: { path: string }) => [e.path] }, ['rename out of a heavy path', 'copy from a heavy path']);
mutant('renames ignored (old path only)', { pathsOf: (e: { path: string; oldPath?: string }) => [e.oldPath || e.path] }, ['rename into a heavy path']);
mutant('sink rule dropped', { sinkPatterns: [] }, ['renderer line: +el.innerHTML = a;', 'renderer line: +const s = escHtml(a);', 'renderer line: -function esc(a) {}']);
mutant('sink rule only innerHTML', { sinkPatterns: [/innerHTML/] }, ['renderer line: +safeMask(a);', 'renderer line: +window.agentDurbar.pick();', 'renderer line: +openExternal(u);']);
mutant('one light file hides a heavy one (decided by the first)', { combine: (r: { profile: string }[]) => (r.length && r[0].profile === 'light' ? 'light' : 'heavy') }, ['light first, heavy last']);
mutant('one light file hides a heavy one (decided by the last)', { combine: (r: { profile: string }[]) => (r.length && r[r.length - 1].profile === 'light' ? 'light' : 'heavy') }, ['heavy first, light last']);
mutant('any light file makes it light', { combine: (r: { profile: string }[]) => (r.some((f) => f.profile === 'light') ? 'light' : 'heavy') }, ['light first, heavy last', 'many light, one unknown']);
mutant('keyword check dropped', { keywords: [] }, ['test name with "redact"', 'test name with "mask"']);

// hole 2 mutants: no name scanning; shorter keyword list
mutant('path.join names not scanned', { keywords: [], heavyRenderer: [] }, ['test-safetext loads safetext.js by path.join']);
mutant('heavy renderer list dropped', { heavyVeto: D.heavyVeto.filter((r) => r.name !== 'renderer masking, trust and text modules') }, ['renderer module by path: safetext.js', 'renderer module by path: whyallowed.js', 'renderer module by path, rename away']);

// hole 3: contents are read from <head>, not from the working tree
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-'));
  try {
    const g = (...a: string[]): void => { cp.execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, stdio: 'ignore' }); };
    g('init', '-q');
    fs.writeFileSync(path.join(dir, 'f.txt'), 'at-head');
    g('add', 'f.txt'); g('commit', '-q', '-m', 'x');
    fs.writeFileSync(path.join(dir, 'f.txt'), 'working-tree');
    const rd = rp.headReader('HEAD', dir);
    assert.strictEqual(rd('f.txt'), 'at-head', 'the reader must return the content at <head>, not the working tree');
    assert.throws(() => rd('missing.txt'), 'a file missing at head must throw (heavy)');
    assert.throws(() => rp.headReader('--output=x', dir), 'an option-shaped ref is refused');
    // mutant: a working-tree reader dies at the first assert
    const wt = (p: string): string => fs.readFileSync(path.join(dir, p), 'utf8');
    assert.notStrictEqual(wt('f.txt'), 'at-head', 'mutant (working-tree reader) must differ from the head reader');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// 3. refs given to git are never options or shell text
assert.ok(rp.validRef('origin/main') && rp.validRef('HEAD~3') && rp.validRef('0123abcd'));
assert.ok(!rp.validRef('--output=x') && !rp.validRef('-x') && !rp.validRef('a b') && !rp.validRef('a;ls') && !rp.validRef('') && !rp.validRef('$(x)'));

console.log(`test-review-profile: ${CASES.length} cases and 22 mutants and the head-reader check pass`);
