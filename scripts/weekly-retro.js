#!/usr/bin/env node
/*
 * Spec 021 FR-063 (retro #854, task T049): the weekly retro mechanism. A scheduled workflow (.github/workflows/weekly-retro.yml)
 * runs this script; it gathers the last 7 days of facts with `gh` and the workflow's GITHUB_TOKEN, and opens ONE issue
 * "Weekly retro <YYYY>-W<ww>" for the three agent sides to answer. No AI calls, no third-party code, no shell (execFileSync).
 *
 * Aggregates only: counts, medians, workflow and job names, issue numbers. No login names and no outsider text (an issue or PR
 * title is never copied: items appear as "#N"). That is the DORA rule of AGENTS.md (never rank people or agents).
 *
 *   node scripts/weekly-retro.js                         live: gather with gh, open the issue unless this week's exists
 *   node scripts/weekly-retro.js --dry-run               live gather, print the issue, change nothing
 *   node scripts/weekly-retro.js --dry-run --fixture D   read JSON files from D instead of gh (tests); --now ISO fixes the clock
 *
 * Fixture files in D (all optional, default []): prs.json (gh pr list: number,state,createdAt,mergedAt,closedAt,reviews[].state),
 * runs.json (gh run list: databaseId,workflowName,conclusion,event,createdAt,failedJobs[] as an array of job names),
 * scheduled.json (same, event schedule), claimed.json and approval.json (issues: number,createdAt,updatedAt), retro-issues.json
 * (REST issues: title,user.login), and optionally a copy of the rule files for the word counts (AGENTS.md ...).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const rules = require('./rules-check.js');

const DAY = 86400000;
const LABELS = ['task', 'area:harness', 'spec:021'];
const BOT = 'github-actions[bot]';

/** ISO 8601 week of a date, as { year, week }. */
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const y = t.getUTCFullYear();
  return { year: y, week: Math.ceil(((t - Date.UTC(y, 0, 1)) / DAY + 1) / 7) };
}
function titleFor(now) {
  const { year, week } = isoWeek(now);
  return `Weekly retro ${year}-W${String(week).padStart(2, '0')}`;
}
function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const hours = (ms) => Math.round((ms / 3600000) * 10) / 10;
const ts = (s) => (s ? Date.parse(s) : NaN);
function countBy(arr, key) {
  const m = new Map();
  for (const x of arr) m.set(key(x), (m.get(key(x)) || 0) + 1);
  return m;
}

