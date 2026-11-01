#!/usr/bin/env node
/*
 * Spec 025 delta 2026-10-22: the specs index is generated and its rows are NOT committed, so two pull requests never meet in
 * specs/README.md (review on #518: committed rows still conflicted when two PRs changed neighbouring specs). Each
 * specs/NNN-name/spec.md carries its row in a comment block right under its title:
 *
 *   <!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
 *   group: 046
 *   title: Short feature name
 *   status: built
 *   note: open follow-ups, in one short line (optional, at most 160 characters)
 *   -->
 *
 * `group` names a table of specs/README.md (a `<!-- specs-index group=ID -->` line marks where it goes); `title` is the row's
 * feature cell. `status` is ONE word from a fixed list (spec 021 FR-063, delta 2026-10-29): draft (outline, not agreed), specified
 * (spec, plan and tasks agreed, nothing or little built), building (work in progress, or planned build tasks still open), built
 * (done; open tasks are only deferred follow-ups, [KNOWN GAP]s or checks that need a real account or an owner), released (built
 * and shipped in a published release), superseded (replaced by another spec; say which in the note). The detail belongs in the
 * spec's `## Changes`, not here. `note` is optional and shown after the status. One line each, Markdown allowed, no "|", no
 * "-->" or "--!>". specs/README.md holds only the hand-written text and the markers; the tables are built from the blocks by the
 * website (spec 050) and by this script.
 *
 *   node scripts/specs-index.js             write the full index to specs/INDEX.md (git-ignored) to read it locally
 *   node scripts/specs-index.js --print     print it
 *   node scripts/specs-index.js --check     every spec has a valid block, every group a marker, no committed rows in specs/README.md
 *   node scripts/specs-index.js --add specs/NNN-name   give a new spec a block (group of the newest spec, its title, status draft)
 *   node scripts/specs-index.js --import    migration: read the hand tables of specs/README.md into the blocks, then remove the rows
 *
 * Transition: problems only warn until specs/README.md has the line `<!-- specs-index: strict -->` (a small PR adds it after the
 * open PRs have landed) or --strict is given. No clock: the same commit always gives the same result.
 * Plain Node, no shell, no network; paths with path.join (Windows, macOS, Linux).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STRICT_RE = /^<!--\s*specs-index: strict\s*-->$/m;
const HEADER = ['| # | Feature | Status |', '| --- | --- | --- |'];
const BLOCK_RE = /<!--\s*specs-index\b[^\n]*\n([\s\S]*?)^--!?>[ \t]*(?:\n|$)/m; // the block ends at a line that is only "-->" (or "--!>", which also ends an HTML comment)
const MARK_RE = /^<!--\s*specs-index group=([A-Za-z0-9._-]+)\s*-->$/;
const ROW_RE = /^\| \[(\d{3})\]\((\d{3}-[a-z0-9-]+)\/spec\.md\) \| (.*?) \| (.*) \|$/;
const KEYS = ['group', 'title', 'status', 'note'];
const REQUIRED = ['group', 'title', 'status'];
const STATUSES = ['draft', 'specified', 'building', 'built', 'released', 'superseded'];
const NOTE_MAX = 160;
/* Numbers of the one-release spec folders folded into spec 008's release table (spec 021 FR-063): never reused for a new spec. */
const RETIRED = ['023', '026', '031', '042', '046', '047', '053', '055', '067', '071', '078', '079', '082', '086', '088', '089', '090', '091'];
const retiredMsg = (n) => `number ${n} is retired (its release folder became a row of spec 008's release table): take the next free number`;
const BLOCK_HEAD = '<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)';
const COMMENT_END = /--!?>/;

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
  for (const k of REQUIRED) if (!meta[k]) errors.push(`"${k}:" is missing or empty`);
  errors.push(...valueErrors(meta));
  return { meta, errors };
}

/* What a title or status may not contain: an unescaped "|" (splits the cell), "-->" or "--!>" (ends the comment early). */
function valueErrors(meta) {
  const errors = [];
  if (meta.status && !STATUSES.includes(meta.status)) errors.push(`"status" must be one of ${STATUSES.join(', ')} (got "${String(meta.status).slice(0, 40)}"); put the detail in "note:" (at most ${NOTE_MAX} characters) or in the spec's Changes`);
  if (meta.note && meta.note.length > NOTE_MAX) errors.push(`"note" is ${meta.note.length} characters (at most ${NOTE_MAX}); move the detail into the spec's Changes`);
  for (const k of ['title', 'status', 'note']) {
    if (!meta[k]) continue;
    if (/(^|[^\\])\|/.test(meta[k])) errors.push(`"${k}" contains "|", which would split the table cell`);
    if (COMMENT_END.test(meta[k])) errors.push(`"${k}" contains "-->" or "--!>", which would end the comment block`);
  }
  return errors;
}

