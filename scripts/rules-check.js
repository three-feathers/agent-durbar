#!/usr/bin/env node
/*
 * Spec 021 FR-063 (retro #854, B2 and the C list: "one rule in, one rule out"): the rule files every agent reads have a word
 * budget. `npm run rules:check` (also the second step of `npm run test:rules`, so part of `npm test`) fails when a file is over
 * its budget or missing. A PR that needs more room deletes or merges text elsewhere first; raising a budget is a rule change
 * and goes through spec 021 like any other.
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
const BUDGETS = {
  'AGENTS.md': 3000,
  'CLAUDE.md': 150,
  '.github/copilot-instructions.md': 100,
  'docs/collaboration.md': 1150,
  'docs/agent-notes.md': 4600,
  'docs/review-checklist.md': 2450,
  'docs/agent-apps.md': 9000,
};

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
  return { rows, problems };
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
  console.log('rules:check: every rule file is within its word budget');
  return 0;
}

module.exports = { BUDGETS, countWords, check };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
