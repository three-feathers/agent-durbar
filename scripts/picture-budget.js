#!/usr/bin/env node
/*
 * Spec 021 FR-063 (delta 2026-11-08): picture budget. `npm test` (suite test:picturebudget) fails when a picture that this branch
 * ADDS or CHANGES since its merge-base with origin/main is over BUDGET_BYTES. Why: three PRs on 2026-11-07/08 committed
 * uncompressed pictures (1.5-4.4 MB each); merges here are merge commits, so a big blob stays in history and each PR needed a full
 * re-commit on a fresh branch.
 *
 * Existing capability (AGENTS.md FR-031), checked first: `scripts/compress-shots.js` (spec 050 FR-012) is the FIX: it palette-compresses
 * with a quality guard, and the docs screenshots it produces have a median of 120 KB, a 90th percentile of 240 KB. `test:site`
 * (spec 050) holds the 8 MB budget of the whole built site, not one PR's new files. Neither looks at what a branch adds, so this
 * is a small check beside them, with the same fix.
 *
 *   node scripts/picture-budget.js [--strict] [--root D]
 *     no origin/main (shallow clone): prints a SKIP line with the fetch hint and exits 0; --strict (or PICTURE_BUDGET_STRICT=1,
 *     used by CI) exits 1 instead, so a missing base is never a silent pass.
 *
 * Pure renames (100% similar) are not new content and are ignored; deleted files are ignored; only tracked paths (committed,
 * or staged/modified in the working tree) count. LFS is not used here. A picture that must be larger goes in
 * scripts/picture-budget-allow.txt, one line per file: `path | max KB | reason`; the check fails on a line without a reason, a
 * bad size or a file that no longer exists, so the list cannot rot. Plain Node, no shell, no network.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// One constant. 300 KB: a compress-shots screenshot is 120 KB median / 240 KB p90, so a bigger one is uncompressed or a full-size
// capture that a crop or downscale would fix; the cost is permanent because every merge commit keeps the blob in history.
const BUDGET_BYTES = 300 * 1024;
const ALLOW_FILE = 'scripts/picture-budget-allow.txt';
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|tiff?|avif|heic|ico|svg)$/i;
const FIX = 'commit a crop or downscale that passes compress-shots (`npm run shots:compress -- <file>`), or keep it local only (untracked, gitignored); a real asset that must be larger needs a reasoned line in ' + ALLOW_FILE;

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const gitOk = (root, args) => { try { return git(root, args).trim(); } catch { return null; } };

/** `path | max KB | reason` lines -> { entries: Map(path -> bytes), problems } */
function parseAllow(text) {
  const entries = new Map(), problems = [];
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const [p, kb, ...rest] = line.split('|').map((s) => s.trim());
    const reason = rest.join('|').trim();
    if (!p || !/^\d+$/.test(kb || '') || Number(kb) <= 0) problems.push(`${ALLOW_FILE}:${i + 1}: needs "path | max KB | reason" with a whole number of KB`);
    else if (!reason) problems.push(`${ALLOW_FILE}:${i + 1}: ${p} has no reason`);
    else if (entries.has(p)) problems.push(`${ALLOW_FILE}:${i + 1}: ${p} is listed twice`);
    else entries.set(p, Number(kb) * 1024);
  });
  return { entries, problems };
}

/** Changed pictures since `base`: [{ path, status }] (A, C, M, R with edits); pure renames and deletions are left out. */
function changedPictures(root, base) {
  // -z: NUL-separated, so odd file names are safe; -M finds renames; the working tree is compared (staged and unstaged tracked changes)
  const out = git(root, ['diff', '-z', '-M', '--name-status', '--diff-filter=ACMR', base]).split('\0');
  const res = [];
  for (let i = 0; i < out.length && out[i];) {
    const st = out[i++];
    const kind = st[0];
    if (kind === 'R' || kind === 'C') {
      const to = (i++, out[i++]);
      if (kind === 'R' && st === 'R100') continue; // same content under a new name
      res.push({ path: to, status: kind });
    } else res.push({ path: out[i++], status: kind });
  }
  return res.filter((r) => IMAGE_RE.test(r.path));
}

function sizeOf(root, p) {
  try { return fs.statSync(path.join(root, p)).size; } catch { return null; }
}

/** -> { status: 'ok' | 'skip' | 'fail', lines: [string] } */
function check(root, { strict = false, budget = BUDGET_BYTES } = {}) {
  const lines = [];
  let allowText = '';
  try { allowText = fs.readFileSync(path.join(root, ALLOW_FILE), 'utf8'); } catch { /* no list: nothing is allowed */ }
  const allow = parseAllow(allowText);
  const problems = [...allow.problems];
  for (const p of allow.entries.keys()) if (sizeOf(root, p) === null) problems.push(`${ALLOW_FILE}: ${p} does not exist; delete the line`);

  let base = null;
  if (gitOk(root, ['rev-parse', '--verify', '-q', 'origin/main'])) base = gitOk(root, ['merge-base', 'HEAD', 'origin/main']);
  if (!base) {
    const hint = 'no origin/main (shallow or fresh clone): run `git fetch origin main` (CI: fetch-depth 0), then re-run';
    if (problems.length) return { status: 'fail', lines: [...problems, `picture-budget: ${hint}`] };
    return strict ? { status: 'fail', lines: [`picture-budget: FAIL (strict): ${hint}`] }
      : { status: 'skip', lines: [`picture-budget: SKIP: ${hint}; pictures were NOT checked`] };
  }

  const over = [];
  const pics = changedPictures(root, base);
  for (const { path: p } of pics) {
    const size = sizeOf(root, p);
    if (size === null) continue;
    const cap = allow.entries.has(p) ? allow.entries.get(p) : budget;
    if (size > cap) over.push(`  ${p}: ${(size / 1024).toFixed(0)} KB, over the ${(cap / 1024).toFixed(0)} KB ${allow.entries.has(p) ? 'allow-list cap' : 'budget'}`);
  }
  if (over.length || problems.length) {
    lines.push(...problems);
    if (over.length) lines.push(`picture-budget: ${over.length} picture(s) added or changed since ${base.slice(0, 9)} are over budget:`, ...over, `Fix: ${FIX}.`);
    return { status: 'fail', lines };
  }
  lines.push(`picture-budget: ok, ${pics.length} picture(s) added or changed since ${base.slice(0, 9)}, each at most ${budget / 1024} KB`);
  return { status: 'ok', lines };
}

module.exports = { BUDGET_BYTES, ALLOW_FILE, IMAGE_RE, parseAllow, changedPictures, check };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const ri = argv.indexOf('--root');
  const root = ri >= 0 ? path.resolve(argv[ri + 1]) : path.join(__dirname, '..');
  const strict = argv.includes('--strict') || !['', '0', 'false'].includes(String(process.env.PICTURE_BUDGET_STRICT || '').toLowerCase());
  const r = check(root, { strict });
  console.log(r.lines.join('\n'));
  process.exit(r.status === 'fail' ? 1 : 0);
}
