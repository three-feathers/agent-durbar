#!/usr/bin/env node
/*
 * Spec 021 FR-423 (harness series S2): the checkable half of "keep the PR template and docs consistent" (docs/rules/docs-sync.md).
 * `scripts/rules-check.js` calls check(root, budgets) next to the word budgets; one problem line per finding, "file:line: what".
 * Five checks, all plain Node, no shell, no network, CRLF-safe (lines split on \r?\n only, never on U+2028):
 *   path       a backticked repo path or a relative link in AGENTS.md, docs/rules/*.md exists (a line that names an unticked
 *              task passes: the file is planned, not built; placeholders NNN, <x>, *, {x} are skipped)
 *   pointer    a rule file's name (AGENTS.md or a docs/rules file) followed in the same sentence by `*Section*` must match a
 *              heading or a bold lead of that file; scanned only in files whose change already runs `npm test`: the budgeted
 *              files, docs/agent-setup/, .claude/, the PR template, docs/development.md, CONTRIBUTING.md
 *   invisible  U+2028, U+2029 or U+00A0 in a budgeted file (an editor or the Write tool put it there; it splits a word in two)
 *   label      a backticked label (needs-*, status:word, spec-exempt, docs-n/a) in the rule files, the constitution and
 *              CONTRIBUTING.md exists in .github/labels.tsv; LABEL_ALLOW lists the known exceptions, and a stale entry fails
 *   marker     a git conflict marker line in a budgeted file or under .claude/ (specs/ is covered by `npm run specs:check`)
 * Missing files are skipped here (rules-check.js reports a missing budgeted file itself).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { markersIn } = require('./specs-index.js');

const RULES_DIR = 'docs/rules';
const CONSTITUTION = '.specify/memory/constitution.md';
const POINTER_EXTRA = ['.github/pull_request_template.md', 'docs/development.md', 'CONTRIBUTING.md'];
const POINTER_DIRS = ['docs/agent-setup', '.claude'];
const LABEL_FILES = ['CONTRIBUTING.md', CONSTITUTION];
const PATH_ROOTS = ['scripts/', 'docs/', '.github/', '.claude/', '.specify/', 'src/'];
// label -> [file, reason]: the constitution names `needs-approval`, the label that exists is needs-owner-approval (owner question 12)
const LABEL_ALLOW = { 'needs-approval': [CONSTITUTION, "owners' amendment pending"] };
// built from code points: a typed or escaped literal turns into the raw character in some editors (docs/agent-notes.md)
const INVISIBLE = [8232, 8233, 160].map((c) => ({ ch: String.fromCharCode(c), name: `U+${c.toString(16).toUpperCase().padStart(4, '0')}` }));

const lines = (t) => String(t).split(/\r?\n/);
function read(root, rel) {
  try {
    return fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
  } catch {
    return null;
  }
}
function walk(root, rel, out = []) {
  let ents = [];
  try {
    ents = fs.readdirSync(path.join(root, ...rel.split('/')), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) walk(root, r, out);
    else if (e.isFile() && /\.(md|template)$/.test(e.name)) out.push(r);
  }
  return out;
}
function ruleFiles(root) {
  const dir = path.join(root, ...RULES_DIR.split('/'));
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  } catch {
    // none
  }
  return ['AGENTS.md', ...names.map((f) => `${RULES_DIR}/${f}`)];
}
// every regex metacharacter and the backslash itself, so a file name is matched literally (CodeQL js/incomplete-sanitization)
const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

function unticked(root) {
  const ids = new Set();
  const dir = path.join(root, 'specs');
  let specs = [];
  try {
    specs = fs.readdirSync(dir);
  } catch {
    return ids;
  }
  for (const s of specs) {
    const t = read(root, `specs/${s}/tasks.md`);
    if (t) for (const l of lines(t)) { const m = /^\s*- \[ \] (T\d+)/.exec(l); if (m) ids.add(m[1]); }
  }
  return ids;
}

function checkPaths(root, files, problems) {
  const open = unticked(root);
  for (const f of files) {
    const t = read(root, f);
    if (t === null) continue;
    lines(t).forEach((l, i) => {
      if ((l.match(/\bT\d{3,}\b/g) || []).some((id) => open.has(id))) return;
      const cands = [];
      for (const m of l.matchAll(/`([^`\s]+)`/g)) cands.push({ raw: m[1], rel: PATH_ROOTS.some((p) => m[1].startsWith(p)) });
      for (const m of l.matchAll(/\]\(([^)\s]+)\)/g)) if (!/^([a-z]+:|#|mailto:)/i.test(m[1])) cands.push({ raw: m[1], rel: true, link: true });
      for (const c of cands) {
        if (!c.rel || /[<>*{}$|]|NNN|nnn|\.\.\.|\\/.test(c.raw)) continue;
        let p = c.raw.replace(/#.*$/, '').replace(/:\d+(-\d+)?$/, '');
        if (!p || !/^[\w.\-/]+$/.test(p)) continue;
        const base = c.link ? path.posix.dirname(f) : '.';
        const target = path.posix.normalize(path.posix.join(base, p));
        if (target.startsWith('..')) continue;
        if (!fs.existsSync(path.join(root, ...target.split('/')))) problems.push(`${f}:${i + 1}: path \`${c.raw}\` does not exist (harness-refs path check, spec 021 FR-423)`);
      }
    });
  }
}

function sectionsOf(text) {
  const out = [];
  for (const l of lines(text)) {
    const h = /^#{1,6}\s+(.*?)\s*#*$/.exec(l);
    if (h) out.push(norm(h[1].replace(/[*`_]/g, '')));
    for (const b of l.matchAll(/\*\*([^*]+)\*\*/g)) out.push(norm(b[1]));
  }
  return out.filter(Boolean);
}

