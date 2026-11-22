/**
 * Guard (spec 117 FR-012 / O2, T046; FR-014 / O3, T010): what `ui-platforms.yml` ("UI on three OSes") runs per event.
 *   (a) on pull_request the matrix holds the 4 Linux shards, plus the 4 Windows shards unless the decision's `os_sensitive` output is
 *       'false' (missing or any other value runs Windows: fail closed), never macOS; main pushes run Linux and Windows and schedule
 *       and dispatch all three OSes whatever `os_sensitive` says; the decision job passes `os_sensitive` on;
 *   (b) every main push shares the group "<workflow>-ui-main" with cancel-in-progress true; schedule and workflow_dispatch runs get a
 *       group of their own (github.run_id) and never cancel; PR runs keep their per-PR group and cancel a superseded run;
 *   (c) "UI suite complete" needs the shard job and fails unless it succeeded (a Windows shard that ran is in that result; one left out
 *       on purpose is not), with one early pass only (ui=false).
 * The workflow's `${{ }}` expressions are evaluated (a small evaluator for the operators the file uses), not matched as text, so an
 * equivalent rewrite passes and a changed meaning fails. No YAML dependency, no git, no network, no Electron. Mutants run on copies and
 * each must fail with exactly its own labelled problem.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const FILE = path.join(__dirname, '..', '..', '.github', 'workflows', 'ui-platforms.yml');
const WORKFLOW = 'UI on three OSes';

// ---- a small evaluator for GitHub expressions: literals, context paths, == != ! && || ( ), fromJSON(), format() ----
type V = string | number | boolean | null | V[] | { [k: string]: V };
type Tok = { t: 'str' | 'num' | 'id' | 'op'; v: string };
function tokens(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'") {
      let s = ''; i++;
      for (;;) {
        if (i >= src.length) throw new Error(`unterminated string in: ${src}`);
        if (src[i] === "'" && src[i + 1] === "'") { s += "'"; i += 2; continue; }
        if (src[i] === "'") { i++; break; }
        s += src[i++];
      }
      out.push({ t: 'str', v: s }); continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '&&', '||'].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('!(),'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    const num = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (num) { out.push({ t: 'num', v: num[0] }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z_][A-Za-z0-9_-]*)*/.exec(src.slice(i));
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    throw new Error(`unexpected "${c}" in: ${src}`);
  }
  return out;
}
const truthy = (v: V): boolean => !(v === null || v === false || v === 0 || v === '');
function get(ctx: Record<string, V>, p: string): V {
  let cur: V = ctx as V;
  for (const k of p.split('.')) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return null;
    cur = k in cur ? (cur as Record<string, V>)[k] : null;
  }
  return cur;
}
export function evaluate(src: string, ctx: Record<string, V>): V {
  const ts = tokens(src);
  let k = 0;
  const peek = (v: string): boolean => k < ts.length && ts[k].t === 'op' && ts[k].v === v;
  const eat = (v: string): void => { if (!peek(v)) throw new Error(`expected "${v}" in: ${src}`); k++; };
  const or = (): V => { let l = and(); while (peek('||')) { k++; const r = and(); l = truthy(l) ? l : r; } return l; };
  const and = (): V => { let l = eq(); while (peek('&&')) { k++; const r = eq(); l = truthy(l) ? r : l; } return l; };
  const eq = (): V => {
    let l = un();
    while (peek('==') || peek('!=')) {
      const op = ts[k++].v; const r = un();
      const same = typeof l === 'string' && typeof r === 'string' ? l.toLowerCase() === r.toLowerCase() : l === r;
      l = op === '==' ? same : !same;
    }
    return l;
  };
  const un = (): V => { if (peek('!')) { k++; return !truthy(un()); } return prim(); };
  const prim = (): V => {
    const t = ts[k++];
    if (!t) throw new Error(`unexpected end of: ${src}`);
    if (t.t === 'str') return t.v;
    if (t.t === 'num') return Number(t.v);
    if (t.t === 'op' && t.v === '(') { const v = or(); eat(')'); return v; }
    if (t.t === 'id') {
      if (t.v === 'true') return true;
      if (t.v === 'false') return false;
      if (t.v === 'null') return null;
      if (peek('(')) {
        k++; const args: V[] = [];
        if (!peek(')')) { args.push(or()); while (peek(',')) { k++; args.push(or()); } }
        eat(')');
        if (t.v === 'fromJSON') return JSON.parse(String(args[0])) as V;
        if (t.v === 'format') return String(args[0]).replace(/\{(\d+)\}/g, (_, n: string) => String(args[Number(n) + 1] ?? ''));
        throw new Error(`function ${t.v} not supported`);
      }
      return get(ctx, t.v);
    }
    throw new Error(`unexpected "${t.v}" in: ${src}`);
  };
  const v = or();
  if (k !== ts.length) throw new Error(`trailing tokens in: ${src}`);
  return v;
}
/** A YAML value that is `${{ expr }}` evaluates the expression; anything else is the plain value (minus quotes). */
function value(raw: string, ctx: Record<string, V>): V {
  const m = /^\$\{\{([\s\S]*)\}\}$/.exec(raw.trim());
  if (m && raw.split('${{').length === 2) return evaluate(m[1], ctx);
  // a value mixing text and expressions (e.g. "a-${{ x }}") is interpolated
  if (raw.includes('${{')) return raw.trim().replace(/\$\{\{([\s\S]*?)\}\}/g, (_, e: string) => String(evaluate(e, ctx) ?? ''));
  return raw.trim().replace(/^'(.*)'$/, '$1');
}
assert.strictEqual(evaluate("'a' == 'A' && 'x' || 'y'", {}), 'x', 'evaluator: == ignores case, && then ||');
assert.strictEqual(evaluate("false && 'x' || 'y'", {}), 'y', 'evaluator: falsy && falls through ||');
assert.strictEqual(evaluate("github.event.pull_request.number || github.run_id", { github: { run_id: '9' } }), '9', 'evaluator: a missing path is null');
assert.deepStrictEqual(evaluate(`fromJSON('["a"]')`, {}), ['a'], 'evaluator: fromJSON');

