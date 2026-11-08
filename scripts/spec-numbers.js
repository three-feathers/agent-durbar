#!/usr/bin/env node
/*
 * Spec 021 FR-085 (delta 2026-11-08), AGENTS.md "Numbers" (FR-048c): `npm run specs:numbers`, run before each push. On 2026-11-07/08
 * two PRs took the same task numbers because parallel lanes checked at different times. NETWORK check, so NOT in `npm test`
 * (the parser and the clash logic are: scripts/test-spec-numbers.js, offline).
 *
 * It fails (exit 1) when an FR-, T- or Q- number that this branch ADDS in specs/NNN-*\/spec.md (FR, Q) or tasks.md (T), measured against
 * the merge-base with origin/main, is also (a) added by another open PR head, or (b) already defined on origin/main, in the SAME file
 * (numbers are per spec: two specs may use the same number). Exit 2: it could not check (no origin/main, a failed fetch, an unreadable PR list or
 * file, no network); never a silent pass. The branch is `--head <sha>` (CI passes the PR head: HEAD there is a merge commit, and a number
 * that main took meanwhile would be hidden by the merge); a number defined twice in one file at HEAD, more often than on origin/main, is a clash too.
 *
 * A number is "added" only by a new DEFINITION line, never a mention (see parseDefinitions); a number that moved to another line in the
 * same file, or a line that was reworded, is not new (set difference of the definitions before and after).
 *
 * Heads: `gh pr list` when gh exists, else the public REST API (a token in GH_TOKEN/GITHUB_TOKEN is used only as a request header when
 * present, and the call is retried without it on 401/403); then `git fetch origin +refs/pull/N/head:refs/remotes/pr/N` for the open ones.
 * A list that cannot be read is exit 2. Own PR: a head that HEAD already contains is skipped,
 * and `--exclude N` / PR_NUMBER skip one number.
 *
 * It NEVER prints a token or an environment value: git and gh output is scrubbed (URL credentials, token shapes anywhere in the text, the values
 * of secret-looking variables; plus src/shared/redact.ts when the build is there) before it is shown, and only the first line of a failure
 * is printed. Everything from a PR (paths) goes through scripts/safe-print.js (no `::` workflow command, no newline).
 *
 *   node scripts/spec-numbers.js [--no-fetch] [--exclude N] [--head SHA] [--root D]     --no-fetch: use the refs already there (refs/remotes/pr/*)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');
const { printable, emit } = require('./safe-print.js');

const SPEC_FILE_RE = /^specs\/[^/]+\/(spec|tasks)\.md$/;
// A bold id that talks ABOUT a number is not a definition. Explicit syntax only: a list or range (`FR-7, FR-8`, `FR-10..FR-12`, `FR-7 and FR-8`),
// or an amendment tag without a closing full stop (`FR-9 delta`, `FR-10 status (2026-10-28)`). A title ends with `.` or `:` (`FR-124 Status line only.`).
const LIST_AFTER_ID = /^(?:[^\s.:]|\.\.|\s+(?:and|or|to|through|\u2013|-)\s)/;
const AMEND_TAG = /^\s+(delta|status|stays?|amend\w*|supersed\w*|struck)\b/i;
function boldDefines(rest) {
  if (/^[.:]?$/.test(rest)) return true;
  if (LIST_AFTER_ID.test(rest)) return false;
  if (AMEND_TAG.test(rest) && !/[.:]\s*$/.test(rest)) return false;
  return /^\s/.test(rest);
}

/** Definition lines of a file as Map(id -> count). spec.md: FR and Q; tasks.md: T. Not tables, code fences, prose mentions, nested FR/Q bullets. */
function definitionCounts(text, kind) {
  const ids = new Map();
  const add = (id) => ids.set(id, (ids.get(id) || 0) + 1);
  let fence = false;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    let m;
    if (kind === 'tasks') {
      // `- [ ] T123 ...`, `- [x] T123a ...` (any indent: sub-tasks are indented); a bare `- T12 stays done` is a mention
      if ((m = line.match(/^\s*[-*] \[[ xX~-]\] (?:\*\*|~~)?(T\d+[a-z]?)(?![\w-])/))) add(m[1]);
    } else {
      // `- **FR-123**`, `- **FR-123.** text`, `- **FR-123 Read/write access.** text` and the column-0 paragraph `**FR-123** text` (specs 005, 012, 058)
      if ((m = line.match(/^(?:[-*] )?\*\*(FR-\d+[a-z]?)((?:[^*]|\*(?!\*))*)\*\*/))) { if (boldDefines(m[2])) add(m[1]); }
      else if ((m = line.match(/^(?:[-*]|\d+\.) (?:\*\*)?(Q\d+)(?![\w-])/))) add(m[1]);
    }
  }
  return ids;
}
/** The ids a file defines (a Set). */
const parseDefinitions = (text, kind) => new Set(definitionCounts(text, kind).keys());
const kindOf = (file) => (/\/tasks\.md$/.test(file) ? 'tasks' : 'spec');
const added = (before, after) => new Set([...after].filter((x) => !before.has(x)));

