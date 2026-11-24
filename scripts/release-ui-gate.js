#!/usr/bin/env node
'use strict';
/*
 * Spec 117 FR-014 / T045: the release UI gate. release.yml's first job runs this; every other job needs it, so no package is
 * built or drafted unless the "UI on three OSes" workflow (ui-platforms.yml) finished green on exactly the tagged commit.
 *
 * Runs that can count: runs of ui-platforms.yml in this repository whose head_sha is the tagged commit and whose event is a push
 * on main, a workflow_dispatch (any ref whose head is that commit, so the workflow file is the commit's own) or the nightly
 * schedule. A pull_request run never counts: it tests the PR merged into its base, not the commit itself.
 * WHICH of those runs, and which of their jobs, decide is ONE named policy, POLICY below. In force: 'linux-windows-jobs' (owner
 * pick, Vikram 2026-11-23, #2038 item 1, recorded on #1995): every counting run is judged on its Linux and Windows UI shards and
 * the decision job only, so a red macOS shard of a nightly or by-hand run never vetoes a release. The other options stay tested.
 * Among the runs the policy counts, the LATEST decides, by run_started_at (a re-run attempt moves it), then the higher run id:
 * an older green run does not outvote a newer red, cancelled or running one (fail closed).
 *   - no counting run yet: wait up to --not-found-minutes (a push run appears within a minute of the merge), then fail;
 *   - the latest is still running (for its deciding jobs): wait up to --max-minutes in all, then fail;
 *   - it finished: pass only when it (or its deciding jobs) succeeded; cancelled and every other result fail.
 * The printed remedy never suggests re-running a main push run (once spec 117 O3 lands, a re-run joins the ui-main group and
 * cancels main's newest UI run): only a by-hand run on the tag, or tagging a newer green commit, then re-running the failed jobs
 * of the release run (spec 021 FR-087 delta 2026-11-22).
 * API answers: 5xx, 429, a rate-limit 403 and network errors count as a wait (failing at --max-minutes, never passing); any other
 * 4xx (401, a permission 403, 404: a wrong repo, permission or workflow name) fails at once.
 *
 * CLI: node scripts/release-ui-gate.js --sha <40 hex> --repo <owner/name> --tag <v...> [--not-found-minutes 15]
 *      [--max-minutes 150] [--interval-seconds 60] [--summary <file>] [--runs-file <json>]
 * Exit 0 pass, 1 fail, 2 bad input. --runs-file decides once from a saved API answer ({"workflow_runs": [...], "jobs":
 * {"<run id>": [...]}}) with no network (a dry run). Otherwise `gh api` (GH_TOKEN from the job, actions: read) through
 * execFileSync with an argument array: no shell. Prints run ids, events, states and links only, never a run title.
 */
const fs = require('fs');
const { execFileSync } = require('child_process');

const WORKFLOW_FILE = 'ui-platforms.yml';
const MIN = 60 * 1000;
const SHARD = /^UI shard \((ubuntu|windows|macos)-latest (\d+)\/(\d+)\)$/;
const DECISION_JOB = 'What the UI suite needs';

function runState(r) {
  if (r.status !== 'completed') return { state: 'running', detail: '' };
  if (r.conclusion === 'success') return { state: 'success', detail: '' };
  if (r.conclusion === 'cancelled') return { state: 'cancelled', detail: '' };
  return { state: 'failed', detail: '' };
}

/** Shards 1..n of one OS, each exactly once, all with the same n (a missing or doubled shard is not a complete set). */
function completeSet(list) {
  if (list.length === 0) return false;
  const n = list[0].n;
  if (list.some((x) => x.n !== n)) return false;
  const ks = list.map((x) => x.k).sort((a, b) => a - b);
  return ks.length === n && ks.every((k, i) => k === i + 1);
}

/** The Linux and Windows shards (every one the run defines) and the decision job of one run; macOS shards are not read. */
function linuxWindowsState(r) {
  const jobs = Array.isArray(r.jobs) ? r.jobs : null;
  if (!jobs) return r.status !== 'completed' ? { state: 'running', detail: 'jobs not listed yet' } : { state: 'failed', detail: 'its jobs could not be read' };
  const decision = jobs.filter((j) => j.name === DECISION_JOB);
  const shards = { ubuntu: [], windows: [] };
  for (const j of jobs) {
    const m = SHARD.exec(j.name);
    if (m && m[1] !== 'macos') shards[m[1]].push({ k: Number(m[2]), n: Number(m[3]), j });
  }
  const pick = [...decision, ...shards.ubuntu.map((x) => x.j), ...shards.windows.map((x) => x.j)];
  if (pick.some((j) => j.status !== 'completed')) return { state: 'running', detail: 'Linux and Windows jobs' };
  if (decision.length !== 1 || !completeSet(shards.ubuntu) || !completeSet(shards.windows)) {
    return r.status !== 'completed' ? { state: 'running', detail: 'jobs not listed yet' } : { state: 'failed', detail: 'a Linux or Windows shard or the decision job is missing' };
  }
  if (pick.every((j) => j.conclusion === 'success')) return { state: 'success', detail: 'Linux and Windows jobs' };
  if (pick.some((j) => j.conclusion === 'cancelled')) return { state: 'cancelled', detail: 'a Linux or Windows job' };
  return { state: 'failed', detail: 'a Linux or Windows job' };
}

