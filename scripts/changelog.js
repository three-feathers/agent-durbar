#!/usr/bin/env node
/*
 * Spec 025 delta 2026-10-22: CHANGELOG fragments, so pull requests stop colliding in CHANGELOG.md's "Unreleased" section.
 * Each PR adds one small file `changelog.d/<branch-or-topic>.md` with its bullet line(s); a release folds them into CHANGELOG.md.
 *
 *   node scripts/changelog.js check                      validate fragments; warn (or fail, after the cut-over) on bullets under Unreleased
 *   node scripts/changelog.js preview                    print the bullets the next release would get, change nothing
 *   node scripts/changelog.js build --release "<heading>" [--dry-run]
 *                                                        new "## <heading>" section under Unreleased with every fragment and every
 *                                                        bullet still under Unreleased; deletes the fragments; marks the cut-over
 *   node scripts/changelog.js migrate                    move the bullets under Unreleased into changelog.d/before-fragments.md
 *
 * Fragment format: one or more top-level bullets ("- text"), each optionally followed by indented lines ("  more" or "  - sub");
 * blank lines between bullets are fine; nothing else (no headings, no unindented prose). File names are lower case
 * (`[a-z0-9][a-z0-9._-]*.md`) so two names never clash on a case-insensitive disk (Windows, macOS); changelog.d/README.md
 * explains the folder and is not a fragment.
 *
 * Transition (the open PRs still edit Unreleased the old way): until CHANGELOG.md's Unreleased section carries the cut-over marker,
 * bullets there are only a warning, and `build` folds them like fragments. The first `build` writes the marker, so from then on a
 * hand-written Unreleased bullet fails `check` (and `npm test`). Plain Node, no shell, no network.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MARKER = '<!-- changelog.d: fragments only; a bullet here fails npm run changelog:check -->';
const INTRO = 'Not released yet: each change is a file in [`changelog.d/`](changelog.d/) until the next release folds them in (`npm run changelog:preview` lists them).';
const MARKER_RE = /<!--\s*changelog\.d: fragments only\b/;
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,79}\.md$/;
const NOT_FRAGMENTS = new Set(['README.md', '.gitkeep']);

const norm = (s) => String(s).replace(/\r\n?/g, '\n');

/* Split CHANGELOG.md into the lines before Unreleased, the Unreleased heading, its body lines, and the rest (from the next "## "). */
function splitChangelog(text) {
  const lines = norm(text).split('\n');
  const start = lines.findIndex((l) => /^## Unreleased\b/.test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return { before: lines.slice(0, start), heading: lines[start], body: lines.slice(start + 1, end), rest: lines.slice(end) };
}

/* Bullet blocks in a list of lines: a top-level "- " line plus the indented lines under it. Returns { bullets, other }. */
function bulletBlocks(lines) {
  const bullets = [];
  const other = [];
  let cur = null;
  for (const l of lines) {
    if (/^-[ \t]+\S/.test(l)) { cur = [l]; bullets.push(cur); continue; }
    if (cur && /^\s+\S/.test(l)) { cur.push(l); continue; }
    cur = null;
    other.push(l);
  }
  return { bullets: bullets.map((b) => b.join('\n')), other };
}

/* Parse one fragment's text: { bullets, errors }. */
function parseFragment(text) {
  const errors = [];
  const lines = norm(text).split('\n');
  let inBullet = false;
  const bullets = [];
  lines.forEach((l, i) => {
    const n = i + 1;
    if (!l.trim()) { return; }
    if (/^-[ \t]+\S/.test(l)) { bullets.push([l.replace(/\s+$/, '')]); inBullet = true; return; }
    if (/^\s+\S/.test(l) && inBullet) { bullets[bullets.length - 1].push(l.replace(/\s+$/, '')); return; }
    if (/^#/.test(l)) errors.push(`line ${n}: no headings in a fragment (the release adds them)`);
    else if (/^\s/.test(l)) errors.push(`line ${n}: an indented line must follow a "- " bullet`);
    else errors.push(`line ${n}: every entry starts with "- " (a Markdown bullet)`);
  });
  if (!bullets.length && !errors.length) errors.push('empty: write at least one "- " bullet');
  if (/<!--|--!?>/.test(text)) errors.push('no HTML comments in a fragment');
  return { bullets: bullets.map((b) => b.join('\n')), errors };
}

/* Read changelog.d/: [{ file, bullets, errors }] sorted by file name (the order a release lists them). */
function readFragments(root = ROOT) {
  const dir = path.join(root, 'changelog.d');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => !NOT_FRAGMENTS.has(f))
    .sort()
    .map((f) => {
      const full = path.join(dir, f);
      if (!fs.statSync(full).isFile()) return { file: f, bullets: [], errors: ['not a file'] };
      if (!NAME_RE.test(f)) return { file: f, bullets: [], errors: ['name must be lower case letters, digits, ".", "_" or "-", ending in .md'] };
      return { file: f, ...parseFragment(fs.readFileSync(full, 'utf8')) };
    });
}

const key = (b) => b.replace(/\s+/g, ' ').trim();

/* check: { errors, warnings }. `strict` treats Unreleased bullets as errors even before the cut-over marker. */
function check(root = ROOT, { strict = false } = {}) {
  const errors = [];
  const warnings = [];
  const file = path.join(root, 'CHANGELOG.md');
  const parts = splitChangelog(fs.readFileSync(file, 'utf8'));
  if (!parts) return { errors: ['CHANGELOG.md has no "## Unreleased" heading'], warnings };
  const seen = new Map();
  // every bullet already released (or under Unreleased) counts for the duplicate check
  for (const b of bulletBlocks([...parts.body, ...parts.rest]).bullets) seen.set(key(b), 'CHANGELOG.md');
  for (const fr of readFragments(root)) {
    for (const e of fr.errors) errors.push(`changelog.d/${fr.file}: ${e}`);
    for (const b of fr.bullets) {
      const k = key(b);
      if (seen.has(k)) errors.push(`changelog.d/${fr.file}: the entry "${k.slice(0, 70)}…" is already in ${seen.get(k)}`);
      else seen.set(k, `changelog.d/${fr.file}`);
    }
  }
  const hand = bulletBlocks(parts.body).bullets;
  if (hand.length) {
    const cutOver = parts.body.some((l) => MARKER_RE.test(l));
    const msg = `CHANGELOG.md has ${hand.length} bullet(s) under "Unreleased": put a change in its own changelog.d/<branch>.md instead (npm run changelog:migrate moves them)`;
    if (cutOver || strict) errors.push(msg);
    else warnings.push(`${msg}; allowed until the first changelog:build release (transition)`);
  }
  return { errors, warnings };
}

/* The bullets the next release gets: fragments first (newer), then the transition bullets still under Unreleased. */
function pending(root = ROOT) {
  const parts = splitChangelog(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'));
  const frs = readFragments(root);
  return { parts, frs, bullets: [...frs.flatMap((f) => f.bullets), ...(parts ? bulletBlocks(parts.body).bullets : [])] };
}

const squeeze = (lines) => {
  const out = [];
  for (const l of lines) if (l.trim() || (out.length && out[out.length - 1].trim())) out.push(l);
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
};

/* The edited head (blank runs squeezed, one blank line before the next section) and the untouched rest of the file. */
const joinParts = (head, rest) => `${head.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '')}\n\n${rest.join('\n')}`;

/* build: returns { changed, text, removed } and, unless dryRun, writes CHANGELOG.md and deletes the folded fragments. */
function build(root = ROOT, { release, dryRun = false } = {}) {
  const { errors } = check(root);
  if (errors.length) throw new Error(`fix these first:\n  ${errors.join('\n  ')}`);
  const { parts, frs, bullets } = pending(root);
  if (!bullets.length) return { changed: false, removed: [] };
  if (!release || !release.trim() || /\n/.test(release)) throw new Error('give the release heading: --release "v0.1.0-alpha.N ([pre-release](<url>), YYYY-MM-DD)"');
  const heading = `## ${release.trim().replace(/^##\s*/, '')}`;
  if (parts.rest.some((l) => l.trim() === heading.trim())) throw new Error(`CHANGELOG.md already has "${heading}"`);
  const keep = squeeze(bulletBlocks(parts.body).other);
  if (!keep.some((l) => l.includes('](changelog.d/)'))) keep.unshift(INTRO, '');
  if (!keep.some((l) => MARKER_RE.test(l))) keep.push(MARKER);
  const tag = /\b(alpha|beta|rc)\.\d+\b/.exec(release);
  const unreleased = tag ? parts.heading.replace(/\bafter the \S+ tag\b/, `after the ${tag[0]} tag`) : parts.heading;
  const text = joinParts([...parts.before, unreleased, '', ...keep, '', heading, '', ...bullets.join('\n').split('\n')], parts.rest);
  const removed = frs.map((f) => path.join('changelog.d', f.file));
  if (!dryRun) {
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), text);
    for (const f of removed) fs.unlinkSync(path.join(root, f));
  }
  return { changed: true, text, removed };
}