/**
 * Pure clash logic. branchAdds: Map(file -> Set(id)); main: Map(file -> Set(id defined on origin/main));
 * prs: [{ label, adds: Map(file -> Set(id)) }]  -> [{ file, id, with }] sorted
 */
function findClashes({ branchAdds, main, prs, twice = [] }) {
  const out = twice.map(({ file, id }) => ({ file, id, with: 'this branch itself (defined twice in the file; main took it too?)' }));
  for (const [file, ids] of branchAdds) {
    for (const id of ids) {
      if ((main.get(file) || new Set()).has(id)) out.push({ file, id, with: 'origin/main (already defined there)' });
      for (const pr of prs) if ((pr.adds.get(file) || new Set()).has(id)) out.push({ file, id, with: `${pr.label} (added there too)` });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.id.localeCompare(b.id, undefined, { numeric: true }) || a.with.localeCompare(b.with));
}

// ---------- never print a secret ----------
const SECRET_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API[_-]?KEY|PRIVATE|AUTH|^GH_|^GITHUB_|^ANTHROPIC|^OPENAI|^COPILOT|^NPM_)/i;
// Token shapes anywhere in the text, with NO word boundary: `\b` sat between a letter and `_`, so `my_ghp_...` and `_ghp_..._` got through
// (docs/agent-notes.md, src/shared/redact.ts START). Over-masking a glued token is the safe side.
const TOKEN_SHAPES = [
  /(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g,
  /sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g,
  /(?:AKIA|ASIA)[0-9A-Z]{16}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g,
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];
// Reuse (FR-031): src/shared/redact.ts is the repository's mask, but it is TypeScript; when the build is there (`npm test`, local runs) it is
// applied on top; the CI job runs without a build, so the shapes above are the floor that always applies.
let redactTs;
function builtRedact() {
  if (redactTs === undefined) {
    try { redactTs = require(path.join(__dirname, '..', 'dist', 'shared', 'redact.js')).redact; } catch { redactTs = null; }
  }
  return redactTs;
}
function scrub(text, env = process.env, { useBuilt = true } = {}) {
  let s = String(text);
  for (const [k, v] of Object.entries(env)) if (v && v.length >= 6 && SECRET_NAME.test(k)) s = s.split(v).join('***');
  s = s.replace(/(\w+:\/\/)[^/@\s]+@/g, '$1***@');
  for (const re of TOKEN_SHAPES) s = s.replace(re, (m, g1) => (/^(Bearer|Basic)$/i.test(g1 || '') ? `${g1} ***` : '***'));
  const red = useBuilt && builtRedact();
  if (red) { try { s = red(s, env); } catch { /* the floor above already ran */ } }
  return s;
}
const firstLine = (e) => printable(scrub(String((e && (e.stderr || e.message)) || e).trim().split('\n')[0]).slice(0, 300));

// ---------- git ----------
const run = (root, cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000, ...opts });
const gitq = (root, args) => { try { return run(root, 'git', args).trim(); } catch { return null; } };
/** A file's text at a revision. Missing there is '' (no definitions); any other failure THROWS (with a partial clone `git show` fetches the
 * blob from the network): the run ends with exit 2, never with an empty answer that reads as "no clash". */
function show(root, rev, file) {
  const listed = run(root, 'git', ['ls-tree', '-z', '--name-only', rev, '--', file]).split('\0');
  if (!listed.includes(file)) return '';
  return run(root, 'git', ['show', `${rev}:${file}`]);
}
const isAncestor = (root, a, b) => { try { run(root, 'git', ['merge-base', '--is-ancestor', a, b]); return true; } catch { return false; } };

