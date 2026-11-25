#!/usr/bin/env node
/*
 * Spec 021 FR-384 (delta 2026-11-22, "first-time-right kit"): `npm run pr:preflight -- <N>` (or `scripts/pr-preflight.sh <N>`) runs, in one
 * pass, the checks a reviewer runs by hand before a review, so the author runs them BEFORE asking for review. The delivery-speed review of
 * 2026-11-22 found 47 % of all reviews were rework (change requests and re-approvals after a push) for findings these checks catch.
 *
 * READ ONLY: it reads the PR with `gh` (pr view, pulls/N/commits, pr checks) and the repository with git; it never comments, labels, pushes
 * or changes the working tree, the index or a branch. The only local effect is the fetch (unless --no-fetch): remote-tracking refs
 * (refs/remotes/origin/*) are updated and the PR head's objects are downloaded WITHOUT a ref (--no-write-fetch-head).
 *
 * Each line is `ok ...`, `NOTE ...` (read it, not a blocker) or `FAIL ...`. Exit 0 no FAIL, 1 a FAIL, 2 wrong usage.
 *   1  PR readable; an outside PR (author not on the trusted list, scripts/trusted-authors.js, or from a fork) stops here: author and link only (AGENTS.md)
 *   2  mergeable (CONFLICTING = FAIL, UNKNOWN = NOTE)
 *   3  labels: exactly one type, at least one area:*, at least one spec:* (FR-045)
 *   4  no AI line in the PR body, 5 no AI trailer in any commit, every commit Verified (FR-061)
 *   6  each merge commit is merge-only: its tree equals `git merge-tree` of its two parents; a file the merge had to resolve is a NOTE
 *      (read the resolution), any other change is a FAIL; a clean merge of main is a NOTE ("resolved nothing": proposed rule, merge main only
 *      on a conflict, red CI or a reviewer's request)
 *   7  spec numbers the PR adds, by the rule of `npm run specs:numbers` (its parser, collect and findClashes, reused) against
 *      origin/main and every other remote head: a clash it reports is a FAIL; a number other specs on main also use is not one
 *   8  removed assert lines under scripts/: listed, NOTE (a removed assert needs an equal or stricter replacement)
 *   9  area:security PRs: no NET-NEW shape word (SHAPE_WORDS) in the body or in specs/, docs/, changelog.d/ (more often in added than in
 *      removed lines of a file): FAIL, named by place and word
 *   10 package.json: no script removed or changed by the PR (merge-base to head, so a script main added later is not "removed")
 *   11 size: under 100 changed lines NOTE (batch), over 300 NOTE (split)
 *   12 the checks summary; a failing check is a FAIL
 * Nothing from the PR's text is printed except label names, the branch and file names, assert lines from the diff and check names, all
 * through scripts/safe-print.js. The body and commit messages are matched, never printed.
 *
 *   node scripts/pr-preflight.js <N> [--no-fetch] [--root DIR]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { printable, emit } = require('./safe-print.js');
const sn = require('./spec-numbers.js');
const { trustedAuthors } = require('./trusted-authors.js'); // the one loader of the trusted list (FR-092)

const TIMEOUT_MS = 120000;
const MAX_BUFFER = 64 * 1024 * 1024;
const TYPES = ['bug', 'enhancement', 'task', 'documentation', 'question'];
const AI_LINE = /Generated (with|by) \[?(Claude|Copilot|GitHub Copilot|Codex|ChatGPT|Gemini|an AI)|claude\.ai\/code|Claude-Session:|Co-Authored-By:[^\n]*(claude|anthropic|copilot|codex|openai|chatgpt|gemini)/i;
const ASSERT_LINE = /\bassert\b|\bexpect\(/;
// Words that describe the SHAPE of a secret or a bypass in public text (spec 021 FR-060 "Public text"): matched case-insensitively.
const SHAPE_WORDS = ['bearer ', 'gh' + 'p_', '--token', 'api_key=', 'password=', 'backslash', 'caret', 'crlf'];
const SMALL = 100, LARGE = 300;

function git(root, args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch (e) {
    if (allowFail && e.code !== 'ETIMEDOUT') return { failed: true, status: e.status, stdout: String(e.stdout || '') };
    throw e;
  }
}
const gitq = (root, args) => { const r = git(root, args, { allowFail: true }); return typeof r === 'string' ? r.trim() : null; };
const isAncestor = (root, a, b) => typeof git(root, ['merge-base', '--is-ancestor', a, b], { allowFail: true }) === 'string';

/** The real `gh`, no shell: { status, stdout }. `gh pr checks` exits non-zero while checks fail or run, with its JSON on stdout. */
function realGh(root) {
  return (args) => {
    const r = spawnSync('gh', args, { cwd: root, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true });
    return { status: r.error ? -1 : r.status, stdout: r.stdout || '' };
  };
}

