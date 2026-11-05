#!/usr/bin/env node
/*
 * Spec 021 FR-063 (retro #854, B2 and the C list: "one rule in, one rule out"): the rule files every agent reads have a word
 * budget. `npm run rules:check` (also the second step of `npm run test:rules`, so part of `npm test`) fails when a file is over
 * its budget or missing. A PR that needs more room deletes or merges text elsewhere first; raising a budget is a rule change
 * and goes through spec 021 like any other.
 *
 * FR-082 (2026-11-04): AGENTS.md is the always-loaded core with a lower cap; task rules live in `docs/rules/*.md`, each with
 * its own budget. Every `docs/rules/*.md` file must have a budget here, carry the rule-text header (RULE_HEADER) and be linked
 * from AGENTS.md as `](docs/rules/<name>.md)`, so no task file is orphaned or read as guidance; AGENTS.md plus `docs/rules/`
 * together stay under TOTAL_CAP.
 *
 * Words are counted like `wc -w`: runs of non-whitespace. Plain Node, no shell, no network; paths with path.join.
 *
 *   node scripts/rules-check.js            check this repository, print each file's words and budget
 *   node scripts/rules-check.js --root D   check another checkout (tests)
 */
'use strict';
const fs = require('fs');
const path = require('path');

// file (relative to the repository root, forward slashes) -> maximum words; set 2026-10-29 at about 10% above the slimmed files
// docs/rules/* set 2026-11-04 (FR-082) at about 10% above the split files; AGENTS.md lowered from 3000 to the core cap
const BUDGETS = {
  'AGENTS.md': 2000,
  'docs/rules/incident-triage.md': 240,
  'docs/rules/merge-mechanics.md': 290,
  'docs/rules/review-rounds.md': 680,
  'docs/rules/chat-and-decisions.md': 180,
  'docs/rules/docs-sync.md': 290,
  'CLAUDE.md': 150,
  '.github/copilot-instructions.md': 100,
  'docs/collaboration.md': 1150,
  'docs/agent-notes.md': 4600,
  'docs/review-checklist.md': 2450,
  'docs/agent-apps.md': 9000,
};

const RULES_DIR = 'docs/rules';
const RULE_HEADER = 'This file is rule text, part of [AGENTS.md](../../AGENTS.md)';
const TOTAL_CAP = 3500; // AGENTS.md + docs/rules/*.md: the split may not grow the rule text past this

function countWords(text) {
  const m = String(text).match(/\S+/g);
  return m ? m.length : 0;
}

// -> { rows: [{ file, words, budget, ok }], problems: [string] }
function check(root, budgets = BUDGETS) {
  const rows = [];
  const problems = [];
  for (const [file, budget] of Object.entries(budgets)) {
    const p = path.join(root, ...file.split('/'));
    let text;
    try {
      text = fs.readFileSync(p, 'utf8');
    } catch (e) {
      problems.push(`${file}: missing (${e.code || e.message})`);
      rows.push({ file, words: null, budget, ok: false });
      continue;
    }
    const words = countWords(text);
    const ok = words <= budget;
    if (!ok) problems.push(`${file}: ${words} words, budget ${budget} (over by ${words - budget}): delete or merge text before adding (one rule in, one rule out)`);
    rows.push({ file, words, budget, ok });
  }
  rulesFiles(root, budgets, rows, problems);
  return { rows, problems };
}

// FR-082: the task files of docs/rules/ (only when the budget table has any, so fixtures without them stay simple)
function rulesFiles(root, budgets, rows, problems) {
  const budgeted = Object.keys(budgets).filter((f) => f.startsWith(`${RULES_DIR}/`));
  if (!budgeted.length) return;
  let present = [];
  try {
    present = fs.readdirSync(path.join(root, ...RULES_DIR.split('/'))).filter((f) => f.endsWith('.md')).map((f) => `${RULES_DIR}/${f}`);
  } catch {
    // each budgeted file already reports itself missing
  }
  for (const f of present) if (!(f in budgets)) problems.push(`${f}: a rule file with no word budget: add it to BUDGETS in scripts/rules-check.js (spec 021 FR-082)`);
  let core = '';
  try {
    core = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  } catch {
    // reported above
  }
  for (const f of [...new Set([...budgeted, ...present])]) {
    let text;
    try {
      text = fs.readFileSync(path.join(root, ...f.split('/')), 'utf8');
    } catch {
      continue;
    }
    if (!core.includes(`](${f})`)) problems.push(`${f}: not linked from AGENTS.md (a pointer line "](${f})" is required, spec 021 FR-082)`);
    if (!text.includes(RULE_HEADER)) problems.push(`${f}: missing the rule-text header "${RULE_HEADER} ..." (spec 021 FR-082)`);
  }
  const ruleRows = rows.filter((r) => (r.file === 'AGENTS.md' || r.file.startsWith(`${RULES_DIR}/`)) && r.words !== null);
  const extra = present.filter((f) => !(f in budgets)).map((f) => {
    try {
      return countWords(fs.readFileSync(path.join(root, ...f.split('/')), 'utf8'));
    } catch {
      return 0;
    }
  });
  const total = ruleRows.reduce((n, r) => n + r.words, 0) + extra.reduce((n, w) => n + w, 0);
  if (total > TOTAL_CAP) problems.push(`AGENTS.md + ${RULES_DIR}/: ${total} words, cap ${TOTAL_CAP} (over by ${total - TOTAL_CAP}): delete or merge text before adding (one rule in, one rule out)`);
}

function main(argv) {
  const i = argv.indexOf('--root');
  const root = i >= 0 && argv[i + 1] ? path.resolve(argv[i + 1]) : path.join(__dirname, '..');
  const { rows, problems } = check(root);
  for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'OVER'} ${String(r.words ?? '-').padStart(5)} / ${String(r.budget).padStart(5)}  ${r.file}`);
  if (problems.length) {
    for (const p of problems) console.error(`rules:check: ${p}`);
    return 1;
  }
  console.log('rules:check: every rule file is within its word budget; every docs/rules file is linked from AGENTS.md');
  return 0;
}

module.exports = { BUDGETS, RULES_DIR, RULE_HEADER, TOTAL_CAP, countWords, check };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
