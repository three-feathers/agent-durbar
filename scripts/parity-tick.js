#!/usr/bin/env node
// Spec 021 FR-088 (2026-11-09): the parity checklists tick themselves. Run by .github/workflows/parity-tick.yml on
// `issues: [closed, reopened]`: an issue closed as completed ticks `- [ ] #N` to `- [x] #N` in each tracker issue listed in
// .github/parity-trackers.json; a reopened issue unticks it. tickBody() is the pure text transform (tested by
// scripts/test-parity-tick.ts); main() does the GitHub calls through the preinstalled gh with execFileSync (no shell).
// Inputs come only from quoted env values the workflow sets; titles, bodies and labels of the event are never read.
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

// The event's action and close reason, mapped to what to do: null means "do nothing".
function stateFor(action, reason) {
  if (action === 'reopened') return 'untick';
  if (action === 'closed' && reason === 'completed') return 'tick';
  return null; // closed as not planned or duplicate: the item was not delivered
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

// call: the gh runner (args, stdin) -> stdout; tests pass a fake one.
function main(env, root, call = gh) {
  const n = env.ISSUE_NUMBER || '';
  const repo = env.GITHUB_REPOSITORY || '';
  if (!NUMBER_RE.test(n)) { console.log('parity-tick: issue number is not 1 to 9 digits; nothing done'); return 0; }
  if (!REPO_RE.test(repo)) { console.log('parity-tick: bad repository name; nothing done'); return 0; }
  const state = stateFor(env.EVENT_ACTION, env.STATE_REASON);
  if (!state) { console.log(`parity-tick: #${n} was not closed as completed or reopened; nothing done`); return 0; }
  const trusted = new Set(readTrusted(root));
  const isTrusted = (login) => typeof login === 'string' && trusted.has(login); // exact match against the list
  if (!isTrusted(env.ISSUE_AUTHOR) && !isTrusted(env.ACTOR)) {
    console.log(`parity-tick: neither the author of #${n} nor the actor is a trusted account; nothing done`);
    return 0;
  }
  for (const t of readTrackers(root)) {
    // read the live body right before the edit (the workflow's concurrency group serialises runs)
    const issue = JSON.parse(call(['api', `repos/${repo}/issues/${t}`]));
    const author = issue && issue.user && issue.user.login;
    if (!isTrusted(author)) { console.log(`parity-tick: tracker #${t} is not by a trusted account; skipped`); continue; }
    const out = tickBody(typeof issue.body === 'string' ? issue.body : '', n, state);
    if (!out.changed) { console.log(`parity-tick: no open line for #${n} in tracker #${t}`); continue; }
    call(['api', '-X', 'PATCH', `repos/${repo}/issues/${t}`, '--input', '-'], JSON.stringify({ body: out.body }));
    console.log(`parity-tick: ${state === 'tick' ? 'ticked' : 'unticked'} #${n} in tracker #${t} (${out.changed} line(s))`);
  }
  return 0;
}

module.exports = { tickBody, stateFor, main, NUMBER_RE };

if (require.main === module) {
  process.exitCode = main(process.env, path.join(__dirname, '..'));
}
