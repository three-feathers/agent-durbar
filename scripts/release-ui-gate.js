#!/usr/bin/env node
'use strict';
/*
 * Spec 117 FR-014 / T045: the release UI gate. release.yml's first job runs this; every other job needs it, so no package is
 * built or drafted unless the "UI on three OSes" workflow (ui-platforms.yml) finished green on exactly the tagged commit.
 *
 * Which runs count: runs of ui-platforms.yml in this repository whose head_sha is the tagged commit and whose event is a push on
 * main, a workflow_dispatch (any ref whose head is that commit, so the workflow file is the commit's own) or the nightly schedule.
 * A pull_request run never counts: it tests the PR merged into its base, not the commit itself.
 * The verdict is the LATEST counting run, by run_started_at (a re-run attempt moves it, so re-running a cancelled run makes that
 * attempt the verdict), then by the higher run id. An older green run does not outvote a newer red, cancelled or running one:
 * the newest result on the commit is what the gate trusts (fail closed), and a red run is fixed by re-running it, not hidden.
 *   - no counting run yet: wait up to --not-found-minutes (a push run appears within a minute of the merge), then fail;
 *   - the latest is queued or running: wait up to --max-minutes in all, then fail;
 *   - the latest completed: pass only on conclusion "success"; "cancelled" (spec 117 O3: a newer merge cancelled it) and every
 *     other conclusion fail, each with what to do next.
 * API errors count as a wait; if they last until --max-minutes the gate fails, never passes.
 *
 * CLI: node scripts/release-ui-gate.js --sha <40 hex> --repo <owner/name> --tag <v...> [--not-found-minutes 15]
 *      [--max-minutes 150] [--interval-seconds 60] [--summary <file>] [--runs-file <json>]
 * --runs-file decides once from a saved API answer ({"workflow_runs": [...]}) with no network (a dry run). Otherwise `gh api`
 * (GH_TOKEN from the job, actions: read) through execFileSync with an argument array: no shell. Prints run ids, events, states
 * and links only, never a run title (a commit message).
 */
const fs = require('fs');
const { execFileSync } = require('child_process');

const WORKFLOW_FILE = 'ui-platforms.yml';
const MIN = 60 * 1000;

function checkInputs(o) {
  const bad = [];
  if (!/^[0-9a-f]{40}$/i.test(String(o.sha))) bad.push('sha must be 40 hex characters');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(o.repo))) bad.push('repo must be owner/name');
  if (!/^v[0-9A-Za-z.-]+$/.test(String(o.tag))) bad.push('tag must look like v1.2.3');
  if (!(Number(o.maxMs) > 0) || !(Number(o.notFoundMs) > 0) || Number(o.notFoundMs) > Number(o.maxMs)) bad.push('limits must be positive, not-found at most the whole wait');
  return bad;
}

function runsPath(repo, sha) {
  return `repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?head_sha=${sha}&per_page=100`;
}

function eligible(r, sha, repo) {
  const EVENTS = ['push', 'workflow_dispatch', 'schedule'];
  const s = String(sha).toLowerCase();
  return !!r && String(r.head_sha).toLowerCase() === s
    && EVENTS.includes(r.event)
    && (r.event !== 'push' || r.head_branch === 'main')
    && (!r.head_repository || r.head_repository.full_name === repo)
    && (!r.path || r.path.split('@')[0] === `.github/workflows/${WORKFLOW_FILE}`);
}

const at = (r) => Date.parse(r.run_started_at || r.created_at) || 0;
function newestFirst(a, b) {
  const ta = at(a);
  const tb = at(b);
  return tb - ta || b.id - a.id;
}

function describe(r) {
  return `run ${r.id} (${r.event}, attempt ${r.run_attempt || 1}, ${r.status}${r.conclusion ? '/' + r.conclusion : ''}) ${r.html_url || ''}`.trim();
}

