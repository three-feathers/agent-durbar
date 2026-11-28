/**
 * Guard (spec 008 delta 2026-11-23, spec 117 O1, T480): no workflow runs a job on a macOS runner for a `pull_request`,
 * `pull_request_target` or `merge_group` event. macOS runs on `main` pushes, nightly and by hand only.
 * Every workflow is parsed (js-yaml, LF-normalised; the same run on a CRLF copy). For each PR-event job it works out the runner
 * labels: a literal `runs-on`, or `${{ matrix.os }}` with a literal list, `include:` entries, or an expression evaluated for that
 * event (scripts/test-ui-platforms-events.ts's evaluator, every unknown `needs.`/`inputs.`/`vars.` value tried as null, 'true' and
 * 'false'). A job-level `if:` skips the event only when it is `&&`-joined parts, one of them `github.event_name != '<event>'`.
 * Any other shape (a reusable workflow, another expression, a matrix from a job output) FAILS CLOSED, except the one reviewed
 * install-check.yml shape below. No git, no network, no Electron. Mutants run on copies; each must fail with its own problem.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { evaluate } from './test-ui-platforms-events';

// eslint-disable-next-line @typescript-eslint/no-var-requires
let yaml: { load: (s: string) => unknown } | undefined; try { yaml = require('js-yaml'); } catch { yaml = undefined; }
assert.ok(yaml, 'js-yaml is missing (a transitive dependency, as test:electroncache): fix the install instead of skipping');
const Y = yaml as { load: (s: string) => unknown };

const WF = path.join(__dirname, '..', '..', '.github', 'workflows');
const PR_EVENTS = ['pull_request', 'pull_request_target', 'merge_group'];
type Job = { 'runs-on'?: unknown; if?: unknown; uses?: unknown; needs?: unknown; strategy?: { matrix?: unknown }; steps?: { id?: string; run?: string }[]; outputs?: Record<string, string> };
type V = Parameters<typeof evaluate>[1][string];

const MAC = /mac/i;
const EXPR = /^\$\{\{([\s\S]*)\}\}$/;
const inner = (s: string): string => { const m = EXPR.exec(s.trim()); return m ? m[1].trim() : s.trim(); };

/** The events a workflow's `on:` names (string, list or map). */
function events(on: unknown): string[] {
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  return on && typeof on === 'object' ? Object.keys(on) : [];
}
/** True when the job-level `if:` can never be true for this event: `&&` parts only, one of them `github.event_name != '<event>'`. */
function skipped(cond: unknown, event: string): boolean {
  if (typeof cond !== 'string' || /\|\|/.test(cond)) return false;
  return inner(cond).split('&&').some((p) => p.trim().replace(/\s+/g, ' ') === `github.event_name != '${event}'`);
}
/** Every value an expression can take for this event, unknown outputs and inputs tried as null, 'true' and 'false'. */
function values(expr: string, event: string): V[] {
  const paths = [...new Set(expr.match(/\b(?:needs|inputs|vars)\.[\w.-]+/g) || [])];
  const out: V[] = [];
  for (let n = 0; n < 3 ** paths.length; n++) {
    const ctx: Record<string, V> = { github: { event_name: event, event: event === 'merge_group' ? {} : { pull_request: { draft: false, number: 1 } } } };
    paths.forEach((p, i) => {
      const v = [null, 'true', 'false'][Math.floor(n / 3 ** i) % 3];
      const keys = p.split('.');
      let cur = ctx as Record<string, V>;
      keys.slice(0, -1).forEach((k) => { if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {}; cur = cur[k] as Record<string, V>; });
      cur[keys[keys.length - 1]] = v;
    });
    out.push(evaluate(expr, ctx));
  }
  return out;
}
// The one reviewed shape that is not a literal (spec 008 FR-106, install-check.yml): the matrix is the `platforms` job's list, and that
// job's step drops every macos entry on a pull request. Valid for `pull_request` only; any change to these lines fails closed.
const INSTALL_FILTER = `if [ "$EVENT_NAME" = pull_request ]; then f='map(select(startswith("macos") | not))'; else f='.'; fi`;
function reviewedDynamic(file: string, id: string, jobs: Record<string, Job>, os: unknown, event: string): boolean {
  if (file !== 'install-check.yml' || id !== 'install' || event !== 'pull_request' || os !== '${{ fromJSON(needs.platforms.outputs.list) }}') return false;
  const p = jobs.platforms;
  const step = (p?.steps || []).find((s) => s.id === 'p');
  return jobs[id].needs === 'platforms' && p?.['runs-on'] === 'ubuntu-latest' && p?.outputs?.list === '${{ steps.p.outputs.list }}' && !!step && (step.run || '').split('\n')[0] === INSTALL_FILTER;
}