/* migrate: move the bullets under Unreleased into changelog.d/<name> (one file, their order kept). */
function migrate(root = ROOT, { name = 'before-fragments.md' } = {}) {
  if (!NAME_RE.test(name)) throw new Error(`bad fragment name ${name}`);
  const file = path.join(root, 'CHANGELOG.md');
  const parts = splitChangelog(fs.readFileSync(file, 'utf8'));
  if (!parts) throw new Error('CHANGELOG.md has no "## Unreleased" heading');
  const { bullets, other } = bulletBlocks(parts.body);
  if (!bullets.length) return { moved: 0 };
  const out = path.join(root, 'changelog.d', name);
  if (fs.existsSync(out)) throw new Error(`changelog.d/${name} exists already (pick another name: --name <file>.md)`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, bullets.join('\n') + '\n');
  const keep = squeeze(other);
  if (!keep.some((l) => l.includes('](changelog.d/)'))) keep.unshift(INTRO, '');
  const text = joinParts([...parts.before, parts.heading, '', ...keep], parts.rest);
  fs.writeFileSync(file, text);
  return { moved: bullets.length, file: path.join('changelog.d', name) };
}

module.exports = { MARKER, INTRO, splitChangelog, bulletBlocks, parseFragment, readFragments, check, pending, build, migrate };

