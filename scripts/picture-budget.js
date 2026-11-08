#!/usr/bin/env node
/*
 * Spec 021 FR-085 (delta 2026-11-08): picture budget. `npm test` (suite test:picturebudget) fails when a picture that this branch
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
const { printable, emit } = require('./safe-print.js');

// One constant. 300 KB: a compress-shots screenshot is 120 KB median / 240 KB p90, so a bigger one is uncompressed or a full-size
// capture that a crop or downscale would fix; the cost is permanent because every merge commit keeps the blob in history.
const BUDGET_BYTES = 300 * 1024;
const ALLOW_FILE = 'scripts/picture-budget-allow.txt';
// Every picture or media extension the repository could get; a file with another name is still caught by its first bytes (looksLikeMedia).
const IMAGE_RE = /\.(png|apng|jpe?g|jpe|jfif|gif|webp|avif|heic|heif|jxl|svg|ico|icns|cur|bmp|dib|tiff?|dds|tga|psd|mp4|m4v|webm|mov|mkv|avi|ogv)$/i;
/** First bytes of a PNG/APNG, JPEG, GIF, WebP/RIFF, BMP, TIFF, ICO/CUR, ICNS, JPEG XL, DDS, PSD, ISO-BMFF (mp4, mov, avif, heic), EBML (webm, mkv). */
function looksLikeMedia(b) {
  const at = (off, str) => b.length >= off + str.length && b.toString('latin1', off, off + str.length) === str;
  return at(1, 'PNG') || (b[0] === 0xff && b[1] === 0xd8) || at(0, 'GIF8') || (at(0, 'RIFF') && b.length >= 12) || at(0, 'BM') || at(0, 'II*\0') || at(0, 'MM\0*')
    || (b.length >= 4 && b[0] === 0 && b[1] === 0 && (b[2] === 1 || b[2] === 2) && b[3] === 0) || at(0, 'icns') || (b[0] === 0xff && b[1] === 0x0a) || at(0, '\0\0\0\x0cJXL ')
    || at(0, 'DDS ') || at(0, '8BPS') || at(4, 'ftyp') || (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3);
}
const FIX = 'commit a crop or downscale that passes compress-shots (`npm run shots:compress -- <file>`), or keep it local only (untracked, gitignored); a real asset that must be larger needs a reasoned line in ' + ALLOW_FILE;

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const gitOk = (root, args) => { try { return git(root, args).trim(); } catch { return null; } };

/** An allow-list path that could point outside the checkout (`../x`, `/etc/x`, `C:\\x`, NUL): refused before anything is looked up, so the check cannot be
 * used to learn whether a file exists elsewhere. */
const unsafePath = (p) => path.isAbsolute(p) || path.win32.isAbsolute(p) || /^[A-Za-z]:/.test(p) || p.includes('\0') || p.split(/[\\/]/).includes('..');

/** `path | max KB | reason` lines -> { entries: Map(path -> bytes), problems } */
function parseAllow(text) {
  const entries = new Map(), problems = [];
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const [p, kb, ...rest] = line.split('|').map((s) => s.trim());
    const reason = rest.join('|').trim();
    if (p && unsafePath(p)) problems.push(`${ALLOW_FILE}:${i + 1}: ${printable(p)} must be a path inside the repository (no .. segment, not absolute)`);
    else if (!p || !/^\d+$/.test(kb || '') || Number(kb) <= 0) problems.push(`${ALLOW_FILE}:${i + 1}: needs "path | max KB | reason" with a whole number of KB`);
    else if (!reason) problems.push(`${ALLOW_FILE}:${i + 1}: ${printable(p)} has no reason`);
    else if (entries.has(p)) problems.push(`${ALLOW_FILE}:${i + 1}: ${printable(p)} is listed twice`);
    else entries.set(p, Number(kb) * 1024);
  });
  return { entries, problems };
}

/** Changed files since `base`: [{ path, status }] (A, C, M, R with edits); pure renames and deletions are left out. */
function changedFiles(root, base) {
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
  return res;
}