/** The clash lines for the numbers a PR adds: exactly the rule of `npm run specs:numbers` (its findClashes, reused, FR-031: same file vs
 * origin/main or another head, another spec file of the same kind vs another head, FR-098), never a stricter one of its own. */
function numberFindings(clashes) {
  return clashes.map((c) => ({ level: 'FAIL', text: `number ${c.id} (${sn.safe(c.file)}) is also in ${c.with}` }));
}

/** Pure: label check. -> { level, text } */
function labelFinding(names) {
  const types = names.filter((n) => TYPES.includes(n));
  const area = names.some((n) => n.startsWith('area:'));
  const spec = names.some((n) => n.startsWith('spec:'));
  const why = [];
  if (types.length !== 1) why.push(`${types.length} type labels (want exactly one of ${TYPES.join(', ')})`);
  if (!area) why.push('no area:* label');
  if (!spec) why.push('no spec:* label');
  return { level: why.length ? 'FAIL' : 'ok', text: `labels: ${names.join(', ') || '(none)'}${why.length ? ` -- ${why.join('; ')}` : ''}` };
}

/** Pure: removed and added assert lines of a unified diff of scripts/. -> { removed: [{ file, text }], added } */
function assertChanges(diff) {
  let file = '';
  const removed = [];
  let added = 0;
  for (const line of String(diff).split('\n')) {
    if (line.startsWith('+++ ')) { file = line.replace(/^\+\+\+ (b\/)?/, ''); continue; }
    if (line.startsWith('--- ')) { if (line !== '--- /dev/null') file = line.replace(/^--- (a\/)?/, ''); continue; }
    if (line.startsWith('-') && ASSERT_LINE.test(line)) removed.push({ file, text: line.slice(1).trim() });
    else if (line.startsWith('+') && ASSERT_LINE.test(line)) added++;
  }
  return { removed, added };
}

const countOf = (text, w) => String(text).toLowerCase().split(w).length - 1;
/** Pure: NET-NEW shape words in public text. sources: [{ where, added, removed }] -> ['where: word', ...]; a word counts only when the
 * added lines hold it more often than the removed ones (an edited sentence that already named it on the base is not new). */
function shapeHits(sources) {
  const out = [];
  for (const { where, added, removed = '' } of sources) {
    for (const w of SHAPE_WORDS) if (countOf(added, w) > countOf(removed, w)) out.push(`${where}: "${w.trim()}"`);
  }
  return out;
}

/** Added and removed lines per file of a unified diff: [{ where: file, added, removed }]. */
function linesByFile(diff) {
  const m = new Map();
  let file = '';
  const at = (f) => { if (!m.has(f)) m.set(f, { where: f, added: '', removed: '' }); return m.get(f); };
  for (const line of String(diff).split('\n')) {
    if (line.startsWith('+++ ')) { if (line !== '+++ /dev/null') file = line.replace(/^\+\+\+ (b\/)?/, ''); continue; }
    if (line.startsWith('--- ')) { if (line !== '--- /dev/null') file = line.replace(/^--- (a\/)?/, ''); continue; }
    if (line.startsWith('+')) at(file).added += line.slice(1) + '\n';
    else if (line.startsWith('-')) at(file).removed += line.slice(1) + '\n';
  }
  return [...m.values()];
}

/** Pure: package.json scripts removed or changed between two package.json texts. */
function scriptChanges(baseText, headText) {
  const s = (t) => { try { return JSON.parse(t).scripts || {}; } catch { return null; } };
  const a = s(baseText), b = s(headText);
  if (!a || !b) return { error: true };
  return {
    removed: Object.keys(a).filter((k) => !(k in b)),
    changed: Object.keys(a).filter((k) => k in b && a[k] !== b[k]),
    added: Object.keys(b).filter((k) => !(k in a)),
  };
}

