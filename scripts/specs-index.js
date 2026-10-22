#!/usr/bin/env node
/*
 * Spec 025 delta 2026-10-22: the specs index (specs/README.md) is generated, so a pull request only touches its own spec folder.
 * Each specs/NNN-name/spec.md carries its index row in a comment block right under its title:
 *
 *   <!-- specs-index (the row in specs/README.md; after an edit run `npm run specs:index`)
 *   group: 046
 *   title: Short feature name
 *   status: **built** 2026-10-21: what was checked and how
 *   -->
 *
 * `group` names the table in specs/README.md (a `<!-- specs-index group=ID -->` line right above it); `title` and `status` are the
 * row's two cells, one line each, Markdown allowed, no "|". Everything else in specs/README.md is hand-written and kept.
 *
 *   node scripts/specs-index.js             rewrite the tables in specs/README.md (rows sorted by spec number within each group)
 *   node scripts/specs-index.js --check     exit 1 if specs/README.md is not what the blocks generate (before the cut-over: warn only)
 *   node scripts/specs-index.js --import    the other way round, for the migration: read the tables and write each row into its
 *                                           spec's block (adds the group markers on first use); run it after a PR edited the table
 *
 * Transition: open PRs still edit specs/README.md rows by hand. Until CUTOVER (or with --strict) --check only warns.
 * Plain Node, no shell, no network; paths with path.join (Windows, macOS, Linux).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CUTOVER = '2026-10-29'; // from this date (UTC) a stale index fails `npm test`
const HEADER = ['| # | Feature | Status |', '| --- | --- | --- |'];
const BLOCK_RE = /<!--\s*specs-index\b[^\n]*\n([\s\S]*?)-->\n?/;
const MARK_RE = /^<!--\s*specs-index group=([A-Za-z0-9._-]+)\s*-->$/;
const ROW_RE = /^\| \[(\d{3})\]\((\d{3}-[a-z0-9-]+)\/spec\.md\) \| (.*?) \| (.*) \|$/;
const KEYS = ['group', 'title', 'status'];
const BLOCK_HEAD = '<!-- specs-index (the row in specs/README.md; after an edit run `npm run specs:index`)';

const norm = (s) => String(s).replace(/\r\n?/g, '\n');
const read = (p) => norm(fs.readFileSync(p, 'utf8'));

/* The block of one spec.md: { meta, errors } (meta null when there is no block). */
function parseBlock(text) {
  const m = BLOCK_RE.exec(norm(text));
  if (!m) return { meta: null, errors: [] };
  const meta = {};
  const errors = [];
  for (const l of m[1].split('\n')) {
    if (!l.trim()) continue;
    const kv = /^([a-z]+):\s?(.*)$/.exec(l);
    if (!kv) { errors.push(`bad line in the specs-index block: "${l.slice(0, 60)}"`); continue; }
    if (!KEYS.includes(kv[1])) { errors.push(`unknown key "${kv[1]}" (use ${KEYS.join(', ')})`); continue; }
    if (kv[1] in meta) errors.push(`"${kv[1]}" given twice`);
    meta[kv[1]] = kv[2].trim();
  }
  for (const k of KEYS) if (!meta[k]) errors.push(`"${k}:" is missing or empty`);
  for (const k of ['title', 'status']) if (meta[k] && /(^|[^\\])\|/.test(meta[k])) errors.push(`"${k}" contains "|", which would split the table cell`);
  return { meta, errors };
}

/* Write (or replace) the block in a spec.md text: right under the first "# " title, else at the top. */
function setBlock(text, meta) {
  const t = norm(text);
  const block = `${BLOCK_HEAD}\n${KEYS.map((k) => `${k}: ${meta[k]}`).join('\n')}\n-->\n`;
  if (BLOCK_RE.test(t)) return t.replace(BLOCK_RE, () => block); // a function: a "$&" or "$1" in a status stays literal
  const lines = t.split('\n');
  if (/^# /.test(lines[0])) {
    const rest = lines.slice(1);
    if (rest[0] !== '') rest.unshift('');
    return [lines[0], '', block.replace(/\n$/, ''), ...rest].join('\n');
  }
  return `${block}\n${t}`;
}

/* Every spec folder with its block: [{ dir, num, meta, errors }]. */
function readSpecs(root = ROOT) {
  const specs = path.join(root, 'specs');
  return fs
    .readdirSync(specs)
    .filter((d) => /^\d{3}-/.test(d) && fs.existsSync(path.join(specs, d, 'spec.md')))
    .sort()
    .map((dir) => ({ dir, num: dir.slice(0, 3), ...parseBlock(read(path.join(specs, dir, 'spec.md'))) }));
}

const row = (s) => `| [${s.num}](${s.dir}/spec.md) | ${s.meta.title} | ${s.meta.status} |`;