const isMacJob = (j) => (SHARD.exec(j.name) || [])[1] === 'macos';
const dispatchRedo = (o) => `gh workflow run ${WORKFLOW_FILE} --repo ${o.repo} --ref ${o.tag}`;

/** Owner question #2038 item 1: which runs and jobs decide. One entry per option; POLICY names the one in force. */
const POLICIES = {
  // as first built: the latest push-on-main, by-hand or nightly run decides as a whole (macOS shards included)
  'latest-run': {
    needsJobs: false,
    counts: () => true,
    state: runState,
    remedy: (o) => `Start a by-hand run on the tag (${dispatchRedo(o)}; it runs macOS too, and its whole result decides)`,
  },
  // option (a), IN FORCE: the same runs, judged on their Linux and Windows shards and the decision job only
  'linux-windows-jobs': {
    needsJobs: true,
    counts: () => true,
    state: linuxWindowsState,
    remedy: (o) => `Start a by-hand UI run at this exact commit (${dispatchRedo(o)}; only its Linux and Windows jobs decide)`,
  },
  // option (b): only main push runs, and by-hand runs that have no macOS job, decide, as a whole
  'push-or-dispatch-without-macos': {
    needsJobs: true,
    counts: (r) => r.event === 'push' || (r.event === 'workflow_dispatch' && Array.isArray(r.jobs) && r.jobs.length > 0 && !r.jobs.some(isMacJob)),
    state: runState,
    remedy: () => 'A by-hand run counts only without macOS jobs (today\'s by-hand matrix has them), so tag a newer main commit whose main push UI run is green',
  },
};
// owner pick, Vikram 2026-11-23 (option (a), recorded on #1995): a red macOS shard never vetoes a release
const POLICY = 'linux-windows-jobs';

function checkInputs(o) {
  const bad = [];
  if (!/^[0-9a-f]{40}$/i.test(String(o.sha))) bad.push('sha must be 40 hex characters');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(o.repo))) bad.push('repo must be owner/name');
  if (!/^v[0-9A-Za-z.-]+$/.test(String(o.tag))) bad.push('tag must look like v1.2.3');
  if (!(Number(o.maxMs) > 0) || !(Number(o.notFoundMs) > 0) || Number(o.notFoundMs) > Number(o.maxMs)) bad.push('limits must be positive, not-found at most the whole wait');
  if (o.policy !== undefined && !Object.prototype.hasOwnProperty.call(POLICIES, o.policy)) bad.push('unknown policy');
  return bad;
}

function runsPath(repo, sha) {
  return `repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?head_sha=${sha}&per_page=100`;
}
function jobsPath(repo, id) {
  return `repos/${repo}/actions/runs/${Number(id)}/jobs?filter=latest&per_page=100`;
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
  const policy = POLICIES[o.policy || POLICY];
  const sha = String(o.sha).toLowerCase();
  const after = 'When it is green, re-run only the failed jobs of this release run (gh run rerun <this release run id> --failed; spec 021 FR-087 delta 2026-11-22), or tag a newer main commit whose UI run is green. Never re-run a main push UI run: it would cancel main\'s newest UI run (spec 117 O3).';
  const ok = (runs || []).filter((r) => eligible(r, sha, o.repo) && policy.counts(r));
  if (ok.length === 0) {
    if (o.elapsedMs < o.notFoundMs) return { verdict: 'wait', reason: 'none-yet', message: `No deciding "UI on three OSes" run for ${sha} yet; waiting.` };
    return { verdict: 'fail', reason: 'none', message: `No deciding "UI on three OSes" run for ${sha} after ${Math.round(o.notFoundMs / MIN)} minutes. Likely: the merge queue pushed this commit together with a newer one, and GitHub starts a push run only for the newest commit of a push (v0.1.28); or the workflow's paths filter skipped it; or the tag is not on a main push. ${policy.remedy(o)}. ${after}` };
  }
  const latest = ok.slice().sort(newestFirst)[0];
  const s = policy.state(latest);
  const what = `${describe(latest)}${s.detail ? ` [${s.detail}]` : ''}`;
  if (s.state === 'running') {
    if (o.elapsedMs < o.maxMs) return { verdict: 'wait', reason: 'running', run: latest, message: `Waiting for ${what}.` };
    return { verdict: 'fail', reason: 'timeout', run: latest, message: `The UI run for ${sha} did not finish within ${Math.round(o.maxMs / MIN)} minutes: ${what}. ${policy.remedy(o)}. ${after}` };
  }
  if (s.state === 'success') return { verdict: 'pass', reason: 'success', run: latest, message: `The UI run for ${sha} is green: ${what}.` };
  if (s.state === 'cancelled') {
    return { verdict: 'fail', reason: 'cancelled', run: latest, message: `The latest deciding UI run for ${sha} was cancelled: ${what}. A run is cancelled by a newer run in its concurrency group, a job time limit or a person; its page says which. ${policy.remedy(o)}. ${after}` };
  }
  return { verdict: 'fail', reason: 'failed', run: latest, message: `The latest deciding UI run for ${sha} did not pass: ${what}. Fix the cause on main. ${policy.remedy(o)}. ${after}` };
}