/* Write (or replace) the block in a spec.md text: right under the first "# " title, else at the top. */
function setBlock(text, meta) {
  const bad = valueErrors(meta);
  if (bad.length) throw new Error(bad.join('; '));
  const t = norm(text);
  const block = `${BLOCK_HEAD}\n${KEYS.filter((k) => meta[k]).map((k) => `${k}: ${meta[k]}`).join('\n')}\n-->\n`;
  if (BLOCK_RE.test(t)) return t.replace(BLOCK_RE, () => block); // a function: a "$&" or "$1" in a status stays literal
  const lines = t.split('\n');
  if (/^# /.test(lines[0])) {
    const rest = lines.slice(1);
    if (rest[0] !== '') rest.unshift('');
    return [lines[0], '', block.replace(/\n$/, ''), ...rest].join('\n');
  }
  return `${block}\n${t}`;
}

/* Conflict markers left in any Markdown file under specs/ (spec 025 FR-018): always an error, strict marker or not. "=======" alone is a Markdown heading underline, so it is not looked for. */
const CONFLICT_RE = /^(<<<<<<<|\|\|\|\|\|\|\||>>>>>>>)( |$)/;
function conflictMarkers(root = ROOT) {
  const found = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.md')) {
        read(p).split(/\r?\n/).forEach((l, i) => {
          if (CONFLICT_RE.test(l)) found.push(`${path.relative(root, p).split(path.sep).join('/')}:${i + 1}: a conflict marker was left in (${l.slice(0, 7)})`);
        });
      }
    }
  };
  walk(path.join(root, 'specs'));
  return found;
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

const row = (s) => `| [${s.num}](${s.dir}/spec.md) | ${s.meta.title} | ${s.meta.status}${s.meta.note ? `: ${s.meta.note}` : ''} |`;

/* The full index: specs/README.md's hand-written text with each marked table built from the blocks. { text, errors, committedRows }. */
function generate(root = ROOT) {
  const errors = [];
  let committedRows = 0;
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
    if (!m) { if (!STRICT_RE.test(lines[i])) out.push(lines[i]); continue; } // the markers themselves are not part of the index
    if (used.has(m[1])) errors.push(`specs/README.md: group ${m[1]} is marked twice`);
    used.add(m[1]);
    let j = i + 1;
    while (j < lines.length && lines[j].startsWith('|')) j++; // a table committed under the marker: replaced, and reported
    committedRows += j - i - 1;
    out.push(...HEADER, ...(groups.get(m[1]) || []).map(row));
    i = j - 1;
  }
  for (const g of groups.keys()) if (!used.has(g)) errors.push(`group "${g}" (used by ${groups.get(g).map((s) => s.num).join(', ')}) has no "<!-- specs-index group=${g} -->" line in specs/README.md`);
  return { text: out.join('\n'), errors, committedRows };
}

/* --check: { problems, strict }. */
function check(root = ROOT, { strict = false } = {}) {
  const readme = read(path.join(root, 'specs', 'README.md'));
  const { errors, committedRows } = generate(root);
  const problems = [...errors];
  for (const d of fs.readdirSync(path.join(root, 'specs'))) {
    const n = /^(\d{3})-/.exec(d);
    if (n && RETIRED.includes(n[1])) problems.push(`specs/${d}: ${retiredMsg(n[1])}`);
  }
  if (committedRows) problems.push(`specs/README.md has ${committedRows} table line(s) under its specs-index markers: the rows are generated, not committed. Move a hand-edited row into its spec with npm run specs:index -- --import`);
  return { problems, strict: strict || STRICT_RE.test(readme) };
}

