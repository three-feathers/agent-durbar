/*
 * scripts/pr-gate.sh and a CodeQL check GitHub skipped (spec 021 FR-089, issue #1420): a `skipping` or absent CodeQL check counts as passed
 * only when the check list was read, every changed file is on the no-code list and the open alerts are 0; anything else blocks (fail closed).
 * Runs the gate against a fake `gh` (bash, answers from fixture files, applies each `--jq` / `-q` with the real jq), then plants two mutants
 * in a copy of the gate (a failing CodeQL treated as skipped; the file filter removed) and checks each is caught by its labelled assert.
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
assert.ok(gate.includes('gh pr diff $p --name-only'), 'pr-gate.sh reads the changed files');
assert.ok(gate.includes('[ -z "$codeql_ok" ]'), 'the verdict uses codeql_ok, not a raw state');

const bash = process.platform === 'win32' ? null : spawnSync('bash', ['-c', 'command -v jq'], { encoding: 'utf8' });
if (!bash || bash.status !== 0) {
  console.log('pr-gate codeql: no bash or jq here, static checks only');
  console.log('pr-gate codeql tests passed');
  process.exit(0);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-gate-codeql-'));
const bin = path.join(dir, 'bin');
const fx = path.join(dir, 'fx');
fs.mkdirSync(bin);
fs.mkdirSync(fx);
// fixtures: checks.txt (tab-separated `gh pr checks` lines; absent = the call fails), diff.txt (absent = the call fails),
// alerts-merge.json / alerts-head.json (absent = the call fails); the comment lists are empty and the PR is ours
fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/bash
F="${fx}"; prog=.; prev=
for a in "$@"; do { [ "$prev" = --jq ] || [ "$prev" = -q ]; } && prog=$a; prev=$a; done
ep=; for a in "$@"; do case $a in repos/*|graphql|user) ep=$a; break;; esac; done
case "$1 $2" in
  "repo view") echo '{"nameWithOwner":"o/r"}' | jq -r "$prog"; exit;;
  "pr checks") [ -f "$F/checks.txt" ] || { echo "fake gh: checks failed" >&2; exit 1; }; cat "$F/checks.txt"; exit;;
  "pr diff") [ -f "$F/diff.txt" ] || { echo "fake gh: diff failed" >&2; exit 1; }; cat "$F/diff.txt"; exit;;
  "pr view") echo '{"mergeable":"MERGEABLE","files":[{"path":"package-lock.json"}],"labels":[]}' | jq -r "$prog"; exit;;
esac
case $ep in
  user) echo '{"login":"vikramgorla"}' | jq -r "$prog"; exit;;
  graphql) echo '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]},"comments":{"nodes":[]},"reviews":{"nodes":[]}}}}}' | jq -r "$prog"; exit;;
  repos/o/r/code-scanning/alerts?ref=refs/pull/1/merge*) f=alerts-merge;;
  repos/o/r/code-scanning/alerts?ref=refs/pull/1/head*) f=alerts-head;;
  repos/o/r/pulls/1) echo '{"user":{"login":"dependabot[bot]"},"head":{"repo":{"full_name":"o/r"}},"base":{"repo":{"full_name":"o/r"}}}' | jq -r "$prog"; exit;;
  repos/o/r/pulls/1/reviews|repos/o/r/issues/1/comments|repos/o/r/pulls/1/comments) echo '[]' | jq -r "$prog"; exit;;
  *) echo "fake gh: no fixture for $*" >&2; exit 9;;
esac
[ -f "$F/$f.json" ] || { echo "fake gh: $f failed" >&2; exit 1; }
jq -r "$prog" < "$F/$f.json"
`, { mode: 0o755 });
const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };

const OTHER = 'Build and test (ubuntu-latest)\tpass\t1m\thttps://x\nSpec Kit gate\tpass\t1m\thttps://x\n';
const set = (name: string, v: string | null): void => {
  const f = path.join(fx, name);
  if (v === null) fs.rmSync(f, { force: true });
  else fs.writeFileSync(f, v);
};
const fixture = (o: { codeql?: string | null; checks?: boolean; files?: string[] | null; merge?: unknown[] | null; head?: unknown[] | null } = {}): void => {
  const codeql = o.codeql === undefined ? 'skipping' : o.codeql;
  set('checks.txt', o.checks === false ? null : OTHER + (codeql === null ? '' : `CodeQL\t${codeql}\t0\thttps://x\n`));
  set('diff.txt', o.files === null ? null : `${(o.files ?? ['scripts/prereview/package-lock.json', 'scripts/prereview/package.json']).join('\n')}\n`);
  set('alerts-merge.json', o.merge === null ? null : JSON.stringify(o.merge ?? []));
  set('alerts-head.json', o.head === null ? null : JSON.stringify(o.head ?? []));
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

// every case, against a given copy of the gate; each assert's label names the case, so a mutant's failure says which case caught it
const cases = (g: string): void => {
  fixture({ codeql: 'pass', files: ['src/main/a.ts'] });
  ready(g, 'CASE pass: a passed CodeQL');
  fixture();
  ready(g, 'CASE lockfile-skipped: a lockfile-only PR, CodeQL skipping, 0 alerts');
  const r = run(g);
  assert.ok(r.out.includes('CodeQL skipped (no analysed files)'), `CASE lockfile-skipped: the verdict says why\n${r.out}`);
  fixture({ codeql: null, files: ['docs/a.md', 'docs/pics/a.png', 'package-lock.json', 'specs/021-x/spec.md'] });
  ready(g, 'CASE no-codeql-check: docs, a picture and the root lockfile, no CodeQL check at all');
  fixture({ merge: [{ number: 1 }] });
  notReady(g, 'CASE alert-merge: lockfile-only, 1 alert on the merge ref', /alerts=1/);
  fixture({ head: [{ number: 1 }] });
  notReady(g, 'CASE alert-head: lockfile-only, 1 alert on the head ref', /alerts=1/);
  fixture({ codeql: 'fail' });
  notReady(g, 'CASE codeql-fail: a failing CodeQL on a lockfile-only PR', /codeql=fail/);
  fixture({ codeql: 'pending' });
  notReady(g, 'CASE codeql-pending: a pending CodeQL', /codeql=pending/);
  fixture({ codeql: 'cancel' });
  notReady(g, 'CASE codeql-cancel: a cancelled CodeQL', /codeql=cancel/);
  fixture({ files: ['scripts/prereview/package-lock.json', 'src/main/a.ts'] });
  notReady(g, 'CASE skipped-with-src: CodeQL skipped on a PR that changes src/*.ts', /codeql=skipping\(analysed or unknown files changed\)/);
  fixture({ codeql: null, files: ['src/main/a.ts'] });
  notReady(g, 'CASE missing-with-src: no CodeQL check on a PR that changes src/*.ts', /codeql=missing\(analysed or unknown files changed\)/);
  for (const f of ['scripts/trusted-authors.txt', 'package.json', 'docs/site/app.js', '.github/workflows/ci.yml', 'docs/a.svg', 'README.MD', 'scripts/x/package.json.bak', 'evil-package-lock.json']) {
    fixture({ files: ['docs/a.md', f] });
    notReady(g, `CASE unknown-file: ${f} is not on the no-code list`, /codeql=skipping\(analysed or unknown files changed\)/);
  }
  fixture({ files: [] });
  notReady(g, 'CASE empty-diff: no changed files read', /codeql=skipping\(/);
  fixture({ files: null });
  notReady(g, 'CASE diff-error: the file list cannot be read', /codeql=skipping\(/);
  fixture({ merge: null });
  notReady(g, 'CASE alerts-error: the alerts cannot be read', /alerts=unread/);
  fixture();
  set('alerts-merge.json', '');
  notReady(g, 'CASE alerts-empty: the alerts call prints no number', /alerts=unread/);
  fixture({ checks: false });
  notReady(g, 'CASE checks-error: the check list cannot be read', /codeql=/);
};

try {
  cases(path.join(SCRIPTS, 'pr-gate.sh'));
  // mutants: a copy of the gate next to copies of the files it sources; each must fail the case named
  const mdir = path.join(dir, 'mutant');
  fs.mkdirSync(mdir);
  for (const f of ['trusted-lib.sh', 'trusted-authors.txt', 'pr-status-note.re']) fs.copyFileSync(path.join(SCRIPTS, f), path.join(mdir, f));
  const mutants: Array<[string, string, string, string]> = [
    ['a failing CodeQL treated as skipped', '[ "$codeql" = skipping ] ||', '[ "$codeql" = skipping ] || [ "$codeql" = fail ] ||', 'CASE codeql-fail'],
    ['the file filter removed', 'nocode "$f" || return 1', 'true', 'CASE skipped-with-src'],
    ['an API error on the diff ignored', 'files=$(gh pr diff $p --name-only) && [ -n "$files" ] || return 1', 'files=$(gh pr diff $p --name-only); [ -n "$files" ] || return 0', 'CASE empty-diff'],
    ['the alerts read without a number check', '&& isnum "$a_merge" && isnum "$a_head" ', '', 'CASE alerts-empty'],
  ];
  for (const [name, from, to, caught] of mutants) {
    assert.ok(gate.includes(from), `mutant "${name}": its anchor is in the gate`);
    const m = path.join(mdir, 'pr-gate.sh');
    fs.writeFileSync(m, gate.replace(from, to), { mode: 0o755 });
    let msg = '';
    try { cases(m); } catch (e) { msg = (e as Error).message; }
    assert.ok(msg.startsWith(caught), `mutant "${name}" is caught by ${caught}, got: ${msg.split('\n')[0] || 'no failure'}`);
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('pr-gate codeql tests passed');