/** "wait" for 5xx, 429, a rate-limit 403 and errors with no HTTP status (network); "fatal" for every other 4xx (401, 403, 404, 422 ...). */
function errorKind(message) {
  const m = /HTTP (\d{3})/.exec(String(message));
  if (!m) return 'wait';
  const code = Number(m[1]);
  if (code === 403 && /rate limit/i.test(String(message))) return 'wait'; // primary and secondary rate limits answer 403
  return code === 429 || code >= 500 ? 'wait' : 'fatal';
}

/** The runs for the sha, with each counting run's latest-attempt jobs attached when the policy reads jobs. gh(path) -> JSON. */
function fetchRuns(gh, o) {
  const policy = POLICIES[o.policy || POLICY];
  const data = gh(runsPath(o.repo, String(o.sha).toLowerCase()));
  const runs = data.workflow_runs || [];
  if (Number(data.total_count) > runs.length) throw new Error(`${data.total_count} runs for one commit, more than one page: not decided`);
  if (policy.needsJobs) {
    for (const r of runs.filter((x) => eligible(x, o.sha, o.repo)).sort(newestFirst).slice(0, 10)) {
      const all = [];
      let total = 0;
      for (let page = 1; page <= 10; page++) {
        const d = gh(`${jobsPath(o.repo, r.id)}&page=${page}`);
        total = Number(d.total_count) || 0;
        const got = d.jobs || [];
        all.push(...got);
        if (got.length === 0 || all.length >= total) break;
      }
      if (all.length < total) throw new Error(`run ${r.id}: ${total} jobs, ${all.length} listed: not decided`);
      r.jobs = all.map((j) => ({ name: j.name, status: j.status, conclusion: j.conclusion }));
    }
  }
  return runs;
}

/** The wait loop. fetchRuns() returns the runs array or throws; sleep(ms) and now() are injected so tests need no clock. */
async function poll(o) {
  const start = o.now();
  for (;;) {
    const elapsedMs = o.now() - start;
    let v;
    try {
      v = decide(o.fetchRuns(), { ...o, elapsedMs });
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (/bad input/.test(msg)) throw e;
      const err = msg.replace(/\s+/g, ' ').trim().slice(0, 300);
      if (errorKind(err) === 'fatal') {
        return { verdict: 'fail', reason: 'api-fatal', message: `The GitHub API refused the request (${err}): a wrong repository, permission or workflow name does not get better by waiting.` };
      }
      o.log(`API error (counted as a wait): ${err}`);
      if (elapsedMs >= o.maxMs) {
        return { verdict: 'fail', reason: 'api', message: `The GitHub API kept failing for ${Math.round(o.maxMs / MIN)} minutes (${err}); the gate does not pass without an answer.` };
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

/** gh api through an argument array (no shell); a failure carries gh's stderr, where the HTTP status is ("... (HTTP 404)"). */
function ghApi(path, exec = execFileSync) {
  try {
    return JSON.parse(exec('gh', ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (e) {
    throw new Error(`${String((e && e.stderr) || '').trim()} ${String((e && e.message) || e).split('\n')[0]}`.trim());
  }
}

/** Returns the exit code: 0 pass, 1 fail, 2 bad input. */
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
    const jobs = data.jobs || {};
    const runs = (data.workflow_runs || []).map((r) => (jobs[r.id] ? { ...r, jobs: jobs[r.id] } : r));
    v = decide(runs, { ...o, elapsedMs: o.maxMs }); // a dry run decides as if every wait were over
  } else {
    v = await poll({
      ...o,
      fetchRuns: () => fetchRuns((p) => ghApi(p), o),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      log: (s) => console.log(s),
    });
  }
  const line = `${v.verdict === 'pass' ? 'PASS' : 'FAIL'} release UI gate (spec 117 FR-014, policy ${POLICY}): ${v.message}`;
  (v.verdict === 'pass' ? console.log : console.error)(line);
  if (summary) { try { fs.appendFileSync(summary, `### Release UI gate\n\n${line}\n`); } catch { /* summary is best effort */ } }
  return v.verdict === 'pass' ? 0 : 1;
}

module.exports = { WORKFLOW_FILE, POLICY, POLICIES, checkInputs, runsPath, jobsPath, eligible, decide, errorKind, ghApi, fetchRuns, poll, main };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(`release UI gate: ${e && e.message}`); process.exitCode = 1; });
}