/** Every list a matrix value can be for this event: a literal list, or an expression whose every value is a non-empty list; null = cannot tell. */
function lists(raw: unknown, event: string): V[][] | null {
  if (Array.isArray(raw)) return [raw as V[]];
  if (typeof raw !== 'string' || !EXPR.test(raw.trim()) || /\b(?:steps|matrix|env|secrets)\./.test(raw)) return null;
  let vs: V[];
  try { vs = values(inner(raw), event); } catch { return null; }
  return vs.every((v) => Array.isArray(v) && v.length > 0) ? (vs as V[][]) : null;
}
/** The problems of one workflow text (empty = no macOS runner on a PR event). */
export function problems(file: string, raw: string): string[] {
  const text = raw.replace(/\r\n/g, '\n');
  const bad: string[] = [];
  let doc: { on?: unknown; true?: unknown; jobs?: Record<string, Job> };
  try { doc = Y.load(text) as typeof doc; } catch { return [`${file}: not valid YAML`]; }
  const evs = events(doc.on ?? doc.true).filter((e) => PR_EVENTS.includes(e));
  if (!evs.length) return [];
  for (const [id, job] of Object.entries(doc.jobs || {})) {
    for (const ev of evs) {
      const where = `${file} ${id} on ${ev}`;
      if (skipped(job.if, ev)) continue;
      if (job.uses !== undefined) { bad.push(`${where}: a reusable workflow, cannot tell its runner`); continue; }
      const runsOn = job['runs-on'];
      const labels: string[] = [];
      if (Array.isArray(runsOn) && runsOn.every((l) => typeof l === 'string' && !l.includes('${{'))) labels.push(...runsOn);
      else if (typeof runsOn === 'string' && !runsOn.includes('${{')) labels.push(runsOn);
      else if (runsOn === '${{ matrix.os }}') {
        const m = job.strategy?.matrix as { os?: unknown; include?: unknown } | undefined;
        if (!m || typeof m !== 'object' || Array.isArray(m)) { bad.push(`${where}: a matrix that is not a map, cannot tell its runner`); continue; }
        const inc = m.include === undefined ? [[]] : lists(m.include, ev);
        const os = m.os === undefined || reviewedDynamic(file, id, doc.jobs || {}, m.os, ev) ? [[]] : lists(m.os, ev);
        if (!inc || inc.some((l) => l.some((e) => !e || typeof e !== 'object' || ('os' in e && typeof (e as { os: unknown }).os !== 'string')))) { bad.push(`${where}: matrix.include has a shape this guard cannot read`); continue; }
        if (!os || os.some((l) => l.some((x) => typeof x !== 'string'))) { bad.push(`${where}: matrix.os has a shape this guard cannot read`); continue; }
        for (const l of inc) for (const e of l) if ('os' in (e as object)) labels.push((e as { os: string }).os);
        for (const l of os) labels.push(...(l as string[]));
      } else { bad.push(`${where}: runs-on has a shape this guard cannot read`); continue; }
      for (const l of new Set(labels)) if (MAC.test(l)) bad.push(`${where}: runs on macOS (${l})`);
    }
  }
  return bad;
}

const files = fs.readdirSync(WF).filter((f) => /\.ya?ml$/.test(f)).sort();
const live: Record<string, string> = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(WF, f), 'utf8').replace(/\r\n/g, '\n')]));
const all = (set: Record<string, string>, crlf = false): string[] => Object.entries(set).flatMap(([f, t]) => problems(f, crlf ? t.replace(/\n/g, '\r\n') : t));
assert.deepStrictEqual(all(live), [], 'no workflow runs a macOS job on pull_request or merge_group');
assert.deepStrictEqual(all(live, true), [], 'the same on CRLF copies');
// the guard sees the PR workflows it must (a parse that silently found nothing would pass the line above)
const seen = files.filter((f) => events((Y.load(live[f]) as { on?: unknown }).on).some((e) => PR_EVENTS.includes(e)));
for (const f of ['ci.yml', 'ui-platforms.yml', 'fast-lane.yml', 'install-check.yml', 'spec-kit.yml']) assert.ok(seen.includes(f), `${f} is read as a PR-event workflow`);
for (const f of ['macos-pr.yml', 'mac-titlebar-pr.yml']) assert.ok(!seen.includes(f), `${f} has no PR event (by hand only)`);

