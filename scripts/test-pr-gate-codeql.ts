/*
 * scripts/pr-gate.sh and a CodeQL check GitHub skipped (spec 021 FR-089, issue #1420): a `skipping` or absent CodeQL check counts as passed
 * only when the check list was read, every changed file is on the no-code list and the open alerts are 0; anything else blocks (fail closed).
 * Runs the gate against a fake `gh` (bash, answers from fixture files, applies each `--jq` / `-q` with the real jq), then plants mutants
 * in a copy of the gate (a failing CodeQL treated as skipped, the file filter removed and more) and checks each is caught by its labelled assert.
 * Needs bash and jq: on Windows, or without jq, only the static checks run (Linux CI runs it all).
 */
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'scripts');
const gate = fs.readFileSync(path.join(SCRIPTS, 'pr-gate.sh'), 'utf8');

// ---- static: the rule's parts are in the gate
assert.ok(/nocode\(\) \{ case \$1 in /.test(gate), 'pr-gate.sh has the no-code file list');
assert.ok(gate.includes('repos/$R/pulls/$p/files'), 'pr-gate.sh reads the changed files, renames\' old paths too');
assert.ok(gate.includes('[ -z "$codeql_ok" ]'), 'the verdict uses codeql_ok, not a raw state');
// FR-090: the CodeQL result is taken from the head commit's check runs, as one run of GitHub's code-scanning app with the id linked in the checks
assert.ok(gate.includes('repos/$R/commits/$head_sha/check-runs'), 'pr-gate.sh reads the head commit\'s check runs');
assert.ok(gate.includes('[ "$runs" != "github-advanced-security $codeql_id" ]'), 'pr-gate.sh wants exactly one CodeQL run, from github-advanced-security, with the checked run id');
assert.ok(gate.includes('ready to merge at $head_sha'), 'the ready line names the head commit it checked');
const checksAt = gate.indexOf('checks_out=$(gh pr checks $p)');
assert.ok(checksAt > 0 && gate.indexOf('checks_out=$(gh pr checks', checksAt + 1) < 0 && checksAt < gate.indexOf('pr_line=$(gh api repos/$R/pulls/$p '), 'the check list is read once, before the head sha');
assert.ok(!/gh pr checks \$p \|/.test(gate), 'every verdict check uses that one read');
// FR-090: the file lists follow the live head; both are read after pr_line, and the head is read again after them, before the verdict
const prLineAt = gate.indexOf('pr_line=$(gh api repos/$R/pulls/$p ');
const headNowAt = gate.indexOf('head_now=$(gh api repos/$R/pulls/$p --jq .head.sha');
const verdictAt = gate.indexOf('if [ -n "$bad" ] || [ -z "$codeql_ok" ]');
for (const [read, what] of [['repos/$R/pulls/$p/files', 'the one file list (src/ check and FR-089, FR-091)'], ['checks_out=$(gh pr checks $p)', 'the check list']]) {
  const at = gate.indexOf(read);
  assert.ok(at > 0 && gate.indexOf(read, at + 1) < 0 && at < headNowAt, `${what} is read once, before the final head read`);
}
assert.ok(prLineAt < gate.indexOf('src_files=$(gh api --paginate') && prLineAt < gate.indexOf('only_nocode; then'), 'the file list is read after pr_line');
assert.ok(!gate.includes('--json files') && !/--jq \.changed_files/.test(gate) && gate.includes('src_total=$pr_total;'), 'changed_files comes from pr_line only (FR-091), no gh pr view file list');
assert.ok(gate.includes('files=$src_files;'), 'only_nocode reuses the one file list (FR-031)');
assert.ok(headNowAt > 0 && headNowAt < verdictAt && gate.slice(headNowAt, verdictAt).split('\n').length <= 4, 'the head is read again just before the verdict');

const bash = process.platform === 'win32' ? null : spawnSync('bash', ['-c', 'command -v jq'], { encoding: 'utf8' });
if (!bash || bash.status !== 0) {
  console.log('pr-gate codeql: no bash or jq here, static checks only');
  console.log('pr-gate codeql tests passed');
  process.exit(0);
}

const SHA = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-gate-codeql-'));
const bin = path.join(dir, 'bin');
const fx = path.join(dir, 'fx');
fs.mkdirSync(bin);
fs.mkdirSync(fx);
// fixtures: checks.txt (tab-separated `gh pr checks` lines; absent = the call fails), checkruns.json and checkruns2.json (the head commit's
// check runs, pages 1 and 2; checkruns.fail: the call fails after its pages), files.json and files2.json (pages 1 and 2 of the PR
// files API: page 2 only with --paginate, as the real gh; absent = the call fails), pull.json (the PR: changed_files, head sha;
// pull-later.json: what every read after the first returns, a push while the gate runs; pull-later.fail: those reads fail),
// contents/<path> (a file at the head commit; absent = 404), alerts-merge.json / alerts-head.json (absent = the call fails);
// the comment lists are empty and the PR is ours
fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/bash
F="${fx}"; prog=.; prev=
for a in "$@"; do { [ "$prev" = --jq ] || [ "$prev" = -q ]; } && prog=$a; prev=$a; done
ep=; for a in "$@"; do case $a in repos/*|graphql|user) ep=$a; break;; esac; done
case "$1 $2" in
  "repo view") echo '{"nameWithOwner":"o/r"}' | jq -r "$prog"; exit;;
  "pr checks") [ -f "$F/checks.txt" ] || { echo "fake gh: checks failed" >&2; exit 1; }; cat "$F/checks.txt"; exit;;
  "pr view") echo '{"mergeable":"MERGEABLE","files":[{"path":"package-lock.json"}],"labels":[]}' | jq -r "$prog"; exit;;
esac
case $ep in
  user) echo '{"login":"vikramgorla"}' | jq -r "$prog"; exit;;
  graphql) echo '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]},"comments":{"nodes":[]},"reviews":{"nodes":[]}}}}}' | jq -r "$prog"; exit;;
  repos/o/r/code-scanning/alerts?ref=refs/pull/1/merge*) f=alerts-merge;;
  repos/o/r/code-scanning/alerts?ref=refs/pull/1/head*) f=alerts-head;;
  repos/o/r/pulls/1) f=pull; { [ -f "$F/pull-later.json" ] || [ -f "$F/pull-later.fail" ]; } && { [ -f "$F/pull.seen" ] && f=pull-later; : > "$F/pull.seen"; };;
  repos/o/r/commits/*/check-runs*) f=checkruns;;
  repos/o/r/contents/*\?ref=${BASE}) c=\${ep#repos/o/r/contents/}; c=\${c%%\?ref=*}; [ -f "$F/base/$c" ] || { echo "fake gh: 404 $c" >&2; exit 1; }; jq -r "$prog" < "$F/base/$c"; exit;;
  repos/o/r/contents/*\?ref=${SHA}) c=\${ep#repos/o/r/contents/}; c=\${c%%\?ref=*}; [ -f "$F/contents/$c" ] || { echo "fake gh: 404 $c" >&2; exit 1; }; jq -r "$prog" < "$F/contents/$c"; exit;;
  repos/o/r/pulls/1/files) f=files;;
  repos/o/r/pulls/1/reviews|repos/o/r/issues/1/comments|repos/o/r/pulls/1/comments) echo '[]' | jq -r "$prog"; exit;;
  *) echo "fake gh: no fixture for $*" >&2; exit 9;;
esac
[ -f "$F/$f.json" ] || { echo "fake gh: $f failed" >&2; exit 1; }
jq -r "$prog" < "$F/$f.json" || exit
case " $* " in *" --paginate "*) [ -f "$F/\${f}2.json" ] && { jq -r "$prog" < "$F/\${f}2.json" || exit; };; esac
[ -f "$F/$f.fail" ] && { echo "fake gh: $f failed after its first page" >&2; exit 1; }
exit 0
`, { mode: 0o755 });
const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };

const OTHER = 'Build and test (ubuntu-latest)\tpass\t1m\thttps://x\nSpec Kit gate\tpass\t1m\thttps://x\n';
const set = (name: string, v: string | null): void => {
  const f = path.join(fx, name);
  if (v === null) fs.rmSync(f, { force: true });
  else fs.writeFileSync(f, v);
};
type File = string | { filename: string; previous_filename: string };
const LOCK = { lockfileVersion: 3, packages: { '': { dependencies: { x: '^1.0.0' } }, 'node_modules/x': { version: '1.0.1', resolved: 'https://registry.npmjs.org/x/-/x-1.0.1.tgz', integrity: 'sha512-AAAA' } } };
const PKG = { name: 'prereview', scripts: { test: 'node test.js' }, dependencies: { x: '^1.0.0' } };
const fixture = (o: { codeql?: string | null; checks?: boolean; files?: File[] | null; page2?: File[]; changed?: number; contents?: Record<string, unknown>; base?: Record<string, unknown>; baseRef?: string; author?: string; merge?: unknown[] | null; head?: unknown[] | null; runs?: string[] | null; runs2?: string[]; runId?: string; headSha?: string } = {}): void => {
  const codeql = o.codeql === undefined ? 'skipping' : o.codeql;
  set('checks.txt', o.checks === false ? null : OTHER + (codeql === null ? '' : `CodeQL\t${codeql}\t0\t${o.runId ?? 'https://github.com/o/r/runs/101'}\n`));
  const files = o.files ?? ['scripts/prereview/package-lock.json', 'scripts/prereview/package.json'];
  const page = (l: File[]): string => JSON.stringify(l.map((f) => (typeof f === 'string' ? { filename: f } : f)));
  set('files.json', o.files === null ? null : page(files));
  set('files2.json', o.page2 ? page(o.page2) : null);
  set('pull.json', JSON.stringify({ user: { login: o.author ?? 'dependabot[bot]' }, head: { sha: o.headSha ?? SHA, repo: { full_name: 'o/r' } }, base: { sha: BASE, ref: o.baseRef ?? 'main', repo: { full_name: 'o/r' } }, changed_files: o.changed ?? files.length + (o.page2 ?? []).length }));
  fs.rmSync(path.join(fx, 'contents'), { recursive: true, force: true });
  fs.rmSync(path.join(fx, 'base'), { recursive: true, force: true });
  // the base commit has the same dependency files as the default head, unless a case says otherwise (null: not on the base)
  for (const [f, v] of Object.entries({ 'scripts/prereview/package-lock.json': LOCK, 'scripts/prereview/package.json': PKG, 'package-lock.json': LOCK, ...(o.base ?? {}) })) {
    if (v === null) continue;
    fs.mkdirSync(path.dirname(path.join(fx, 'base', f)), { recursive: true });
    fs.writeFileSync(path.join(fx, 'base', f), JSON.stringify(v));
  }
  const contents: Record<string, unknown> = { 'scripts/prereview/package-lock.json': LOCK, 'scripts/prereview/package.json': PKG, 'package-lock.json': LOCK, ...(o.contents ?? {}) };
  for (const [f, v] of Object.entries(contents)) {
    if (v === null) continue;
    fs.mkdirSync(path.dirname(path.join(fx, 'contents', f)), { recursive: true });
    fs.writeFileSync(path.join(fx, 'contents', f), JSON.stringify(v));
  }
  set('alerts-merge.json', o.merge === null ? null : JSON.stringify(o.merge ?? []));
  set('alerts-head.json', o.head === null ? null : JSON.stringify(o.head ?? []));
  set('files.fail', null);
  set('pull-later.json', null);
  set('pull-later.fail', null);
  set('pull.seen', null);
  set('checkruns.fail', null);
  // the head commit's check runs, "name@slug" or "name@slug#id" (id 101 by default, the run the CodeQL line links): by default one CodeQL
  // run from GitHub's code-scanning app (null: the call fails)
  const runs = (l: string[]): string => JSON.stringify({ check_runs: l.map((x) => { const [name, rest] = x.split('@'); const [slug, id] = rest.split('#'); return { name, id: Number(id ?? 101), app: { slug } }; }) });
  set('checkruns.json', o.runs === null ? null : runs(o.runs ?? ['CodeQL@github-advanced-security', 'Spec Kit gate@github-actions']));
  set('checkruns2.json', o.runs2 ? runs(o.runs2) : null);
};
const run = (gatePath: string): { code: number | null; out: string } => {
  const r = spawnSync('bash', [gatePath, '1'], { env, encoding: 'utf8', timeout: 60000 });
  assert.ok(!/fake gh: no fixture/.test(r.stderr), r.stderr);
  return { code: r.status, out: r.stdout + r.stderr };
};
const ready = (gatePath: string, label: string): void => {
  const r = run(gatePath);
  assert.ok(r.code === 0 && r.out.includes('ready to merge'), `${label}: ready\n${r.out}`);
};
const notReady = (gatePath: string, label: string, want: RegExp): void => {
  const r = run(gatePath);
  assert.ok(r.code === 1 && r.out.includes('#1 not ready') && want.test(r.out), `${label}: not ready\n${r.out}`);
};

// the cases by name; a mutant runs only the case named for it and must fail it (the label names the case)
type Case = (g: string, label: string) => void;
const R = (o: Parameters<typeof fixture>[0]): Case => (g, l) => { fixture(o); ready(g, l); };
const N = (o: Parameters<typeof fixture>[0], want: RegExp, after?: () => void): Case => (g, l) => { fixture(o); after?.(); notReady(g, l, want); };
const noGates = (): void => set('checks.txt', 'CodeQL\tpass\t0\thttps://github.com/o/r/runs/101\n');
const other = /codeql=skipping\(analysed or unknown files changed\)/;
const refused = /codeql=skipping\(dependency files refused/;
const lock = (pkg: object): object => ({ ...LOCK, packages: { ...LOCK.packages, 'node_modules/y': pkg } });
const CASES: Record<string, Case> = {
  'pass: a passed CodeQL': R({ codeql: 'pass', files: ['src/main/a.ts'] }),
  'lockfile-skipped: a Dependabot lockfile-only PR, CodeQL skipping, 0 alerts': (g, l) => {
    fixture({});
    const r = run(g);
    assert.ok(r.code === 0 && r.out.includes('CodeQL skipped (no analysed files; dependency files changed: CodeQL does not read them, a reviewer reads the diff)'), `${l}: ready, and the verdict says why\n${r.out}`);
  },
  'docs-skipped: docs, a picture and a spec, CodeQL skipping': (g, l) => {
    fixture({ files: ['docs/a.md', 'docs/pics/a.png', 'specs/021-x/spec.md'], author: 'vikramgorla' });
    const r = run(g);
    assert.ok(r.code === 0 && !r.out.includes('dependency files changed'), `${l}: ready, no dependency note\n${r.out}`);
  },
  'root-lockfile: the root package-lock.json in a Dependabot PR': R({ files: ['package-lock.json'] }),
  'two-pages-docs: two pages of docs (--paginate reads both)': R({ files: ['docs/a.md'], page2: ['docs/b.md'] }),
  'no-codeql-check: no CodeQL check yet on a docs-only PR': N({ codeql: null, files: ['docs/a.md'] }, /codeql=missing /),
  'alert-merge: 1 alert on the merge ref': N({ merge: [{ number: 1 }] }, /alerts=1/),
  'alert-head: 1 alert on the head ref': N({ head: [{ number: 1 }] }, /alerts=1/),
  'codeql-fail: a failing CodeQL on a lockfile-only PR': N({ codeql: 'fail' }, /codeql=fail /),
  'codeql-pending: a pending CodeQL': N({ codeql: 'pending' }, /codeql=pending /),
  'codeql-cancel: a cancelled CodeQL': N({ codeql: 'cancel' }, /codeql=cancel /),
  'skipped-with-src: CodeQL skipped on a PR that changes src/*.ts': N({ files: ['scripts/prereview/package-lock.json', 'src/main/a.ts'] }, other),
  'missing-with-src: no CodeQL check on a PR that changes src/*.ts': N({ codeql: null, files: ['src/main/a.ts'] }, /codeql=missing /),
  'unknown-file: files off the no-code list': (g, l) => {
    for (const f of ['scripts/trusted-authors.txt', 'package.json', 'docs/site/app.js', '.github/workflows/ci.yml', 'docs/a.svg', 'README.MD', 'scripts/x/package.json.bak', 'evil-package-lock.json', 'src/package-lock.json', '.github/workflows/package-lock.json', 'scripts/a/b/package-lock.json']) {
      fixture({ files: ['docs/a.md', f] });
      notReady(g, `${l}: ${f}`, other);
    }
  },
  'newline-name: a file name with a newline that splits into two allowed names': N({ files: ['a.md\npackage-lock.json'] }, other),
  'control-name: a file name with a control character': N({ files: ['docs/a\u0001.md'] }, other),
  'rename-from-src: a src/*.ts file renamed to a .md': N({ files: [{ filename: 'docs/a.md', previous_filename: 'src/main/a.ts' }] }, other),
  'page2-src: src/a.ts on the second page of the file list': N({ files: ['docs/a.md'], page2: ['src/a.ts'] }, other),
  'count-mismatch: the API lists fewer files than the PR changed': N({ files: ['docs/a.md'], changed: 2 }, other),
  'cap-3000: 3000 files, where the files API stops': N({ files: Array.from({ length: 3000 }, (_, i) => `docs/f${i}.md`) }, other),
  'empty-files: no changed files read': N({ files: [] }, other),
  'files-partial: the file list fails after its first page (all docs so far)': N({}, other, () => set('files.fail', '')),
  'files-error: the file list cannot be read': N({ files: null }, other),
  'dep-author: a lockfile-only PR by a teammate, not Dependabot': N({ author: 'vikramgorla' }, refused),
  'dep-resolved: a lockfile entry resolved outside registry.npmjs.org': N({ contents: { 'scripts/prereview/package-lock.json': lock({ version: '1.0.0', resolved: 'https://evil.example/y-1.0.0.tgz' }) } }, refused),
  'dep-installscript-old: an install script the base commit already has': R({ contents: { 'scripts/prereview/package-lock.json': lock({ version: '1.0.1', resolved: 'https://registry.npmjs.org/y/-/y-1.0.1.tgz', hasInstallScript: true }) }, base: { 'scripts/prereview/package-lock.json': lock({ version: '1.0.0', resolved: 'https://registry.npmjs.org/y/-/y-1.0.0.tgz', hasInstallScript: true }) } }),
  'dep-installscript: a new dependency with an install script': N({ contents: { 'scripts/prereview/package-lock.json': lock({ version: '1.0.0', resolved: 'https://registry.npmjs.org/y/-/y-1.0.0.tgz', hasInstallScript: true }) } }, refused),
  'dep-scripts-same: a package.json whose scripts match the base commit': R({ files: ['scripts/prereview/package.json'] }),
  'dep-scripts: any change to package.json scripts against the base commit': (g, l) => {
    for (const scripts of [{ test: 'node test.js', prepublish: 'node x.js' }, { test: 'node test.js', preprepare: 'node x.js' }, { test: 'node test.js', postprepare: 'node x.js' }, { test: 'node evil.js' }, {}, { test: 'node test.js', postinstall: 'node x.js' }]) {
      fixture({ contents: { 'scripts/prereview/package.json': { ...PKG, scripts } } });
      notReady(g, `${l}: ${JSON.stringify(scripts)}`, refused);
    }
    fixture({ files: ['scripts/tool/package.json'], contents: { 'scripts/tool/package.json': PKG }, base: { 'scripts/tool/package.json': null } });
    notReady(g, `${l}: a new package.json with scripts`, refused);
  },
  'dep-lockv1: a lockfileVersion 1 lockfile (dependencies map, packages present)': N({ contents: { 'scripts/prereview/package-lock.json': { ...LOCK, lockfileVersion: 1, dependencies: { y: { version: '1.0.0', resolved: 'https://registry.npmjs.org/y/-/y-1.0.0.tgz' } } } } }, refused),
  'dep-nopackages: a lockfile without a packages map': N({ contents: { 'scripts/prereview/package-lock.json': { lockfileVersion: 3, dependencies: { y: { version: '1.0.0', resolved: 'https://registry.npmjs.org/y/-/y-1.0.0.tgz' } } } } }, refused),
  'dep-nested-spec: a git, file or URL spec in a lockfile package entry': (g, l) => {
    for (const spec of ['github:evil/z', 'git+https://evil.example/z.git', 'file:../z', 'https://evil.example/z.tgz', 'evil/z']) {
      fixture({ contents: { 'scripts/prereview/package-lock.json': lock({ version: '1.0.0', resolved: 'https://registry.npmjs.org/y/-/y-1.0.0.tgz', dependencies: { z: spec } }) } });
      notReady(g, `${l}: ${spec}`, refused);
    }
  },
  'dep-no-resolved: a lockfile package entry without a resolved URL (caught by the same check as dep-resolved)': N({ contents: { 'scripts/prereview/package-lock.json': lock({ version: '1.0.0' }) } }, refused),
  'dep-link-same: a link entry identical to the base commit\'s': R({ contents: { 'scripts/prereview/package-lock.json': lock({ link: true, resolved: 'scripts/y' }) }, base: { 'scripts/prereview/package-lock.json': lock({ link: true, resolved: 'scripts/y' }) } }),
  'dep-link: a link entry new or changed against the base commit': (g, l) => {
    fixture({ contents: { 'scripts/prereview/package-lock.json': lock({ link: true, resolved: '../../evil' }) } });
    notReady(g, `${l}: new`, refused);
    fixture({ contents: { 'scripts/prereview/package-lock.json': lock({ link: true, resolved: '../../evil' }) }, base: { 'scripts/prereview/package-lock.json': lock({ link: true, resolved: 'scripts/y' }) } });
    notReady(g, `${l}: changed`, refused);
  },
  'dep-overrides: a git, file or URL spec in package.json overrides, at any depth': (g, l) => {
    for (const overrides of [{ a: { b: 'github:evil/b' } }, { a: 'file:../a' }, { a: { '.': 'https://evil.example/a.tgz' } }, { a: { b: { c: 'evil/c' } } }]) {
      fixture({ contents: { 'scripts/prereview/package.json': { ...PKG, overrides } } });
      notReady(g, `${l}: ${JSON.stringify(overrides)}`, refused);
    }
  },
  'dep-resolutions: a git, file or URL spec in package.json resolutions': N({ contents: { 'scripts/prereview/package.json': { ...PKG, resolutions: { 'a/**/b': 'github:evil/b' } } } }, refused),
  'dep-bundled: bundled dependencies in package.json': (g, l) => {
    for (const b of [{ bundledDependencies: ['x'] }, { bundleDependencies: ['x'] }, { bundleDependencies: true }]) {
      fixture({ contents: { 'scripts/prereview/package.json': { ...PKG, ...b } } });
      notReady(g, `${l}: ${JSON.stringify(b)}`, refused);
    }
  },
  'dep-overrides-plain: plain version overrides': R({ files: ['scripts/prereview/package.json'], contents: { 'scripts/prereview/package.json': { ...PKG, overrides: { a: '1.2.3', b: { c: '^2.0.0' } }, bundleDependencies: [] } } }),
  'dep-base-branch: a Dependabot PR whose base is not main': N({ baseRef: 'release' }, refused),
  'dep-spec: a git, file or URL dependency spec': (g, l) => {
    for (const spec of ['github:evil/y', 'git+https://evil.example/y.git', 'file:../y', 'evil/y']) {
      fixture({ contents: { 'scripts/prereview/package.json': { ...PKG, dependencies: { y: spec } } } });
      notReady(g, `${l}: ${spec}`, refused);
    }
  },
  'dep-unreadable: a dependency file that cannot be read at the head commit': N({ contents: { 'scripts/prereview/package-lock.json': null } }, refused),
  'dep-odd-path: a dependency file path with a space': N({ files: ['scripts/a b/package.json'], contents: { 'scripts/a b/package.json': PKG }, base: { 'scripts/a b/package.json': PKG } }, refused),
  'alerts-error: the alerts cannot be read': N({ merge: null }, /alerts=unread/),
  'alerts-empty: the alerts call prints no number': N({}, /alerts=unread/, () => set('alerts-merge.json', '')),
  'app-other: a CodeQL check run from another app': N({ runs: ['CodeQL@evil-app'] }, /codeql=skipping\(no analysed files[^\n]*not exactly one CodeQL run/),
  'app-second: a second CodeQL run from another app, on page 2': N({ runs: ['CodeQL@github-advanced-security'], runs2: ['CodeQL@evil-app'] }, /not exactly one CodeQL run/),
  'app-twice: two CodeQL runs from the code-scanning app': N({ runs: ['CodeQL@github-advanced-security', 'CodeQL@github-advanced-security'] }, /not exactly one CodeQL run/),
  'app-none: no CodeQL run in the head commit\'s check runs': N({ runs: ['Spec Kit gate@github-actions'] }, /not exactly one CodeQL run/),
  'app-pass-other: a passed CodeQL from another app': N({ codeql: 'pass', files: ['src/main/a.ts'], runs: ['CodeQL@evil-app'] }, /codeql=pass\(not exactly one CodeQL run/),
  'app-unread: the check runs cannot be read': N({ codeql: 'pass', files: ['src/main/a.ts'], runs: null }, /check runs unread/),
  'app-partial: the check runs fail after a first page that holds the app\'s run': N({ runs: ['CodeQL@github-advanced-security'] }, /check runs unread/, () => set('checkruns.fail', '')),
  'app-newer-run: the app\'s CodeQL run on the head commit is not the run the checks list links (a push in between)': N({ runs: ['CodeQL@github-advanced-security#102'] }, /not exactly one CodeQL run from github-advanced-security, run 101 of a{40}/),
  'app-bad-link: the CodeQL line links no run of this repo': N({ codeql: 'pass', files: ['src/main/a.ts'], runId: 'https://github.com/evil/r/runs/101' }, /check runs unread/),
  'app-short-sha: a head sha that is not 40 hex characters': N({ codeql: 'pass', files: ['src/main/a.ts'], headSha: 'a'.repeat(39) }, /check runs unread/),
  'ready-sha: the ready line names the head commit': (g, l) => {
    fixture({ codeql: 'pass', files: ['src/main/a.ts'] });
    const r = run(g);
    assert.ok(r.code === 0 && r.out.includes(`#1 ready to merge at ${SHA}:`), `${l}: ready at the head sha\n${r.out}`);
  },
  'head-moved: the head changes after the PR read (a push A->B while the file lists are read)': (g, l) => {
    fixture({ codeql: 'pass', files: ['docs/a.md'] });
    set('pull-later.json', JSON.stringify({ user: { login: 'dependabot[bot]' }, head: { sha: 'c'.repeat(40), repo: { full_name: 'o/r' } }, base: { sha: BASE, ref: 'main', repo: { full_name: 'o/r' } }, changed_files: 1 }));
    notReady(g, l, new RegExp(`head-changed\\(read ${SHA} first, c{40} at the end`));
  },
  'head-unread: the final head read fails': N({ codeql: 'pass', files: ['docs/a.md'] }, /head-changed\(read a{40} first, unread at the end/, () => set('pull-later.fail', '')),
  // the src/ check at the top of the gate (FR-091, #1422): CodeQL passed and the gates absent, so only src/ makes it block
  'src-page2: src/a.ts on the second page of the file list': N({ codeql: 'pass', files: ['docs/a.md'], page2: ['src/a.ts'] }, /missing:Spec Kit gate/, noGates),
  'src-rename: a src/*.ts file renamed to a .md': N({ codeql: 'pass', files: [{ filename: 'docs/a.md', previous_filename: 'src/main/a.ts' }] }, /missing:Spec Kit gate/, noGates),
  'src-docs-only: docs only, the src gates not needed': (g, l) => { fixture({ codeql: 'pass', files: ['docs/a.md'], page2: ['docs/b.md'] }); noGates(); ready(g, l); },
  'src-count: the API lists fewer files than the PR changed': N({ codeql: 'pass', files: ['docs/a.md'], changed: 2 }, /src-check-unreadable/),
  'src-cap: 3000 files, where the files API stops': N({ codeql: 'pass', files: Array.from({ length: 3000 }, (_, i) => `docs/f${i}.md`) }, /src-check-unreadable/),
  'src-error: the file list cannot be read': N({ codeql: 'pass', files: null }, /src-check-unreadable/),
  'src-partial: the file list fails after its first page': N({ codeql: 'pass', files: ['docs/a.md'] }, /src-check-unreadable/, () => set('files.fail', '')),
  'src-empty: the files API lists no file (changed_files 0)': N({ codeql: 'pass', files: [], changed: 0 }, /src-check-unreadable/),
  'src-ctrl: a file name with a newline counts as src/': N({ codeql: 'pass', files: ['src/a\n.ts'] }, /missing:Spec Kit gate/, noGates),
  'checks-error: the check list cannot be read': N({ checks: false }, /codeql=missing /),
};
const runCase = (g: string, name: string): void => {
  const k = Object.keys(CASES).find((c) => c.startsWith(`${name}:`));
  assert.ok(k, `no case ${name}`);
  CASES[k as string](g, `CASE ${k}`);
};

try {
  for (const name of Object.keys(CASES)) runCase(path.join(SCRIPTS, 'pr-gate.sh'), name.split(':')[0]);
  // mutants: a copy of the gate next to copies of the files it sources; each must fail the case named
  const mdir = path.join(dir, 'mutant');
  fs.mkdirSync(mdir);
  for (const f of ['trusted-lib.sh', 'trusted-authors.txt', 'pr-status-note.re']) fs.copyFileSync(path.join(SCRIPTS, f), path.join(mdir, f));
  const mutants: Array<[string, string, string, string]> = [
    ['a failing CodeQL treated as skipped', '[ "$codeql" = skipping ] &&', '{ [ "$codeql" = skipping ] || [ "$codeql" = fail ]; } &&', 'codeql-fail'],
    ['a missing CodeQL treated as skipped', '[ "$codeql" = skipping ] &&', '{ [ "$codeql" = skipping ] || [ "$codeql" = missing ]; } &&', 'no-codeql-check'],
    ['the file filter removed', 'nocode "$f" || return 1', 'true', 'skipped-with-src'],
    ['lockfiles in any folder', 'scripts/*/*/*) return 1;; package-lock.json|', '*/package-lock.json|package-lock.json|', 'unknown-file'],
    ['the control-character check removed', '|any(test("[\\\\x00-\\\\x1f\\\\x7f]"))', '|any(false)', 'control-name'],
    ['a partly read file list accepted', `"P \\(.)") end') || src_files=ERR`, `"P \\(.)") end')`, 'files-partial'],
    ['a rename\'s old path ignored', ', (.previous_filename // empty|"P \\(.)")', '', 'rename-from-src'],
    ['--paginate removed from the file list', 'gh api --paginate "repos/$R/pulls/$p/files"', 'gh api "repos/$R/pulls/$p/files"', 'two-pages-docs'],
    ['the count check removed', '[ "$n" = "$total" ] && ', '', 'count-mismatch'],
    ['the 3000-file cap removed', '&& [ "$n" -lt 3000 ] ', '', 'cap-3000'],
    ['the Dependabot author check removed', '[ "$author" = "dependabot[bot]" ] && ', '', 'dep-author'],
    ['the install-script check removed', '| grep -q . && return 2', '| grep -q . && true', 'dep-installscript'],
    ['every install script refused', 'grep -vxF -f <(printf \'%s\\n\' "$base_i")', 'cat', 'dep-installscript-old'],
    ['the scripts comparison removed', '[ "$head_i" = "$base_i" ] || return 2;;', ';;', 'dep-scripts'],
    ['the lockfileVersion check removed', '.lockfileVersion >= 2', 'true', 'dep-lockv1'],
    ['the spec check at the top level only', '[..|objects|(.dependencies?', '[(.dependencies?', 'dep-nested-spec'],
    ['entries without resolved accepted', 'select((.value.resolved // "")|startswith("https://registry.npmjs.org/")|not)', 'select(false)', 'dep-resolved'],
    ['the link comparison removed', `printf '%s\\n' "$head_l" | grep -vxF -f <(printf '%s\\n' "$base_l") | grep -q . && return 2`, 'true', 'dep-link'],
    ['overrides not scanned', '(.overrides?, .resolutions?)', '(.resolutions?)', 'dep-overrides'],
    ['resolutions not scanned', '(.overrides?, .resolutions?)', '(.overrides?)', 'dep-resolutions'],
    ['bundled dependencies accepted', 'select(. != null and . != false and . != [])', 'select(false)', 'dep-bundled'],
    ['the base branch check removed', '&& [ "$baseref" = main ] ', '', 'dep-base-branch'],
    ['the dependency spec check removed', 'select(test("[:/]"))', 'select(false)', 'dep-spec'],
    ['the dependency files not read', '[ ${#deps[@]} = 0 ] && return 0', 'return 0', 'lockfile-skipped'],
    ['the path check removed', 'case $f in *[!A-Za-z0-9._/-]*|*..*) return 2;; esac', '', 'dep-odd-path'],
    ['the app filter removed', `[ "$runs" != "github-advanced-security $codeql_id" ]`, `[ "\${runs#* }" != "$codeql_id" ]`, 'app-other'],
    ['the run id not compared', `[ "$runs" != "github-advanced-security $codeql_id" ]`, `[ "\${runs% *}" != "github-advanced-security" ]`, 'app-newer-run'],
    ['only the first CodeQL run read', `--jq '.check_runs[]|select(.name=="CodeQL")|"\\(.app.slug) \\(.id)"'`, `--jq '[.check_runs[]|select(.name=="CodeQL")|"\\(.app.slug) \\(.id)"][0]'`, 'app-twice'],
    ['a partly read check-run list accepted', '|| ! runs=$(', '|| false; runs=$(', 'app-partial'],
    ['the link check removed', `*) codeql_id=;; esac`, `*) codeql_id=101;; esac`, 'app-bad-link'],
    ['the 40-character sha check removed', '[ ${#head_sha} = 40 ] || head_sha=', 'true', 'app-short-sha'],
    ['the head sha left out of the ready line', 'ready to merge at $head_sha:', 'ready to merge:', 'ready-sha'],
    ['--paginate removed from the check runs', 'gh api --paginate "repos/$R/commits/', 'gh api "repos/$R/commits/', 'app-second'],
    ['the final head re-check removed', '[ -n "$head_sha" ] && [ "$head_now" = "$head_sha" ] || bad=', 'true || bad=', 'head-moved'],
    ['the final head read error ignored', '--jq .head.sha 2>/dev/null) || head_now=;', '--jq .head.sha 2>/dev/null) || head_now=$head_sha;', 'head-unread'],
    ['the src/ check without --paginate', 'src_files=$(gh api --paginate', 'src_files=$(gh api', 'src-page2'],
    ['the src/ check ignoring a rename\'s old path', ', (.previous_filename // empty|"P \\(.)")', '', 'src-rename'],
    ['the src/ check without the count comparison', ' || [ "$(grep -cE \'^(F |C$)\' <<< "$src_files")" != "$src_total" ]', '', 'src-count'],
    ['the src/ check without the 3000 cap', ' || [ "$src_total" -ge 3000 ]', '', 'src-cap'],
    ['the src/ check blocking on nothing', 'if [ "$src_files" = ERR ] || [ -z "$src_files" ] || [ "$(grep -cE \'^(F |C$)\' <<< "$src_files")" != "$src_total" ] || [ "$src_total" -ge 3000 ]; then', 'if false; then', 'src-error'],
    ['the src/ check accepting a partly read list', `"P \\(.)") end') || src_files=ERR`, `"P \\(.)") end')`, 'src-partial'],
    ['the src/ check accepting an empty list', ' || [ -z "$src_files" ]', '', 'src-empty'],
    ['a control-character name not counted as src/', `grep -qE '^([FP] src/|C$)' <<< "$src_files"`, `grep -qE '^([FP] src/)' <<< "$src_files"`, 'src-ctrl'],
    ['the alerts read without a number check', '&& isnum "$a_merge" && isnum "$a_head" ', '', 'alerts-empty'],
  ];
  for (const [name, from, to, caught] of mutants) {
    assert.ok(gate.includes(from), `mutant "${name}": its anchor is in the gate`);
    const m = path.join(mdir, 'pr-gate.sh');
    fs.writeFileSync(m, gate.split(from).join(to), { mode: 0o755 });
    let msg = '';
    try { runCase(m, caught); } catch (e) { msg = (e as Error).message; }
    assert.ok(msg.startsWith(`CASE ${caught}:`), `mutant "${name}" is caught by CASE ${caught}, got: ${msg.split('\n')[0] || 'no failure'}`);
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('pr-gate codeql tests passed');