/** Every blob that a commit of this branch (since `base`, merge commits left out) added or changed, even one a later commit replaced:
 * history keeps it. [{ path, sha }]. -z output, so a newline in a name cannot split a record. */
function historyBlobs(root, base) {
  const out = git(root, ['log', '-z', '--no-merges', '--no-renames', '--raw', '--no-abbrev', '--diff-filter=AM', '--format=', `${base}..HEAD`]).split('\0');
  // content that `base` already holds (a pure rename, a revert) is not new
  const known = new Set(git(root, ['ls-tree', '-r', '-z', base]).split('\0').map((l) => (l.match(/^\d+ blob ([0-9a-f]{40})\t/) || [])[1]).filter(Boolean));
  const res = [];
  for (let i = 0; i < out.length; i++) {
    const head = out[i].replace(/^\n+/, '');
    const m = head.match(/^:(\d{6}) (\d{6}) [0-9a-f]+ ([0-9a-f]{40}) [AM]$/);
    if (!m) continue;
    const file = out[++i];
    if (file !== undefined && m[2] !== '160000' && m[2] !== '120000' && !known.has(m[3])) res.push({ path: file, sha: m[3] });
  }
  return res;
}
/** Sizes of blobs: Map(sha -> bytes). `git cat-file --batch-check` (a missing promisor blob is fetched); a blob that cannot be read throws. */
function blobSizes(root, shas) {
  const m = new Map();
  if (!shas.length) return m;
  const out = execFileSync('git', ['cat-file', '--batch-check=%(objectname) %(objectsize)'], { cwd: root, input: [...new Set(shas)].join('\n') + '\n', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  for (const l of out.split('\n')) { const [sha, size] = l.split(' '); if (/^\d+$/.test(size || '')) m.set(sha, Number(size)); else if (l) throw new Error(`cannot read object ${String(sha).slice(0, 12)}`); }
  return m;
}
const lstatOf = (root, p) => { try { return fs.lstatSync(path.join(root, p)); } catch { return null; } };
// A symlink is never read through (its target may be anywhere: a big file outside the checkout would be judged, or its existence revealed): sizeOf
// (the only caller's gate) sees it as no file; git holds only the link text, a few bytes, and historyBlobs skips mode 120000 the same way.
const headOfFile = (root, p) => { try { const fd = fs.openSync(path.join(root, p), 'r'); try { const b = Buffer.alloc(32); fs.readSync(fd, b, 0, 32, 0); return b; } finally { fs.closeSync(fd); } } catch { return Buffer.alloc(0); } };
const headOfBlob = (root, sha) => execFileSync('git', ['cat-file', 'blob', sha], { cwd: root, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).subarray(0, 32);

/** True when `p`, with every symlink on the way resolved (a symlinked FOLDER included), stays inside the real root. The nearest existing ancestor is
 * resolved, so the answer is the same whether or not the file at the end exists. */
function insideRoot(root, p) {
  let realRoot;
  try { realRoot = fs.realpathSync(root); } catch { return false; }
  let dir = path.dirname(path.resolve(root, p));
  for (;;) {
    try { const rel = path.relative(realRoot, fs.realpathSync(dir)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); } catch { /* not there: its parent decides */ }
    const up = path.dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
}

function sizeOf(root, p) {
  const st = lstatOf(root, p);
  return st && st.isFile() ? st.size : null;
}

/** -> { status: 'ok' | 'skip' | 'fail', lines: [string] } */
function check(root, { strict = false, budget = BUDGET_BYTES } = {}) {
  const lines = [];
  let allowText = '';
  try { allowText = fs.readFileSync(path.join(root, ALLOW_FILE), 'utf8'); } catch { /* no list: nothing is allowed */ }
  const allow = parseAllow(allowText);
  const problems = [...allow.problems];
  for (const p of allow.entries.keys()) {
    if (!insideRoot(root, p)) { problems.push(`${ALLOW_FILE}: ${printable(p)} must be a path inside the repository (no .. segment, not absolute, no symlinked folder out of it)`); continue; }
    const st = lstatOf(root, p);
    if (st && st.isSymbolicLink()) problems.push(`${ALLOW_FILE}: ${printable(p)} is a symlink; list the file itself`);
    else if (!st || !st.isFile()) problems.push(`${ALLOW_FILE}: ${printable(p)} does not exist; delete the line`);
  }

  let base = null;
  if (gitOk(root, ['rev-parse', '--verify', '-q', 'origin/main'])) base = gitOk(root, ['merge-base', 'HEAD', 'origin/main']);
  if (!base) {
    const hint = 'no origin/main (shallow or fresh clone): run `git fetch origin main` (CI: fetch-depth 0), then re-run';
    if (problems.length) return { status: 'fail', lines: [...problems, `picture-budget: ${hint}`] };
    return strict ? { status: 'fail', lines: [`picture-budget: FAIL (strict): ${hint}`] }
      : { status: 'skip', lines: [`picture-budget: SKIP: ${hint}; pictures were NOT checked`] };
  }

  const over = [], seen = new Set();
  const capOf = (p) => (allow.entries.has(p) ? allow.entries.get(p) : budget);
  const flag = (p, size, where) => {
    const key = `${p}|${size}`;
    if (seen.has(key)) return;
    seen.add(key);
    over.push(`  ${printable(p)}: ${(size / 1024).toFixed(0)} KB${where}, over the ${(capOf(p) / 1024).toFixed(0)} KB ${allow.entries.has(p) ? 'allow-list cap' : 'budget'}`);
  };
  // a picture is judged by its name or, over the cap, by its first bytes (a `.apng`, `.dat` or `.bin` that is a PNG is still one)
  let count = 0;
  for (const { path: p } of changedFiles(root, base)) {
    const size = sizeOf(root, p);
    if (size === null) continue;
    const named = IMAGE_RE.test(p);
    if (!named && !(size > capOf(p) && looksLikeMedia(headOfFile(root, p)))) continue;
    count++;
    if (size > capOf(p)) flag(p, size, '');
  }
  // blobs that a commit of the branch added and a later commit replaced or deleted stay in history, the cost this check exists for
  const blobs = historyBlobs(root, base);
  const sizes = blobSizes(root, blobs.map((b) => b.sha));
  for (const { path: p, sha } of blobs) {
    const size = sizes.get(sha);
    if (size === undefined || size <= capOf(p)) continue;
    if (!IMAGE_RE.test(p) && !looksLikeMedia(headOfBlob(root, sha))) continue;
    flag(p, size, ' (a commit of this branch)');
  }
  const pics = { length: count };
  if (over.length || problems.length) {
    lines.push(...problems);
    if (over.length) lines.push(`picture-budget: ${over.length} picture(s) added or changed since ${base.slice(0, 9)} are over budget:`, ...over, `Fix: ${FIX}. A blob that a commit of this branch added stays in history even when a later commit replaced it: start a fresh branch from origin/main with the compressed file.`);
    return { status: 'fail', lines };
  }
  lines.push(`picture-budget: ok, ${pics.length} picture(s) added or changed since ${base.slice(0, 9)}, each at most ${budget / 1024} KB`);
  return { status: 'ok', lines };
}

module.exports = { BUDGET_BYTES, ALLOW_FILE, IMAGE_RE, looksLikeMedia, parseAllow, changedFiles, historyBlobs, check };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const ri = argv.indexOf('--root');
  const root = ri >= 0 ? path.resolve(argv[ri + 1]) : path.join(__dirname, '..');
  const strict = argv.includes('--strict') || !['', '0', 'false'].includes(String(process.env.PICTURE_BUDGET_STRICT || '').toLowerCase());
  let r;
  try { r = check(root, { strict }); } catch (e) { emit(`picture-budget: NOT CHECKED: ${String((e && (e.stderr || e.message)) || e).trim().split('\n')[0].slice(0, 300)}`); process.exit(2); }
  emit(r.lines.join('\n'));
  process.exit(r.status === 'fail' ? 1 : 0);
}