/** A name that may be printed: letters, digits and a few plain marks only (no markdown, links, quotes or newlines), at most 80 characters. */
function clean(x) {
  return String(x).replace(/[^A-Za-z0-9 ()._+\/-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}
/** The `name:` of each workflow file in root/.github/workflows (our own files on main): the only workflow names a report may print. */
function workflowNames(root) {
  const dir = path.join(root, '.github', 'workflows');
  const out = new Set();
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)); } catch (e) { /* none */ }
  for (const f of files) {
    const m = /^name:\s*(.+?)\s*$/m.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (m) out.add(m[1].replace(/^['"]|['"]$/g, ''));
  }
  return out;
}

/** Facts from raw gh data. Pure; `now` is a Date. */
function buildFacts(d, now, root, repo) {
  const since = now.getTime() - 7 * DAY;
  const inWin = (s) => ts(s) >= since;
  const prs = d.prs || [];
  const merged = prs.filter((p) => p.state === 'MERGED' && inWin(p.mergedAt));
  const closed = prs.filter((p) => p.state === 'CLOSED' && inWin(p.closedAt));
  const open = prs.filter((p) => p.state === 'OPEN');
  const toMerge = merged.map((p) => ts(p.mergedAt) - ts(p.createdAt)).filter((x) => x >= 0);
  const changeReqs = (p) => (p.reviews || []).filter((r) => r.state === 'CHANGES_REQUESTED').length;
  const crTotal = prs.filter((p) => inWin(p.mergedAt) || inWin(p.closedAt)).reduce((n, p) => n + changeReqs(p), 0);

  // Only runs of this repository, of a workflow our own files on main define: a fork's run carries the fork's workflow and job names (outside text).
  const names = workflowNames(root);
  const ours = (r) => r.headRepository === repo && names.has(r.workflowName);
  const runs = (d.runs || []).filter((r) => ours(r) && (r.conclusion === 'success' || r.conclusion === 'failure'));
  const byWf = new Map();
  for (const r of runs) {
    const o = byWf.get(r.workflowName) || { runs: 0, failed: 0 };
    o.runs++;
    if (r.conclusion === 'failure') o.failed++;
    byWf.set(r.workflowName, o);
  }
  const workflows = [...byWf.entries()]
    .map(([name, o]) => ({ name, runs: o.runs, failed: o.failed, pct: Math.round((100 * o.failed) / o.runs) }))
    .sort((a, b) => b.failed - a.failed || a.name.localeCompare(b.name));
  const jobCounts = countBy(runs.filter((r) => r.conclusion === 'failure').flatMap((r) => (r.failedJobs || []).map(clean).filter(Boolean)), (j) => j);
  const topJobs = [...jobCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([name, n]) => ({ name, n }));

  // red scheduled workflows: the newest finished scheduled run of each workflow is a failure
  const latest = new Map();
  for (const r of (d.scheduled || []).filter((x) => ours(x) && (x.conclusion === 'success' || x.conclusion === 'failure'))) {
    const cur = latest.get(r.workflowName);
    if (!cur || ts(r.createdAt) > ts(cur.createdAt)) latest.set(r.workflowName, r);
  }
  const red = [...latest.values()].filter((r) => r.conclusion === 'failure').map((r) => r.workflowName).sort();

  const idle = (d.claimed || [])
    .map((i) => ({ number: i.number, days: Math.floor((now.getTime() - ts(i.updatedAt)) / DAY) }))
    .filter((i) => i.days > 3)
    .sort((a, b) => b.days - a.days);
  const approval = (d.approval || [])
    .map((i) => ({ number: i.number, days: Math.floor((now.getTime() - ts(i.createdAt)) / DAY) }))
    .sort((a, b) => b.days - a.days);

  const rc = rules.check(root);
  let notes = null;
  try {
    notes = (fs.readFileSync(path.join(root, 'docs', 'agent-notes.md'), 'utf8').match(/^(### |- \*\*)/gm) || []).length;
  } catch (e) { /* no notes file in this root */ }

  return {
    title: titleFor(now),
    since: new Date(since).toISOString().slice(0, 10),
    until: now.toISOString().slice(0, 10),
    prs: { merged: merged.length, closed: closed.length, open: open.length, medianHoursToMerge: median(toMerge) === null ? null : hours(median(toMerge)) },
    changeRequests: crTotal,
    workflows, topJobs, red, idle, approval,
    rules: rc.rows,
    protocolNotes: notes,
  };
}

function renderBody(f) {
  const L = [];
  L.push(`Weekly retro for ${f.since} to ${f.until} (spec 021 FR-063, task T049). Opened by \`scripts/weekly-retro.js\`; facts are aggregates from the GitHub API and \`main\`, never a ranking of people or agents (AGENTS.md, DORA rule). Issue and PR items are numbers only.`);
  L.push('', '## Facts', '');
  L.push(`- PRs: ${f.prs.merged} merged, ${f.prs.closed} closed unmerged, ${f.prs.open} open now. Median open to merge: ${f.prs.medianHoursToMerge === null ? 'n/a' : f.prs.medianHoursToMerge + ' h'}.`);
  L.push(`- Change-request reviews on PRs finished this week: ${f.changeRequests}.`);
  L.push('', '### CI by workflow (finished runs, last 7 days)', '');
  if (f.workflows.length) {
    L.push('| workflow | runs | failed | fail % |', '|---|---:|---:|---:|');
    for (const w of f.workflows) L.push(`| ${w.name} | ${w.runs} | ${w.failed} | ${w.pct} |`);
  } else L.push('No finished runs found.');
  L.push('', 'Top failing jobs: ' + (f.topJobs.length ? f.topJobs.map((j) => `${j.name} (${j.n})`).join(', ') : 'none') + '.');
  L.push('', `- Red scheduled workflows (newest scheduled run failed; each needs an owner within 24 h or a pause, AGENTS.md *Red means owned*): ${f.red.length ? f.red.join(', ') : 'none'}.`);
  L.push(`- \`status:claimed\` issues idle more than 3 days: ${f.idle.length ? f.idle.map((i) => `#${i.number} (${i.days} d)`).join(', ') : 'none'}.`);
  L.push(`- \`needs-owner-approval\` open items and their age: ${f.approval.length ? f.approval.map((i) => `#${i.number} (${i.days} d)`).join(', ') : 'none'}.`);
  L.push('', '### Rule files against their word budgets (`npm run rules:check`)', '', '| file | words | budget |', '|---|---:|---:|');
  for (const r of f.rules) L.push(`| ${r.file} | ${r.words === null ? 'missing' : r.words} | ${r.budget}${r.ok ? '' : ' OVER'} |`);
  L.push('', `Protocol notes in \`docs/agent-notes.md\`: ${f.protocolNotes === null ? 'n/a' : f.protocolNotes}.`);
  L.push('', '## What each side does', '',
    'Write your retro blind first (do not read the other sides before you post): what went **well**, what we would do **differently**, **cleanup**, what to **slim**, and **next**. Post it as a comment here within your working day, then tick your box.', '',
    "- [ ] Vikram's agent side",
    "- [ ] Paco's agent side",
    "- [ ] Ruben's agent side",
    '- [ ] merged proposals + one batched owner-decision message with recommendations', '',
    'The first side to finish merges the proposals into one list; small cleanups become PRs reviewed for each other; decisions that need an owner go into one batched message with a recommendation each. Close this issue when the last box is ticked.');
  return L.join('\n') + '\n';
}

/** True when a retro issue with exactly this title by the Actions bot already exists. */
function exists(issues, title) {
  return (issues || []).some((i) => i && i.title === title && i.user && i.user.login === BOT);
}

// --- gh access ---------------------------------------------------------------------------------------------------------------
function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024, stdio: ['pipe', 'pipe', 'inherit'] });
}
const ghJson = (args) => JSON.parse(gh(args) || '[]');

function gather(now, repo) {
  const since = new Date(now.getTime() - 7 * DAY).toISOString().slice(0, 10);
  const prs = ghJson(['pr', 'list', '--state', 'all', '--limit', '500', '--search', `updated:>=${since}`, '--json', 'number,state,createdAt,mergedAt,closedAt,reviews']);
  const rest = (extra, pages) => {
    const out = [];
    for (let p = 1; p <= pages; p++) {
      const j = JSON.parse(gh(['api', `repos/${repo}/actions/runs?per_page=100&page=${p}&${extra}`]) || '{}');
      const rs = j.workflow_runs || [];
      for (const r of rs) out.push({ databaseId: r.id, workflowName: r.name, conclusion: r.conclusion, event: r.event, createdAt: r.created_at, headRepository: r.head_repository && r.head_repository.full_name });
      if (rs.length < 100) break;
    }
    return out;
  };
  const runs = rest(`created=%3E%3D${since}`, 10);
  const scheduled = rest('event=schedule', 2);
  // failed job names for at most 60 failed runs (cheap: one call each)
  let n = 0;
  for (const r of runs) {
    if (r.conclusion !== 'failure' || n >= 60 || r.headRepository !== repo) continue;
    n++;
    try {
      const j = ghJson(['run', 'view', String(r.databaseId), '--json', 'jobs']);
      r.failedJobs = (j.jobs || []).filter((x) => x.conclusion === 'failure').map((x) => x.name);
    } catch (e) { r.failedJobs = []; }
  }
  const labelled = (l) => ghJson(['issue', 'list', '--state', 'open', '--label', l, '--limit', '200', '--json', 'number,createdAt,updatedAt']);
  const issues = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/issues?state=all&per_page=100&creator=${encodeURIComponent(BOT)}`]) || '[]').flat();
  return { prs, runs, scheduled, claimed: labelled('status:claimed'), approval: labelled('needs-owner-approval'), retroIssues: issues };
}

function readFixture(dir) {
  const rd = (f) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { return []; }
  };
  return { prs: rd('prs.json'), runs: rd('runs.json'), scheduled: rd('scheduled.json'), claimed: rd('claimed.json'), approval: rd('approval.json'), retroIssues: rd('retro-issues.json') };
}

function main(argv) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const dry = argv.includes('--dry-run');
  const fixture = arg('--fixture');
  if (fixture && !dry) { console.error('weekly-retro: --fixture needs --dry-run'); return 2; }
  const now = arg('--now') ? new Date(arg('--now')) : new Date();
  if (Number.isNaN(now.getTime())) { console.error('weekly-retro: bad --now'); return 2; }
  const root = fixture && fs.existsSync(path.join(path.resolve(fixture), 'AGENTS.md')) ? path.resolve(fixture) : path.join(__dirname, '..');
  const repo = fixture ? 'three-feathers/agent-durbar' : process.env.GITHUB_REPOSITORY || gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
  const title = titleFor(now);
  const data = fixture ? readFixture(path.resolve(fixture)) : gather(now, repo);
  if (exists(data.retroIssues, title)) { console.log(`weekly-retro: "${title}" already exists; nothing to do`); return 0; }
  const body = renderBody(buildFacts(data, now, root, repo));
  if (dry) { console.log(`TITLE: ${title}\nLABELS: ${LABELS.join(',')}\n\n${body}`); return 0; }
  const args = ['issue', 'create', '--title', title, '--body-file', '-'];
  for (const l of LABELS) args.push('--label', l);
  console.log(gh(args, body).trim());
  return 0;
}

module.exports = { isoWeek, titleFor, median, buildFacts, renderBody, exists, LABELS, BOT };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