// ---- mutants: each re-adds a macOS PR job (or a shape the guard cannot read) and must fail with exactly its own problem, LF and CRLF ----
const swap = (f: string, from: string | RegExp, to: string): Record<string, string> => {
  const t = live[f].replace(from, to);
  assert.notStrictEqual(t, live[f], `mutant anchor found in ${f}: ${String(from)}`);
  return { ...live, [f]: t };
};
const mutants: [string, Record<string, string>, string[]][] = [
  ['macos-pr.yml on pull_request again', swap('macos-pr.yml', 'on:\n  workflow_dispatch:\n', 'on:\n  pull_request:\n  workflow_dispatch:\n'), ['macos-pr.yml macos-test on pull_request: runs on macOS (macos-latest)']],
  ['mac-titlebar-pr.yml in the merge queue', swap('mac-titlebar-pr.yml', 'on:\n  workflow_dispatch:\n', 'on: [merge_group, workflow_dispatch]\n'), ['mac-titlebar-pr.yml mac-titlebar on merge_group: runs on macOS (macos-latest)']],
  ['macOS back in the fast lane', swap('fast-lane.yml', 'os: [ubuntu-latest, windows-latest]', 'os: [ubuntu-latest, windows-latest, macos-latest]'), ['fast-lane.yml fast on pull_request: runs on macOS (macos-latest)']],
  ['ci.yml macOS parts on pull requests', swap('ci.yml', " && github.event_name != 'pull_request' && github.event_name != 'merge_group' }}", " && github.event_name != 'merge_group' }}"), ['ci.yml test-macos on pull_request: runs on macOS (macos-latest)']],
  ['ci.yml macOS parts behind an ||', swap('ci.yml', " && github.event_name != 'pull_request' && github.event_name != 'merge_group' }}", " && github.event_name != 'pull_request' && github.event_name != 'merge_group' || false }}"), ['ci.yml test-macos on pull_request: runs on macOS (macos-latest)', 'ci.yml test-macos on merge_group: runs on macOS (macos-latest)']],
  ['ui-platforms.yml macOS on a pull request', swap('ui-platforms.yml', `'["ubuntu-latest","windows-latest"]') }}`, `'["ubuntu-latest","windows-latest","macos-latest"]') }}`), ['ui-platforms.yml ui on pull_request: runs on macOS (macos-latest)']],
  ['a macOS include entry', swap('fast-lane.yml', 'os: [ubuntu-latest, windows-latest]\n', 'os: [ubuntu-latest, windows-latest]\n        include:\n          - os: macos-14\n'), ['fast-lane.yml fast on pull_request: runs on macOS (macos-14)']],
  ['runs-on from a job output', swap('fast-lane.yml', 'runs-on: ${{ matrix.os }}', 'runs-on: ${{ needs.x.outputs.os }}'), ['fast-lane.yml fast on pull_request: runs-on has a shape this guard cannot read']],
  ['a reusable workflow job', { ...live, 'zz.yml': 'on:\n  pull_request:\njobs:\n  r:\n    uses: ./.github/workflows/macos-pr.yml\n' }, ['zz.yml r on pull_request: a reusable workflow, cannot tell its runner']],
  ['install-check.yml filter dropped', swap('install-check.yml', INSTALL_FILTER, `f='.'`), ['install-check.yml install on pull_request: matrix.os has a shape this guard cannot read']],
  ['install-check.yml in the merge queue', swap('install-check.yml', 'on:\n  workflow_dispatch:\n', 'on:\n  merge_group:\n  workflow_dispatch:\n'), ['install-check.yml install on merge_group: matrix.os has a shape this guard cannot read']],
  ['a self-hosted Mac label list, on: as a string', { ...live, 'zz.yml': 'on: pull_request\njobs:\n  m:\n    runs-on: [self-hosted, macOS]\n' }, ['zz.yml m on pull_request: runs on macOS (macOS)']],
];
for (const [name, set, want] of mutants) {
  assert.deepStrictEqual(all(set), want, `mutant "${name}" dies at its own assert`);
  assert.deepStrictEqual(all(set, true), want, `mutant "${name}" dies the same on a CRLF copy`);
}
console.log(`[ci-macos-off-prs] ok: ${seen.length} PR-event workflows, no macOS runner on pull_request or merge_group; ${mutants.length} mutants caught (LF and CRLF)`);
