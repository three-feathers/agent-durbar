#!/usr/bin/env node
/*
 * Spec 021 FR-085 (delta 2026-11-08), AGENTS.md "Numbers" (FR-048c): `npm run specs:numbers`, run before each push. On 2026-11-07/08
 * two PRs took the same task numbers because parallel lanes checked at different times. NETWORK check, so NOT in `npm test`
 * (the parser and the clash logic are: scripts/test-spec-numbers.js, offline).
 *
 * It fails (exit 1) when an FR-, T- or Q- number that this branch ADDS in specs/NNN-*\/spec.md (FR, Q) or tasks.md (T), measured against
 * the merge-base with origin/main, is also (a) added by another open PR head, or (b) already defined on origin/main, in the SAME file
 * (a same-file clash). Issue #1935: an id another head adds in a DIFFERENT existing spec's file of the same kind is a clash too (numbers are global since the
 * FR-048c sequence); a spec that is new on main numbers from 001 and is not compared across files. Exit 2: it could not check (no origin/main, a failed fetch, an unreadable PR list or
 * file, no network); never a silent pass. The branch is `--head <sha>` (CI passes the PR head: HEAD there is a merge commit, and a number
 * that main took meanwhile would be hidden by the merge); a number defined twice in one file at HEAD, more often than on origin/main, is a clash too.
 *
 * `--dups` (offline, also run by `npm run specs:check` and the test): a number defined twice inside ONE spec.md / tasks.md fails, naming every
 * line, for every spec folder, whether or not the branch touched it. Duplicates that were already there are listed in
 * scripts/spec-duplicates-baseline.txt (a ratchet: a count may only go down); `--write-baseline` rewrites it. (issue #1553)
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
 * is printed. Everything from a PR (paths) goes through scripts/safe-print.js (no `::` or `##[` workflow command, no newline).
 *
 * `--wide` (what `npm run specs:numbers` passes; spec 021 FR-085 delta 2026-11-23): besides the open PR heads, also the remote branches that have no open PR
 * (`git ls-remote --heads origin`, names as argv, never in a shell string) and the branches checked out in this machine's worktrees
 * (`git worktree list --porcelain`). A head whose PR is closed and not merged, at that very tip, is skipped and printed as a NOTE (read with
 * `gh pr list --head=<name> --state all --json headRefOid,mergedAt,state,isCrossRepository`: head ref names, shas and merged state, never a title), asked only for a
 * branch that would clash. Not read = exit 2. CI (`spec-kit.yml`) runs without --wide: open PR heads only.
 *
 *   node scripts/spec-numbers.js [--wide] [--no-fetch] [--exclude N] [--head SHA] [--root D]     --no-fetch: use the refs already there (refs/remotes/pr/*, refs/remotes/origin/*)
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

const TAG_PREFIX = /^((?:[-*]|\d+\.) )`\[[A-Z][A-Z ]*\]` /;
/** Definition lines of a file as Map(id -> [line numbers]). spec.md: FR and Q; tasks.md: T. Not tables, code fences, prose mentions, nested FR/Q bullets. */
function definitionLines(text, kind) {
  const ids = new Map();
  let lineNo = 0;
  const add = (id) => { if (!ids.has(id)) ids.set(id, []); ids.get(id).push(lineNo); };
  let fence = false;
  for (const line of String(text || '').split(/\r?\n/)) {
    lineNo++;
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    let m;
    if (kind === 'tasks') {
      // `- [ ] T123 ...`, `- [x] T123a ...` (any indent: sub-tasks are indented); a bare `- T12 stays done` is a mention
      if ((m = line.match(/^\s*[-*] \[[ xX~-]\] (?:\*\*|~~)?(T\d+[a-z]?)(?![\w-])/))) add(m[1]);
    } else {
      // `- **FR-123**`, `- **FR-123.** text`, `- **FR-123 Read/write access.** text` and the column-0 paragraph `**FR-123** text` (specs 005, 012, 058)
      // An evidence tag may stand before the id (`- \`[IMPLEMENTED]\` **FR-243 Title.** ...`, 18 lines in the specs; issue #1768): stripped here, one place for FR and Q
      const body = line.replace(TAG_PREFIX, '$1');
      if ((m = body.match(/^(?:[-*] )?\*\*(FR-\d+[a-z]?)((?:[^*]|\*(?!\*))*)\*\*/))) { if (boldDefines(m[2])) add(m[1]); }
      else if ((m = body.match(/^(?:[-*]|\d+\.) (?:\*\*)?(Q\d+)(?![\w-])/))) add(m[1]);
    }
  }
  return ids;
}
/** The same as Map(id -> count). */
function definitionCounts(text, kind) {
  return new Map([...definitionLines(text, kind)].map(([id, lines]) => [id, lines.length]));
}
/** The ids a file defines (a Set). */
const parseDefinitions = (text, kind) => new Set(definitionCounts(text, kind).keys());
const kindOf = (file) => (/\/tasks\.md$/.test(file) ? 'tasks' : 'spec');
const added = (before, after) => new Set([...after].filter((x) => !before.has(x)));

