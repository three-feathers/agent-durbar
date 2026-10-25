/**
 * Weekly test audit (spec 021 FR-058): `npm run test:weeklyaudit`. No Claude, no network, no real `gh`: canned JSON goes through the
 * validator and the filer with an injected `gh`; the mutation helper runs on a scratch folder; the Claude argv is asserted as built.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  AREAS, FOOTER, MAX_NEW, SCHEMA_ID, buildClaudeArgv, fingerprint, ghRunner, issueBody, main, markersIn, planAndFile, readTokenFile,
  renderPrompt, validateOutput, Finding, Gh,
} from './weekly-test-audit';
import { run as mutateRun, suiteSteps, targetPath } from './weekly-test-audit-mutate';

const ROOT = path.join(__dirname, '..', '..');
const posix = process.platform !== 'win32';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-audit-test-'));
let done = false;
process.on('exit', () => { fs.rmSync(tmp, { recursive: true, force: true }); if (!done) { console.error('test-weekly-audit: did not finish'); process.exitCode = 1; } });

const good = (o: Partial<Finding> = {}): Finding => ({
  id: 'cannot-fail-test-theme-self-compare',
  kind: 'cannot-fail',
  title: 'test-theme: default cell size compares a value with itself',
  file: 'scripts/test-theme.ts',
  line: 128,
  labels: ['bug', 'area:ci', 'spec:035'],
  verification: 'mutation',
  evidence: 'baseline test:theme pass; mutate ... -> survived',
  body: 'The assert compares _compilePixelMap(x) with itself, so it passes whatever the code does.',
  ...o,
});
const out = (findings: unknown[], extra: Record<string, unknown> = {}): string => JSON.stringify({ schema: SCHEMA_ID, findings, ...extra });

// ---- the schema: whole-answer rejects
{
  assert.deepStrictEqual(validateOutput(out([good()])), { ok: true, findings: [good()], rejected: [] }, 'a valid answer passes');
  assert.ok(validateOutput('  \n' + out([]) + '\n').ok, 'surrounding whitespace is fine');
  const bad = (t: string, re: RegExp, why: string): void => {
    const v = validateOutput(t);
    assert.ok(!v.ok && re.test(v.error), `${why}: ${JSON.stringify(v)}`);
  };
  bad('Here are the findings: ' + out([]), /not JSON/, 'prose before the JSON');
  bad('```json\n' + out([]) + '\n```', /not JSON/, 'a Markdown fence');
  bad('', /not JSON/, 'empty output');
  bad('[]', /not a JSON object/, 'a list');
  bad(JSON.stringify({ schema: 'other/1', findings: [] }), /schema/, 'a wrong schema id');
  bad(out([], { note: 'x' }), /unknown top-level key/, 'an extra top-level key');
  bad(JSON.stringify({ schema: SCHEMA_ID, findings: {} }), /not a list/, 'findings not a list');
  bad(out(Array.from({ length: 21 }, (_, i) => good({ id: `cannot-fail-test-x-${i}` }))), /more than 20/, 'too many findings');
  bad('x'.repeat(200_001), /longer than/, 'a huge answer');
}
// ---- the schema: one bad finding is dropped with its reason, the others stay
{
  const drop = (f: unknown, re: RegExp, why: string): void => {
    const v = validateOutput(out([good(), f]));
    assert.ok(v.ok, why);
    if (!v.ok) return;
    assert.strictEqual(v.findings.length, 1, `${why}: the good one stays`);
    assert.ok(v.rejected.length === 1 && v.rejected[0].index === 1 && v.rejected[0].errors.some((e) => re.test(e)), `${why}: ${JSON.stringify(v.rejected)}`);
  };
  drop({ ...good(), extra: 1 }, /unknown key/, 'an extra field');
  drop(JSON.parse(JSON.stringify(good()).replace('{', '{"__proto__":{"x":1},')), /unknown key/, 'a __proto__ key');
  const { body: _b, ...noBody } = good();
  drop(noBody, /missing body/, 'a missing field');
  drop(good({ labels: ['bug', 'area:ci', 'spec:035', 'status:claimed'] }), /not in the taxonomy/, 'a flag label');
  drop(good({ labels: ['bug', 'area:ci', 'spec:035', 'wontfix'] }), /not in the taxonomy/, 'a closing label');
  drop(good({ labels: ['bug', 'area:frontend', 'spec:035'] }), /not in the taxonomy/, 'an unknown area');
  drop(good({ labels: ['bug', 'area:ci', 'spec:35'] }), /not in the taxonomy/, 'a malformed spec label');
  drop(good({ labels: ['bug', 'task', 'area:ci', 'spec:035'] }), /exactly one type/, 'two types');
  drop(good({ labels: ['area:ci', 'area:ui', 'spec:035'] }), /exactly one type/, 'no type');
  drop(good({ labels: ['bug', 'spec:035', 'spec:008'] }), /area/, 'no area');
  drop(good({ labels: ['bug', 'area:ci', 'area:ui'] }), /spec:NNN/, 'no spec label');
  drop(good({ labels: ['bug', 'area:ci', 'spec:035', 'spec:035'] }), /repeat/, 'a repeated label');
  drop(good({ labels: ['bug', 'area:ci', 'spec:035', 'area:ui', 'area:mcp', 'area:usage', 'area:docs'] }), /3\.\.6/, 'too many labels');
  drop(good({ body: 'x'.repeat(4001) }), /body has 4001/, 'an oversized body');
  drop(good({ evidence: 'x'.repeat(2001) }), /evidence has 2001/, 'oversized evidence');
  drop(good({ title: 'x'.repeat(121) }), /title has 121/, 'an oversized title');
  drop(good({ title: 'short' }), /title has 5/, 'a too-short title');
  drop(good({ title: 'test-theme: one\nline two' }), /line break/, 'a two-line title');
  drop(good({ body: 'text with a ‮ bidi override in it, long enough' }), /control character/, 'a bidi control');
  drop(good({ id: 'Not Kebab' }), /kebab/, 'an id that is not kebab-case');
  drop(good({ file: '../etc/passwd' }), /relative path/, 'a path out of the repo');
  drop(good({ file: '/etc/passwd' }), /relative path/, 'an absolute path');
  drop(good({ file: 'scripts/../../x.ts' }), /relative path/, 'a .. segment');
  drop(good({ file: 'node_modules/x/index.js' }), /relative path/, 'a path outside src/scripts/specs/docs');
  drop(good({ line: 0 }), /line/, 'line 0');
  drop(good({ line: 1.5 }), /line/, 'a fractional line');
  drop(good({ kind: 'style' as Finding['kind'] }), /kind/, 'an unknown kind');
  drop(good({ verification: 'guess' as Finding['verification'] }), /verification/, 'an unknown verification');
  drop('a string', /not an object/, 'a string finding');
  for (const a of AREAS) assert.ok(validateOutput(out([good({ labels: ['task', a, 'spec:021'] })])).ok && (validateOutput(out([good({ labels: ['task', a, 'spec:021'] })])) as { findings: unknown[] }).findings.length === 1, `area ${a} is allowed`);
}
// ---- fingerprint and the issue text
{
  assert.strictEqual(fingerprint(good()), fingerprint(good({ line: 9, title: 'test-theme: another wording here' })), 'the line and title do not change the fingerprint');
  assert.notStrictEqual(fingerprint(good()), fingerprint(good({ id: 'cannot-fail-test-theme-other' })), 'the id does');
  assert.notStrictEqual(fingerprint(good()), fingerprint(good({ file: 'scripts/test-x.ts' })), 'the file does');
  assert.match(fingerprint(good()), /^[0-9a-f]{16}$/);
  const token = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
  const body = issueBody(good({ body: `Ping @someone <img src=x onerror=alert(1)> ![t](http://x/p.png) and ${token} here.`, evidence: 'ran ``` and ' + token }), {});
  assert.deepStrictEqual(markersIn(body), [fingerprint(good())], 'the body carries the marker');
  assert.ok(body.trimEnd().endsWith(FOOTER), 'the body ends with the footer');
  assert.ok(!body.includes('@someone') && body.includes('&#64;someone'), 'mentions are escaped');
  assert.ok(!/<img/.test(body) && body.includes('&lt;img'), 'HTML is escaped');
  assert.ok(!body.includes('![t]'), 'images are escaped');
  assert.ok(!body.includes(token) && !body.includes('A1b2C3d4E5f6G7h8'), 'a token is masked in the body and the evidence');
  assert.ok(/````text\n/.test(body), 'the evidence fence is longer than any backtick run inside');
  const hidden = issueBody(good({ body: 'a token split by marks gh**p_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8** here, long enough' }), {});
  assert.ok(!hidden.includes('A1b2C3d4E5f6G7h8'), 'a token hidden by Markdown marks is masked too');
}

// ---- the filer, with an injected gh
type Call = string[];
function fakeGh(opts: { issues?: { number: number; state: string; body: string }[]; labels?: string[]; searchFails?: boolean; createFails?: boolean } = {}): { gh: Gh; calls: Call[] } {
  const calls: Call[] = [];
  let n = 900;
  const gh: Gh = async (args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') return opts.searchFails ? { code: 1, stdout: '[]', stderr: 'boom' } : { code: 0, stdout: JSON.stringify(opts.issues || []), stderr: '' };
    if (args[0] === 'label' && args[1] === 'list') return { code: 0, stdout: JSON.stringify((opts.labels || ['bug', 'task', 'area:ci', 'area:ui', 'spec:035', 'spec:021']).map((name) => ({ name }))), stderr: '' };
    if (args[0] === 'issue' && args[1] === 'create') return opts.createFails ? { code: 1, stdout: '', stderr: 'denied' } : { code: 0, stdout: `https://github.com/o/r/issues/${n++}\n`, stderr: '' };
    return { code: 1, stdout: '', stderr: 'unexpected' };
  };
  return { gh, calls };
}
const creates = (calls: Call[]): Call[] => calls.filter((c) => c[0] === 'issue' && c[1] === 'create');
const many = (k: number): Finding[] => Array.from({ length: k }, (_, i) => good({ id: `cannot-fail-test-many-${i}` }));

(async () => {
  // dedupe against open and closed issues, and inside the run
  {
    const a = good({ id: 'cannot-fail-test-a-open' }), b = good({ id: 'cannot-fail-test-b-closed' }), c = good({ id: 'cannot-fail-test-c-new' });
    const { gh, calls } = fakeGh({ issues: [
      { number: 10, state: 'OPEN', body: `x\n<!-- weekly-audit:${fingerprint(a)} -->\n` },
      { number: 11, state: 'CLOSED', body: `<!-- weekly-audit:${fingerprint(b)} -->` },
    ] });
    const s = await planAndFile({ findings: [a, b, c, c], mode: 'file', gh, repo: 'o/r', env: {} });
    assert.deepStrictEqual(s.outcomes.map((o) => o.status), ['duplicate', 'duplicate', 'filed', 'duplicate'], JSON.stringify(s.outcomes));
    assert.strictEqual(s.outcomes[0].note, '#10 (open)');
    assert.strictEqual(s.outcomes[1].note, '#11 (closed)', 'a closed issue also blocks a refile');
    assert.strictEqual(s.outcomes[3].note, 'repeated in this run');
    const cr = creates(calls);
    assert.strictEqual(cr.length, 1, 'only the new finding is filed');
    const search = calls.find((x) => x[1] === 'list' && x[0] === 'issue')!;
    assert.ok(search.includes('--state') && search[search.indexOf('--state') + 1] === 'all', 'the search covers open and closed issues');
    const body = cr[0][cr[0].indexOf('--body') + 1];
    assert.deepStrictEqual(markersIn(body), [fingerprint(c)]);
    assert.deepStrictEqual(cr[0].filter((_, i) => cr[0][i - 1] === '--label'), ['bug', 'area:ci', 'spec:035'], 'the labels are the finding\'s');
    assert.strictEqual(cr[0][cr[0].indexOf('--repo') + 1], 'o/r');
  }
  // the cap of 5
  {
    const { gh, calls } = fakeGh();
    const s = await planAndFile({ findings: many(7), mode: 'file', gh, repo: 'o/r', env: {} });
    assert.strictEqual(MAX_NEW, 5);
    assert.strictEqual(creates(calls).length, 5, 'at most 5 new issues');
    assert.deepStrictEqual(s.outcomes.map((o) => o.status), ['filed', 'filed', 'filed', 'filed', 'filed', 'capped', 'capped']);
  }
  // duplicates do not use up the cap
  {
    const f = many(7);
    const { gh, calls } = fakeGh({ issues: [{ number: 1, state: 'CLOSED', body: marker2(f[0]) }, { number: 2, state: 'OPEN', body: marker2(f[1]) }] });
    await planAndFile({ findings: f, mode: 'file', gh, repo: 'o/r', env: {} });
    assert.strictEqual(creates(calls).length, 5);
  }
  // a dry run files nothing, with or without gh
  {
    const { gh, calls } = fakeGh();
    const s = await planAndFile({ findings: many(3), mode: 'dry-run', gh, repo: 'o/r', env: {} });
    assert.strictEqual(creates(calls).length, 0, 'a dry run creates nothing');
    assert.deepStrictEqual(s.outcomes.map((o) => o.status), ['would-file', 'would-file', 'would-file']);
    assert.strictEqual(s.dedupe, 'checked');
    const s2 = await planAndFile({ findings: many(7), mode: 'dry-run', gh: null, repo: 'o/r', env: {} });
    assert.strictEqual(s2.dedupe, 'not checked');
    assert.strictEqual(s2.outcomes.filter((o) => o.status === 'would-file').length, 5, 'the dry run shows the cap too');
  }
  // fail closed: a failed search files nothing; filing needs gh
  {
    const { gh, calls } = fakeGh({ searchFails: true });
    const s = await planAndFile({ findings: many(2), mode: 'file', gh, repo: 'o/r', env: {} });
    assert.ok(s.error && /nothing filed/.test(s.error) && creates(calls).length === 0, 'no search, no filing');
    const s2 = await planAndFile({ findings: many(2), mode: 'file', gh: null, repo: 'o/r', env: {} });
    assert.ok(s2.error && /token file/.test(s2.error));
  }
  // a spec label the repo lacks is dropped and said; a failed create is reported
  {
    const { gh, calls } = fakeGh({ labels: ['bug', 'area:ci'] });
    const s = await planAndFile({ findings: [good()], mode: 'file', gh, repo: 'o/r', env: {} });
    const cr = creates(calls)[0];
    assert.ok(!cr.includes('spec:035') && /spec:035/.test(s.outcomes[0].note || ''));
    const f2 = fakeGh({ createFails: true });
    const s2 = await planAndFile({ findings: [good()], mode: 'file', gh: f2.gh, repo: 'o/r', env: {} });
    assert.strictEqual(s2.outcomes[0].status, 'failed');
  }

  // ---- main(): the CLI the shell script calls
  {
    const input = path.join(tmp, 'out.txt');
    fs.writeFileSync(input, out([good(), good({ id: 'cannot-fail-test-other-one', labels: ['bug', 'area:ci', 'spec:035', 'needs-owner-approval'] })]));
    const log = path.join(tmp, 'audit.log');
    let text = '';
    const io = (env: Record<string, string>, gh?: (t: string) => Gh) => ({ out: (s: string) => { text += s; }, env, gh });
    // dry run, no token file: prints the issue it would file, rejects the bad finding, files nothing, exit 0
    text = '';
    let code = await main(['run', '--input', input, '--log', log], io({}));
    assert.strictEqual(code, 0, text);
    assert.ok(/dry-run, dedupe not checked/.test(text) && /would file: 1/.test(text) && /rejected #1: .*not in the taxonomy/.test(text), text);
    assert.ok(text.includes(FOOTER) && text.includes('--- would file:'), 'the dry run shows the issue text');
    assert.ok(fs.readFileSync(log, 'utf8').includes('would file: 1'), 'the summary goes to the log too');
    // --file without a token file: nothing filed, exit 1
    text = '';
    code = await main(['run', '--input', input, '--file'], io({}));
    assert.ok(code === 1 && /token file/.test(text), text);
    // not JSON: rejected, exit 1
    fs.writeFileSync(path.join(tmp, 'bad.txt'), 'I found nothing.');
    text = '';
    code = await main(['run', '--input', path.join(tmp, 'bad.txt'), '--file'], io({}));
    assert.ok(code === 1 && /output rejected: output is not JSON; nothing filed/.test(text), text);
    // token file: checked, used only for gh, never printed
    const token = 'github_pat_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3';
    const tf = path.join(tmp, 'token');
    fs.writeFileSync(tf, token + '\n', { mode: 0o600 });
    if (posix) fs.chmodSync(tf, 0o600);
    let seenToken = '';
    const { gh, calls } = fakeGh();
    fs.writeFileSync(input, out([good({ body: `the token ${token} leaked into a test name, long enough` })]));
    text = '';
    code = await main(['run', '--input', input, '--file', '--log', log], io({ DURBAR_AUDIT_GH_TOKEN_FILE: tf }, (t) => { seenToken = t; return gh; }));
    assert.strictEqual(code, 0, text);
    assert.strictEqual(seenToken, token, 'gh gets the token from the file');
    assert.strictEqual(creates(calls).length, 1);
    assert.ok(!text.includes(token) && !fs.readFileSync(log, 'utf8').includes(token), 'the token is never printed or logged');
    assert.ok(!creates(calls)[0].join(' ').includes(token), 'the token is masked in the issue it files');
    if (posix) {
      fs.chmodSync(tf, 0o644);
      assert.throws(() => readTokenFile(tf), /0600/, 'a group- or world-readable token file is refused');
      text = '';
      code = await main(['run', '--input', input, '--file'], io({ DURBAR_AUDIT_GH_TOKEN_FILE: tf }, () => { throw new Error('gh must not run'); }));
      assert.ok(code === 1 && /0600/.test(text), text);
      fs.chmodSync(tf, 0o600);
      const link = path.join(tmp, 'token-link');
      fs.symlinkSync(tf, link);
      assert.throws(() => readTokenFile(link), /regular file/, 'a link is refused');
    }
    fs.writeFileSync(path.join(tmp, 'notoken'), 'two words\n', { mode: 0o600 });
    assert.throws(() => readTokenFile(path.join(tmp, 'notoken')), /one token/);
  }

  // ---- the real gh runner with a fake gh (POSIX: a shell script stands in for gh)
  if (posix) {
    const fake = path.join(tmp, 'gh');
    const rec = path.join(tmp, 'gh-args.txt');
    fs.writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > '${rec}'\n[ -n "$GH_TOKEN" ] && echo has-token >> '${rec}'\necho https://github.com/o/r/issues/1\n`, { mode: 0o700 });
    const r = await ghRunner('github_pat_abcdefghijklmnopqrstuvwxyz', fake)(['issue', 'create', '--title', 'a "quoted" $(title)']);
    assert.strictEqual(r.code, 0);
    assert.deepStrictEqual(fs.readFileSync(rec, 'utf8').trim().split('\n'), ['issue', 'create', '--title', 'a "quoted" $(title)', 'has-token'], 'gh gets each argument as is, no shell, and the token in its env');
  }

  // ---- the Claude argv
  {
    const mutate = '/tmp/durbar-weekly-audit.abc/priv/dist/scripts/weekly-test-audit-mutate.js';
    const argv = buildClaudeArgv({ model: 'sonnet', mutate });
    const after = (f: string): string => argv[argv.indexOf(f) + 1];
    const list = (f: string): string[] => { const i = argv.indexOf(f) + 1; const r: string[] = []; for (let j = i; j < argv.length && !argv[j].startsWith('--'); j++) r.push(argv[j]); return r; };
    assert.strictEqual(argv[0], '-p');
    assert.ok(argv.includes('--strict-mcp-config'), 'no MCP servers (CLAUDE.md)');
    assert.strictEqual(after('--setting-sources'), '', 'no settings files (CLAUDE.md)');
    assert.ok(argv.includes('--restricted'));
    assert.strictEqual(after('--tools'), 'Read,Grep,Glob,Bash', 'only these tools exist');
    assert.deepStrictEqual(list('--allowedTools'), ['Read', 'Grep', 'Glob', `Bash(node ${mutate} *)`], 'Bash is allowed only for the helper');
    for (const t of ['WebFetch', 'WebSearch', 'Edit', 'Write', 'Bash(gh *)', 'Bash(git *)', 'Bash(curl *)']) assert.ok(list('--disallowedTools').includes(t), `${t} is denied`);
    assert.strictEqual(after('--permission-mode'), 'dontAsk');
    assert.strictEqual(after('--permission-prompts'), 'none');
    assert.ok(argv.includes('--no-session-persistence'));
    assert.strictEqual(after('--model'), 'sonnet');
    assert.ok(!argv.some((a) => /dangerously|bypassPermissions|--mcp-config|acceptEdits/.test(a)), 'nothing that skips permissions or adds MCP servers');
    assert.ok(!list('--allowedTools').some((t) => /^Bash$|Web|gh|git|curl|Edit|Write/.test(t)), 'no open Bash, network or edit tool is allowed');
    assert.throws(() => buildClaudeArgv({ model: 'sonnet; rm -rf ~', mutate }), /model/);
    assert.throws(() => buildClaudeArgv({ model: 'sonnet', mutate: 'weekly-test-audit-mutate.js' }), /absolute/);
    assert.throws(() => buildClaudeArgv({ model: 'sonnet', mutate: '/tmp/x y/weekly-test-audit-mutate.js' }), /absolute/, 'no spaces in the allow rule');
    let text = '';
    await main(['claude-argv', '--mutate', mutate], { out: (s) => { text += s; }, env: {} });
    assert.deepStrictEqual(text.split('\0').slice(0, -1), argv, 'the CLI prints the same argv, NUL-separated, default model sonnet');
    // the shell script runs claude with that argv, without the token variables, under a lock and a time limit, dry run by default
    const sh = fs.readFileSync(path.join(ROOT, 'scripts', 'weekly-test-audit.sh'), 'utf8');
    assert.ok(/claude-argv --model "\$model" --mutate "\$mutate"/.test(sh) && /claude "\$\{args\[@\]\}"/.test(sh), 'the script uses the built argv');
    assert.ok(/env -u GH_TOKEN -u GITHUB_TOKEN -u GH_ENTERPRISE_TOKEN -u DURBAR_AUDIT_GH_TOKEN_FILE/.test(sh), 'claude runs without token variables');
    assert.ok(/flock -n 9/.test(sh) && /timeout --kill-after=60 "\$limit"/.test(sh) && /^mode=dry-run$/m.test(sh), 'lock, time limit, dry run by default');
    assert.ok(/trap cleanup EXIT/.test(sh) && /worktree add --quiet --detach "\$wt" origin\/main/.test(sh), 'a temp worktree of origin/main, removed on exit');
  }
  // ---- the prompt
  {
    const tpl = fs.readFileSync(path.join(ROOT, 'scripts', 'weekly-test-audit.prompt.md'), 'utf8');
    const p = renderPrompt(tpl, { mutate: '/tmp/a/weekly-test-audit-mutate.js', sha: 'bf6ea552' });
    assert.ok(!/\{\{[A-Z_]+\}\}/.test(p), 'every placeholder is filled');
    assert.ok(p.includes(`"schema": "${SCHEMA_ID}"`) && p.includes('node /tmp/a/weekly-test-audit-mutate.js baseline --test'), 'the prompt names the schema and the helper');
    assert.ok(/test:uisuite/.test(p), 'the prompt skips what test:uisuite guards');
    assert.throws(() => renderPrompt(tpl, { mutate: '/tmp/a/weekly-test-audit-mutate.js', sha: 'main; x' }), /sha/);
  }

  // ---- the mutation helper
  {
    const pkg = { scripts: { 'test:serial': 'npm run test:a && npm run test:b', 'test:a': 'tsc -p tsconfig.scripts.json && node dist-scripts/scripts/test-a.js && node scripts/x.js', 'test:b': 'node scripts/b.js; curl x', 'test:c': 'node scripts/c.js' } };
    assert.deepStrictEqual(suiteSteps(pkg, 'test:a'), [['dist-scripts/scripts/test-a.js'], ['scripts/x.js']]);
    assert.match(String(suiteSteps(pkg, 'test:b')), /not "node <file>"/, 'a step that is not node <file> is refused');
    assert.match(String(suiteSteps(pkg, 'test:c')), /not in test:serial/);
    assert.match(String(suiteSteps(pkg, 'test:a; rm')), /test:\* script name/);
    // a scratch worktree with one suite
    const wt = path.join(tmp, 'wt');
    fs.mkdirSync(path.join(wt, 'src'), { recursive: true });
    fs.mkdirSync(path.join(wt, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'package.json'), JSON.stringify({ scripts: { 'test:serial': 'npm run test:fake', 'test:fake': 'node scripts/fake-test.js' } }));
    const lib = 'exports.add = (a, b) => a + b; // sum\nexports.twice = (a) => a + a;\n';
    fs.writeFileSync(path.join(wt, 'src', 'lib.js'), lib);
    fs.writeFileSync(path.join(wt, 'scripts', 'fake-test.js'), "const assert = require('assert'); const l = require('../src/lib.js'); assert.strictEqual(l.add(2, 3), 5); if (process.env.GH_TOKEN) throw new Error('token leaked to the test'); console.log('ok');\n");
    fs.writeFileSync(path.join(wt, 'scripts', 'weekly-test-audit.prompt.md'), 'x');
    const env = { ...process.env, DURBAR_AUDIT_WORKTREE: wt, GH_TOKEN: 'github_pat_should_not_reach_children_0123456789' };
    const m = (args: string[]) => mutateRun(args, env, 60_000);
    assert.strictEqual(m(['baseline', '--test', 'test:fake']).result, 'pass', 'the baseline passes, and the child had no GH_TOKEN');
    const killed = m(['mutate', '--test', 'test:fake', '--file', 'src/lib.js', '--find', 'a + b', '--replace', 'a - b']);
    assert.strictEqual(killed.result, 'killed', JSON.stringify(killed));
    assert.strictEqual(fs.readFileSync(path.join(wt, 'src', 'lib.js'), 'utf8'), lib, 'the file is restored after a killed mutant');
    const survived = m(['mutate', '--test', 'test:fake', '--file', 'src/lib.js', '--find', 'a + a', '--replace', 'a * 3']);
    assert.strictEqual(survived.result, 'survived', 'an untested change survives');
    assert.strictEqual(fs.readFileSync(path.join(wt, 'src', 'lib.js'), 'utf8'), lib, 'the file is restored after a surviving mutant');
    const refused = (args: string[], re: RegExp, why: string): void => { const r = m(args); assert.ok(r.result === 'refused' && re.test(r.reason || ''), `${why}: ${JSON.stringify(r)}`); };
    refused(['mutate', '--test', 'test:fake', '--file', 'src/lib.js', '--find', 'a', '--replace', 'b'], /exactly once/, 'an ambiguous snippet');
    refused(['mutate', '--test', 'test:fake', '--file', 'src/lib.js', '--find', 'nope', '--replace', 'b'], /0 times/, 'a missing snippet');
    refused(['mutate', '--test', 'test:fake', '--file', '../outside.js', '--find', 'a', '--replace', 'b'], /plain relative path/, 'a path out of the worktree');
    refused(['mutate', '--test', 'test:fake', '--file', 'package.json', '--find', 'a', '--replace', 'b'], /plain relative path/, 'package.json');
    refused(['mutate', '--test', 'test:fake', '--file', 'scripts/weekly-test-audit.prompt.md', '--find', 'x', '--replace', 'y'], /own files/, 'the audit\'s own files');
    refused(['mutate', '--test', 'test:fake', '--file', 'src/lib.js', '--find', 'a + b', '--replace', 'a + b'], /same/, 'a no-op');
    refused(['mutate', '--test', 'test:fake', '--file', 'src/lib.js', '--find', 'x'.repeat(2001), '--replace', 'b'], /1\.\.2000/, 'a huge snippet');
    refused(['mutate', '--test', 'test:nope', '--file', 'src/lib.js', '--find', 'a + b', '--replace', 'a - b'], /not in test:serial/, 'an unknown suite');
    refused(['rm', '--test', 'test:fake'], /usage/, 'an unknown command');
    assert.strictEqual(mutateRun(['baseline', '--test', 'test:fake'], { DURBAR_AUDIT_WORKTREE: 'relative' }, 60_000).result, 'refused', 'the worktree must be absolute');
    fs.writeFileSync(path.join(wt, '.weekly-audit-mutate.lock'), '');
    refused(['baseline', '--test', 'test:fake'], /one at a time/, 'a second run while one holds the lock');
    fs.rmSync(path.join(wt, '.weekly-audit-mutate.lock'));
    if (posix) {
      fs.writeFileSync(path.join(tmp, 'outside.js'), 'exports.add = (a, b) => a + b;\n');
      fs.symlinkSync(path.join(tmp, 'outside.js'), path.join(wt, 'src', 'link.js'));
      refused(['mutate', '--test', 'test:fake', '--file', 'src/link.js', '--find', 'a + b', '--replace', 'a - b'], /regular file/, 'a link');
      fs.symlinkSync(tmp, path.join(wt, 'src', 'dirlink'));
      assert.ok('error' in targetPath(wt, 'src/dirlink/outside.js'), 'a path through a linked folder is refused');
      assert.strictEqual(fs.readFileSync(path.join(tmp, 'outside.js'), 'utf8'), 'exports.add = (a, b) => a + b;\n', 'nothing outside the worktree changed');
    }
  }

  done = true;
  console.log('test-weekly-audit: all tests passed');
})().catch((e) => { console.error(e); process.exitCode = 1; });

function marker2(f: Finding): string { return `<!-- weekly-audit:${fingerprint(f)} -->`; }