if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const root = opt('--root') ? path.resolve(opt('--root')) : ROOT;
  try {
    if (cmd === 'check') {
      const { errors, warnings } = check(root, { strict: args.includes('--strict') });
      for (const w of warnings) console.log(`warning: ${w}`);
      for (const e of errors) console.error(`error: ${e}`);
      const n = readFragments(root).length;
      console.log(errors.length ? `changelog:check failed (${errors.length} error(s))` : `changelog:check ok (${n} fragment(s))`);
      process.exit(errors.length ? 1 : 0);
    } else if (cmd === 'preview') {
      const { bullets } = pending(root);
      console.log(bullets.length ? bullets.join('\n') : '(nothing pending)');
    } else if (cmd === 'build') {
      const r = build(root, { release: opt('--release'), dryRun: args.includes('--dry-run') });
      if (!r.changed) console.log('nothing to fold: no fragments and no bullets under Unreleased');
      else if (args.includes('--dry-run')) process.stdout.write(r.text);
      else console.log(`folded into CHANGELOG.md; removed ${r.removed.length} fragment(s)${r.removed.length ? `: ${r.removed.join(', ')}` : ''}`);
    } else if (cmd === 'migrate') {
      const r = migrate(root, { name: opt('--name') });
      console.log(r.moved ? `moved ${r.moved} bullet(s) to ${r.file}` : 'nothing under Unreleased to move');
    } else {
      console.error('usage: node scripts/changelog.js check [--strict] | preview | build --release "<heading>" [--dry-run] | migrate [--name <file>.md]');
      process.exit(2);
    }
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}