/** One decision from the runs the API returned: { verdict: pass|wait|fail, reason, run?, message }. */
function decide(runs, o) {
  const bad = checkInputs(o);
  if (bad.length) throw new Error(`release UI gate: bad input: ${bad.join('; ')}`);
  const sha = String(o.sha).toLowerCase();
  const redo = `gh workflow run ${WORKFLOW_FILE} --repo ${o.repo} --ref ${o.tag}`;
  const after = 'When it is green, re-run this release run (gh run rerun <this run id> --failed), or tag a newer main commit whose UI run is green.';
  const ok = (runs || []).filter((r) => eligible(r, sha, o.repo));
  if (ok.length === 0) {
    if (o.elapsedMs < o.notFoundMs) return { verdict: 'wait', reason: 'none-yet', message: `No "UI on three OSes" run for ${sha} yet; waiting.` };
    return { verdict: 'fail', reason: 'none', message: `No "UI on three OSes" run (push on main, by hand or nightly) for ${sha} after ${Math.round(o.notFoundMs / MIN)} minutes. The workflow's paths filter may have skipped this commit, or the tag is not on a main push. Start one on the tag: ${redo}. ${after}` };
  }
  const latest = ok.slice().sort(newestFirst)[0];
  if (latest.status !== 'completed') {
    if (o.elapsedMs < o.maxMs) return { verdict: 'wait', reason: 'running', run: latest, message: `Waiting for ${describe(latest)}.` };
    return { verdict: 'fail', reason: 'timeout', run: latest, message: `The UI run for ${sha} did not finish within ${Math.round(o.maxMs / MIN)} minutes: ${describe(latest)}. ${after}` };
  }
  if (latest.conclusion === 'success') return { verdict: 'pass', reason: 'success', run: latest, message: `The UI run for ${sha} is green: ${describe(latest)}.` };
  if (latest.conclusion === 'cancelled') {
    return { verdict: 'fail', reason: 'cancelled', run: latest, message: `The latest UI run for ${sha} was cancelled (spec 117 O3: a newer merge to main cancels the older main UI run): ${describe(latest)}. Re-run it (gh run rerun ${latest.id} --repo ${o.repo}) or start one on the tag (${redo}). ${after}` };
  }
  return { verdict: 'fail', reason: 'failed', run: latest, message: `The latest UI run for ${sha} did not pass: ${describe(latest)}. Fix it on main, or re-run it if the durbar-ci-rerun skill allows (gh run rerun ${latest.id} --repo ${o.repo}). ${after}` };
}

/** The wait loop. fetchRuns() returns the runs array or throws; sleep(ms) and now() are injected so tests need no clock. */
async function poll(o) {
  const start = o.now();
  let lastError = '';
  for (;;) {
    const elapsedMs = o.now() - start;
    let v;
    try {
      v = decide(o.fetchRuns(), { ...o, elapsedMs });
      lastError = '';
    } catch (e) {
      if (/bad input/.test(String(e && e.message))) throw e;
      lastError = String((e && e.message) || e).split('\n')[0].slice(0, 200);
      o.log(`API error (counted as a wait): ${lastError}`);
      if (elapsedMs >= o.maxMs) {
        return { verdict: 'fail', reason: 'api', message: `The GitHub API kept failing for ${Math.round(o.maxMs / MIN)} minutes (${lastError}); the gate does not pass without an answer.` };
      }
      v = { verdict: 'wait', reason: 'api', message: 'retrying' };
    }
    if (v.verdict !== 'wait') return v;
    if (v.reason !== 'api') o.log(v.message);
    await o.sleep(o.intervalMs);
  }
}

function arg(argv, name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
}

async function main(argv) {
  const o = {
    sha: String(arg(argv, '--sha', '')).toLowerCase(),
    repo: arg(argv, '--repo', ''),
    tag: arg(argv, '--tag', ''),
    notFoundMs: Number(arg(argv, '--not-found-minutes', '15')) * MIN,
    maxMs: Number(arg(argv, '--max-minutes', '150')) * MIN,
    intervalMs: Number(arg(argv, '--interval-seconds', '60')) * 1000,
  };
  const bad = checkInputs(o);
  if (bad.length || !(o.intervalMs > 0)) { console.error(`release UI gate: ${bad.join('; ') || 'interval must be positive'}`); return 2; }
  const summary = arg(argv, '--summary', '');
  const runsFile = arg(argv, '--runs-file', '');
  let v;
  if (runsFile) {
    const data = JSON.parse(fs.readFileSync(runsFile, 'utf8'));
    v = decide(data.workflow_runs || [], { ...o, elapsedMs: o.maxMs }); // a dry run decides as if every wait were over
  } else {
    v = await poll({
      ...o,
      fetchRuns: () => {
        const data = JSON.parse(execFileSync('gh', ['api', runsPath(o.repo, o.sha)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
        const runs = data.workflow_runs || [];
        if (Number(data.total_count) > runs.length) throw new Error(`${data.total_count} runs for one commit, more than one page: not decided`);
        return runs;
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      log: (s) => console.log(s),
    });
  }
  const line = `${v.verdict === 'pass' ? 'PASS' : 'FAIL'} release UI gate (spec 117 FR-014): ${v.message}`;
  (v.verdict === 'pass' ? console.log : console.error)(line);
  if (summary) { try { fs.appendFileSync(summary, `### Release UI gate\n\n${line}\n`); } catch { /* summary is best effort */ } }
  return v.verdict === 'pass' ? 0 : 1;
}

module.exports = { WORKFLOW_FILE, checkInputs, runsPath, eligible, decide, poll };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(`release UI gate: ${e && e.message}`); process.exitCode = 1; });
}