// ---- reading the workflow by lines (comments dropped; a `#` inside `${{ }}` or quotes does not occur in this file's checked lines) ----
const strip = (text: string): string[] => text.split(/\r?\n/).map((l) => l.replace(/(^|\s)#.*$/, '')).filter((l) => l.trim() !== '');
function block(ls: string[], key: string, indent: number): string[] | null {
  const pad = ' '.repeat(indent);
  const i = ls.findIndex((l) => l.startsWith(pad + key + ':') && !/^\s/.test(l.slice(indent)));
  if (i < 0) return null;
  const out = [ls[i]];
  for (let j = i + 1; j < ls.length && ls[j].length - ls[j].trimStart().length > indent; j++) out.push(ls[j]);
  return out;
}
const field = (b: string[] | null, key: string): string | null => {
  const l = (b || []).find((x) => new RegExp(`^\\s+${key}\\s*:`).test(x));
  return l ? l.replace(new RegExp(`^\\s+${key}\\s*:\\s*`), '') : null;
};

// os: the decision job's os_sensitive output for this run (undefined = the output is missing)
type Run = { event: string; runId: string; pr: number | null; os?: string };
const ctxOf = (r: Run): Record<string, V> => ({
  github: { event_name: r.event, workflow: WORKFLOW, run_id: r.runId, event: r.pr === null ? {} : { pull_request: { number: r.pr, draft: false } } },
  needs: { changes: { outputs: r.os === undefined ? {} : { os_sensitive: r.os } } },
});
const RUNS: Run[] = [
  { event: 'pull_request', runId: '101', pr: 42, os: 'false' }, { event: 'pull_request', runId: '102', pr: 42, os: 'true' }, { event: 'pull_request', runId: '103', pr: 43, os: 'false' },
  { event: 'push', runId: '201', pr: null, os: 'false' }, { event: 'push', runId: '202', pr: null, os: 'true' },
  { event: 'schedule', runId: '301', pr: null, os: 'false' }, { event: 'schedule', runId: '302', pr: null },
  { event: 'workflow_dispatch', runId: '401', pr: null, os: 'false' }, { event: 'workflow_dispatch', runId: '402', pr: null },
];
const LINUX4 = ['ubuntu-latest 1', 'ubuntu-latest 2', 'ubuntu-latest 3', 'ubuntu-latest 4'];
const LINUX_WINDOWS8 = [...LINUX4, 'windows-latest 1', 'windows-latest 2', 'windows-latest 3', 'windows-latest 4'];

/** The shard matrix entries (os, shard) one run of this event gets: os list x shard list minus excludes. */
function shards(ls: string[], r: Run): string[] {
  const ui = block(ls, 'ui', 2);
  const matrix = block(ui || [], 'matrix', 6);
  const osRaw = field(matrix, 'os');
  const shardRaw = field(matrix, 'shard');
  if (!osRaw || !shardRaw) throw new Error('the ui job has no matrix os/shard');
  const os = value(osRaw, ctxOf(r)) as string[];
  const shard = JSON.parse(shardRaw) as number[];
  const ex = (matrix || []).filter((l) => /^\s+- \{\s*os:/.test(l)).map((l) => {
    const m = /os:\s*([\w-]+),\s*shard:\s*(\d+)/.exec(l);
    return m ? `${m[1]} ${m[2]}` : '';
  });
  return os.flatMap((o) => shard.map((s) => `${o} ${s}`)).filter((e) => !ex.includes(e));
}

/** Every problem with the file, as labels; empty = fine. Each mutant below must produce exactly its own label. */
export function problems(text: string): string[] {
  const ls = strip(text);
  const bad: string[] = [];
  // (a) pull requests: Linux always, Windows unless os_sensitive is exactly 'false'; other events never read it
  const same = (a: string[], b: string[]): boolean => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const pr = (os?: string): string[] => shards(ls, { event: 'pull_request', runId: '1', pr: 7, os });
  if (!same(pr('false'), LINUX4)) bad.push('a pull_request with os_sensitive=false does not run exactly the 4 Linux shards');
  if (!same(pr('true'), LINUX_WINDOWS8)) bad.push('a pull_request with os_sensitive=true does not run the 4 Linux and 4 Windows shards');
  if (!same(pr(undefined), LINUX_WINDOWS8) || !same(pr(''), LINUX_WINDOWS8) || !same(pr('yes'), LINUX_WINDOWS8)) bad.push('a pull_request with os_sensitive missing or not true/false does not run Windows (fail closed)');
  for (const r of [RUNS[3], RUNS[4]]) if (!same(shards(ls, r), LINUX_WINDOWS8)) bad.push(`a main push (os_sensitive=${r.os}) does not run Linux and Windows, 4 shards each`);
  for (const r of [RUNS[5], RUNS[6], RUNS[7], RUNS[8]]) {
    const all = shards(ls, r);
    if (all.length !== 11 || !all.includes('macos-latest 3') || !all.includes('windows-latest 4')) bad.push(`${r.event} (os_sensitive=${r.os ?? 'missing'}) does not run the full three-OS matrix`);
  }
  if (!/^\s+os_sensitive:\s*\$\{\{\s*steps\.changes\.outputs\.os_sensitive\s*\}\}\s*$/m.test((block(ls, 'changes', 2) || []).join('\n'))) bad.push('the decision job does not pass os_sensitive on');
  // (b) concurrency per event
  const conc = block(ls, 'concurrency', 0);
  const g = field(conc, 'group');
  const c = field(conc, 'cancel-in-progress');
  if (!g || !c) { bad.push('no top-level concurrency group and cancel-in-progress'); return bad; }
  const group = (r: Run): string => String(value(g, ctxOf(r)));
  const cancels = (r: Run): boolean => truthy(value(c, ctxOf(r)));
  const [p1, p2, p3, m1, m2, s1, s2, d1, d2] = RUNS;
  if (group(m1) !== `${WORKFLOW}-ui-main` || group(m2) !== group(m1)) bad.push('main pushes do not share the group "<workflow>-ui-main"');
  if (!cancels(m1)) bad.push('main pushes do not cancel an older main UI run');
  if (group(p1) !== group(p2) || group(p1) === group(p3) || !group(p1).includes('42')) bad.push('pull request runs are not grouped per PR number');
  if (!cancels(p1)) bad.push('a superseded pull request run is not cancelled');
  for (const [a, b] of [[s1, s2], [d1, d2]]) {
    if (cancels(a)) bad.push(`${a.event} runs cancel (they must always finish)`);
    const others = RUNS.filter((r) => r !== a).map(group);
    if (others.includes(group(a)) || group(a) === group(b)) bad.push(`${a.event} runs share a group (they must each have their own)`);
  }
  // (c) the summary job needs the shard job and fails unless it succeeded
  const complete = block(ls, 'complete', 2);
  const needs = field(complete, 'needs') || '';
  const needList = needs.replace(/[[\]\s]/g, '').split(',').filter(Boolean);
  if (!needList.includes('ui') || !needList.includes('changes')) bad.push('"UI suite complete" does not need the shard job and the decision');
  const body = (complete || []).join('\n');
  if (!/RESULT:\s*\$\{\{\s*needs\.ui\.result\s*\}\}/.test(body) || !/\n\s+test "\$RESULT" = "success"\s*$/.test(body)) bad.push('"UI suite complete" does not fail unless every shard succeeded');
  // its one early pass is ui=false: an `exit 0` anywhere else (say, when Windows was skipped) would pass failed Linux shards
  const early = body.match(/\bexit 0\b/g) || [];
  const uiFalse = /if \[ "\$UI_NEEDED" = "false" \]; then\n[^\n]*\n\s+exit 0\n\s+fi\n/.test(body + '\n');
  if (early.length !== 1 || !uiFalse) bad.push('"UI suite complete" passes early for something other than ui=false');
  const uiIf = field(block(ls, 'ui', 2), 'if') || '';
  if (/matrix\.os|windows|ubuntu/.test(uiIf)) bad.push('the shard job skips an OS by a job-level if (a skipped shard would read as absent)');
  return bad;
}

const real = fs.readFileSync(FILE, 'utf8');
assert.deepStrictEqual(problems(real), [], 'ui-platforms.yml: Linux UI on PRs plus Windows when OS-sensitive (fail closed), main pushes collapse to the newest, schedule and dispatch never cancel, the summary needs every shard');

// mutants: each must be reported with exactly its own label
const swap = (from: string, to: string): string => { assert.strictEqual(real.split(from).length - 1, 1, `mutant anchor occurs once: ${from}`); return real.replace(from, () => to); };
const PR_OS = `(github.event_name == 'pull_request' && needs.changes.outputs.os_sensitive == 'false') && '["ubuntu-latest"]'`;
const GROUP = "group: ${{ github.workflow }}-${{ github.event_name == 'push' && 'ui-main' || github.event.pull_request.number || github.run_id }}";
const CANCEL = "cancel-in-progress: ${{ github.event_name == 'pull_request' || github.event_name == 'push' }}";
const mutants: Array<[string, string, string[]]> = [
  ['Windows never on a PR (the simple O2 form of #2033)', swap(PR_OS, `github.event_name == 'pull_request' && '["ubuntu-latest"]'`),
    ['a pull_request with os_sensitive=true does not run the 4 Linux and 4 Windows shards', 'a pull_request with os_sensitive missing or not true/false does not run Windows (fail closed)']],
  ['Windows on every PR (the pull_request branch dropped)', swap(` || ${PR_OS}`, ''),
    ['a pull_request with os_sensitive=false does not run exactly the 4 Linux shards']],
  ['fail open: Linux only unless os_sensitive is exactly true', swap(PR_OS, PR_OS.replace("os_sensitive == 'false'", "os_sensitive != 'true'")),
    ['a pull_request with os_sensitive missing or not true/false does not run Windows (fail closed)']],
  ['main pushes skip Windows too when os_sensitive=false', swap(PR_OS, PR_OS.replace("github.event_name == 'pull_request'", "(github.event_name == 'pull_request' || github.event_name == 'push')")),
    ['a main push (os_sensitive=false) does not run Linux and Windows, 4 shards each']],
  ['the decision job drops the os_sensitive output', swap('      os_sensitive: ${{ steps.changes.outputs.os_sensitive }}\n', ''), ['the decision job does not pass os_sensitive on']],
  ['the summary passes early when Windows was skipped', swap('| tee -a "$GITHUB_STEP_SUMMARY"\n          fi\n          test "$RESULT"', '| tee -a "$GITHUB_STEP_SUMMARY"\n            exit 0\n          fi\n          test "$RESULT"'),
    ['"UI suite complete" passes early for something other than ui=false']],
  ['cancel on schedule', swap(CANCEL, "cancel-in-progress: ${{ github.event_name != 'workflow_dispatch' }}"), ['schedule runs cancel (they must always finish)']],
  ['cancel everything', swap(CANCEL, 'cancel-in-progress: true'), ['schedule runs cancel (they must always finish)', 'workflow_dispatch runs cancel (they must always finish)']],
  ['schedule joins the main group', swap(GROUP, "group: ${{ github.workflow }}-${{ (github.event_name == 'push' || github.event_name == 'schedule') && 'ui-main' || github.event.pull_request.number || github.run_id }}"),
    ['schedule runs share a group (they must each have their own)']],
  ['main pushes keep per-run groups (FR-107 as before)', swap(GROUP, 'group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.run_id }}'),
    ['main pushes do not share the group "<workflow>-ui-main"']],
  ['main pushes do not cancel', swap(CANCEL, "cancel-in-progress: ${{ github.event_name == 'pull_request' }}"), ['main pushes do not cancel an older main UI run']],
  ['the summary drops the shard job from needs', swap('needs: [changes, ui]', 'needs: [changes]'), ['"UI suite complete" does not need the shard job and the decision']],
  ['the summary stops testing the shard result', swap('\n          test "$RESULT" = "success"', '\n          echo "$RESULT"'), ['"UI suite complete" does not fail unless every shard succeeded']],
  ['a shard lost on every OS', swap('shard: [1, 2, 3, 4]', 'shard: [1, 2, 3]'),
    ['a pull_request with os_sensitive=false does not run exactly the 4 Linux shards', 'a pull_request with os_sensitive=true does not run the 4 Linux and 4 Windows shards',
      'a pull_request with os_sensitive missing or not true/false does not run Windows (fail closed)', 'a main push (os_sensitive=false) does not run Linux and Windows, 4 shards each',
      'a main push (os_sensitive=true) does not run Linux and Windows, 4 shards each', 'schedule (os_sensitive=false) does not run the full three-OS matrix',
      'schedule (os_sensitive=missing) does not run the full three-OS matrix', 'workflow_dispatch (os_sensitive=false) does not run the full three-OS matrix',
      'workflow_dispatch (os_sensitive=missing) does not run the full three-OS matrix']],
];
for (const [name, text, want] of mutants) assert.deepStrictEqual(problems(text), want, `mutant is caught at its own assert: ${name}`);
console.log(`[ui-platforms-events] ok: PR = Linux (+ Windows when OS-sensitive), main = newest push, schedule and dispatch never cancel; ${mutants.length} mutants caught`);
