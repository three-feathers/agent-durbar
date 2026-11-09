#!/usr/bin/env node
// Spec 021 FR-088 (2026-11-09): the parity checklists tick themselves. Run by .github/workflows/parity-tick.yml on
// `issues: [closed, reopened]`, by hand (workflow_dispatch) and once a day. Every run RECONCILES each tracker issue listed in
// .github/parity-trackers.json with the live state of every issue its `- [ ] #M` lines name: closed as completed => `[x]`,
// open => `[ ]`, anything else (not planned, duplicate, a pull request, a failed lookup) => unchanged. So a run GitHub cancels
// while it is pending (one pending run per concurrency group) loses nothing: the next run does its work.
// tickBody() and itemNumbers() are the pure text part (tested by scripts/test-parity-tick.ts); main() does the GitHub calls
// through the preinstalled gh with execFileSync (no shell). No value of the triggering event is used at all.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const NUMBER_RE = /^[1-9][0-9]{0,8}$/; // an issue number: 1 to 9 digits, no sign, no leading zero
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/;

// body: the tracker's text; n: the issue number (string of digits); state: 'tick' or 'untick'.
// Returns { body, changed } where changed counts the lines edited. Lines inside fenced code blocks are never edited; line
// endings (LF or CRLF) and every other byte are kept.
function tickBody(body, n, state) {
  if (typeof body !== 'string') throw new TypeError('parity-tick: body must be a string');
  n = String(n);
  if (!NUMBER_RE.test(n)) throw new Error('parity-tick: issue number must be 1 to 9 digits');
  if (state !== 'tick' && state !== 'untick') throw new Error('parity-tick: state must be tick or untick');
  const from = state === 'tick' ? '[ ]' : '[xX]';
  const to = state === 'tick' ? 'x' : ' ';
  const line = new RegExp('^([ \\t]*- \\[)' + from + '(\\] #' + n + ')(?![0-9])');
  const lines = body.split('\n');
  let fence = null; // the opening fence run (e.g. '```') while inside a fenced block
  let changed = 0;
  for (let i = 0; i < lines.length; i++) {
    const f = FENCE_RE.exec(lines[i]);
    if (f) {
      if (fence === null) { fence = f[1]; continue; }
      if (f[1][0] === fence[0] && f[1].length >= fence.length && lines[i].trim() === f[1]) { fence = null; continue; }
    }
    if (fence !== null) continue;
    const next = lines[i].replace(line, '$1' + to + '$2');
    if (next !== lines[i]) { lines[i] = next; changed++; }
  }
  return { body: changed ? lines.join('\n') : body, changed };
}

// The issue numbers of the checkbox lines (`- [ ] #M` / `- [x] #M`, first `#M` after the box) outside fenced code, in order,
// without repeats.
function itemNumbers(body) {
  if (typeof body !== 'string') return [];
  const item = /^[ \t]*- \[[ xX]\] #([1-9][0-9]{0,8})(?![0-9])/;
  const seen = new Set();
  let fence = null;
  for (const l of body.split('\n')) {
    const f = FENCE_RE.exec(l);
    if (f) {
      if (fence === null) { fence = f[1]; continue; }
      if (f[1][0] === fence[0] && f[1].length >= fence.length && l.trim() === f[1]) { fence = null; continue; }
    }
    if (fence !== null) continue;
    const m = item.exec(l);
    if (m) seen.add(m[1]);
  }
  return [...seen];
}

// What a line for this issue should show, from the issue's live REST object: 'tick', 'untick' or null (leave it).
// A tick needs a trusted account: the issue's author or the one who closed it (an outsider can close only their own issue).
function desiredState(issue, isTrusted) {
  if (!issue || typeof issue !== 'object' || issue.pull_request) return null;
  if (issue.state === 'open') return 'untick';
  if (issue.state !== 'closed' || issue.state_reason !== 'completed') return null; // not planned, duplicate: not delivered
  const author = issue.user && issue.user.login;
  const closer = issue.closed_by && issue.closed_by.login;
  return isTrusted(author) || isTrusted(closer) ? 'tick' : null;
}

function readTrusted(root) {
  return fs.readFileSync(path.join(root, 'scripts', 'trusted-authors.txt'), 'utf8')
    .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

function readTrackers(root) {
  const raw = JSON.parse(fs.readFileSync(path.join(root, '.github', 'parity-trackers.json'), 'utf8'));
  const list = raw && Array.isArray(raw.trackers) ? raw.trackers : [];
  return list.filter((t) => Number.isInteger(t) && t > 0 && t < 1e9).map(String);
}

function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
}

// call: the gh runner (args, stdin) -> stdout; tests pass a fake one. Returns the exit code: 1 if a lookup or edit failed
// (the rest is still done), else 0.
function main(env, root, call = gh) {
  const repo = env.GITHUB_REPOSITORY || '';
  if (!REPO_RE.test(repo)) { console.log('parity-tick: bad repository name; nothing done'); return 1; }
  const trusted = new Set(readTrusted(root));
  const isTrusted = (login) => typeof login === 'string' && trusted.has(login); // exact match against the list
  const states = new Map(); // issue number -> desired state, looked up once per run
  let failed = 0;
  const lookup = (m) => {
    if (!states.has(m)) {
      try { states.set(m, desiredState(JSON.parse(call(['api', `repos/${repo}/issues/${m}`])), isTrusted)); }
      catch { failed++; states.set(m, null); console.log(`parity-tick: could not read #${m}; its line is left as it is`); }
    }
    return states.get(m);
  };
  for (const t of readTrackers(root)) {
    try {
      // read the live body right before the edit (the workflow's concurrency group serialises runs)
      const issue = JSON.parse(call(['api', `repos/${repo}/issues/${t}`]));
      const author = issue && issue.user && issue.user.login;
      if (!isTrusted(author)) { console.log(`parity-tick: tracker #${t} is not by a trusted account; skipped`); continue; }
      let body = typeof issue.body === 'string' ? issue.body : '';
      const done = [];
      for (const m of itemNumbers(body)) {
        const want = lookup(m);
        if (!want) continue;
        const out = tickBody(body, m, want);
        if (out.changed) { body = out.body; done.push(`${want === 'tick' ? '+' : '-'}#${m}`); }
      }
      if (!done.length) { console.log(`parity-tick: tracker #${t} already matches`); continue; }
      call(['api', '-X', 'PATCH', `repos/${repo}/issues/${t}`, '--input', '-'], JSON.stringify({ body }));
      console.log(`parity-tick: tracker #${t}: ${done.join(' ')}`);
    } catch { failed++; console.log(`parity-tick: tracker #${t} could not be read or edited`); }
  }
  return failed ? 1 : 0;
}

module.exports = { tickBody, itemNumbers, desiredState, main, NUMBER_RE };

if (require.main === module) {
  process.exitCode = main(process.env, path.join(__dirname, '..'));
}