/* --add: a draft block for a new spec (group of the newest spec that has one, title from the "# " line). */
function addBlock(root, dir) {
  const name = path.basename(path.resolve(root, dir));
  const spec = path.join(root, 'specs', name, 'spec.md');
  if (!/^\d{3}-/.test(name) || !fs.existsSync(spec)) throw new Error(`${dir}: not a specs/NNN-name folder with a spec.md`);
  if (RETIRED.includes(name.slice(0, 3))) throw new Error(`${dir}: ${retiredMsg(name.slice(0, 3))}`);
  const text = read(spec);
  if (parseBlock(text).meta) throw new Error(`specs/${name}/spec.md already has a block`);
  const newest = readSpecs(root).filter((s) => s.meta && s.meta.group && s.dir !== name).pop();
  const title = ((/^# (.*)$/m.exec(text) || [])[1] || name).replace(/^Feature Specification:\s*/i, '').trim();
  const meta = { group: newest ? newest.meta.group : 'index', title, status: 'draft' };
  fs.writeFileSync(spec, setBlock(text, meta));
  return meta;
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
      if (!group) {
        let id = groupId(heading);
        for (let n = 2; ids.has(id); n++) id = `${groupId(heading)}-${n}`;
        ids.add(id);
        group = id;
        out.push(`<!-- specs-index group=${id} -->`);
      }
      continue; // the table lines are not kept: the rows live in the blocks
    }
    const r = ROW_RE.exec(l);
    if (r && group) {
      if (r[2].slice(0, 3) !== r[1]) errors.push(`row ${r[1]} links to ${r[2]}`);
      if (rows.has(r[2])) errors.push(`${r[2]} has two rows (merge them first)`);
      const meta = { group, title: r[3].trim(), status: r[4].trim() };
      for (const e of valueErrors(meta)) errors.push(`row ${r[1]}: ${e}`);
      rows.set(r[2], meta);
      continue;
    }
    if (group && l.startsWith('|')) {
      if (l.startsWith('| [')) errors.push(`specs/README.md: a row the importer cannot read: "${l.slice(0, 70)}"`);
      if (l !== HEADER[1]) out.push(l);
      continue;
    }
    if (!l.startsWith('|')) group = null;
    out.push(l);
  }
  if (errors.length) return { readme: null, specs: rows.size, errors };
  for (const [dir, meta] of rows) {
    const spec = path.join(root, 'specs', dir, 'spec.md');
    if (!fs.existsSync(spec)) { errors.push(`row for ${dir}, which has no spec.md`); continue; }
    if (write) fs.writeFileSync(spec, setBlock(read(spec), meta));
  }
  if (write) fs.writeFileSync(file, out.join('\n'));
  return { readme: out.join('\n'), specs: rows.size, errors };
}

module.exports = { RETIRED, STATUSES, NOTE_MAX, parseBlock, setBlock, valueErrors, readSpecs, generate, check, conflictMarkers, addBlock, groupId, importIndex };

if (require.main === module) {
  const args = process.argv.slice(2);
  const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const root = arg('--root') ? path.resolve(arg('--root')) : ROOT;
  try {
    if (args.includes('--import')) {
      const r = importIndex(root);
      for (const e of r.errors) console.error(`error: ${e}`);
      console.log(r.errors.length ? 'nothing written' : `imported ${r.specs} row(s) into their spec.md and removed them from specs/README.md`);
      process.exit(r.errors.length ? 1 : 0);
    }
    if (arg('--add')) {
      const m = addBlock(root, arg('--add'));
      console.log(`block added: group ${m.group}, title "${m.title}", status ${m.status}`);
      process.exit(0);
    }
    if (args.includes('--check')) {
      const { problems, strict } = check(root, { strict: args.includes('--strict') });
      const markers = conflictMarkers(root);
      for (const m of markers) console.error(`error: ${m}`);
      if (markers.length) console.log(`specs:check: ${markers.length} conflict marker(s)`);
      for (const p of problems) console[strict ? 'error' : 'log'](`${strict ? 'error' : 'warning'}: ${p}`);
      if (problems.length && !strict) console.log('(warning only until specs/README.md has the line "<!-- specs-index: strict -->")');
      if (!markers.length) console.log(problems.length ? `specs:check: ${problems.length} problem(s)` : 'specs:check ok');
      process.exit((problems.length && strict) || markers.length ? 1 : 0);
    }
    const { text, errors } = generate(root);
    for (const e of errors) console.error(`error: ${e}`);
    if (args.includes('--print')) process.stdout.write(text);
    else { fs.writeFileSync(path.join(root, 'specs', 'INDEX.md'), text); console.log('wrote specs/INDEX.md (git-ignored)'); }
    process.exit(errors.length ? 1 : 0);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}
