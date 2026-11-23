'use strict';
/*
 * Spec 117 FR-001 / T003 (`npm run ci:stats [--days N] [--sample N]`): CI cost numbers from GitHub metadata, read-only.
 * `gh` runs through execFileSync with an argument array (no shell, no string of ours is ever a command line). Only metadata is
 * requested: run and job names, events, conclusions, timestamps, runner labels, PR numbers, label names, counts, file paths and
 * line counts. The GraphQL query (PR_QUERY) lists its fields and has no `body` or `title`; nothing from a run's or PR's text is
 * read or printed (AGENTS.md, untrusted content). Output goes through scripts/safe-print.js. Not in `npm test` (network); the
 * pure functions are checked offline by scripts/test-ci-stats.ts on a fixture.
 */
const { execFileSync } = require('child_process');
const { emit } = require('./safe-print.js');

const MIN = 60000;
const DAY = 86400000;
const FULL_WORKFLOWS = ['CI', 'UI on three OSes', 'macOS on pull requests', 'World matrix', 'Mac title bar on pull requests'];
const UI_WORKFLOW = 'UI on three OSes';
const PR_QUERY = 'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){pullRequests(states:MERGED,first:100,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number createdAt mergedAt labels(first:20){nodes{name}} reviews{totalCount} commits{totalCount} files(first:100){nodes{path additions}}}}}}';

/** Nearest-rank percentile (p in 1..100) of a list of numbers; null for an empty list. */
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.max(1, Math.ceil((p / 100) * sorted.length)) - 1];
}

const ms = (t) => Date.parse(t);
/** Minutes a job waited for a runner (started_at minus created_at); null when a time is missing. */
function queueWait(job) {
  if (!job || !job.created_at || !job.started_at) return null;
  return (ms(job.started_at) - ms(job.created_at)) / MIN;
}
/** Minutes a job ran (completed_at minus started_at); null when a time is missing. */
function duration(job) {
  if (!job || !job.started_at || !job.completed_at) return null;
  return (ms(job.completed_at) - ms(job.started_at)) / MIN;
}
/** `windows`, `linux` or `macos` from a job's runner labels. */
function osOf(job) {
  const l = ((job && job.labels) || []).join(' ').toLowerCase();
  return /windows/.test(l) ? 'windows' : /mac/.test(l) ? 'macos' : /ubuntu|linux/.test(l) ? 'linux' : 'other';
}