function specFilesChanged(root, base, head) {
  return run(root, 'git', ['diff', '-z', '--name-only', '--diff-filter=ACMR', base, head]).split('\0').filter((f) => SPEC_FILE_RE.test(f));
}
function definitionsAt(root, rev, file) { return parseDefinitions(show(root, rev, file), kindOf(file)); }
function countsAt(root, rev, file) { return definitionCounts(show(root, rev, file), kindOf(file)); }

function addsOf(root, base, head, files) {
  const m = new Map();
  for (const f of files) {
    const a = added(definitionsAt(root, base, f), definitionsAt(root, head, f));
    if (a.size) m.set(f, a);
  }
  return m;
}

/** -> { base, branchAdds, main, prs, skipped, twice } from the refs in the repository (no network). heads: [{ label, sha }]; headRev: the branch
 * (a sha; CI passes the PR head, because HEAD there is a merge commit with current main inside, where a number main took meanwhile would
 * vanish from "added"). Throws when anything cannot be read. */
function collect(root, heads, headRev = 'HEAD') {
  const base = gitq(root, ['merge-base', headRev, 'origin/main']);
  if (!base) throw new Error('no origin/main or no merge-base with it (shallow clone?): run `git fetch origin main` (CI: fetch-depth 0)');
  const files = specFilesChanged(root, base, headRev);
  const branchAdds = addsOf(root, base, headRev, files);
  const main = new Map(files.map((f) => [f, definitionsAt(root, 'origin/main', f)]));
  // a number that main took after the merge-base and was merged into HEAD cleanly shows up as a second definition in the file
  const twice = [];
  for (const f of files) {
    const here = countsAt(root, headRev, f), there = countsAt(root, 'origin/main', f);
    for (const [id, n] of here) if (n > 1 && n > (there.get(id) || 0)) twice.push({ file: f, id });
  }
  const prs = [], skipped = [], noBase = [];
  for (const h of heads) {
    if (isAncestor(root, h.sha, headRev)) { skipped.push(`${h.label} (already in this branch)`); continue; }
    if (isAncestor(root, h.sha, 'origin/main')) { skipped.push(`${h.label} (merged)`); continue; }
    const pbase = gitq(root, ['merge-base', h.sha, 'origin/main']);
    if (!pbase) { noBase.push(h.label); continue; }
    prs.push({ label: h.label, adds: addsOf(root, pbase, h.sha, files) });
  }
  return { base, branchAdds, main, prs, skipped, noBase, twice, files };
}

// ---------- open PR heads ----------
function httpsJson(url, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'durbar-specs-numbers', Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = https.get(url, { headers, timeout: 30000 }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; if (body.length > 20e6) req.destroy(new Error('answer too large')); });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode }));
        try { resolve(JSON.parse(body)); } catch { reject(new Error('answer is not JSON')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => reject(new Error(e.message)));
  });
}
function ownerRepo(root) {
  const url = gitq(root, ['remote', 'get-url', 'origin']) || '';
  const m = url.match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}