/** Pure: size note. */
function sizeFinding(additions, deletions) {
  const n = Number(additions || 0) + Number(deletions || 0);
  if (n < SMALL) return { level: 'NOTE', text: `size: ${n} changed lines, under ${SMALL}: batch it with related work if there is any` };
  if (n > LARGE) return { level: 'NOTE', text: `size: ${n} changed lines, over ${LARGE}: split it if it holds separable parts` };
  return { level: 'ok', text: `size: ${n} changed lines` };
}

/** Pure: checks summary from `gh pr checks --json name,bucket` rows. */
function checksFinding(rows) {
  if (!Array.isArray(rows) || !rows.length) return { level: 'NOTE', text: 'checks: none reported yet' };
  const by = {};
  for (const r of rows) by[r.bucket || 'unknown'] = (by[r.bucket || 'unknown'] || 0) + 1;
  const sum = Object.keys(by).sort().map((k) => `${k}=${by[k]}`).join(' ');
  const failing = rows.filter((r) => r.bucket === 'fail').map((r) => r.name);
  return failing.length ? { level: 'FAIL', text: `checks: ${sum} -- failing: ${failing.join(', ')}` } : { level: 'ok', text: `checks: ${sum}` };
}

/** Merge commit check: -> [{ level, text }]; "resolved nothing" only when the second parent is on origin/main (a merge of main). */
function mergeFindings(root, sha) {
  const p1 = gitq(root, ['rev-parse', `${sha}^1`]), p2 = gitq(root, ['rev-parse', `${sha}^2`]);
  if (!p1 || !p2) return [{ level: 'FAIL', text: `merge ${sha.slice(0, 9)}: parents not readable (fetch the PR head)` }];
  // exit 1 = conflicts, still prints the tree (with markers) and, with --name-only, the conflicted paths until the first blank line
  const r = git(root, ['merge-tree', '--write-tree', '--name-only', '--no-messages', p1, p2], { allowFail: true });
  const outText = typeof r === 'string' ? r : r.stdout;
  if (typeof r !== 'string' && r.status !== 1) return [{ level: 'FAIL', text: `merge ${sha.slice(0, 9)}: git merge-tree failed (git 2.38 or later needed)` }];
  const [tree, ...rest] = outText.split('\n');
  const conflicted = new Set();
  for (const l of rest) { if (!l) break; conflicted.add(l); }
  const changed = gitq(root, ['diff', '--name-only', '-z', tree.trim(), sha]);
  const files = (changed || '').split('\0').filter(Boolean);
  const extra = files.filter((f) => !conflicted.has(f));
  const out = [];
  if (extra.length) out.push({ level: 'FAIL', text: `merge ${sha.slice(0, 9)}: changes beyond the plain merge in ${extra.join(', ')} (an evil merge: move them to their own commit)` });
  if (conflicted.size) out.push({ level: 'NOTE', text: `merge ${sha.slice(0, 9)}: resolved conflicts in ${[...conflicted].join(', ')}: read the resolution` });
  if (!extra.length && !conflicted.size) {
    out.push({ level: 'ok', text: `merge ${sha.slice(0, 9)}: merge-only` });
    if (isAncestor(root, p2, 'origin/main')) out.push({ level: 'NOTE', text: `merge ${sha.slice(0, 9)}: resolved nothing (a clean merge of main); proposed rule: merge main only on a conflict, red CI or a reviewer's request` });
  }
  return out;
}