/** Spec Evidence classes: tests = scripts/**; code = src/ except test files; docs = specs/, docs/, changelog.d/, root *.md. */
function classifyPath(p) {
  const f = String(p).replace(/\\/g, '/');
  if (f.startsWith('scripts/')) return 'tests';
  if (f.startsWith('src/')) return /(^|\/)(test-[^/]*|[^/]*\.test\.[a-z]+)$/.test(f) ? 'tests' : 'code';
  if (/^(specs|docs|changelog\.d)\//.test(f) || /^[^/]+\.md$/.test(f)) return 'docs';
  return 'other';
}

/** Minutes (of `total` in [fromMs, toMs)) with at least `n` jobs waiting for a runner. */
function queuedMinutes(jobs, n, fromMs, toMs) {
  const total = Math.max(0, Math.ceil((toMs - fromMs) / MIN));
  const diff = new Int32Array(total + 1);
  for (const j of jobs) {
    if (!(queueWait(j) > 0)) continue;
    const a = Math.max(0, Math.floor((ms(j.created_at) - fromMs) / MIN));
    const b = Math.min(total, Math.ceil((ms(j.started_at) - fromMs) / MIN));
    if (b > a) { diff[a] += 1; diff[b] -= 1; }
  }
  let run = 0, hit = 0, max = 0;
  for (let i = 0; i < total; i++) { run += diff[i]; if (run >= n) hit++; if (run > max) max = run; }
  return { minutes: hit, total, max };
}

/** One window per day, newest last, each [from, to] inclusive to the second, covering [now - days, now]. */
function dayWindows(days, now) {
  const out = [];
  for (let i = days; i >= 1; i--) {
    const from = new Date(now.getTime() - i * DAY);
    const to = new Date(now.getTime() - (i - 1) * DAY - 1000);
    out.push({ from: from.toISOString().replace(/\.\d+Z$/, 'Z'), to: to.toISOString().replace(/\.\d+Z$/, 'Z') });
  }
  return out;
}

/** Per type label (bug, enhancement, task, other, all): PR count, cycle hours, reviews, commits, lines added by class. */
function prStats(prs) {
  const groups = new Map();
  const add = (k, pr) => { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(pr); };
  for (const pr of prs) {
    const names = ((pr.labels && pr.labels.nodes) || []).map((l) => l.name);
    add(['bug', 'enhancement', 'task'].find((t) => names.includes(t)) || 'other', pr);
    add('all', pr);
  }
  const out = {};
  for (const [k, list] of groups) {
    const lines = { code: 0, tests: 0, docs: 0, other: 0 };
    for (const pr of list) for (const f of (pr.files && pr.files.nodes) || []) lines[classifyPath(f.path)] += f.additions || 0;
    const cyc = list.map((pr) => (ms(pr.mergedAt) - ms(pr.createdAt)) / 3600000);
    out[k] = {
      prs: list.length,
      cycleH: [percentile(cyc, 50), percentile(cyc, 90)],
      reviews: [percentile(list.map((p) => p.reviews.totalCount), 50), percentile(list.map((p) => p.reviews.totalCount), 90)],
      commits: [percentile(list.map((p) => p.commits.totalCount), 50), percentile(list.map((p) => p.commits.totalCount), 90)],
      lines,
      noSrc: list.filter((pr) => !((pr.files && pr.files.nodes) || []).some((f) => classifyPath(f.path) === 'code' && f.additions > 0)).length,
    };
  }
  return out;
}

const q = (a, p) => (a.length ? percentile(a, p) : null);
const f1 = (x) => (x === null || x === undefined ? '-' : (Math.round(x * 10) / 10).toString());
const pair = (a) => `${f1(q(a, 50))} / ${f1(q(a, 90))}`;
function group(items, key) {
  const m = new Map();
  for (const it of items) { const k = key(it); if (k === null || k === undefined) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(it); }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** The report lines for runs ({id,name,event,conclusion,head_sha,head_branch,pull_requests:[{number}]}) and jobs (with run_id, name, labels, times). */
function report({ runs, jobs, prs, fromMs, toMs, days }) {
  const L = [];
  const wait = (arr) => arr.map(queueWait).filter((x) => x !== null && x >= 0);
  const runById = new Map(runs.map((r) => [r.id, r]));
  const ran = jobs.filter((j) => queueWait(j) !== null && j.conclusion !== 'skipped');
  L.push(`CI stats: last ${days} days, ${runs.length} runs, ${jobs.length} jobs (metadata only; Spec Kit, Project site, Nightly watch and CodeQL jobs are sampled)`);
  L.push('', 'Queue wait, minutes (p50 / p90), jobs that ran:');
  for (const [k, g] of group(ran, osOf)) L.push(`  OS ${k}: n=${wait(g).length} ${pair(wait(g))}`);
  for (const [k, g] of group(ran, (j) => (runById.get(j.run_id) || {}).event)) L.push(`  event ${k}: n=${wait(g).length} ${pair(wait(g))}`);
  for (const [k, g] of group(ran, (j) => new Date(j.created_at).getUTCHours())) L.push(`  hour ${String(k).padStart(2, '0')} UTC: n=${wait(g).length} ${pair(wait(g))}`);
  const qm = queuedMinutes(jobs, 10, fromMs, toMs);
  L.push('', `Minutes with >=10 jobs queued: ${qm.minutes} of ${qm.total} (${f1((100 * qm.minutes) / (qm.total || 1))} %), max queued at once ${qm.max}`);
  L.push('', 'Duration, minutes (p50 / p90), success or failure, by job name:');
  const done = jobs.filter((j) => (j.conclusion === 'success' || j.conclusion === 'failure') && duration(j) !== null);
  for (const [k, g] of group(done, (j) => j.name)) L.push(`  ${k}: n=${g.length} ${pair(g.map(duration))}`);
  // spec 117 FR-018, SC-003: since the split, "Build and test (<os>)" is a seconds-long summary job; the npm test time of a run is its LONGEST part
  // ("Build and test (<os>) part i/n"), counted only when every part of that run finished (success or failure); a part cancelled (the 25-min limit) is counted apart
  L.push('', 'npm test per OS (SC-003): longest part per run, minutes (p50 / p90); parts cancelled:');
  const PART = /^Build and test \(([\w.-]+)\) part (\d+)\/(\d+)$/;
  const parts = jobs.filter((j) => PART.test(j.name || ''));
  for (const [osName, g] of group(parts, (j) => PART.exec(j.name)[1])) {
    const longest = [];
    for (const [, rj] of group(g, (j) => `${j.run_id}#${j.run_attempt || 1}`)) {
      const n = Number(PART.exec(rj[0].name)[3]);
      if (rj.length === n && rj.every((j) => (j.conclusion === 'success' || j.conclusion === 'failure') && duration(j) !== null)) longest.push(Math.max(...rj.map(duration)));
    }
    L.push(`  ${osName}: runs=${longest.length} ${pair(longest)}; parts cancelled ${g.filter((j) => j.conclusion === 'cancelled').length}`);
  }
  const pj = jobs.filter((j) => (runById.get(j.run_id) || {}).event === 'pull_request');
  const pjMin = pj.reduce((s, j) => s + (duration(j) || 0), 0);
  const cancelled = pj.filter((j) => j.conclusion === 'cancelled').reduce((s, j) => s + (duration(j) || 0), 0);
  L.push('', `Cancelled share of pull_request runner minutes: ${f1((100 * cancelled) / (pjMin || 1))} % (${f1(cancelled)} of ${f1(pjMin)})`);
  for (const ev of ['pull_request', 'push']) { // E1: only our own workflow's name is ever matched, nothing else is named
    const evJobs = jobs.filter((j) => (runById.get(j.run_id) || {}).event === ev);
    const tot = evJobs.reduce((a, j) => a + (duration(j) || 0), 0);
    const ui = evJobs.filter((j) => (runById.get(j.run_id) || {}).name === UI_WORKFLOW).reduce((a, j) => a + (duration(j) || 0), 0);
    L.push(`Share of ${ev} runner minutes in the UI shards (${UI_WORKFLOW}): ${f1((100 * ui) / (tot || 1))} % (${Math.round(ui)} of ${Math.round(tot)}; sampled workflows make the total a lower bound)`);
  }
  const perHead = group(pj.filter((j) => j.conclusion !== 'skipped'), (j) => (runById.get(j.run_id) || {}).head_sha);
  L.push(`Jobs that ran per PR head (p50 / p90): ${pair(perHead.map(([, g]) => g.length))} over ${perHead.length} heads`);
  const prRuns = runs.filter((r) => r.event === 'pull_request' && r.pull_requests && r.pull_requests[0]);
  L.push(`Runs per PR (p50 / p90): ${pair(group(prRuns, (r) => r.pull_requests[0].number).map(([, g]) => g.length))}`);
  const mq = group(runs.filter((r) => r.event === 'merge_group'), (r) => { const m = /pr-(\d+)-/.exec(r.head_branch || ''); return m ? Number(m[1]) : null; });
  L.push(`Merge-queue runs per PR (p50 / p90): ${pair(mq.map(([, g]) => g.length))} over ${mq.length} PRs`);
  const st = prStats(prs || []);
  L.push('', `Last ${(prs || []).length} merged PRs: created to merged hours, reviews, commits (p50 / p90), lines added code / tests / docs / other, PRs with no src/ line:`);
  for (const k of ['bug', 'enhancement', 'task', 'other', 'all']) {
    const s = st[k];
    if (s) L.push(`  ${k}: ${s.prs} PRs; ${f1(s.cycleH[0])} / ${f1(s.cycleH[1])} h; reviews ${f1(s.reviews[0])} / ${f1(s.reviews[1])}; commits ${f1(s.commits[0])} / ${f1(s.commits[1])}; ${s.lines.code} / ${s.lines.tests} / ${s.lines.docs} / ${s.lines.other}; no-src ${s.noSrc}`);
  }
  return L;
}

/** The real `gh`: an argument array, no shell. Never prints stderr (it could echo request details). */
function ghJson(args, call = execFileSync) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) { // a transient 5xx or network error is retried
    try {
      return JSON.parse(call('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`gh ${args[0]} ${args[0] === 'api' && args[3] ? String(args[3]).replace(/\d+/g, 'N') : ''} failed (exit ${last && last.status})`);
}
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Fetch and report. `gh(args)` returns parsed JSON (injected by the test). */
function run({ days = 7, sample = 60, now = new Date(), gh = ghJson, repo } = {}) {
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('--days must be a whole number from 1 to 30');
  if (!Number.isInteger(sample) || sample < 1) throw new Error('--sample must be a positive whole number');
  const slug = repo || process.env.GITHUB_REPOSITORY || (() => { const r = gh(['repo', 'view', '--json', 'owner,name']); return `${r.owner.login}/${r.name}`; })();
  if (!REPO_RE.test(slug)) throw new Error('repository must be owner/name');
  const [owner, name] = slug.split('/');
  const runs = [];
  let forkRuns = 0;
  for (const w of dayWindows(days, now)) {
    for (let page = 1; ; page++) {
      const r = gh(['api', '-X', 'GET', `repos/${slug}/actions/runs`, '-f', `created=${w.from}..${w.to}`, '-f', 'per_page=100', '-f', `page=${page}`]);
      const list = (r && r.workflow_runs) || [];
      runs.push(...list);
      if (list.length < 100) break;
    }
  }
  // A fork's run uses the fork's own workflow file, so its workflow and job names are outside text (AGENTS.md). Only runs whose
  // head repository is this repo count; the rest are counted as a number and never fetched or printed.
  const own = runs.filter((r) => r.head_repository && r.head_repository.full_name === slug);
  forkRuns = runs.length - own.length;
  runs.length = 0;
  runs.push(...own);
  const byName = group(runs, (r) => r.name);
  const picked = [];
  for (const [n, list] of byName) {
    if (FULL_WORKFLOWS.includes(n) || list.length <= sample) picked.push(...list);
    else { const step = list.length / sample; for (let i = 0; i < sample; i++) picked.push(list[Math.floor(i * step)]); } // evenly spread, no randomness
  }
  const jobs = [];
  for (const r of picked) {
    for (let page = 1; ; page++) {
      const j = gh(['api', '-X', 'GET', `repos/${slug}/actions/runs/${Number(r.id)}/jobs`, '-f', 'filter=all', '-f', 'per_page=100', '-f', `page=${page}`]);
      const list = (j && j.jobs) || [];
      jobs.push(...list);
      if (list.length < 100) break;
    }
  }
  const g = gh(['api', 'graphql', '-f', `query=${PR_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`]);
  const prs = (((g || {}).data || {}).repository || {}).pullRequests;
  const lines = report({ runs, jobs, prs: (prs && prs.nodes) || [], fromMs: now.getTime() - days * DAY, toMs: now.getTime(), days });
  lines.splice(1, 0, `Runs from other repositories (forks) are left out of every number and name: ${forkRuns}`);
  return lines;
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--days' || a === '--sample') && /^\d+$/.test(argv[i + 1] || '')) o[a.slice(2)] = Number(argv[++i]);
    else throw new Error('usage: npm run ci:stats [--days N] [--sample N]');
  }
  return o;
}

if (require.main === module) {
  try {
    emit(run(parseArgs(process.argv.slice(2))).join('\n'));
  } catch (e) {
    emit(`ci:stats: ${e.message}`, console.error);
    process.exitCode = 1;
  }
}

module.exports = { ghJson, percentile, queueWait, duration, osOf, classifyPath, queuedMinutes, dayWindows, prStats, report, run, parseArgs, PR_QUERY };