/** The open PRs over the public REST API. A token that is invalid or expired answers 401/403 even for public data: retry once without it. */
async function restOpenPrs(repo, token, getJson = httpsJson) {
  const pages = async (tok) => {
    const res = [];
    for (let page = 1; page <= 10; page++) {
      const rows = await getJson(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100&page=${page}`, tok);
      for (const r of rows) res.push({ number: r.number, sha: r.head && r.head.sha });
      if (rows.length < 100) break;
    }
    return res;
  };
  try { return await pages(token); } catch (e) {
    if (token && (e.status === 401 || e.status === 403)) { try { return await pages(''); } catch { return null; } }
    return null;
  }
}
/** -> [{ number, sha }] of the open PRs, or null when the list cannot be read */
async function openPrs(root, env = process.env) {
  try {
    const out = run(root, 'gh', ['pr', 'list', '--state', 'open', '--limit', '500', '--json', 'number,headRefOid']);
    return JSON.parse(out).map((p) => ({ number: p.number, sha: p.headRefOid }));
  } catch { /* no gh, or not logged in, or a bad token: the public API */ }
  const repo = ownerRepo(root);
  if (!repo) return null;
  return restOpenPrs(repo, env.GH_TOKEN || env.GITHUB_TOKEN || '');
}
function fetchHeads(root, prs) {
  for (let i = 0; i < prs.length; i += 100) {
    const specs = prs.slice(i, i + 100).map((p) => `+refs/pull/${p.number}/head:refs/remotes/pr/${p.number}`);
    run(root, 'git', ['fetch', '--quiet', '--no-tags', 'origin', ...specs]);
  }
}
function headsFromRefs(root) {
  const out = gitq(root, ['for-each-ref', '--format=%(refname:strip=3) %(objectname)', 'refs/remotes/pr']) || '';
  return out.split('\n').filter(Boolean).map((l) => { const [n, sha] = l.split(' '); return { label: `PR #${n}`, sha, number: n }; });
}

function report({ branchAdds, prs, skipped, noBase = [], base }, clashes) {
  const lines = [];
  const n = [...branchAdds.values()].reduce((a, s) => a + s.size, 0);
  lines.push(`specs:numbers: ${n} number(s) added since ${base.slice(0, 9)}, checked against origin/main and ${prs.length} other open PR head(s)${skipped.length ? ` (${skipped.length} skipped: already in this branch or merged)` : ''}`);
  if (noBase.length) lines.push(`specs:numbers: WARN not compared (no common history with origin/main): ${noBase.join(', ')}`);
  if (!clashes.length) { lines.push('specs:numbers: ok, no clash'); return lines; }
  for (const c of clashes) lines.push(`  CLASH ${printable(c.file)}: ${c.id} is also in ${c.with}`);
  lines.push('Fix: take the next free number in that file (check origin/main and the open PR heads again), renumber your lines and every mention, then re-run.');
  return lines;
}

const argOf = (argv, name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

/** deps.openPrs: a stand-in for the PR list (tests). Exit 0 ok, 1 clash, 2 could not check. */
async function main(argv, env, deps = {}) {
  const say = (t) => emit(t);
  const root = argOf(argv, '--root') ? path.resolve(argOf(argv, '--root')) : path.join(__dirname, '..');
  const noFetch = argv.includes('--no-fetch');
  const exclude = String(argOf(argv, '--exclude') || env.PR_NUMBER || '');
  const headRev = String(argOf(argv, '--head') || env.PR_HEAD_SHA || 'HEAD');
  if (headRev !== 'HEAD' && !/^[0-9a-f]{40}$/i.test(headRev)) { say('specs:numbers: NOT CHECKED: --head / PR_HEAD_SHA must be a full 40-character commit sha'); return 2; }
  let prList = null;
  if (!noFetch) {
    try { run(root, 'git', ['fetch', '--quiet', '--no-tags', 'origin', 'main']); } catch (e) { say(`specs:numbers: NOT CHECKED: could not fetch origin/main (${firstLine(e)}). Run it again with network (--no-fetch uses the refs that are here).`); return 2; }
    prList = await (deps.openPrs || openPrs)(root, env);
    if (!prList) { say('specs:numbers: NOT CHECKED: the open PR list could not be read (gh and the public API both failed). Run it again with network.'); return 2; }
    try { fetchHeads(root, prList); } catch (e) { say(`specs:numbers: NOT CHECKED: could not fetch the PR heads (${firstLine(e)}). Run it again with network.`); return 2; }
  }
  let heads = headsFromRefs(root).filter((h) => h.number !== exclude);
  if (prList) { const open = new Set(prList.map((p) => String(p.number))); heads = heads.filter((h) => open.has(h.number)); }
  if (!heads.length && !noFetch) say('specs:numbers: WARN no PR heads found; only origin/main was compared');
  let res;
  try { res = collect(root, heads, headRev); } catch (e) { say(`specs:numbers: NOT CHECKED: ${firstLine(e)}`); return 2; }
  const clashes = findClashes(res);
  say(report(res, clashes).join('\n'));
  return clashes.length ? 1 : 0;
}

module.exports = { parseDefinitions, definitionCounts, added, findClashes, scrub, collect, report, restOpenPrs, main, show, SPEC_FILE_RE };

if (require.main === module) {
  main(process.argv.slice(2), process.env).then((c) => process.exit(c), (e) => { emit(`specs:numbers: NOT CHECKED: ${firstLine(e)}`); process.exit(2); });
}