/* Generate specs/README.md from its hand-written parts and the blocks: { text, errors }. */
function generate(root = ROOT) {
  const errors = [];
  const lines = read(path.join(root, 'specs', 'README.md')).split('\n');
  const specs = readSpecs(root);
  const groups = new Map();
  for (const s of specs) {
    for (const e of s.errors) errors.push(`specs/${s.dir}/spec.md: ${e}`);
    if (!s.meta) { errors.push(`specs/${s.dir}/spec.md: no specs-index block, so it is not in the index (see scripts/specs-index.js)`); continue; }
    if (s.errors.length) continue;
    if (!groups.has(s.meta.group)) groups.set(s.meta.group, []);
    groups.get(s.meta.group).push(s);
  }
  const out = [];
  const used = new Set();
  for (let i = 0; i < lines.length; i++) {
    const m = MARK_RE.exec(lines[i]);
    out.push(lines[i]);
    if (!m) continue;
    if (used.has(m[1])) errors.push(`specs/README.md: group ${m[1]} is marked twice`);
    used.add(m[1]);
    let j = i + 1;
    while (j < lines.length && lines[j].startsWith('|')) j++; // the old table
    out.push(...HEADER, ...(groups.get(m[1]) || []).map(row));
    i = j - 1;
  }
  for (const g of groups.keys()) if (!used.has(g)) errors.push(`group "${g}" (used by ${groups.get(g).map((s) => s.num).join(', ')}) has no "<!-- specs-index group=${g} -->" line in specs/README.md`);
  return { text: out.join('\n'), errors };
}

/* An id for an index table from the "## " heading above it: "## Features 001-010: ..." -> "001-010", "## Index" -> "index". */
function groupId(heading) {
  const m = /^##\s+Features?\s+(\d{3}(?:-\d{3})?)\b/.exec(heading || '');
  if (m) return m[1];
  return String(heading || 'index').replace(/^#+\s*/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'index';
}

/* --import: read the tables of specs/README.md into the blocks; add the group markers. Returns { readme, specs: n, errors }. */
function importIndex(root = ROOT, { write = true } = {}) {
  const errors = [];
  const file = path.join(root, 'specs', 'README.md');
  const lines = read(file).split('\n');
  const out = [];
  const rows = new Map();
  let heading = '';
  let group = null;
  const ids = new Set();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^## /.test(l)) heading = l;
    const mk = MARK_RE.exec(l);
    if (mk) { group = mk[1]; ids.add(group); out.push(l); continue; }
    if (l === HEADER[0]) {
      if (!(out.length && MARK_RE.test(out[out.length - 1]))) {
        let id = groupId(heading);
        for (let n = 2; ids.has(id); n++) id = `${groupId(heading)}-${n}`;
        ids.add(id);
        group = id;
        out.push(`<!-- specs-index group=${id} -->`);
      }
      out.push(l);
      continue;
    }
    const r = ROW_RE.exec(l);
    if (r && group) {
      if (r[2].slice(0, 3) !== r[1]) errors.push(`row ${r[1]} links to ${r[2]}`);
      if (rows.has(r[2])) errors.push(`${r[2]} has two rows (merge them first)`);
      rows.set(r[2], { group, title: r[3].trim(), status: r[4].trim() });
    } else if (l.startsWith('| [')) errors.push(`specs/README.md: a row the importer cannot read: "${l.slice(0, 70)}"`);
    if (!l.startsWith('|')) group = null;
    out.push(l);
  }
  for (const [dir, meta] of rows) {
    const spec = path.join(root, 'specs', dir, 'spec.md');
    if (!fs.existsSync(spec)) { errors.push(`row for ${dir}, which has no spec.md`); continue; }
    if (write) fs.writeFileSync(spec, setBlock(read(spec), meta));
  }
  if (write) fs.writeFileSync(file, out.join('\n'));
  return { readme: out.join('\n'), specs: rows.size, errors };
}

const pastCutover = (now = new Date()) => now.toISOString().slice(0, 10) >= CUTOVER;

module.exports = { CUTOVER, parseBlock, setBlock, readSpecs, generate, groupId, importIndex, pastCutover };

if (require.main === module) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--root');
  const root = i >= 0 ? path.resolve(args[i + 1]) : ROOT;
  const file = path.join(root, 'specs', 'README.md');
  if (args.includes('--import')) {
    const r = importIndex(root);
    for (const e of r.errors) console.error(`error: ${e}`);
    console.log(`imported ${r.specs} row(s) into their spec.md; now run npm run specs:index`);
    process.exit(r.errors.length ? 1 : 0);
  }
  const { text, errors } = generate(root);
  const strict = args.includes('--strict') || pastCutover();
  if (args.includes('--check')) {
    const stale = text !== read(file);
    const problems = [...errors, ...(stale ? ['specs/README.md is not what the specs-index blocks generate: run npm run specs:index (if you edited a row in specs/README.md by hand, run npm run specs:index -- --import first to move it into the spec)'] : [])];
    const tag = strict ? 'error' : 'warning';
    for (const p of problems) console[strict ? 'error' : 'log'](`${tag}: ${p}`);
    if (problems.length && !strict) console.log(`(warning only until ${CUTOVER}, while the open PRs still edit the table by hand)`);
    console.log(problems.length ? `specs:check: ${problems.length} problem(s)` : 'specs:check ok');
    process.exit(problems.length && strict ? 1 : 0);
  }
  for (const e of errors) console.error(`error: ${e}`);
  if (errors.length) process.exit(1);
  if (text !== read(file)) { fs.writeFileSync(file, text); console.log('specs/README.md rewritten'); } else console.log('specs/README.md already current');
}
