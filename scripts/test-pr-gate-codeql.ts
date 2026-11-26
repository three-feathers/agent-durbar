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
for (const [read, what] of [['repos/$R/pulls/$p/files', 'the one file list (FR-089, FR-091)'], ['checks_out=$(gh pr checks $p)', 'the check list']]) {
  const at = gate.indexOf(read);
  assert.ok(at > 0 && gate.indexOf(read, at + 1) < 0 && at < headNowAt, `${what} is read once, before the final head read`);
}
assert.ok(prLineAt < gate.indexOf('src_files=$(gh api --paginate') && prLineAt < gate.indexOf('only_nocode; then'), 'the file list is read after pr_line');
assert.ok(!gate.includes('--json files') && !/--jq \.changed_files/.test(gate) && gate.includes('src_total=$pr_total;'), 'changed_files comes from pr_line only (FR-091), no gh pr view file list');
assert.ok(gate.includes('files=$src_files;'), 'only_nocode reuses the one file list (FR-031)');
// FR-420: a draft blocks, and the required names come from the ruleset record, never a list in the gate
assert.ok(gate.includes('$(dirname "$0")/../.github/ruleset-main.json') && !gate.includes("'Build and test (ubuntu-latest)'"), 'the gate reads the required names from .github/ruleset-main.json');
assert.ok(gate.indexOf('read -r pr_total head_sha pr_base pr_baseref pr_author pr_draft outside_pr') > prLineAt, 'the draft state comes from the one PR read (FR-090)');
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
// fixtures: checks.txt (tab-separated `gh pr checks` lines; absent = the call fails; checks.<n>.txt: what the n-th call prints instead, counted in
// checks.n; checks.late.txt: what call n prints from n = checks.after on, or when n is a multiple of checks.mod; checks.exit0: the call exits 0 whatever it lists, else 1 on a fail line and 8 on a pending line, as gh 2.100.0 does), checkruns.json and checkruns2.json (the head commit's
// check runs, pages 1 and 2; checkruns.fail: the call fails after its pages), files.json and files2.json (pages 1 and 2 of the PR
// files API: page 2 only with --paginate, as the real gh; absent = the call fails), pull.json (the PR: changed_files, head sha;
// pull-later.json: what every read after the first returns, a push while the gate runs; pull-later.fail: those reads fail),
// contents/<path> (a file at the head commit; absent = 404), alerts-merge.json / alerts-head.json / alerts-main.json (the PR's base branch; head and main also page 2 as *2.json; absent = the call fails; FR-099);
// the comment lists are empty and the PR is ours
fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/bash
F="${fx}"; prog=.; prev=
for a in "$@"; do { [ "$prev" = --jq ] || [ "$prev" = -q ]; } && prog=$a; prev=$a; done
ep=; for a in "$@"; do case $a in repos/*|graphql|user) ep=$a; break;; esac; done
case "$1 $2" in
  "repo view") echo '{"nameWithOwner":"o/r"}' | jq -r "$prog"; exit;;
  "pr checks") n=$(( $(cat "$F/checks.n" 2>/dev/null || echo 0) + 1 )); echo $n > "$F/checks.n"; c="$F/checks.txt"; [ -f "$F/checks.$n.txt" ] && c="$F/checks.$n.txt"
    [ -f "$F/checks.after" ] && [ "$n" -ge "$(cat "$F/checks.after")" ] && c="$F/checks.late.txt"; [ -f "$F/checks.mod" ] && [ $((n % $(cat "$F/checks.mod"))) = 0 ] && c="$F/checks.late.txt"
    [ -f "$c" ] || { echo "fake gh: checks failed" >&2; exit 1; }; cat "$c"; [ -f "$F/checks.exit0" ] && exit 0
    awk -F'\\t' '$2=="fail"{f=1} $2=="pending"{w=1} END{exit f ? 1 : (w ? 8 : 0)}' "$c"; exit;;
  "pr view") echo '{"mergeable":"MERGEABLE","files":[{"path":"package-lock.json"}],"labels":[]}' | jq -r "$prog"; exit;;
esac
case $ep in
  user) echo '{"login":"vikramgorla"}' | jq -r "$prog"; exit;;
  graphql) echo '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]},"comments":{"nodes":[]},"reviews":{"nodes":[]}}}}}' | jq -r "$prog"; exit;;
  repos/o/r/code-scanning/alerts?ref=refs/pull/1/merge*) f=alerts-merge;;
  repos/o/r/code-scanning/alerts?ref=refs/pull/1/head*) f=alerts-head;;
  repos/o/r/code-scanning/alerts?ref=refs/heads/*) f=alerts-main;;
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
// FR-425: the gate compares its own files with origin/main's through `git`; a fake git (scripts/fake-git.js) answers, so no case reaches the real repository.
// A case sets gitEnv (FAKE_GIT_DIFF, FAKE_GIT_FETCH_RC, FAKE_GIT_NOREPO, FAKE_GIT_LOG: see that file); runCase clears it first.
// the gate copies sit in folders that need a `.git` entry, or the gate takes them for installed copies (no checkout) and blocks (FR-425): one marker per copy root
fs.mkdirSync(path.join(dir, '.git'));
fs.writeFileSync(path.join(bin, 'git'), `#!/bin/bash\nexec node "${path.join(SCRIPTS, 'fake-git.js')}" "$@"\n`, { mode: 0o755 });
let gitEnv: Record<string, string> = {};

// the required names of the ruleset record (FR-420); a copy of the file sits where each gate copy looks for it (<gate dir>/../.github)
const RULESET = path.join(ROOT, '.github', 'ruleset-main.json');
const REQUIRED: string[] = (JSON.parse(fs.readFileSync(RULESET, 'utf8')) as { rules: Array<{ type: string; parameters?: { required_status_checks?: Array<{ context: string }> } }> }).rules
  .filter((r) => r.type === 'required_status_checks').flatMap((r) => (r.parameters?.required_status_checks ?? []).map((c) => c.context));
assert.strictEqual(REQUIRED.length, 5, 'the ruleset record names five required checks');
const listed = (state: string): string => REQUIRED.map((n) => `${n}\t${state}\t1m\thttps://x\n`).join('');
const OTHER = listed('pass');
fs.mkdirSync(path.join(dir, '.github'));
fs.copyFileSync(RULESET, path.join(dir, '.github', 'ruleset-main.json'));
const set = (name: string, v: string | null): void => {
  const f = path.join(fx, name);
  if (v === null) fs.rmSync(f, { force: true });
  else fs.writeFileSync(f, v);
};
type File = string | { filename: string; previous_filename: string };
const LOCK = { lockfileVersion: 3, packages: { '': { dependencies: { x: '^1.0.0' } }, 'node_modules/x': { version: '1.0.1', resolved: 'https://registry.npmjs.org/x/-/x-1.0.1.tgz', integrity: 'sha512-AAAA' } } };
const PKG = { name: 'prereview', scripts: { test: 'node test.js' }, dependencies: { x: '^1.0.0' } };
const fixture = (o: { codeql?: string | null; checks?: boolean; files?: File[] | null; page2?: File[]; changed?: number; contents?: Record<string, unknown>; base?: Record<string, unknown>; baseRef?: string; author?: string; merge?: unknown[] | null; head?: unknown[] | null; main?: unknown[] | null; head2?: unknown[]; main2?: unknown[]; runs?: string[] | null; runs2?: string[]; runId?: string; headSha?: string; draft?: boolean | null } = {}): void => {
  const codeql = o.codeql === undefined ? 'skipping' : o.codeql;
  set('checks.txt', o.checks === false ? null : OTHER + (codeql === null ? '' : `CodeQL\t${codeql}\t0\t${o.runId ?? 'https://github.com/o/r/runs/101'}\n`));
  const files = o.files ?? ['scripts/prereview/package-lock.json', 'scripts/prereview/package.json'];
  const page = (l: File[]): string => JSON.stringify(l.map((f) => (typeof f === 'string' ? { filename: f } : f)));
  set('files.json', o.files === null ? null : page(files));
  set('files2.json', o.page2 ? page(o.page2) : null);
  set('pull.json', JSON.stringify({ user: { login: o.author ?? 'dependabot[bot]' }, head: { sha: o.headSha ?? SHA, repo: { full_name: 'o/r' } }, base: { sha: BASE, ref: o.baseRef ?? 'main', repo: { full_name: 'o/r' } }, changed_files: o.changed ?? files.length + (o.page2 ?? []).length, ...(o.draft === null ? {} : { draft: o.draft ?? false }) }));
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
  set('alerts-main.json', o.main === null ? null : JSON.stringify(o.main ?? []));
  set('alerts-head2.json', o.head2 ? JSON.stringify(o.head2) : null);
  set('alerts-main2.json', o.main2 ? JSON.stringify(o.main2) : null);
  set('files.fail', null);
  set('pull-later.json', null);
  set('pull-later.fail', null);
  set('pull.seen', null);
  set('checkruns.fail', null);
  for (const f of fs.readdirSync(fx)) if (/^checks\.(\d+\.txt|n|exit0|after|mod|late\.txt)$/.test(f) || f.startsWith('sleep.')) fs.rmSync(path.join(fx, f));
  // the head commit's check runs, "name@slug" or "name@slug#id" (id 101 by default, the run the CodeQL line links): by default one CodeQL
  // run from GitHub's code-scanning app (null: the call fails)
  const runs = (l: string[]): string => JSON.stringify({ check_runs: l.map((x) => { const [name, rest] = x.split('@'); const [slug, id] = rest.split('#'); return { name, id: Number(id ?? 101), app: { slug } }; }) });
  set('checkruns.json', o.runs === null ? null : runs(o.runs ?? ['CodeQL@github-advanced-security', 'Spec Kit gate@github-actions']));
  set('checkruns2.json', o.runs2 ? runs(o.runs2) : null);
};
// a fake sleep for --wait (it returns at once), on the PATH only for the cases that pass --wait: it writes its seconds to sleep.log, and after
// SLEEP_CAP calls (more than the gate's bound of 240 rounds allows) it writes sleep.over and stops the gate, so a gate without the bound fails a
// case's own count assert instead of hanging until a time limit
const SLEEP_CAP = 400;
const waitBin = path.join(dir, 'waitbin');
fs.mkdirSync(waitBin);
fs.writeFileSync(path.join(waitBin, 'sleep'), `#!/bin/bash
echo "$1" >> "${fx}/sleep.log"
[ "$(wc -l < "${fx}/sleep.log")" -gt ${SLEEP_CAP} ] && { : > "${fx}/sleep.over"; kill -TERM $PPID; exit 1; }
exit 0
`, { mode: 0o755 });
const sleeps = (): string[] => { try { return fs.readFileSync(path.join(fx, 'sleep.log'), 'utf8').split('\n').filter(Boolean); } catch { return []; } };
const waitRun = (g: string): { code: number | null; out: string } => { gateArgs = ['--wait']; try { return run(g); } finally { gateArgs = []; } };
let gateArgs: string[] = [];
const run = (gatePath: string): { code: number | null; out: string } => {
  const wait = gateArgs.includes('--wait');
  const r = spawnSync('bash', [gatePath, '1', ...gateArgs], { env: { ...(wait ? { ...env, PATH: `${waitBin}${path.delimiter}${env.PATH}` } : env), ...gitEnv }, encoding: 'utf8', timeout: wait ? 90000 : 60000 });
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
// a copy of the gate in its own folder, beside a ruleset record of the case's own (null: none; a string: the file's text)
const gateWith = (g: string, record: unknown): string => {
  const d = path.join(dir, 'own-ruleset', 'scripts');
  fs.rmSync(path.join(dir, 'own-ruleset'), { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  fs.mkdirSync(path.join(d, '..', '.git'));
  for (const f of ['trusted-lib.sh', 'trusted-authors.txt', 'pr-status-note.re', 'pr-gate-answered.awk']) fs.copyFileSync(path.join(SCRIPTS, f), path.join(d, f));
  fs.copyFileSync(g, path.join(d, 'pr-gate.sh'));
  if (record !== null) {
    fs.mkdirSync(path.join(d, '..', '.github'));
    fs.writeFileSync(path.join(d, '..', '.github', 'ruleset-main.json'), typeof record === 'string' ? record : JSON.stringify(record));
  }
  return path.join(d, 'pr-gate.sh');
};
const withNames = (extra: unknown[]): object => ({ rules: [{ type: 'pull_request' }, { type: 'required_status_checks', parameters: { required_status_checks: [...REQUIRED.map((context) => ({ context })), ...extra] } }] });
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
  // FR-099 (#1868): CodeQL on the head ref also lists main's open alerts: a head-ref alert counts only when main does not hold it too
  'alert-main-on-head: main\'s own alert on the head ref does not block': R({ head: [{ number: 107 }], main: [{ number: 107 }] }),
  'alert-new-and-main: a new head-ref alert beside main\'s counts once': N({ head: [{ number: 107 }, { number: 108 }], main: [{ number: 107 }] }, /alerts=1/),
  'alert-merge-main: a merge-ref alert counts even when main holds it': N({ merge: [{ number: 107 }], main: [{ number: 107 }] }, /alerts=1/),
  'alert-head-page2: a new alert on page 2 of the head ref counts': N({ head: [{ number: 107 }], main: [{ number: 107 }], head2: [{ number: 108 }] }, /alerts=1/),
  'alert-main-page2: main\'s alert on page 2 of its list is subtracted': R({ head: [{ number: 107 }], main: [{ number: 1 }], main2: [{ number: 107 }] }),
  'alert-main-unread: main\'s alerts cannot be read': N({ main: null }, /alerts=unread/),
  'alert-main-number: a non-number in main\'s list': N({ head: [{ number: 1 }], main: [{ number: 'x' }] }, /alerts=unread/),
  'alert-base-ref: a base branch name that is not plain': N({ baseRef: 'a;b' }, /alerts=unread/),
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
  // the file list must be read whole (FR-091, #1422); since FR-420 the required checks are wanted on every PR, not only one that changes src/
  'src-page2: src/a.ts on the second page of the file list, read whole': R({ codeql: 'pass', files: ['docs/a.md'], page2: ['src/a.ts'] }),
  'src-docs-only: docs only, the required checks absent': N({ codeql: 'pass', files: ['docs/a.md'], page2: ['docs/b.md'] }, /missing:Spec Kit gate/, noGates),
  // FR-420: a draft is never ready; every required name exactly pass on every PR; the ruleset record must be readable
  'draft: a green draft': N({ codeql: 'pass', files: ['src/main/a.ts'], draft: true }, /checks=\[ draft\(mark it ready first\)\][^\n]*\na draft: CI runs its jobs only after the ready mark/),
  'draft-missing: no draft field in the PR read': N({ codeql: 'pass', files: ['src/main/a.ts'], draft: null }, /draft-unread/),
  'required-skipping: a ready docs-only PR whose required checks are skipping': (g, l) => {
    fixture({ codeql: 'pass', files: ['docs/a.md'], author: 'vikramgorla' });
    set('checks.txt', `${listed('skipping')}CodeQL\tpass\t0\thttps://github.com/o/r/runs/101\n`);
    const r = run(g);
    assert.ok(r.code === 1 && REQUIRED.every((n) => r.out.includes(`missing:${n}`)), `${l}: not ready, every required name missing\n${r.out}`);
  },
  'required-twice: a required name listed passed and skipping': N({ codeql: 'pass', files: ['docs/a.md'] }, /missing:Office layout check \(xvfb\)/, () => set('checks.txt', `${OTHER}Office layout check (xvfb)\tskipping\t0\thttps://x\nCodeQL\tpass\t0\thttps://github.com/o/r/runs/101\n`)),
  'spec-only: a spec-only PR with the five required checks passed': R({ files: ['specs/021-x/spec.md', 'specs/021-x/tasks.md'], author: 'vikramgorla' }),
  'ruleset-missing: no ruleset record beside the gate': (g, l) => {
    fixture({ codeql: 'pass', files: ['src/main/a.ts'] });
    notReady(gateWith(g, null), `${l}: missing`, /required-unread/);
    notReady(gateWith(g, { rules: [{ type: 'pull_request' }] }), `${l}: no required names`, /required-unread/);
    notReady(gateWith(g, '{ not json'), `${l}: unreadable`, /required-unread/);
  },
  // a bad entry after the five good names: without the name check it would be dropped (an empty last line) and the gate would say ready
  'ruleset-bad-name: a required entry without a usable name': (g, l) => {
    fixture({ codeql: 'pass', files: ['src/main/a.ts'] });
    for (const [what, bad] of [['no context', {}], ['a null context', { context: null }], ['a number', { context: 7 }], ['an empty name', { context: '' }], ['a tab', { context: 'a\tb' }], ['a line break', { context: 'a\nb' }], ['a carriage return', { context: 'a\r' }]] as Array<[string, unknown]>) {
      notReady(gateWith(g, withNames([bad])), `${l}: ${what}`, /required-unread/);
    }
  },
  // a backslash in a name is matched as written (awk -v would read "x\ty" as x, a tab, y and never find it)
  'required-backslash: a required name with a backslash, passed': (g, l) => {
    fixture({ codeql: 'pass', files: ['src/main/a.ts'] });
    set('checks.txt', `${OTHER}x\\ty\tpass\t1m\thttps://x\nCodeQL\tpass\t0\thttps://github.com/o/r/runs/101\n`);
    ready(gateWith(g, withNames([{ context: 'x\\ty' }])), l);
  },
  // --wait (gh exits 1 when a check failed, 8 while one is pending): a failed required check ends the wait, and the gate says why
  'wait-failed: --wait on a PR with a failed check': (g, l) => {
    fixture({ codeql: 'pass', files: ['src/main/a.ts'] });
    set('checks.txt', `${OTHER.replace('Spec Kit gate\tpass', 'Spec Kit gate\tfail')}CodeQL\tpass\t0\thttps://github.com/o/r/runs/101\n`);
    const r = waitRun(g);
    assert.ok(sleeps().join(' ') === '90' && !r.out.includes('wait-deadline'), `${l}: the failed check ends the wait at once (only the 90 s pause), got ${sleeps().length} sleeps [${sleeps().slice(0, 4).join(' ')}]\n${r.out}`);
    assert.ok(r.code === 1 && r.out.includes('#1 not ready') && /Spec Kit gate=fail .*missing:Spec Kit gate/.test(r.out), `${l}: not ready\n${r.out}`);
  },
  // the bound: a check pending for ever ends the wait after 240 rounds of 30 s (7200 s), and the verdict says so
  'wait-deadline: --wait on a check that stays pending for ever': (g, l) => {
    fixture({ codeql: 'pass', files: ['src/main/a.ts'] });
    set('checks.txt', `${OTHER.replace('Spec Kit gate\tpass', 'Spec Kit gate\tpending')}CodeQL\tpass\t0\thttps://github.com/o/r/runs/101\n`);
    const r = waitRun(g);
    const s = sleeps();
    assert.ok(!fs.existsSync(path.join(fx, 'sleep.over')) && s.length === 240 && s.every((x) => x === '30'), `${l}: the wait stops at its own bound (240 sleeps of 30 s), got ${s.length} sleeps\n${r.out}`);
    assert.ok(r.code === 1 && r.out.includes('#1 not ready') && /wait-deadline\(/.test(r.out) && /Spec Kit gate=pending/.test(r.out), `${l}: not ready, wait-deadline\n${r.out}`);
  },
  // the bound in the first loop, the check passed in the verdict's own read: every wait read (one call a round, gh exits 8 so pend is not
  // asked: 240 rounds, then the read before the bound check, calls 1-241) is pending, call 242 on (the verdict's read and after) all passed
  'wait-deadline-cleared: --wait at the bound, the check passed only in the verdict read': (g, l) => {
    fixture({ codeql: 'pass', files: ['src/main/a.ts'] });
    set('checks.txt', `${OTHER.replace('Spec Kit gate\tpass', 'Spec Kit gate\tpending')}CodeQL\tpass\t0\thttps://github.com/o/r/runs/101\n`);
    set('checks.late.txt', `${OTHER}CodeQL\tpass\t0\thttps://github.com/o/r/runs/101\n`);
    set('checks.after', '242');
    const r = waitRun(g);
    const s = sleeps();
    assert.ok(!fs.existsSync(path.join(fx, 'sleep.over')) && s.length === 240 && s.every((x) => x === '30'), `${l}: the wait stops at its own bound (240 sleeps of 30 s), got ${s.length} sleeps\n${r.out}`);
    assert.ok(r.code === 1 && r.out.includes('#1 not ready') && /wait-deadline\(/.test(r.out) && !/=pending/.test(r.out), `${l}: not ready, wait-deadline though the verdict read is all passed\n${r.out}`);
  },
  // the bound after the second look: clear at each first look (gh and pend, 2 calls), pending after each 90 s pause (every 3rd call)
  'wait-flapping: --wait, clear at each first look and pending after each pause': (g, l) => {
    fixture({ codeql: 'pass', files: ['src/main/a.ts'] });
    set('checks.late.txt', `${OTHER}Late check\tpending\t0\thttps://x\nCodeQL\tpass\t0\thttps://github.com/o/r/runs/101\n`);
    set('checks.mod', '3');
    const r = waitRun(g);
    const s = sleeps();
    assert.ok(!fs.existsSync(path.join(fx, 'sleep.over')) && s.length === 80 && s.every((x) => x === '90'), `${l}: the wait stops at its own bound after the second look (80 pauses of 90 s), got ${s.length} sleeps\n${r.out}`);
    assert.ok(r.code === 1 && r.out.includes('#1 not ready') && /wait-deadline\(/.test(r.out), `${l}: not ready, wait-deadline\n${r.out}`);
  },
  // exact names: "<name> part 1/2" and "part 2/2" passed do not stand for "<name>"
  'required-prefix: only "<required name> part 1/2" and "part 2/2" listed, both passed': N({ codeql: 'pass', files: ['src/main/a.ts'] }, /missing:Build and test \(ubuntu-latest\)/, () => set('checks.txt', `${OTHER.replace('Build and test (ubuntu-latest)\tpass\t1m\thttps://x\n', 'Build and test (ubuntu-latest) part 1/2\tpass\t1m\thttps://x\nBuild and test (ubuntu-latest) part 2/2\tpass\t1m\thttps://x\n')}CodeQL\tpass\t0\thttps://github.com/o/r/runs/101\n`)),
  // a pending line while gh exits 0: the gate waits on it (one 30 s round) before the 90 s pause, then reads the passed list
  'wait-pending-line: --wait, gh exits 0 but a line says pending': (g, l) => {
    fixture({ codeql: 'pass', files: ['src/main/a.ts'] });
    const pending = `${OTHER}CodeQL\tpending\t0\thttps://github.com/o/r/runs/101\n`;
    set('checks.1.txt', pending);
    set('checks.2.txt', pending);
    set('checks.exit0', '');
    const r = waitRun(g);
    assert.ok(sleeps().join(' ') === '30 90', `${l}: a 30 s round on the pending line before the 90 s pause, got [${sleeps().join(' ')}]\n${r.out}`);
    assert.ok(r.code === 0 && r.out.includes('ready to merge'), `${l}: ready\n${r.out}`);
  },
  // the second look: a check that shows as pending only after the 90 s pause is waited for, not read as the verdict
  'wait-second-look: --wait, a check pending only in the look after the 90 s pause': (g, l) => {
    fixture({ codeql: 'pass', files: ['src/main/a.ts'] });
    const late = (st: string): string => `${OTHER}Late check\t${st}\t0\thttps://x\nCodeQL\tpass\t0\thttps://github.com/o/r/runs/101\n`;
    set('checks.txt', late('pass'));
    set('checks.1.txt', `${OTHER}CodeQL\tpass\t0\thttps://github.com/o/r/runs/101\n`);
    set('checks.2.txt', `${OTHER}CodeQL\tpass\t0\thttps://github.com/o/r/runs/101\n`);
    set('checks.3.txt', late('pending'));
    set('checks.4.txt', late('pending'));
    const r = waitRun(g);
    assert.ok(r.code === 0 && r.out.includes('ready to merge'), `${l}: ready (waited for the late check)\n${r.out}`);
  },
  'src-count: the API lists fewer files than the PR changed': N({ codeql: 'pass', files: ['docs/a.md'], changed: 2 }, /src-check-unreadable/),
  'src-cap: 3000 files, where the files API stops': N({ codeql: 'pass', files: Array.from({ length: 3000 }, (_, i) => `docs/f${i}.md`) }, /src-check-unreadable/),
  'src-error: the file list cannot be read': N({ codeql: 'pass', files: null }, /src-check-unreadable/),
  'src-partial: the file list fails after its first page': N({ codeql: 'pass', files: ['docs/a.md'] }, /src-check-unreadable/, () => set('files.fail', '')),
  'src-empty: the files API lists no file (changed_files 0)': N({ codeql: 'pass', files: [], changed: 0 }, /src-check-unreadable/),
  // FR-425: the gate's own files must equal origin/main's; a fetch that fails, or a folder that is no checkout, blocks too
  'stale-gate: gate files that differ from origin/main': N({ codeql: 'pass', files: ['src/main/a.ts'] }, /stale-gate\(scripts\/pr-gate\.sh scripts\/trusted-authors\.txt: run the gate from a checkout at origin\/main\)/, () => { gitEnv = { FAKE_GIT_DIFF: 'scripts/trusted-authors.txt scripts/pr-gate.sh' }; }),
  'stale-each: every gate input is compared': (g, l) => {
    for (const f of ['scripts/pr-gate.sh', 'scripts/trusted-lib.sh', 'scripts/trusted-authors.txt', 'scripts/pr-gate-answered.awk', 'scripts/pr-status-note.re', '.github/ruleset-main.json', 'scripts/safe-print.js']) {
      fixture({ codeql: 'pass', files: ['src/main/a.ts'] });
      gitEnv = { FAKE_GIT_DIFF: f };
      notReady(g, `${l} (${f})`, new RegExp(`stale-gate\\(${f.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}: run the gate`));
    }
  },
  'stale-missing: a gate file that origin/main lacks': N({ codeql: 'pass', files: ['src/main/a.ts'] }, /stale-gate\(scripts\/pr-status-note\.re: run the gate/, () => { gitEnv = { FAKE_GIT_MISSING: 'scripts/pr-status-note.re' }; }),
  'stale-fetch: the fetch of origin main fails': N({ codeql: 'pass', files: ['src/main/a.ts'] }, /stale-gate\(git fetch origin main failed: the gate files cannot be compared/, () => { gitEnv = { FAKE_GIT_FETCH_RC: '1' }; }),
  'stale-norepo: the folder has no .git at all': (g, l) => {
    // a copy of the gate in a folder with no `.git` entry (an installed copy): blocked as no checkout
    const d = path.join(dir, 'nogit', 'scripts');
    fs.rmSync(path.join(dir, 'nogit'), { recursive: true, force: true });
    fs.mkdirSync(d, { recursive: true });
    for (const f of ['trusted-authors.txt', 'pr-status-note.re', 'pr-gate-answered.awk']) fs.copyFileSync(path.join(SCRIPTS, f), path.join(d, f));
    fs.copyFileSync(path.join(path.dirname(g), 'trusted-lib.sh'), path.join(d, 'trusted-lib.sh')); // the lib that sits beside the gate under test (a lib mutant is one)
    fs.copyFileSync(g, path.join(d, 'pr-gate.sh'));
    fixture({ codeql: 'pass', files: ['src/main/a.ts'] });
    notReady(path.join(d, 'pr-gate.sh'), l, /stale-gate\(not a git checkout/);
  },
  'stale-gitfails: git fails in a folder that has a .git': N({ codeql: 'pass', files: ['src/main/a.ts'] }, /stale-gate\(git fails in this checkout, dubious ownership or no git\?/, () => { gitEnv = { FAKE_GIT_NOREPO: '1' }; }),
  'stale-equal: equal files pass, after one fetch of origin main': (g, l) => {
    const log = path.join(fx, 'git.log');
    fs.rmSync(log, { force: true });
    gitEnv = { FAKE_GIT_LOG: log };
    fixture({ codeql: 'pass', files: ['src/main/a.ts'] });
    ready(g, l);
    const calls = fs.readFileSync(log, 'utf8').split('\n').filter((c) => /fetch/.test(c));
    assert.ok(calls.length === 1 && /fetch -q origin \+refs\/heads\/main:refs\/remotes\/origin\/main$/.test(calls[0]), `${l}: one fetch of origin main with the explicit refspec, got ${JSON.stringify(calls)}`);
  },
  'checks-error: the check list cannot be read': N({ checks: false }, /codeql=missing /),
};
const runCase = (g: string, name: string): void => {
  gitEnv = {};
  const k = Object.keys(CASES).find((c) => c.startsWith(`${name}:`));
  assert.ok(k, `no case ${name}`);
  CASES[k as string](g, `CASE ${k}`);
};

try {
  for (const name of Object.keys(CASES)) runCase(path.join(SCRIPTS, 'pr-gate.sh'), name.split(':')[0]);
  // mutants: a copy of the gate next to copies of the files it sources; each must fail the case named
  const mdir = path.join(dir, 'mutant');
  fs.mkdirSync(mdir);
  for (const f of ['trusted-lib.sh', 'trusted-authors.txt', 'pr-status-note.re', 'pr-gate-answered.awk']) fs.copyFileSync(path.join(SCRIPTS, f), path.join(mdir, f));
  // an optional fifth field names the assert the mutant must fail at, when a case holds more than one
  const mutants: Array<[string, string, string, string, string?]> = [
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
    ['the file list without --paginate', 'src_files=$(gh api --paginate', 'src_files=$(gh api', 'src-page2'],
    ['the file list without the count comparison', ' || [ "$(grep -cE \'^(F |C$)\' <<< "$src_files")" != "$src_total" ]', '', 'src-count'],
    ['the file list without the 3000 cap', ' || [ "$src_total" -ge 3000 ]', '', 'src-cap'],
    ['the file list blocking on nothing', 'if [ "$src_files" = ERR ] || [ -z "$src_files" ] || [ "$(grep -cE \'^(F |C$)\' <<< "$src_files")" != "$src_total" ] || [ "$src_total" -ge 3000 ]; then', 'if false; then', 'src-error'],
    ['the file list accepting a partly read list', `"P \\(.)") end') || src_files=ERR`, `"P \\(.)") end')`, 'src-partial'],
    ['the file list accepting an empty list', ' || [ -z "$src_files" ]', '', 'src-empty'],
    ['the merge count read without a number check', '[ -n "$a_merge" ] && ', '', 'alerts-empty'],
    ['the head ref counted whole (main\'s alerts not subtracted)', `grep -cvxF -f <(printf '%s\\n' "$a_base_nums") <<< "$a_head_nums"`, 'grep -c . <<< "$a_head_nums"', 'alert-main-on-head'],
    ['the merge ref left out of the sum', 'alerts=$((a_merge + a_head))', 'alerts=$a_head', 'alert-merge'],
    ['main\'s list without --paginate', 'gh api --paginate "repos/$R/code-scanning/alerts?ref=refs/heads/', 'gh api "repos/$R/code-scanning/alerts?ref=refs/heads/', 'alert-main-page2'],
    ['the head list without --paginate', 'gh api --paginate "repos/$R/code-scanning/alerts?ref=refs/pull/$p/head', 'gh api "repos/$R/code-scanning/alerts?ref=refs/pull/$p/head', 'alert-head-page2'],
    ['a main read error ignored', '|| a_base_nums=ERR;; esac', '|| a_base_nums=;; esac', 'alert-main-unread'],
    ['the main list not checked for numbers', "numlist() { [ -z \"$1\" ] || ! grep -qvE '^[0-9]+$' <<< \"$1\"; }", 'numlist() { true; }', 'alert-main-number'],
    ['the draft test removed', 'true) bad="$bad draft(mark it ready first)";;', 'true) ;;', 'draft'],
    ['a missing draft field accepted', `*) bad="$bad draft-unread(the PR's draft state cannot be read)";;`, '*) ;;', 'draft-missing'],
    ['skipping accepted for a required name', 'if($2!="pass") b=1', 'if($2!="pass" && $2!="skipping") b=1', 'required-skipping'],
    ['one passed line enough for a required name', 'END{exit !(f && !b)}', 'END{exit !f}', 'required-twice'],
    ['the required names asked only when src/ changes', 'while IFS= read -r need; do', `grep -qE '^([FP] src/|C$)' <<< "$src_files" && while IFS= read -r need; do`, 'src-docs-only'],
    ['an unreadable ruleset record accepted (no reason added)', 'bad="$bad required-unread(.github/ruleset-main.json: no required check names)"', ':', 'ruleset-missing'],
    ['the name check removed', 'if(!n.length||n.some((s)=>typeof s!=="string"||!/^[^\\t\\r\\n]+$/.test(s)))process.exit(1);', 'if(!n.length)process.exit(1);', 'ruleset-bad-name'],
    ['the required name passed to awk with -v', `need="$need" awk -F'\\t' '$1==ENVIRON["need"]`, `awk -F'\\t' -v n="$need" '$1==n`, 'required-backslash'],
    ['the wait going on after a failed check', 'until gh pr checks $p >/dev/null 2>&1; [ $? != 8 ] && ! pend; do', 'until gh pr checks $p >/dev/null 2>&1 && ! pend; do', 'wait-failed', 'the failed check ends the wait at once'],
    ['--wait without its bound', 'wait_more() { [ "$waited" -lt 240 ] || { wait_cut=1; return 1; }; }', 'wait_more() { true; }', 'wait-deadline', 'the wait stops at its own bound'],
    ['the wait-deadline reason not added', '[ -n "$wait_cut" ] && bad=', 'false && bad=', 'wait-deadline', 'not ready, wait-deadline'],
    ['the wait-deadline reason only while a check is pending', '[ -n "$wait_cut" ] && bad=', '[ -n "$wait_cut" ] && pend && bad=', 'wait-deadline-cleared', 'not ready, wait-deadline though the verdict read is all passed'],
    ['the bound after the second look removed', '  wait_more || break\ndone', 'done', 'wait-flapping', 'the wait stops at its own bound after the second look'],
    ['a required name matched by prefix', `need="$need" awk -F'\\t' '$1==ENVIRON["need"]`, `need="$need" awk -F'\\t' 'index($1,ENVIRON["need"])==1`, 'required-prefix'],
    ['the pending-line test removed from the wait', '[ $? != 8 ] && ! pend; do', '[ $? != 8 ]; do', 'wait-pending-line'],
    ['the second look after the 90 s pause removed', '  pend || break\n', '  break\n', 'wait-second-look'],
    ['the stale compare skipped', 'stale=$(gate_stale $GATE_FILES); case $? in', 'stale=; case 0 in', 'stale-gate'],
    ['a failed fetch ignored', '  2) bad="$bad stale-gate(git fetch origin main failed', '  2) : "$bad stale-gate(git fetch origin main failed', 'stale-fetch'],
    ['a folder with no checkout accepted', '  3) bad="$bad stale-gate(not a git checkout', '  3) : "$bad stale-gate(not a git checkout', 'stale-norepo'],
    ['a git failure in a checkout accepted', '  *) bad="$bad stale-gate(git fails in this checkout', '  *) : "$bad stale-gate(git fails in this checkout', 'stale-gitfails'],
    ['the draft line removed', '[ "$pr_draft" = true ] && echo "a draft:', 'false && echo "a draft:', 'draft'],
    ['the base branch name not checked', "case $pr_baseref in ''|*[!A-Za-z0-9._/-]*|*..*) a_base_nums=ERR;;", "case $pr_baseref in 'zzzz') a_base_nums=ERR;;", 'alert-base-ref'],
  ];
  for (const [name, from, to, caught, at] of mutants) {
    assert.ok(gate.includes(from), `mutant "${name}": its anchor is in the gate`);
    const m = path.join(mdir, 'pr-gate.sh');
    assert.notStrictEqual(gate.split(from).join(to), gate, `mutation did not apply: ${name}`);
    fs.writeFileSync(m, gate.split(from).join(to), { mode: 0o755 });
    let msg = '';
    try { runCase(m, caught); } catch (e) { msg = (e as Error).message; }
    assert.ok(msg.startsWith(`CASE ${caught}:`) && (!at || msg.split('\n')[0].includes(at)), `mutant "${name}" is caught by CASE ${caught}${at ? ` at "${at}"` : ''}, got: ${msg.split('\n')[0] || 'no failure'}`);
    if (process.env.DURBAR_MUTANT_LOG) console.log(`mutant "${name}": ${msg.split('\n')[0]}`);
  }
  // the same, for the compare itself, which lives in trusted-lib.sh: the mutated lib sits beside the unchanged gate copy, then is put back
  const lib = fs.readFileSync(path.join(SCRIPTS, 'trusted-lib.sh'), 'utf8').replace(/\r\n/g, '\n');
  fs.copyFileSync(path.join(SCRIPTS, 'pr-gate.sh'), path.join(mdir, 'pr-gate.sh'));
  const libMutants: Array<[string, string, string, string]> = [
    ['HEAD compared instead of the file on disk', 'have=$(git -C "$_trusted_root" hash-object -- "$f" 2>/dev/null)', 'have=$(git -C "$_trusted_root" rev-parse --verify -q "HEAD:$f" 2>/dev/null)', 'stale-gate'],
    ['the fetch skipped', 'git -C "$_trusted_root" fetch -q origin +refs/heads/main:refs/remotes/origin/main >/dev/null 2>&1 || return 2', 'true', 'stale-fetch'],
    ['a git failure in a checkout read as an installed copy', 'rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 4', 'rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 3', 'stale-gitfails'],
    ['the .git test removed', '[ -e "$_trusted_root/.git" ] || return 3\n', '', 'stale-norepo'],
    ['a plain fetch of origin main', 'fetch -q origin +refs/heads/main:refs/remotes/origin/main >/dev/null', 'fetch -q origin main >/dev/null', 'stale-equal'],
    ['a file missing on origin/main counted equal', '|| { echo "$f"; continue; }\n    have=', '|| continue\n    have=', 'stale-missing'],
    ['one gate input left out of the compare', 'scripts/pr-status-note.re .github/ruleset-main.json scripts/safe-print.js"', 'scripts/pr-status-note.re scripts/safe-print.js"', 'stale-each'],
  ];
  for (const [name, from, to, caught] of libMutants) {
    assert.ok(lib.includes(from), `lib mutant "${name}": its anchor is in trusted-lib.sh`);
    assert.notStrictEqual(lib.split(from).join(to), lib, `mutation did not apply: lib mutant ${name}`);
    fs.writeFileSync(path.join(mdir, 'trusted-lib.sh'), lib.split(from).join(to));
    let msg = '';
    try { runCase(path.join(mdir, 'pr-gate.sh'), caught); } catch (e) { msg = (e as Error).message; }
    assert.ok(msg.startsWith(`CASE ${caught}:`), `lib mutant "${name}" is caught by CASE ${caught}, got: ${msg.split('\n')[0] || 'no failure'}`);
    if (process.env.DURBAR_MUTANT_LOG) console.log(`lib mutant "${name}": ${msg.split('\n')[0]}`);
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('pr-gate codeql tests passed');