function checkPointers(root, files, rules, problems) {
  const heads = new Map();
  for (const r of rules) heads.set(r, sectionsOf(read(root, r) || ''));
  const names = rules.map((r) => r.replace(/^docs\/rules\//, '')).map(escapeRegExp);
  const mention = new RegExp(`(?:docs/rules/)?(?:${names.join('|')})`, 'g');
  for (const f of files) {
    const t = read(root, f);
    if (t === null) continue;
    lines(t).forEach((l, i) => {
      const hits = [...l.matchAll(mention)];
      hits.forEach((m, k) => {
        const target = rules.find((r) => r === m[0] || r.endsWith(`/${m[0]}`));
        if (!target || !heads.get(target).length) return;
        const start = m.index + m[0].length;
        let seg = l.slice(start, hits[k + 1] ? hits[k + 1].index : l.length);
        const stop = /;|\.(\s|$)/.exec(seg);
        if (stop) seg = seg.slice(0, stop.index);
        for (const s of seg.matchAll(/(?<![*\w])\*([^*\n]+)\*(?!\*)/g)) {
          const want = norm(s[1]);
          if (!want) continue;
          if (!heads.get(target).some((h) => h === want || h.startsWith(`${want} `) || want.startsWith(`${h} `))) {
            problems.push(`${f}:${i + 1}: pointer *${s[1]}* is no heading or bold lead of ${target} (harness-refs pointer check, spec 021 FR-423)`);
          }
        }
      });
    });
  }
}

function checkInvisible(root, files, problems) {
  for (const f of files) {
    const t = read(root, f);
    if (t === null) continue;
    lines(t).forEach((l, i) => {
      for (const c of INVISIBLE) if (l.includes(c.ch)) problems.push(`${f}:${i + 1}: invisible character ${c.name}: write it as plain text (harness-refs invisible check, spec 021 FR-423)`);
    });
  }
}

function checkMarkers(root, files, problems) {
  for (const f of files) {
    const t = read(root, f);
    if (t === null) continue;
    for (const m of markersIn(t)) problems.push(`${f}:${m.line}: a conflict marker was left in (${m.text}) (harness-refs marker check, spec 021 FR-423)`);
  }
}

function checkLabels(root, files, problems) {
  const tsv = read(root, '.github/labels.tsv');
  if (tsv === null) return;
  const known = new Set(lines(tsv).filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t')[0]));
  const used = new Set();
  for (const f of files) {
    const t = read(root, f);
    if (t === null) continue;
    lines(t).forEach((l, i) => {
      for (const m of l.matchAll(/`((?:needs-[a-z-]+|status:[a-z-]+|spec-exempt|docs-n\/a))`/g)) {
        const lab = m[1];
        if (known.has(lab)) continue;
        if (LABEL_ALLOW[lab] && LABEL_ALLOW[lab][0] === f) { used.add(lab); continue; }
        problems.push(`${f}:${i + 1}: label \`${lab}\` is not in .github/labels.tsv (harness-refs label check, spec 021 FR-423)`);
      }
    });
  }
  for (const [lab, [file, why]] of Object.entries(LABEL_ALLOW)) {
    const t = read(root, file);
    if (t === null) continue; // a checkout without the file has nothing to allow
    if (known.has(lab) || !used.has(lab)) problems.push(`scripts/harness-refs.js: LABEL_ALLOW entry \`${lab}\` (${why}) is no longer needed: delete it (harness-refs label check, spec 021 FR-423)`);
  }
}

// -> [problem line]
function check(root, budgets = {}) {
  const problems = [];
  const rules = ruleFiles(root);
  const budgeted = Object.keys(budgets);
  const pointerFiles = [...new Set([...budgeted, ...rules, ...POINTER_EXTRA, ...POINTER_DIRS.flatMap((d) => walk(root, d))])];
  checkPaths(root, rules, problems);
  checkPointers(root, pointerFiles, rules, problems);
  checkInvisible(root, budgeted, problems);
  checkLabels(root, [...new Set([...rules, ...LABEL_FILES])], problems);
  checkMarkers(root, [...new Set([...budgeted, ...walk(root, '.claude')])], problems);
  return problems;
}

module.exports = { escapeRegExp, LABEL_ALLOW, INVISIBLE, check, sectionsOf };
if (require.main === module) {
  const i = process.argv.indexOf('--root');
  const root = i >= 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : path.join(__dirname, '..');
  const problems = check(root, require('./rules-check.js').BUDGETS);
  for (const p of problems) console.error(`harness-refs: ${p}`);
  process.exitCode = problems.length ? 1 : 0;
}