function parseJsonLines(text) {
  return String(text).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/** The whole preflight. deps: { gh(args) -> { status, stdout }, root, fetch, trusted } -> { lines: [{ level, text }], code } */
function preflight(n, deps = {}) {
  const root = deps.root || path.join(__dirname, '..');
  const gh = deps.gh || realGh(root);
  const trusted = deps.trusted || trustedAuthors(path.join(__dirname, '..'));
  const lines = [];
  const add = (level, text) => lines.push({ level, text });
  const done = () => ({ lines, code: lines.some((l) => l.level === 'FAIL') ? 1 : 0 });
  if (!/^[1-9][0-9]{0,6}$/.test(String(n))) { add('FAIL', 'usage: pr-preflight <PR number>'); return { lines, code: 2 }; }
  const num = String(n);

  // 1. readable, and ours (author check BEFORE any text of the PR is read)
  const metaR = gh(['pr', 'view', num, '--json', 'author,isCrossRepository,url,state']);
  let meta;
  try { if (metaR.status !== 0) throw new Error(); meta = JSON.parse(metaR.stdout); } catch { add('FAIL', `cannot read PR ${num} (gh pr view failed)`); return done(); }
  const login = (meta.author && meta.author.login) || '?';
  if (!trusted.has(login) || meta.isCrossRepository !== false) {
    add('FAIL', `outside PR: author ${login}${meta.isCrossRepository !== false ? ', from a fork' : ''}; not read further, send the link to a human: ${meta.url || ''}`);
    return done();
  }
  const prR = gh(['pr', 'view', num, '--json', 'headRefOid,headRefName,baseRefName,mergeable,labels,body,isDraft,additions,deletions']);
  let pr;
  try { if (prR.status !== 0) throw new Error(); pr = JSON.parse(prR.stdout); } catch { add('FAIL', `cannot read PR ${num} (gh pr view failed)`); return done(); }
  const head = String(pr.headRefOid || '');
  if (!/^[0-9a-f]{40}$/.test(head)) { add('FAIL', 'PR head sha not readable'); return done(); }
  const branch = String(pr.headRefName || '');

  if (deps.fetch !== false) {
    try { git(root, ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', 'origin', '+refs/heads/*:refs/remotes/origin/*', `refs/pull/${num}/head`]); } catch { add('FAIL', 'git fetch origin failed (network?); --no-fetch uses the refs already here'); return done(); }
  }
  if (!gitq(root, ['cat-file', '-t', head])) { add('FAIL', `PR head ${head.slice(0, 9)} is not in this repository (fetch it)`); return done(); }
  add('ok', `PR #${num} head ${head.slice(0, 9)} branch ${branch} base ${pr.baseRefName} draft=${pr.isDraft} author ${login}`);

  // 2. mergeable
  if (pr.mergeable === 'CONFLICTING') add('FAIL', 'mergeable: CONFLICTING (conflicts with the base)');
  else if (pr.mergeable === 'MERGEABLE') add('ok', 'mergeable');
  else add('NOTE', `mergeable: ${pr.mergeable || 'UNKNOWN'} (GitHub has not computed it yet: run again)`);

  // 3. labels
  const l = labelFinding((pr.labels || []).map((x) => x.name));
  add(l.level, l.text);
  const names = (pr.labels || []).map((x) => x.name);

  // 4. body
  add(AI_LINE.test(pr.body || '') ? 'FAIL' : 'ok', AI_LINE.test(pr.body || '') ? 'body: an AI attribution line (FR-061: no Generated-with line, no AI co-author)' : 'body: no AI line');

  // 5. commits: Verified, no AI trailer; 6. merge commits
  const cR = gh(['api', `repos/{owner}/{repo}/pulls/${num}/commits`, '--paginate', '--jq', '.[] | {sha, verified: .commit.verification.verified, message: .commit.message, parents: [.parents[].sha]}']);
  let commits = null;
  try { if (cR.status !== 0) throw new Error(); commits = parseJsonLines(cR.stdout); } catch { add('FAIL', 'commits: not readable (gh api pulls/N/commits)'); }
  if (commits) {
    const unverified = commits.filter((c) => c.verified !== true).map((c) => String(c.sha).slice(0, 9));
    const trailer = commits.filter((c) => AI_LINE.test(c.message || '')).map((c) => String(c.sha).slice(0, 9));
    if (unverified.length) add('FAIL', `commits: not Verified: ${unverified.join(' ')} (FR-061: SSH-signed)`);
    if (trailer.length) add('FAIL', `commits: AI trailer or line in ${trailer.join(' ')} (FR-061)`);
    if (!unverified.length && !trailer.length) add('ok', `commits: ${commits.length}, all Verified, no AI trailer`);
    if (commits.length >= 250) add('NOTE', 'commits: GitHub lists at most 250 commits of a PR; later ones were not read');
    for (const c of commits) if ((c.parents || []).length === 2) for (const f of mergeFindings(root, String(c.sha))) add(f.level, f.text);
  }

  const base = gitq(root, ['merge-base', head, 'origin/main']);
  if (!base) { add('FAIL', 'no merge-base with origin/main (fetch origin main)'); return done(); }

  // 7. numbers
  try {
    // the same list and the same dead-branch rule as `npm run specs:numbers --wide` (FR-031): the heads the remote lists now (git ls-remote; stale remote-tracking refs of deleted branches are not compared; --no-fetch has only the tracked refs) and worktree branches;
    // a branch whose PR is closed and not merged, at its tip, is skipped when it would clash (its PR state is read with the `gh` of this run)
    const heads = sn.wideHeads(root, { remote: deps.liveHeads ? deps.liveHeads(root) : deps.fetch !== false ? sn.liveRemoteHeads(root) : sn.trackedRemoteHeads(root), worktrees: sn.worktreeHeads(root), selfRef: branch, prefix: 'origin/', dates: false });
    const lookup = (name) => { const r = gh(['pr', 'list', `--head=${name}`, '--state', 'all', '--json', 'headRefOid,mergedAt,state,isCrossRepository']); try { if (r.status !== 0) return null; const rows = JSON.parse(r.stdout); return Array.isArray(rows) ? rows : null; } catch { return null; } };
    const { res, clashes, notes } = sn.resolveWide(root, heads, head, { headRef: branch, baseRef: pr.baseRefName, sameRepo: true }, lookup);
    for (const t of notes) add('NOTE', t.replace(/^NOTE /, ''));
    // a head whose base cannot be computed was not compared: fail closed, never ok (a branch pushed between the fetch and the ls-remote)
    if (res.noBase.length) throw new Error(`no base with origin/main for ${res.noBase.join(', ')}`);
    const found = numberFindings(clashes);
    const addedIds = [...res.branchAdds.values()].flatMap((s) => [...s]);
    for (const f of found) add(f.level, f.text);
    if (!found.some((f) => f.level === 'FAIL')) add('ok', `numbers: ${addedIds.length ? addedIds.join(' ') : 'none added'}; checked against origin/main and ${res.prs.length} other head(s) (remote branches and worktree branches)`);
  } catch (e) { add('FAIL', `numbers: not checked (${sn.safe(String(e.message || e).split('\n')[0])})`); }

  // 8. removed asserts
  const a = assertChanges(gitq(root, ['diff', base, head, '--', 'scripts']) || '');
  if (a.removed.length) {
    add('NOTE', `asserts: ${a.removed.length} removed, ${a.added} added under scripts/: each removed one needs an equal or stricter replacement`);
    for (const r of a.removed.slice(0, 30)) add('NOTE', `  - ${r.file}: ${r.text.slice(0, 140)}`);
  } else add('ok', `asserts: none removed, ${a.added} added`);

  // 9. security shape words
  if (names.includes('area:security')) {
    const sources = [{ where: 'PR body', added: pr.body || '' }, ...linesByFile(gitq(root, ['diff', base, head, '--', 'specs', 'docs', 'changelog.d']) || '')];
    const hits = shapeHits(sources);
    add(hits.length ? 'FAIL' : 'ok', hits.length ? `public text: shape words in ${hits.join(', ')} (a security PR describes the fix, not the shape)` : 'public text: no new shape words');
  }

  // 10. package.json scripts
  const touched = (gitq(root, ['diff', '--name-only', '-z', base, head]) || '').split('\0');
  if (touched.includes('package.json')) {
    const s = scriptChanges(sn.show(root, base, 'package.json'), sn.show(root, head, 'package.json'));
    if (s.error) add('FAIL', 'package.json: not valid JSON at the merge-base or the head');
    else add(s.removed.length || s.changed.length ? 'FAIL' : 'ok', `package.json scripts: +${s.added.length}, removed [${s.removed.join(', ')}], changed [${s.changed.join(', ')}]`);
  }

  // 11. size
  const z = sizeFinding(pr.additions, pr.deletions);
  add(z.level, z.text);

  // 12. checks
  const k = gh(['pr', 'checks', num, '--json', 'name,bucket']);
  let rows = null;
  try { rows = JSON.parse(k.stdout); } catch { /* no checks yet: gh prints nothing */ }
  const cf = checksFinding(rows);
  add(cf.level, cf.text);
  return done();
}

function format(lines) {
  const fails = lines.filter((l) => l.level === 'FAIL').length, notes = lines.filter((l) => l.level === 'NOTE').length;
  return [...lines.map((l) => `${l.level === 'ok' ? 'ok  ' : l.level} ${l.text}`), `preflight: ${fails} FAIL, ${notes} NOTE`].join('\n');
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--root');
  const root = i >= 0 ? path.resolve(argv[i + 1]) : undefined;
  const n = argv.find((x, j) => !x.startsWith('-') && argv[j - 1] !== '--root');
  const { lines, code } = preflight(n, { root, fetch: !argv.includes('--no-fetch') });
  emit(format(lines));
  process.exit(code);
}

module.exports = { preflight, format, labelFinding, assertChanges, shapeHits, linesByFile, scriptChanges, sizeFinding, checksFinding, numberFindings, AI_LINE, SHAPE_WORDS };