/**
 * Pure clash logic. branchAdds: Map(file -> Set(id)); main: Map(file -> Set(id defined on origin/main));
 * prs: [{ label, adds: Map(file -> Set(id)) }]  -> [{ file, id, with }] sorted
 */
function findClashes({ branchAdds, main, prs, twice = [], fresh = new Set() }) {
  const out = twice.map(({ file, id, lines }) => ({ file, id, with: `this branch itself (defined twice in the file${lines ? `, lines ${lines.join(' and ')}` : ''}; main took it too?)` }));
  for (const [file, ids] of branchAdds) {
    for (const id of ids) {
      if ((main.get(file) || new Set()).has(id)) out.push({ file, id, with: 'origin/main (already defined there)' });
      for (const pr of prs) {
        if ((pr.adds.get(file) || new Set()).has(id)) out.push({ file, id, with: `${pr.label} (added there too)` });
        // Issue #1935: numbers run across specs (T375 in two specs is one clash). Other file of the same kind only; a spec that is new on main
        // (this side or that) numbers from 001 on its own, so it is not compared across files.
        if (fresh.has(file)) continue;
        for (const [pf, pids] of pr.adds) if (pf !== file && kindOf(pf) === kindOf(file) && !fresh.has(pf) && pids.has(id)) out.push({ file, id, with: `${pr.label} (added there too, in ${printable(pf)}: numbers are global)` });
      }
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
function linesAt(root, rev, file) { return definitionLines(show(root, rev, file), kindOf(file)); }

// ---------- one number defined twice inside one file (offline, whole tree; issue #1553) ----------
const baselinePath = (root) => path.join(root, 'scripts', 'spec-duplicates-baseline.txt');
/** Every spec.md / tasks.md under root/specs: [{ file, id, lines }] for each id defined more than once. Reads ALL spec folders. */
function scanDuplicates(root) {
  const out = [];
  const dir = path.join(root, 'specs');
  for (const d of fs.readdirSync(dir).sort()) {
    for (const [name, kind] of [['spec.md', 'spec'], ['tasks.md', 'tasks']]) {
      const f = path.join(dir, d, name);
      if (!fs.existsSync(f)) continue;
      for (const [id, lines] of definitionLines(fs.readFileSync(f, 'utf8'), kind)) if (lines.length > 1) out.push({ file: `specs/${d}/${name}`, id, lines });
    }
  }
  return out;
}
/** baselineText: lines `file id count` (the duplicates that existed when this check was added; # comments). Returns problem lines:
 * a duplicate that is not in the baseline or is more often than it, naming every line; a baseline entry that is now lower or gone (lower it). */
function checkDuplicates(found, baselineText) {
  const base = new Map();
  for (const l of String(baselineText || '').split(/\r?\n/)) {
    const m = l.match(/^(\S+) (\S+) (\d+)$/);
    if (m) base.set(`${m[1]} ${m[2]}`, Number(m[3]));
  }
  const problems = [];
  const seen = new Set();
  for (const { file, id, lines } of found) {
    const key = `${file} ${id}`; seen.add(key);
    const allowed = base.get(key) || 1;
    if (lines.length > allowed) problems.push(`${printable(file)}: ${id} is defined ${lines.length} times (lines ${lines.join(', ')})${allowed > 1 ? `; the baseline allows ${allowed}` : ''}`);
    else if (lines.length < allowed) problems.push(`${printable(file)}: ${id} is now defined ${lines.length} times: lower its line in scripts/spec-duplicates-baseline.txt (node scripts/spec-numbers.js --write-baseline)`);
  }
  for (const [key, n] of base) if (!seen.has(key)) problems.push(`${printable(key.split(' ')[0])}: ${key.split(' ')[1]} is no longer duplicated (baseline said ${n}): remove its line from scripts/spec-duplicates-baseline.txt (node scripts/spec-numbers.js --write-baseline)`);
  return problems;
}
const baselineOf = (found) => `# Spec numbers defined more than once in one file, as they were when scripts/spec-numbers.js --dups was added (issue #1553).\n# file id count. A new duplicate fails; fixing one means lowering or removing its line (--write-baseline). Never raise a count.\n${[...found].sort((a, b) => a.file.localeCompare(b.file) || a.id.localeCompare(b.id, undefined, { numeric: true })).map((f) => `${f.file} ${f.id} ${f.lines.length}`).join('\n')}\n`;


function addsOf(root, base, head, files) {
  const m = new Map();
  for (const f of files) {
    const a = added(definitionsAt(root, base, f), definitionsAt(root, head, f));
    if (a.size) m.set(f, a);
  }
  return m;
}

/** Spec 021 FR-094: a PR stacked on this one, or one this one is stacked on, INHERITS numbers, it does not claim them again. self: { headRef, baseRef }
 * (the branch's own PR, or the checked-out branch name); heads: [{ label, headRef, baseRef, sameRepo }] -> Map(label -> why), along the base chain in both directions.
 * `main` is never a stack member; a PR from another repository (sameRepo not true) never is either, nor is a branch that is one. */
function stackRelated(self, heads) {
  const out = new Map();
  if (!self) return out;
  const skip = (r) => !r || r === 'main';
  if (!self.sameRepo) return out; // a fork's branch name is the outsider's choice: it never joins a stack (unknown = not stacked)
  let want = self.baseRef;
  for (let i = 0; i < heads.length && !skip(want); i++) {
    const h = heads.find((x) => x.headRef === want && x.sameRepo && !out.has(x.label));
    if (!h) break;
    out.set(h.label, 'this branch is stacked on it: inherited numbers'); want = h.baseRef;
  }
  const names = new Set(skip(self.headRef) ? [] : [self.headRef]);
  for (let grew = true; grew;) {
    grew = false;
    for (const h of heads) {
      if (out.has(h.label) || !h.sameRepo || skip(h.baseRef) || !names.has(h.baseRef)) continue;
      out.set(h.label, 'stacked on this branch: inherited numbers'); grew = true;
      if (!skip(h.headRef)) names.add(h.headRef);
    }
  }
  return out;
}

/** -> { base, branchAdds, main, prs, skipped, twice } from the refs in the repository (no network). heads: [{ label, sha }]; headRev: the branch
 * (a sha; CI passes the PR head, because HEAD there is a merge commit with current main inside, where a number main took meanwhile would
 * vanish from "added"). Throws when anything cannot be read. */
function collect(root, heads, headRev = 'HEAD', self = null) {
  const base = gitq(root, ['merge-base', headRev, 'origin/main']);
  if (!base) throw new Error('no origin/main or no merge-base with it (shallow clone?): run `git fetch origin main` (CI: fetch-depth 0)');
  const files = specFilesChanged(root, base, headRev);
  const branchAdds = addsOf(root, base, headRev, files);
  const main = new Map(files.map((f) => [f, definitionsAt(root, 'origin/main', f)]));
  // a number that main took after the merge-base and was merged into HEAD cleanly shows up as a second definition in the file
  const twice = [];
  for (const f of files) {
    const here = linesAt(root, headRev, f), there = countsAt(root, 'origin/main', f);
    for (const [id, lines] of here) if (lines.length > 1 && lines.length > (there.get(id) || 0)) twice.push({ file: f, id, lines });
  }
  const prs = [], skipped = [], noBase = [];
  const stacked = stackRelated(self, heads);
  for (const h of heads) {
    if (isAncestor(root, h.sha, headRev)) { skipped.push(`${h.label} (already in this branch)`); continue; }
    if (isAncestor(root, h.sha, 'origin/main')) { skipped.push(`${h.label} (merged)`); continue; }
    // FR-094: a PR stacked with this branch (by base ref, or its history contains this head) is not skipped: only what it adds BEYOND the history
    // it shares with this branch counts as its claim, so a number both take on their own is still a clash
    const inStack = stacked.has(h.label) || isAncestor(root, headRev, h.sha);
    const pbase = gitq(root, ['merge-base', h.sha, inStack ? headRev : 'origin/main']);
    if (!pbase) { noBase.push(h.label); continue; }
    // that head's OWN spec files, not only this branch's (issue #1935: a number taken in another spec is the same clash)
    prs.push({ label: h.label, adds: addsOf(root, pbase, h.sha, [...new Set([...files, ...specFilesChanged(root, pbase, h.sha)])]) });
  }
  const fresh = new Set();
  for (const f of new Set([...files, ...prs.flatMap((p) => [...p.adds.keys()])])) if (show(root, 'origin/main', f) === '') fresh.add(f);
  return { base, branchAdds, main, prs, skipped, noBase, twice, files, fresh };
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
const withRefs = (o, headRef, baseRef, sameRepo) => { if (headRef) o.headRef = headRef; if (baseRef) o.baseRef = baseRef; if (sameRepo === true) o.sameRepo = true; return o; };
const GH_LIMIT = 500, REST_PAGES = 30;
/** The open PRs over the public REST API, paged until a short page. A token that is invalid or expired answers 401/403 even for public data:
 * retry once without it. More than REST_PAGES full pages is "cannot tell" (null), never a silently cut list. */
async function restOpenPrs(repo, token, getJson = httpsJson) {
  const pages = async (tok) => {
    const res = [];
    for (let page = 1; page <= REST_PAGES; page++) {
      const rows = await getJson(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100&page=${page}`, tok);
      for (const r of rows) res.push(withRefs({ number: r.number, sha: r.head && r.head.sha }, r.head && r.head.ref, r.base && r.base.ref, !!(r.head && r.head.repo && r.base && r.base.repo && r.head.repo.full_name === r.base.repo.full_name)));
      if (rows.length < 100) return res;
    }
    throw new Error('more open PRs than the pages read');
  };
  try { return await pages(token); } catch (e) {
    if (token && (e.status === 401 || e.status === 403)) { try { return await pages(''); } catch { return null; } }
    return null;
  }
}
/** -> [{ number, sha }] of the open PRs, or null when the list cannot be read or may be cut short. `gh pr list --limit` drops the rest without
 * a word, so an answer that reaches GH_LIMIT is not trusted: the REST pages are read instead. deps: runCmd, getJson (tests). */
async function openPrs(root, env = process.env, deps = {}) {
  try {
    const out = (deps.runCmd || run)(root, 'gh', ['pr', 'list', '--state', 'open', '--limit', String(GH_LIMIT), '--json', 'number,headRefOid,headRefName,baseRefName,isCrossRepository']);
    const rows = JSON.parse(out);
    if (rows.length < GH_LIMIT) return rows.map((p) => withRefs({ number: p.number, sha: p.headRefOid }, p.headRefName, p.baseRefName, p.isCrossRepository === false));
  } catch { /* no gh, or not logged in, or a bad token: the public API */ }
  const repo = ownerRepo(root);
  if (!repo) return null;
  return restOpenPrs(repo, env.GH_TOKEN || env.GITHUB_TOKEN || '', deps.getJson || httpsJson);
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

// ---------- the wide list: branches without an open PR, and worktrees (spec 021 FR-085 delta 2026-11-23) ----------
const QUEUE_PREFIX = 'gh-readonly-queue/';
/** [{ name, sha }] of the heads on the remote, live. Throws when it cannot be read (exit 2, never an empty list that reads as "nothing there"). */
function liveRemoteHeads(root) {
  const out = run(root, 'git', ['ls-remote', '--heads', 'origin']);
  const heads = out.split('\n').filter(Boolean).map((l) => { const m = l.match(/^([0-9a-f]{40})\trefs\/heads\/(.+)$/); if (!m) throw new Error('git ls-remote gave a line that is not a head'); return { sha: m[1], name: m[2] }; });
  if (!heads.some((h) => h.name === 'main')) throw new Error('git ls-remote did not list main');
  return heads;
}
/** One fetch of every head, then each sha must be here; throws when not. */
function fetchRemoteHeads(root, heads) {
  run(root, 'git', ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', 'origin', '+refs/heads/*:refs/remotes/origin/*']);
  for (const h of heads) { try { run(root, 'git', ['cat-file', '-e', `${h.sha}^{commit}`]); } catch { throw new Error('a remote head could not be fetched'); } }
}
/** The same list from the refs already here (--no-fetch, and pr-preflight, which fetched them). */
function trackedRemoteHeads(root) {
  return (gitq(root, ['for-each-ref', '--format=%(refname:strip=3) %(objectname)', 'refs/remotes/origin']) || '').split('\n').filter(Boolean).map((x) => { const [name, sha] = x.split(' '); return { name, sha }; });
}
/** [{ name, sha }]: the branches checked out in this repository's worktrees (their local tips). Throws when git cannot list them. */
function worktreeHeads(root) {
  const out = [];
  for (const block of run(root, 'git', ['worktree', 'list', '--porcelain']).split(/\n\n+/)) {
    const sha = (block.match(/^HEAD ([0-9a-f]{40})$/m) || [])[1], ref = (block.match(/^branch refs\/heads\/(.+)$/m) || [])[1];
    if (sha && ref) out.push({ name: ref, sha });
  }
  return out;
}
/** Pure but for the date: the heads to compare besides the open PR heads. remote, worktrees: [{ name, sha }]; open: [{ sha, headRef }] (the open PR heads, compared already);
 * selfRef: this branch's name. Left out: HEAD, main, this branch, merge-queue branches, an open PR's head (by name or tip), a worktree branch that is a remote head
 * (same tip) or has an open PR. opts.prefix: label start (default `branch `); opts.dates: add `, tip YYYY-MM-DD` (git's committer date). */
function wideHeads(root, { remote = [], worktrees = [], open = [], selfRef, prefix = 'branch ', dates = true }) {
  const openNames = new Set(open.map((o) => o.headRef).filter(Boolean)), openShas = new Set(open.map((o) => o.sha));
  const skip = (h) => !h.name || h.name === 'HEAD' || h.name === 'main' || h.name === selfRef || h.name.startsWith(QUEUE_PREFIX);
  const label = (kind, h) => `${kind}${printable(h.name)}${dates ? `, tip ${gitq(root, ['log', '-1', '--format=%cs', h.sha]) || '?'}` : ''}`;
  const out = remote.filter((h) => !skip(h) && !openNames.has(h.name) && !openShas.has(h.sha))
    .map((h) => ({ label: label(prefix, h), sha: h.sha, name: h.name, headRef: h.name, sameRepo: true, wide: true }));
  for (const h of worktrees) {
    if (skip(h) || openNames.has(h.name) || openShas.has(h.sha) || remote.some((r) => r.sha === h.sha)) continue;
    out.push({ label: label('worktree ', h), sha: h.sha, name: h.name, headRef: h.name, sameRepo: true, wide: true });
  }
  return out;
}
/** The PR state of a branch by `gh` (sync): [{ headRefOid, mergedAt, state, isCrossRepository }] or null when it cannot be read. */
function ghBranchState(root) {
  return (name) => {
    try { const rows = JSON.parse(run(root, 'gh', ['pr', 'list', `--head=${name}`, '--state', 'all', '--json', 'headRefOid,mergedAt,state,isCrossRepository'], { timeout: 60000 })); return Array.isArray(rows) ? rows : null; } catch { return null; }
  };
}
/** collect + findClashes, and then a second look at each wide head that clashes: its PR (lookup(name) -> rows or null) is closed and not merged
 * at that tip -> the head is left out and named in notes. A lookup that fails THROWS (exit 2): a clash is never dropped without knowing. */
function resolveWide(root, heads, headRev, self, lookup) {
  let list = heads;
  const notes = [];
  for (;;) {
    const res = collect(root, list, headRev, self);
    const clashes = findClashes(res);
    const gone = [];
    for (const h of list.filter((x) => x.wide && clashes.some((c) => c.with.startsWith(`${x.label} (added there too`)))) {
      const rows = lookup(h.name);
      if (!rows) throw new Error(`could not read the PR state of branch ${h.name} (gh pr list failed; it is needed to tell a dead branch from a live one)`);
      if (rows.some((p) => p.state === 'CLOSED' && !p.mergedAt && p.isCrossRepository === false && p.headRefOid === h.sha)) gone.push(h);
    }
    if (!gone.length) return { res, clashes, notes };
    for (const h of gone) notes.push(`NOTE skipped ${h.label}: its PR is closed and not merged, so its numbers are free`);
    list = list.filter((x) => !gone.includes(x));
  }
}

function report({ branchAdds, prs, skipped, noBase = [], base }, clashes, notes = [], wideCount = null) {
  const lines = [];
  const n = [...branchAdds.values()].reduce((a, s) => a + s.size, 0);
  lines.push(`specs:numbers: ${n} number(s) added since ${base.slice(0, 9)}, checked against origin/main and ${prs.length} other open PR head(s)${skipped.length ? ` (${skipped.length} skipped: already in this branch or merged)` : ''}`);
  if (wideCount !== null) lines.push(`specs:numbers: --wide: ${wideCount} remote branch(es) without an open PR and worktree branch(es) were in the list too`);
  for (const t of notes) lines.push(`specs:numbers: ${t}`);
  if (noBase.length) lines.push(`specs:numbers: WARN not compared (no common history with origin/main): ${noBase.join(', ')}`);
  if (!clashes.length) { lines.push('specs:numbers: ok, no clash'); return lines; }
  for (const c of clashes) lines.push(`  CLASH ${printable(c.file)}: ${c.id} is also in ${c.with}`);
  lines.push('Fix: take the next free number in that file (check origin/main and the open PR heads again), renumber your lines and every mention, then re-run.');
  return lines;
}

function dupsMain(argv, root) {
  const found = scanDuplicates(root);
  if (argv.includes('--write-baseline')) { fs.mkdirSync(path.dirname(baselinePath(root)), { recursive: true }); fs.writeFileSync(baselinePath(root), baselineOf(found)); emit(`specs:numbers: wrote ${found.length} baseline line(s)`); return 0; }
  const problems = checkDuplicates(found, fs.existsSync(baselinePath(root)) ? fs.readFileSync(baselinePath(root), 'utf8') : '');
  if (!problems.length) { emit(`specs:numbers --dups: ok, no number is defined twice in one file beyond the ${found.length} known (scripts/spec-duplicates-baseline.txt)`); return 0; }
  emit(problems.map((p) => `  DUPLICATE ${p}`).join('\n') + '\nFix: give the second definition the next free number in that file (and every mention).');
  return 1;
}

const argOf = (argv, name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

/** deps.openPrs: a stand-in for the PR list (tests). Exit 0 ok, 1 clash, 2 could not check. */
async function main(argv, env, deps = {}) {
  const say = (t) => emit(t);
  const root = argOf(argv, '--root') ? path.resolve(argOf(argv, '--root')) : path.join(__dirname, '..');
  if (argv.includes('--dups') || argv.includes('--write-baseline')) return dupsMain(argv, root);
  const noFetch = argv.includes('--no-fetch');
  const wide = argv.includes('--wide');
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
  let res, clashes, notes = [], wideCount = null;
  // the branch's own PR (from the list) or, on a local run, the checked-out branch: its refs tell which open PRs are stacked with it
  const own = prList && prList.find((p) => String(p.number) === exclude);
  const refOf = new Map((prList || []).map((p) => [String(p.number), p]));
  heads = heads.map((h) => ({ ...h, headRef: (refOf.get(h.number) || {}).headRef, baseRef: (refOf.get(h.number) || {}).baseRef, sameRepo: (refOf.get(h.number) || {}).sameRepo }));
  const self = own ? { headRef: own.headRef, baseRef: own.baseRef, sameRepo: own.sameRepo } : { headRef: gitq(root, ['symbolic-ref', '--short', '-q', 'HEAD']) || undefined, sameRepo: true };
  try {
    if (wide) {
      const remote = noFetch ? trackedRemoteHeads(root) : liveRemoteHeads(root);
      if (!noFetch) fetchRemoteHeads(root, remote);
      const extra = wideHeads(root, { remote, worktrees: worktreeHeads(root), open: heads.map((h) => ({ sha: h.sha, headRef: h.headRef })), selfRef: self.headRef });
      wideCount = extra.length;
      ({ res, clashes, notes } = resolveWide(root, heads.concat(extra), headRev, self, deps.branchState || ghBranchState(root)));
    } else { res = collect(root, heads, headRev, self); clashes = findClashes(res); }
  } catch (e) { say(`specs:numbers: NOT CHECKED: ${firstLine(e)}`); return 2; }
  say(report(res, clashes, notes, wideCount).join('\n'));
  return clashes.length ? 1 : 0;
}

module.exports = { wideHeads, resolveWide, liveRemoteHeads, trackedRemoteHeads, worktreeHeads, ghBranchState, stackRelated, openPrs, GH_LIMIT, parseDefinitions, definitionCounts, definitionLines, scanDuplicates, checkDuplicates, added, findClashes, scrub, collect, report, restOpenPrs, main, show, SPEC_FILE_RE };

if (require.main === module) {
  main(process.argv.slice(2), process.env).then((c) => process.exit(c), (e) => { emit(`specs:numbers: NOT CHECKED: ${firstLine(e)}`); process.exit(2); });
}
